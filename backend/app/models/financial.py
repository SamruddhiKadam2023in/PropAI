import enum
from sqlalchemy import (
    Column, Integer, String, Float, ForeignKey,
    DateTime, Text, Enum as SAEnum,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base


class PaymentStatus(str, enum.Enum):
    PENDING = "pending"
    COMPLETED = "completed"
    FAILED = "failed"


class ExpenseCategory(str, enum.Enum):
    RENT = "rent"
    ELECTRICITY = "electricity"
    WATER = "water"
    GAS = "gas"
    INTERNET = "internet"
    MAINTENANCE = "maintenance"
    OTHER = "other"


class Payment(Base):
    __tablename__ = "payments"

    id = Column(Integer, primary_key=True, index=True)
    amount = Column(Float, nullable=False)
    payment_date = Column(DateTime(timezone=True), nullable=False)
    status = Column(SAEnum(PaymentStatus), default=PaymentStatus.COMPLETED)
    month = Column(String(7), nullable=True)   # "YYYY-MM"
    payment_type = Column(String(30), nullable=False, default="rent", server_default="rent")   # what it was for (schemas.PAYMENT_TYPES)
    notes = Column(Text, nullable=True)
    receipt_url = Column(String(500), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    tenant_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    property_id = Column(Integer, ForeignKey("properties.id"), nullable=False)
    agreement_id = Column(Integer, ForeignKey("agreements.id"), nullable=True, index=True)   # the agreement this rent counts towards

    tenant = relationship("User", back_populates="payments")
    property = relationship("Property", back_populates="payments")


class Expense(Base):
    __tablename__ = "expenses"

    id = Column(Integer, primary_key=True, index=True)
    category = Column(SAEnum(ExpenseCategory), nullable=False)
    amount = Column(Float, nullable=False)
    expense_date = Column(DateTime(timezone=True), nullable=False)
    vendor = Column(String(255), nullable=True)
    description = Column(Text, nullable=True)
    month = Column(String(7), nullable=True)   # "YYYY-MM"
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    property_id = Column(Integer, ForeignKey("properties.id"), nullable=False)
    document_id = Column(Integer, ForeignKey("documents.id"), nullable=True)

    property = relationship("Property", back_populates="expenses")
