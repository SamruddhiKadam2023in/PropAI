from datetime import datetime, timedelta, timezone
from typing import List, Optional
import logging
import os

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.document import Document, DocumentStatus, DocumentType
from app.models.property_model import Property
from app.models.user import User, UserRole
from app.schemas.document import DocumentCorrection, DocumentResponse
from app.services.ocr_service import (
    STARTED_KEY, mime_for_path, process_document_background, processing_marker,
    remove_file, resolve_stored_path, save_upload,
)
from app.utils.cache import invalidate_pattern
from app.utils.dependencies import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/documents", tags=["Documents"])

PROCESSING_STALE_AFTER = timedelta(minutes=10)
ACTIVE_STATUSES = (DocumentStatus.PENDING, DocumentStatus.PROCESSING)


# ── helpers ───────────────────────────────────────────────────────────────────

def serialize(doc: Document) -> DocumentResponse:
    """API representation: hides the disk path and internal processing markers."""
    data = dict(doc.extracted_data or {})
    error = data.pop("error", None) if doc.status == DocumentStatus.FAILED else None
    data.pop(STARTED_KEY, None)
    path = resolve_stored_path(doc.file_url)
    return DocumentResponse(
        id=doc.id,
        filename=doc.filename,
        file_url=f"/documents/{doc.id}/file",
        document_type=doc.document_type,
        status=doc.status,
        raw_ocr_text=doc.raw_ocr_text,
        extracted_data=data or None,
        corrected_data=doc.corrected_data,
        confidence_score=doc.confidence_score,
        uploaded_at=doc.uploaded_at,
        processed_at=doc.processed_at,
        property_id=doc.property_id,
        user_id=doc.user_id,
        mime_type=mime_for_path(path),
        file_size=os.path.getsize(path) if path else None,
        file_available=path is not None,
        error_message=error,
    )


def _started_at(doc: Document) -> Optional[datetime]:
    raw = (doc.extracted_data or {}).get(STARTED_KEY)
    try:
        return datetime.fromisoformat(raw) if raw else None
    except ValueError:
        return None


async def _expire_stale(db: AsyncSession, docs: List[Document]) -> None:
    """A document stuck in pending/processing (e.g. server restarted mid-OCR) becomes 'failed' so it can be retried."""
    now, changed = datetime.now(timezone.utc), False
    for doc in docs:
        if doc.status in ACTIVE_STATUSES:
            started = _started_at(doc) or doc.uploaded_at
            if started and now - started > PROCESSING_STALE_AFTER:
                doc.status = DocumentStatus.FAILED
                doc.extracted_data = {"error": "Processing timed out. Please retry."}
                doc.processed_at = now
                changed = True
    if changed:
        await db.commit()


async def _get_document(
    doc_id: int, user: User, db: AsyncSession, *, allow_staff: bool = False,
) -> Document:
    """
    Load a document the caller is allowed to see, else 404 (so other users' ids can't be probed).
    The uploader always has access. With allow_staff, a manager, or the owner of the property
    the document is attached to, may also read it.
    """
    doc = await db.get(Document, doc_id)
    if doc is not None:
        if doc.user_id == user.id:
            return doc
        if allow_staff:
            if user.role == UserRole.MANAGER:
                return doc
            if user.role == UserRole.OWNER and doc.property_id:
                prop = await db.get(Property, doc.property_id)
                if prop is not None and prop.owner_id == user.id:
                    return doc
    raise HTTPException(status_code=404, detail="Document not found")


async def _resolve_property(db: AsyncSession, user: User, property_id: Optional[int]) -> Optional[int]:
    """Attach an upload only to a property the caller actually belongs to."""
    if user.role == UserRole.TENANT:
        q = select(Property).where(Property.tenant_id == user.id)
        if property_id is not None:
            q = q.where(Property.id == property_id)
        prop = (await db.execute(q.order_by(Property.id))).scalars().first()
        if property_id is not None and prop is None:
            raise HTTPException(status_code=400, detail="You can only attach documents to your own property.")
        return prop.id if prop else None

    if property_id is None:
        return None
    prop = await db.get(Property, property_id)
    if prop is None:
        raise HTTPException(status_code=400, detail="Property not found.")
    if user.role == UserRole.OWNER and prop.owner_id != user.id:
        raise HTTPException(status_code=400, detail="You can only attach documents to your own properties.")
    return prop.id


# ── endpoints ─────────────────────────────────────────────────────────────────

