import enum
from sqlalchemy import (
    Column, Integer, String, Float, ForeignKey,
    DateTime, Text, JSON, Enum as SAEnum,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base


class DocumentType(str, enum.Enum):
    ELECTRICITY_BILL = "electricity_bill"
    WATER_BILL = "water_bill"
    GAS_BILL = "gas_bill"
    RENT_RECEIPT = "rent_receipt"
    INVOICE = "invoice"
    OTHER = "other"


class DocumentStatus(str, enum.Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FLAGGED = "flagged"    # confidence < 65 % — needs user review
    FAILED = "failed"


class Document(Base):
    __tablename__ = "documents"

    id = Column(Integer, primary_key=True, index=True)
    filename = Column(String(255), nullable=False)
    file_url = Column(String(500), nullable=False)
    document_type = Column(SAEnum(DocumentType), nullable=True)
    status = Column(SAEnum(DocumentStatus), default=DocumentStatus.PENDING)

    # OCR / NLP results
    raw_ocr_text = Column(Text, nullable=True)
    extracted_data = Column(JSON, nullable=True)   # {amount, date, vendor, entities, …}
    confidence_score = Column(Float, nullable=True)

    # User corrections (override OCR)
    corrected_data = Column(JSON, nullable=True)

    uploaded_at = Column(DateTime(timezone=True), server_default=func.now())
    processed_at = Column(DateTime(timezone=True), nullable=True)

    # Foreign keys
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    property_id = Column(Integer, ForeignKey("properties.id"), nullable=True)

    # Relationships
    user = relationship("User", back_populates="documents")
    property = relationship("Property", back_populates="documents")
