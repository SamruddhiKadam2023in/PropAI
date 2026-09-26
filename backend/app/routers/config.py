"""
System configuration - OCR pipeline settings.

Owner and Manager can view and change these; the OCR engine itself (services/ocr_service.py) reads them straight from
the `ocr_config` collection and falls back to safe defaults, so a missing/unreachable config never blocks Tenant
document processing. Only the two fields the live pipeline actually reads are exposed here (see
services/ocr_service.py:_load_ocr_settings) - no settings are offered that would silently do nothing if changed.
"""
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.database import get_mongo_db
from app.models.user import User, UserRole
from app.utils.dependencies import require_roles

router = APIRouter(prefix="/config", tags=["Config"])

VALID_ENGINES = {"auto", "tesseract", "easyocr"}

DEFAULT_OCR_CONFIG = {
    "confidence_threshold":   0.65,
    "ocr_engine":             "auto",       # auto | tesseract | easyocr
    "updated_at":             None,
    "updated_by":             None,
}


class OcrConfigUpdate(BaseModel):
    confidence_threshold: Optional[float] = Field(None, ge=0.0, le=1.0)
    ocr_engine: Optional[str] = None


@router.get("/ocr")
async def get_ocr_config(
    current_user: User = Depends(require_roles(UserRole.OWNER, UserRole.MANAGER)),
):
    mongo = get_mongo_db()
    cfg = await mongo["ocr_config"].find_one({}, {"_id": 0})
    return cfg or DEFAULT_OCR_CONFIG


@router.put("/ocr")
async def update_ocr_config(
    body: OcrConfigUpdate,
    current_user: User = Depends(require_roles(UserRole.OWNER, UserRole.MANAGER)),
):
    changes = body.model_dump(exclude_none=True)
    if not changes:
        raise HTTPException(status_code=400, detail="Nothing to update.")
    if "ocr_engine" in changes and changes["ocr_engine"] not in VALID_ENGINES:
        raise HTTPException(status_code=400, detail=f"ocr_engine must be one of: {sorted(VALID_ENGINES)}")

    mongo = get_mongo_db()
    existing = await mongo["ocr_config"].find_one({}, {"_id": 0}) or dict(DEFAULT_OCR_CONFIG)
    existing.update(changes)
    existing["updated_at"] = datetime.now(timezone.utc).isoformat()
    existing["updated_by"] = current_user.email

    await mongo["ocr_config"].update_one({}, {"$set": existing}, upsert=True)
    return existing
