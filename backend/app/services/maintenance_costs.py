"""Service-cost arithmetic for maintenance records, shared by the API.

Money is handled as Decimal to two places, so totals never drift the way binary floats do
(e.g. 1234.56 + 78.90 + 0.10 is exactly 1313.56).
"""
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from typing import Iterable, Optional

PAYMENT_STATUSES = ("pending", "paid")
PROVIDER_TYPES = ("independent", "authorized_center", "agency", "other")


def money(value) -> Decimal:
    return Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _iso(day: Optional[date]) -> Optional[str]:
    return day.isoformat() if day else None


def build_service_block(
    *,
    provider_name: str,
    provider_type: str,
    service_type: str,
    scheduled_date: date,
    completed_date: Optional[date],
    service_fee,
    additional_charges: Iterable[dict],
    payment_status: str = "pending",
    invoice_no: Optional[str] = None,
) -> dict:
    """The `service` sub-document stored on a maintenance record. `total_amount` is always derived here."""
    fee = money(service_fee)
    charges = [{"label": str(c["label"]).strip(), "amount": float(money(c["amount"]))} for c in additional_charges]
    additional = sum((money(c["amount"]) for c in charges), Decimal("0.00"))
    return {
        "provider_name": provider_name.strip(),
        "provider_type": provider_type,
        "service_type": service_type.strip(),
        "scheduled_date": _iso(scheduled_date),
        "completed_date": _iso(completed_date),
        "service_fee": float(fee),
        "additional_charges": charges,
        "additional_total": float(additional),
        "total_amount": float(fee + additional),
        "payment_status": payment_status,
        "invoice_no": (invoice_no or "").strip() or None,
    }
