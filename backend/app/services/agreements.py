"""
The tenant-abandonment rule, in one place, server-side.

RULE: if a tenant leaves (or abandons) a property before the agreement's term has run out, they stay responsible for the
rent the agreement fixed for the whole term - less what they have already paid towards it.

    contract_total = monthly_rent x term_months                       (both stored on the agreement)
    paid           = completed RENT payments linked to the agreement  (payments.agreement_id)
    outstanding    = max(contract_total - paid, 0)                    only when the agreement was terminated / abandoned

No penalty, fee or interest is added: the only figures are the ones the agreement itself carries. Each payment belongs to at
most one agreement, so nothing already paid can be counted twice, and money paid after the tenant left reduces the balance.
"""
import calendar
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from typing import Dict, Iterable, Optional

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agreement import Agreement, AgreementStatus
from app.models.financial import Payment, PaymentStatus
from app.models.property_model import Property

DEFAULT_TERM_MONTHS = 12          # the lease PDF's "Lease Duration: 12 months (renewable)"
MAX_TERM_MONTHS = 120
EARLY_EXIT = (AgreementStatus.TERMINATED.value, AgreementStatus.ABANDONED.value)

STATUS_LABELS = {"active": "Active", "completed": "Completed", "terminated": "Terminated", "abandoned": "Abandoned"}


def money(value) -> Decimal:
    return Decimal(str(value or 0)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def add_months(day: date, months: int) -> date:
    index = day.year * 12 + (day.month - 1) + months
    year, month = divmod(index, 12)
    month += 1
    return date(year, month, min(day.day, calendar.monthrange(year, month)[1]))


def end_date_for(start: date, term_months: int) -> date:
    """The last day of the term: a 12-month agreement starting 1 Jan ends 31 Dec."""
    return date.fromordinal(add_months(start, term_months).toordinal() - 1)


async def paid_towards(db: AsyncSession, agreement_ids: Iterable[int]) -> Dict[int, Decimal]:
    """Completed rent recorded against each agreement. Pending / failed payments and other purposes (deposit, fees) never count."""
    ids = list(agreement_ids)
    if not ids:
        return {}
    rows = (await db.execute(
        select(Payment.agreement_id, func.coalesce(func.sum(Payment.amount), 0))
        .where(Payment.agreement_id.in_(ids), Payment.status == PaymentStatus.COMPLETED, Payment.payment_type == "rent")
        .group_by(Payment.agreement_id)
    )).all()
    return {agreement_id: money(total) for agreement_id, total in rows}


def evaluate(agreement: Agreement, paid: Decimal, today: date) -> dict:
    """Everything derived from an agreement. `abandonment_outstanding` is 0 unless the tenant left early."""
    rent = money(agreement.monthly_rent)
    contract_total = (rent * agreement.term_months).quantize(Decimal("0.01"))
    paid = money(paid)

    status = agreement.status
    if status == AgreementStatus.ACTIVE.value and today > agreement.end_date:
        status = AgreementStatus.COMPLETED.value           # the term ran out normally - not an abandonment

    early_exit = status in EARLY_EXIT
    outstanding = max(contract_total - paid, Decimal("0")) if early_exit else Decimal("0")
    if not early_exit:
        settlement = "not_applicable"
    else:
        settlement = "outstanding" if outstanding > 0 else "settled"

    return {
        "status": status,
        "status_label": STATUS_LABELS[status],
        "settlement": settlement,                           # outstanding | settled | not_applicable
        "monthly_rent": float(rent),
        "term_months": agreement.term_months,
        "contract_total": float(contract_total),
        "paid": float(paid),
        "abandonment_outstanding": float(outstanding),
        "days_remaining": max((agreement.end_date - today).days, 0) if status == AgreementStatus.ACTIVE.value else 0,
    }


async def link_payments(db: AsyncSession, agreement: Agreement) -> int:
    """Attach the tenant's not-yet-linked rent payments whose month falls inside the agreement's term."""
    first, last = agreement.start_date.strftime("%Y-%m"), agreement.end_date.strftime("%Y-%m")
    result = await db.execute(
        update(Payment)
        .where(Payment.tenant_id == agreement.tenant_id, Payment.property_id == agreement.property_id,
               Payment.agreement_id.is_(None), Payment.payment_type == "rent",
               Payment.month >= first, Payment.month <= last)
        .values(agreement_id=agreement.id)
    )
    return result.rowcount or 0


async def current_agreement(db: AsyncSession, tenant_id: int, property_id: int) -> Optional[Agreement]:
    """The tenant's latest agreement on the property that has not been ended early."""
    return (await db.execute(
        select(Agreement).where(Agreement.tenant_id == tenant_id, Agreement.property_id == property_id,
                                Agreement.status.in_((AgreementStatus.ACTIVE.value, AgreementStatus.COMPLETED.value)))
        .order_by(Agreement.start_date.desc(), Agreement.id.desc()).limit(1)
    )).scalar_one_or_none()


async def create_agreement(db: AsyncSession, prop: Property, tenant_id: int, start: date,
                           term_months: int = DEFAULT_TERM_MONTHS, monthly_rent=None) -> Agreement:
    """Records a new agreement (caller commits). Older agreements of the same tenant/property that ran out are marked completed."""
    agreement = Agreement(
        tenant_id=tenant_id, property_id=prop.id,
        monthly_rent=money(monthly_rent if monthly_rent is not None else prop.rent_amount),
        start_date=start, term_months=term_months, end_date=end_date_for(start, term_months),
        status=AgreementStatus.ACTIVE.value,
    )
    await db.execute(
        update(Agreement)
        .where(Agreement.tenant_id == tenant_id, Agreement.property_id == prop.id,
               Agreement.status == AgreementStatus.ACTIVE.value, Agreement.end_date < start)
        .values(status=AgreementStatus.COMPLETED.value)
    )
    db.add(agreement)
    await db.flush()
    await link_payments(db, agreement)
    return agreement
