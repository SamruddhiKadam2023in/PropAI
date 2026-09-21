from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any, Literal, Union
from datetime import date, datetime
from app.models.financial import PaymentStatus, ExpenseCategory


PAYMENT_TYPES = ("rent", "security_deposit", "maintenance", "utility", "late_fee", "other")
PAYMENT_TYPE_LABELS = {
    "rent": "Rent", "security_deposit": "Security deposit", "maintenance": "Maintenance charge",
    "utility": "Utility bill", "late_fee": "Late fee", "other": "Other",
}


class PaymentCreate(BaseModel):
    amount: float = Field(gt=0, le=10_000_000)
    payment_date: Union[date, datetime]      # a calendar date ("2026-09-19") or a full timestamp
    property_id: int
    month: Optional[str] = None
    notes: Optional[str] = Field(default=None, max_length=500)
    payment_type: Literal[PAYMENT_TYPES] = "rent"
    agreement_id: Optional[int] = None       # only to pay off what is owed under a terminated / abandoned agreement


class PaymentResponse(BaseModel):
    id: int
    amount: float
    payment_date: datetime
    status: PaymentStatus
    month: Optional[str] = None
    payment_type: str = "rent"
    notes: Optional[str] = None
    tenant_id: int
    property_id: int
    agreement_id: Optional[int] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class TransactionOut(PaymentResponse):
    """A payment as the Payments screen shows it: the stored row plus its readable references."""
    transaction_id: str                       # TXN-000123 (from the primary key)
    payment_type_label: str
    payment_day: str                          # YYYY-MM-DD in the business timezone
    property_title: Optional[str] = None
    property_address: Optional[str] = None
    agreement_ref: Optional[str] = None       # only where an approved rental application exists
    receipt_available: bool = False


class ExpenseCreate(BaseModel):
    category: ExpenseCategory
    amount: float
    expense_date: datetime
    vendor: Optional[str] = None
    description: Optional[str] = None
    property_id: int
    month: Optional[str] = None
    document_id: Optional[int] = None


class ExpenseResponse(BaseModel):
    id: int
    category: ExpenseCategory
    amount: float
    expense_date: datetime
    vendor: Optional[str] = None
    description: Optional[str] = None
    month: Optional[str] = None
    property_id: int
    document_id: Optional[int] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class LivingCostBreakdown(BaseModel):
    rent: float = 0
    electricity: float = 0
    water: float = 0
    gas: float = 0
    internet: float = 0
    maintenance: float = 0
    other: float = 0
    total: float = 0
    month: str


class RentDeviationResult(BaseModel):
    tenant_rent: float
    market_rent: float
    deviation: float
    deviation_percent: float
    is_above_market: bool
    status: str   # "above_market" | "below_market" | "at_market"
