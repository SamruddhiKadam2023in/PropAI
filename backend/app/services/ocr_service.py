"""
OCR Service — validated file storage plus background OCR + NLP processing.

Reuses the existing pipelines (app.ml.ocr_pipeline / app.ml.nlp_pipeline); no
second OCR engine. Uploaded originals are stored untouched under
uploads/documents/<user_id>/<uuid><ext> and are never served statically — they
are only reachable through the authenticated /documents/{id}/file endpoint.
"""
import asyncio
import importlib.util
import logging
import os
import time
import uuid
from datetime import datetime, timezone
from typing import Optional, Tuple

import aiofiles
from fastapi import HTTPException, UploadFile
from PIL import Image

from app.config import settings
from app.database import AsyncSessionLocal, get_mongo_db
from app.ml.bill_pipeline import analyze_bill
from app.ml.nlp_pipeline import run_nlp_pipeline
from app.ml.ocr_pipeline import run_ocr_pipeline
from app.models.document import Document, DocumentStatus, DocumentType

logger = logging.getLogger(__name__)

ALLOWED_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "application/pdf": ".pdf",
}
EXT_TO_MIME = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
    ".webp": "image/webp", ".pdf": "application/pdf",
}
UNSUPPORTED_MSG = "Unsupported file type. Please upload a PDF, JPG, PNG or WebP file."

OCR_TIMEOUT_SECONDS = 120
OCR_BUDGET_SECONDS = 60            # the hybrid reader stops adding OCR passes after this long (it always returns what it has)
MAX_IMAGE_PIXELS = 50_000_000
STARTED_KEY = "_processing_started_at"   # internal marker kept inside extracted_data while processing


class _OcrFailure(Exception):
    """A processing failure whose message is safe to show to the user."""


# ── Upload validation & storage ───────────────────────────────────────────────

def sniff_mime(head: bytes) -> Optional[str]:
    """Identify the real file type from its leading bytes (the client-declared type is not trusted)."""
    if head.startswith(b"%PDF-"):
        return "application/pdf"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if head.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    return None


def clean_filename(name: Optional[str]) -> str:
    """Display-only name: no path components or control characters."""
    base = os.path.basename((name or "").replace("\\", "/"))
    base = "".join(ch for ch in base if ch.isprintable() and ch not in '<>:"|?*').strip(" .")
    return base[:120] or "document"


def _check_image(path: str) -> None:
    try:
        with Image.open(path) as im:
            width, height = im.size
    except Exception:
        raise HTTPException(status_code=400, detail="This file could not be read as an image. It may be corrupted.")
    if width * height > MAX_IMAGE_PIXELS:
        raise HTTPException(status_code=400, detail="Image resolution is too large. Please upload a smaller image.")


def remove_file(path: Optional[str]) -> None:
    if path:
        try:
            os.remove(path)
        except OSError:
            pass


async def save_upload(file: UploadFile, user_id: int) -> Tuple[str, str, str, int]:
    """
    Stream the upload to disk, enforcing type, size and basic integrity.
    Returns (stored_path, display_name, mime_type, size_bytes). Raises HTTPException.
    """
    dest_dir = os.path.join(settings.UPLOAD_DIR, "documents", str(user_id))
    os.makedirs(dest_dir, exist_ok=True)
    tmp_path = os.path.join(dest_dir, f".{uuid.uuid4().hex}.part")
    size, mime = 0, None
    try:
        async with aiofiles.open(tmp_path, "wb") as out:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                if size == 0:
                    mime = sniff_mime(chunk[:16])
                    if mime is None:
                        raise HTTPException(status_code=415, detail=UNSUPPORTED_MSG)
                size += len(chunk)
                if size > settings.MAX_FILE_SIZE:
                    limit_mb = settings.MAX_FILE_SIZE // (1024 * 1024)
                    raise HTTPException(status_code=413, detail=f"File is too large. The maximum size is {limit_mb} MB.")
                await out.write(chunk)

        if size == 0:
            raise HTTPException(status_code=400, detail="The file is empty.")
        if mime != "application/pdf":
            _check_image(tmp_path)

        final_path = os.path.join(dest_dir, f"{uuid.uuid4().hex}{ALLOWED_TYPES[mime]}")
        os.replace(tmp_path, final_path)
        return final_path.replace(os.sep, "/"), clean_filename(file.filename), mime, size
    except BaseException:
        remove_file(tmp_path)
        raise


