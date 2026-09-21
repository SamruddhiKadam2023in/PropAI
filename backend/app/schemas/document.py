from pydantic import BaseModel
from typing import Optional, Dict, Any, List
from datetime import datetime
from app.models.document import DocumentType, DocumentStatus


class DocumentResponse(BaseModel):
    id: int
    filename: str
    # Authenticated API path of the original file (never a filesystem path).
    file_url: str
    document_type: Optional[DocumentType] = None
    status: DocumentStatus
    raw_ocr_text: Optional[str] = None
    extracted_data: Optional[Dict[str, Any]] = None
    corrected_data: Optional[Dict[str, Any]] = None
    confidence_score: Optional[float] = None
    uploaded_at: datetime
    processed_at: Optional[datetime] = None
    property_id: Optional[int] = None
    user_id: int

    mime_type: Optional[str] = None
    file_size: Optional[int] = None
    file_available: bool = True
    error_message: Optional[str] = None

    model_config = {"from_attributes": True}


class DocumentCorrection(BaseModel):
    amount: Optional[float] = None
    date: Optional[str] = None
    vendor: Optional[str] = None
    document_type: Optional[str] = None
    description: Optional[str] = None