@router.post("/upload", response_model=DocumentResponse, status_code=201)
async def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    property_id: Optional[int] = Form(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    linked_property = await _resolve_property(db, current_user, property_id)
    stored_path, display_name, _mime, _size = await save_upload(file, current_user.id)

    doc = Document(
        filename=display_name,
        file_url=stored_path,
        user_id=current_user.id,
        property_id=linked_property,
        status=DocumentStatus.PENDING,
        extracted_data=processing_marker(),
    )
    try:
        db.add(doc)
        await db.commit()
        await db.refresh(doc)
    except Exception:
        logger.exception("Could not save document record")
        remove_file(stored_path)
        raise HTTPException(status_code=500, detail="Could not save the document. Please try again.")

    background_tasks.add_task(process_document_background, doc.id, stored_path)
    await invalidate_pattern(f"dashboard:{current_user.id}:*")
    return serialize(doc)


@router.get("/", response_model=List[DocumentResponse])
async def list_documents(
    status: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = select(Document).where(Document.user_id == current_user.id)
    if status:
        try:
            q = q.where(Document.status == DocumentStatus(status))
        except ValueError:
            pass
    q = q.order_by(Document.uploaded_at.desc())
    docs = (await db.execute(q)).scalars().all()
    await _expire_stale(db, docs)
    return [serialize(d) for d in docs]


@router.get("/{doc_id}", response_model=DocumentResponse)
async def get_document(
    doc_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    doc = await _get_document(doc_id, current_user, db, allow_staff=True)
    await _expire_stale(db, [doc])
    return serialize(doc)


@router.get("/{doc_id}/file")
async def get_document_file(
    doc_id: int,
    download: bool = False,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """The original, unmodified upload. Same access rules as the document itself."""
    doc = await _get_document(doc_id, current_user, db, allow_staff=True)
    path = resolve_stored_path(doc.file_url)
    if path is None:
        raise HTTPException(status_code=404, detail="The original file is no longer available.")
    mime = mime_for_path(path)
    return FileResponse(
        path,
        media_type=mime or "application/octet-stream",
        filename=doc.filename or os.path.basename(path),
        content_disposition_type="attachment" if (download or mime is None) else "inline",
        headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store"},
    )


@router.patch("/{doc_id}/correct", response_model=DocumentResponse)
async def correct_document(
    doc_id: int,
    body: DocumentCorrection,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """User corrects OCR fields. Corrections override extracted data."""
    doc = await _get_document(doc_id, current_user, db)
    if doc.status not in (DocumentStatus.COMPLETED, DocumentStatus.FLAGGED):
        raise HTTPException(status_code=409, detail="This document can't be edited until it has finished processing.")

    corrections = body.model_dump(exclude_none=True)
    if "amount" in corrections and corrections["amount"] < 0:
        raise HTTPException(status_code=400, detail="Amount can't be negative.")
    if "document_type" in corrections:
        try:
            doc.document_type = DocumentType(corrections["document_type"])
        except ValueError:
            raise HTTPException(status_code=400, detail="Unknown document type.")

    existing = dict(doc.corrected_data or {})
    existing.update(corrections)
    doc.corrected_data = existing

    merged = dict(doc.extracted_data or {})
    merged.update(existing)
    doc.extracted_data = merged
    doc.status = DocumentStatus.COMPLETED

    await db.commit()
    await db.refresh(doc)
    return serialize(doc)


@router.post("/{doc_id}/reprocess", response_model=DocumentResponse)
async def reprocess_document(
    doc_id: int,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Run OCR again on the stored original (e.g. after a failure)."""
    doc = await _get_document(doc_id, current_user, db)
    if doc.status in ACTIVE_STATUSES:
        raise HTTPException(status_code=409, detail="This document is already being processed.")
    path = resolve_stored_path(doc.file_url)
    if path is None:
        raise HTTPException(status_code=404, detail="The original file is no longer available.")

    doc.status = DocumentStatus.PENDING
    doc.extracted_data = processing_marker()
    doc.raw_ocr_text = None
    doc.confidence_score = None
    doc.processed_at = None
    await db.commit()
    await db.refresh(doc)

    background_tasks.add_task(process_document_background, doc.id, path)
    return serialize(doc)


@router.delete("/{doc_id}", status_code=204)
async def delete_document(
    doc_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    doc = await db.get(Document, doc_id)
    if doc is None or (doc.user_id != current_user.id and current_user.role != UserRole.MANAGER):
        raise HTTPException(status_code=404, detail="Document not found")

    remove_file(resolve_stored_path(doc.file_url))
    await db.delete(doc)
    await db.commit()