def resolve_stored_path(file_url: Optional[str]) -> Optional[str]:
    """Absolute path of a stored file, only if it exists inside the uploads directory."""
    if not file_url:
        return None
    root = os.path.realpath(settings.UPLOAD_DIR)
    path = os.path.realpath(file_url)
    if not path.startswith(root + os.sep) or not os.path.isfile(path):
        return None
    return path


def mime_for_path(path: Optional[str]) -> Optional[str]:
    return EXT_TO_MIME.get(os.path.splitext(path or "")[1].lower())


# ── Background OCR + NLP ──────────────────────────────────────────────────────

def _now() -> datetime:
    return datetime.now(timezone.utc)


def processing_marker() -> dict:
    return {STARTED_KEY: _now().isoformat()}


def _friendly_error(technical: Optional[str]) -> str:
    t = (technical or "").lower()
    if any(k in t for k in ("cannot read", "cannot convert", "pdfium", "load document", "decode", "corrupt", "password")):
        return "The file couldn't be opened. It may be corrupted or password-protected."
    if "not found" in t:
        return "The stored file could not be found."
    return "Text extraction failed. Please try again, or upload a clearer copy."


async def _load_ocr_settings() -> Tuple[str, float]:
    engine, threshold = "auto", settings.CONFIDENCE_THRESHOLD
    try:
        cfg = await get_mongo_db()["ocr_config"].find_one({}, {"_id": 0}) or {}
        engine = cfg.get("ocr_engine", engine)
        threshold = float(cfg.get("confidence_threshold", threshold))
    except Exception as exc:
        logger.warning(f"OCR config unavailable, using defaults: {exc}")
    if engine == "easyocr" and importlib.util.find_spec("easyocr") is None:
        logger.warning("EasyOCR selected but not installed; falling back to auto.")
        engine = "auto"
    return engine, threshold


async def _mark_failed(document_id: int, message: str) -> None:
    try:
        async with AsyncSessionLocal() as db:
            doc = await db.get(Document, document_id)
            if doc:
                doc.status = DocumentStatus.FAILED
                doc.extracted_data = {"error": message}
                doc.confidence_score = None
                doc.processed_at = _now()
                await db.commit()
    except Exception:
        logger.exception(f"Could not record failure for document {document_id}")


