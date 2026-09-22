"""
One call that turns a bill image / PDF into structured data: text -> fields -> address -> confidence.

    analysis = analyze_bill(path, budget_seconds=60)

A PDF that already has a real, selectable text layer (a bill downloaded from a utility's website) is read from that text directly -
no OCR, no misread digits, exact even in Marathi. Everything else (photos, scans, screenshots) goes through the hybrid OCR engine
(English + Marathi).

Returns a plain dict (JSON-friendly). Never raises for trouble: `error` is set instead, and the caller can fall back to the classic
pipeline. The confidence reflects EVIDENCE that the fields are right (labels found, passes/characters agreeing, structure valid), not
just per-word certainty, which is low on small photographed bills even when every field is correct.
"""
import logging
import time
from typing import Any, Dict, List, Optional

from app.config import settings
from app.ml.address_extractor import extract_address
from app.ml.bill_extractor import core_is_sufficient, core_is_sufficient_lite, extract_core
from app.ml.hybrid_ocr import Line, extract_pdf_text_lines, run_hybrid_ocr

logger = logging.getLogger(__name__)

LOW_RESOLUTION_WIDTH = 1000     # a full bill page this narrow MAY have text only a few pixels tall (a small photo with big text still reads fine)


def reading_text(lines: List[Line]) -> str:
    """
    A human-readable transcript for storage / display: the single pass/source that read the most, in page order.
    (All OCR passes together contain every line several times over, which is useful for voting but unreadable.)
    """
    by_source: Dict[str, List[Line]] = {}
    for l in lines:
        by_source.setdefault(l.source, []).append(l)
    if not by_source:
        return ""

    def quality(ls: List[Line]) -> float:
        good = [c.conf for l in ls for c in l.cells if c.conf >= 40 and len(c.text) >= 2]
        return len(good) * (sum(good) / len(good) if good else 0)

    best = max(by_source.values(), key=quality)
    return "\n".join(l.text for l in sorted(best, key=lambda l: (l.page, l.y)))


def _slashed(value):
    """The app shows and edits dates as DD/MM/YYYY (see the correction form); the extractor works in DD-MM-YYYY internally."""
    return value.replace("-", "/") if isinstance(value, str) else value


def extraction_score(core: Dict[str, Any], address: Dict[str, Any]) -> float:
    """0-1 evidence that the extracted fields are right."""
    score = 0.0
    if core.get("document_type"):
        score += 0.20
    if core.get("vendor"):
        score += 0.10
    if core.get("amount") is not None:
        score += 0.30 if (core.get("amount_label") or core.get("amount_votes", 0) >= 3) else 0.15
    basis = core.get("date_basis")
    if basis == "bill date label":
        score += 0.25
    elif basis and basis.startswith("date placed by structure"):
        score += 0.20
    elif basis:
        score += 0.10
    score += 0.15 * float(address.get("confidence") or 0)
    return round(min(score, 1.0), 4)


def _build_result(lines: List[Line], *, ocr_confidence: float, engine: str, languages: str, passes: int, pages: int,
                  image_width: Optional[int], lite_amount_guard: bool, started: float) -> Dict[str, Any]:
    core = extract_core(lines)
    if lite_amount_guard and core.get("amount") is not None and (core.get("amount_votes", 0) < 2 or not core.get("amount_label")):
        core["amount"], core["amount_label"] = None, None      # lite mode: a single or unlabelled OCR reading could be a misread digit, so leave it for the user to confirm
    address = extract_address(lines)
    score = extraction_score(core, address)
    low_resolution = image_width is not None and 0 < image_width < LOW_RESOLUTION_WIDTH and score < 0.45   # small picture AND hardly anything could be read
    result = {
        "error": None,
        "text": reading_text(lines),
        "ocr_confidence": ocr_confidence,
        "ocr_engine": engine,
        "languages": languages,
        "passes": passes,
        "pages": pages,
        "image_width": image_width,
        "low_resolution": low_resolution,
        "document_type": core.get("document_type"),
        "vendor": core.get("vendor"),
        "amount": core.get("amount"),
        "amount_label": core.get("amount_label"),
        "date": _slashed(core.get("date")),
        "date_basis": core.get("date_basis"),
        "due_date": _slashed(core.get("due_date")),
        "bill_period": _slashed(core.get("bill_period")),
        "is_duplicate": core.get("is_duplicate", False),
        "address": {k: address.get(k) for k in ("place", "suburb", "city", "state", "pincode")},
        "customer_name": address.get("customer_name"),
        "extraction_score": score,
        "confidence": round(min(0.3 * ocr_confidence + 0.7 * score, 0.5) if core.get("amount") is None else 0.3 * ocr_confidence + 0.7 * score, 4),   # no amount = needs a human look
        "seconds": round(time.time() - started, 1),
    }
    logger.info("%s: %s | type=%s amount=%s date=%s pin=%s | conf=%.2f | %.1fs (%s passes)", engine, languages, result["document_type"], result["amount"],
                result["date"], result["address"].get("pincode"), result["confidence"], result["seconds"], result["passes"])
    return result


def analyze_bill(path: str, budget_seconds: float = 60.0) -> Dict[str, Any]:
    started = time.time()

    text_lines = extract_pdf_text_lines(path)
    if text_lines:
        result = _build_result(text_lines, ocr_confidence=1.0, engine="pdf-text", languages="text",
                                passes=1, pages=max((l.page for l in text_lines), default=0) + 1,
                                image_width=None, lite_amount_guard=False, started=started)
        if result["document_type"] or result["amount"] is not None or result["address"]["pincode"]:
            return result
        # the PDF has SOME text, but none of it looks like a bill (e.g. a stray watermark, or an old OCR layer baked into a
        # scan) - read the rendered pages with the OCR engine instead, exactly as if no text layer had been found at all.

    ocr = run_hybrid_ocr(path, budget_seconds=budget_seconds, sufficient=core_is_sufficient_lite if settings.OCR_LITE_MODE else core_is_sufficient)
    if not ocr.lines:
        return {"error": ocr.error or "No text was read.", "text": "", "ocr_confidence": 0.0, "ocr_engine": f"hybrid({ocr.languages})"}
    return _build_result(ocr.lines, ocr_confidence=ocr.confidence, engine=f"hybrid({ocr.languages})", languages=ocr.languages,
                          passes=len(ocr.passes), pages=ocr.pages, image_width=ocr.width, lite_amount_guard=settings.OCR_LITE_MODE, started=started)
