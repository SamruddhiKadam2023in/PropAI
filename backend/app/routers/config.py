"""
System configuration - OCR pipeline settings.

Read-only here, and not available to Managers: OCR configuration is not a Manager responsibility. The OCR engine itself
(services/ocr_service.py) reads its settings straight from the `ocr_config` collection and falls back to safe defaults,
so it does not depend on these endpoints and Tenant document processing is unaffected.
"""
from fastapi import APIRouter, Depends

from app.database import get_mongo_db
from app.models.user import User, UserRole
from app.utils.dependencies import require_roles

router = APIRouter(prefix="/config", tags=["Config"])

DEFAULT_OCR_CONFIG = {
    "confidence_threshold":   0.65,
    "ocr_engine":             "auto",       # auto | tesseract | easyocr
    "preprocessing_enabled":  True,
    "tfidf_enabled":          True,
    "min_text_length":        5,
    "updated_at":             None,
    "updated_by":             None,
}


@router.get("/ocr")
async def get_ocr_config(
    current_user: User = Depends(require_roles(UserRole.OWNER)),
):
    mongo = get_mongo_db()
    cfg = await mongo["ocr_config"].find_one({}, {"_id": 0})
    return cfg or DEFAULT_OCR_CONFIG