async def process_document_background(document_id: int, file_path: str) -> None:
    """OCR → NLP → confidence gate → persist. Uses its own DB session (the request's is gone)."""
    try:
        async with AsyncSessionLocal() as db:
            doc = await db.get(Document, document_id)
            if not doc:
                return
            doc.status = DocumentStatus.PROCESSING
            doc.extracted_data = processing_marker()
            await db.commit()
            corrected = dict(doc.corrected_data or {})

            engine, threshold = await _load_ocr_settings()

            analysis = None
            stage_started = time.time()
            logger.info(f"Document {document_id}: reading started (engine setting: {engine})")
            if engine != "easyocr":                     # the hybrid English+Marathi reader is the default; EasyOCR stays an explicit choice
                try:
                    analysis = await asyncio.wait_for(
                        asyncio.to_thread(analyze_bill, file_path, OCR_BUDGET_SECONDS), timeout=OCR_TIMEOUT_SECONDS
                    )
                except asyncio.TimeoutError:
                    raise
                except Exception:
                    logger.exception(f"Hybrid OCR crashed for document {document_id}; using the classic pipeline")
                if analysis and (analysis.get("error") or not (analysis.get("text") or "").strip()):
                    logger.warning(f"Hybrid OCR gave nothing for document {document_id} ({analysis.get('error')}); using the classic pipeline")
                    analysis = None

            if analysis:
                raw_text = analysis["text"].strip()
                ocr = {"confidence": analysis["ocr_confidence"], "ocr_engine": analysis["ocr_engine"]}
            else:
                ocr = await asyncio.wait_for(
                    asyncio.to_thread(run_ocr_pipeline, file_path, engine), timeout=OCR_TIMEOUT_SECONDS
                )
                if ocr.get("error"):
                    logger.error(f"OCR error for document {document_id}: {ocr['error']}")
                    raise _OcrFailure(_friendly_error(ocr["error"]))
                raw_text = (ocr.get("text") or "").strip()
            if not raw_text:
                raise _OcrFailure("No readable text was found in this document. Try a clearer photo or a PDF.")

            logger.info(f"Document {document_id}: reading finished in {time.time() - stage_started:.1f}s")
            nlp = await asyncio.to_thread(run_nlp_pipeline, raw_text)
            logger.info(f"Document {document_id}: NLP finished, {time.time() - stage_started:.1f}s since reading started")     # entities, and the fallback for anything the hybrid reader could not find
            if analysis:
                combined = analysis["confidence"]
                type_value = analysis.get("document_type") or nlp.get("document_type", "other")
            else:
                combined = round(ocr.get("confidence", 0.0) * 0.6 + nlp.get("confidence", 0.0) * 0.4, 4)
                type_value = nlp.get("document_type", "other")

            try:
                doc_type = DocumentType(type_value)
            except ValueError:
                doc_type = DocumentType.OTHER

            def pick(key):
                if not analysis:
                    return nlp.get(key)
                mine = analysis.get(key)
                if mine is not None:
                    return mine
                # The hybrid reader leaves a field EMPTY on purpose when it is not sure. The generic NLP guess on unreadable text is
                # noise ('77.37', '10598 2 OUND OF'), so an amount or date is never back-filled from it; a vendor name only when the
                # text itself was read well.
                if key == "vendor" and analysis.get("ocr_confidence", 0) >= 0.7:
                    return nlp.get(key)
                return None

            final_data = {
                "amount":     pick("amount"),
                "date":       pick("date"),
                "vendor":     pick("vendor"),
                "entities":   nlp.get("entities", []),
                "ocr_engine": ocr.get("ocr_engine", "tesseract"),
            }
            if analysis:                                # richer fields only the hybrid reader can provide
                final_data.update({
                    "address":        analysis.get("address"),
                    "customer_name":  analysis.get("customer_name"),
                    "due_date":       analysis.get("due_date"),
                    "bill_period":    analysis.get("bill_period"),
                    "is_duplicate":   analysis.get("is_duplicate") or None,
                    "ocr_languages":  analysis.get("languages"),
                    "ocr_seconds":    analysis.get("seconds"),
                    "low_resolution": analysis.get("low_resolution") or None,
                    "image_width":    analysis.get("image_width") or None,
                })
                final_data = {k: v for k, v in final_data.items() if v is not None}
            for key, value in corrected.items():          # user corrections always win
                if value is not None:
                    final_data[key] = value

            status = DocumentStatus.COMPLETED if combined >= threshold else DocumentStatus.FLAGGED

            doc.raw_ocr_text = raw_text
            doc.extracted_data = final_data
            doc.confidence_score = combined
            doc.document_type = doc_type
            doc.status = status
            doc.processed_at = _now()
            await db.commit()
            user_id = doc.user_id

        logger.info(f"Document {document_id} processed | engine={ocr.get('ocr_engine')} | "
                    f"confidence={combined:.2f} | status={status.value}")

        try:
            from app.routers.notifications import push_notification
            label = "processed successfully" if status == DocumentStatus.COMPLETED else "flagged for review"
            await push_notification(
                user_id, "ocr_complete", "Document Processed",
                f"Your {doc_type.value.replace('_', ' ').title()} was {label} "
                f"(confidence: {combined * 100:.0f}%, engine: {ocr.get('ocr_engine', 'tesseract')}).",
            )
        except Exception:
            logger.warning("Could not push OCR completion notification", exc_info=True)

    except _OcrFailure as failure:
        await _mark_failed(document_id, str(failure))
    except asyncio.TimeoutError:
        logger.error(f"OCR timed out for document {document_id}")
        await _mark_failed(document_id, "Processing took too long. Please retry, or upload a smaller or clearer file.")
    except Exception:
        logger.exception(f"Background processing failed for document {document_id}")
        await _mark_failed(document_id, "Something went wrong while reading this document. Please retry.")
