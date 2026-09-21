"""
Turns a finished utility bill into an expense on the tenant's property, so the Cost Analysis fills itself as bills are uploaded.

One bill = at most one expense (linked through Expense.document_id). The expense is created or updated when a bill finishes reading with a
type, an amount and a date (or when the user corrects those), and removed again when the bill is deleted or no longer qualifies (for
example the user clears the amount). Nothing is guessed: a bill still waiting for review (FLAGGED) creates no expense.
"""
import logging
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.document import Document, DocumentStatus
from app.models.financial import Expense, ExpenseCategory
from app.models.property_model import Property
from app.utils.cache import invalidate_pattern

logger = logging.getLogger(__name__)

CATEGORY = {"electricity_bill": ExpenseCategory.ELECTRICITY, "water_bill": ExpenseCategory.WATER, "gas_bill": ExpenseCategory.GAS}
MAX_AMOUNT = 10_000_000


def parse_bill_date(value) -> Optional[datetime]:
    """'05/12/2025' or '05-12-2025' (day first, as the app shows dates) -> a datetime, or None if it is not a real date."""
    if not isinstance(value, str):
        return None
    parts = value.strip().replace("-", "/").replace(".", "/").split("/")
    if len(parts) != 3 or not all(p.strip().isdigit() for p in parts):
        return None
    day, month, year = (int(p) for p in parts)
    if year < 100:
        year += 2000
    try:
        return datetime(year, month, day, tzinfo=timezone.utc) if 2000 <= year <= 2100 else None
    except ValueError:
        return None


async def _property_for(db: AsyncSession, doc: Document) -> Optional[int]:
    if doc.property_id:
        return doc.property_id
    result = await db.execute(select(Property.id).where(Property.tenant_id == doc.user_id).order_by(Property.id).limit(1))
    return result.scalar_one_or_none()


async def sync_expense_for_document(db: AsyncSession, doc: Document) -> Optional[Expense]:
    """Make the expense for this bill match the bill as it is now. Adds/updates rows in `db`; the caller commits."""
    data = doc.extracted_data or {}
    category = CATEGORY.get(doc.document_type.value) if doc.document_type else None
    amount = data.get("amount")
    when = parse_bill_date(data.get("date"))
    property_id = await _property_for(db, doc) if doc.id else None
    existing = (await db.execute(select(Expense).where(Expense.document_id == doc.id))).scalars().first() if doc.id else None

    qualifies = (doc.status == DocumentStatus.COMPLETED and category is not None and isinstance(amount, (int, float)) and not isinstance(amount, bool)
                 and 0 < amount <= MAX_AMOUNT and when is not None and property_id is not None)
    if not qualifies:
        if existing is not None:
            await db.delete(existing)                      # the bill no longer supports an expense (amount cleared, type changed ...)
            await invalidate_pattern("dashboard:*")
        return None

    fields = dict(category=category, amount=float(amount), expense_date=when, month=when.strftime("%Y-%m"),
                  vendor=(data.get("vendor") or None), description=f"From uploaded bill: {doc.filename}", property_id=property_id)
    if existing is None:
        existing = Expense(document_id=doc.id, **fields)
        db.add(existing)
    else:
        for key, value in fields.items():
            setattr(existing, key, value)
    await invalidate_pattern("dashboard:*")
    return existing


async def remove_expense_for_document(db: AsyncSession, document_id: int) -> None:
    """Called before a bill is deleted: its expense goes with it."""
    await db.execute(delete(Expense).where(Expense.document_id == document_id))
    await invalidate_pattern("dashboard:*")
