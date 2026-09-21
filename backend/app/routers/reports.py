import logging
from typing import Callable, Dict, List

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models.financial import Expense, Payment, PaymentStatus
from app.models.property_model import Property
from app.models.user import User, UserRole
from app.database import get_mongo_db
from app.services.report_service import (
    generate_financial_pdf,
    generate_rent_receipt_pdf,
    generate_excel_report,
    generate_lease_pdf,
)
from app.services.property_export import generate_properties_excel, generate_properties_pdf, property_row
from bson import ObjectId
from datetime import datetime
from app.utils.dates import app_tz, local_date_of
from app.utils.dependencies import get_current_user, require_roles

router = APIRouter(prefix="/reports", tags=["Reports"])
logger = logging.getLogger(__name__)

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _render(what: str, build: Callable[[], bytes]) -> bytes:
    """Runs a report generator; a failure is logged with its traceback and reported cleanly instead of as a raw 500."""
    try:
        return build()
    except Exception:
        logger.exception("Could not generate the %s", what)
        raise HTTPException(status_code=500, detail=f"The {what} could not be generated. Please try again.")


def _download(content: bytes, media_type: str, filename: str) -> Response:
    return Response(
        content=content, media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"', "Cache-Control": "no-store"},
    )


async def _names(db: AsyncSession, ids) -> Dict[int, str]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    res = await db.execute(select(User.id, User.full_name).where(User.id.in_(ids)))
    return {uid: name for uid, name in res.all()}


async def _report_property(db: AsyncSession, property_id: int, user: User) -> Property:
    """A manager may report on any property, an owner only on their own; everything else looks like 'not found'."""
    prop = (await db.execute(select(Property).where(Property.id == property_id))).scalar_one_or_none()
    if not prop or (user.role == UserRole.OWNER and prop.owner_id != user.id):
        raise HTTPException(status_code=404, detail="Property not found")
    return prop


async def _financial_data(db: AsyncSession, prop: Property):
    exp_res = await db.execute(select(Expense).where(Expense.property_id == prop.id).order_by(Expense.expense_date))
    pay_res = await db.execute(select(Payment).where(Payment.property_id == prop.id).order_by(Payment.payment_date))
    names = await _names(db, [prop.owner_id, prop.tenant_id])
    info = {
        "title": prop.title, "address": prop.address, "city": prop.city, "state": prop.state,
        "type": (prop.property_type or "").replace("_", " ").title(), "rent": float(prop.rent_amount) if prop.rent_amount is not None else None,
        "status": "Available" if prop.is_available else "Occupied", "owner": names.get(prop.owner_id), "tenant": names.get(prop.tenant_id),
    }
    expenses = [
        {"category": e.category.value, "vendor": e.vendor, "amount": e.amount,
         "month": e.month, "expense_date": local_date_of(e.expense_date).isoformat()}
        for e in exp_res.scalars().all()
    ]
    payments = [
        {"month": p.month, "amount": p.amount, "status": p.status.value,
         "payment_date": local_date_of(p.payment_date).isoformat()}
        for p in pay_res.scalars().all()
    ]
    return info, expenses, payments


# ── All Properties export (Manager) ───────────────────────────────────────────

async def _all_property_rows(db: AsyncSession) -> List[Dict]:
    """Every property, straight from the database, in ID order."""
    props = (await db.execute(select(Property).order_by(Property.id))).scalars().all()
    names = await _names(db, [x for p in props for x in (p.owner_id, p.tenant_id)])
    return [
        property_row(p, names.get(p.owner_id), names.get(p.tenant_id), local_date_of(p.created_at).isoformat() if p.created_at else None)
        for p in props
    ]


@router.get("/properties/pdf")
async def all_properties_pdf(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.MANAGER)),
):
    """PDF report of every property (managers only)."""
    rows = await _all_property_rows(db)
    now = datetime.now(app_tz())
    pdf = _render("property report", lambda: generate_properties_pdf(rows, current_user.full_name, now))
    return _download(pdf, "application/pdf", f"properties_report_{now:%Y-%m-%d}.pdf")


@router.get("/properties/excel")
async def all_properties_excel(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.MANAGER)),
):
    """Excel workbook of every property (managers only)."""
    rows = await _all_property_rows(db)
    now = datetime.now(app_tz())
    xlsx = _render("property spreadsheet", lambda: generate_properties_excel(rows, current_user.full_name, now))
    return _download(xlsx, XLSX, f"properties_report_{now:%Y-%m-%d}.xlsx")


# ── Per-property financial report (Manager: any property, Owner: their own) ───

@router.get("/financial/{property_id}/pdf")
async def financial_pdf(
    property_id: int,
    period: str = "All Time",
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.MANAGER, UserRole.OWNER)),
):
    prop = await _report_property(db, property_id, current_user)
    info, expenses, payments = await _financial_data(db, prop)
    pdf_bytes = _render("financial report", lambda: generate_financial_pdf(info, expenses, payments, period, datetime.now(app_tz())))
    return _download(pdf_bytes, "application/pdf", f"report_{property_id}.pdf")


@router.get("/financial/{property_id}/excel")
async def financial_excel(
    property_id: int,
    period: str = "All Time",
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.MANAGER, UserRole.OWNER)),
):
    prop = await _report_property(db, property_id, current_user)
    info, expenses, payments = await _financial_data(db, prop)
    excel_bytes = _render("financial spreadsheet", lambda: generate_excel_report(expenses, payments, period, info))
    return _download(excel_bytes, XLSX, f"report_{property_id}.xlsx")


@router.get("/receipt/{payment_id}/pdf")
async def rent_receipt_pdf(
    payment_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Receipt for a COMPLETED payment. A tenant gets their own; an owner those on their properties; a manager any."""
    res = await db.execute(select(Payment).where(Payment.id == payment_id))
    pay = res.scalar_one_or_none()
    prop_res = await db.execute(select(Property).where(Property.id == pay.property_id)) if pay else None
    prop = prop_res.scalar_one_or_none() if prop_res else None
    if (
        not pay
        or (current_user.role == UserRole.TENANT and pay.tenant_id != current_user.id)
        or (current_user.role == UserRole.OWNER and (not prop or prop.owner_id != current_user.id))
    ):
        raise HTTPException(status_code=404, detail="Payment not found")      # someone else's payment looks the same as a missing one
    if pay.status != PaymentStatus.COMPLETED:
        raise HTTPException(status_code=409, detail="A receipt is only available for completed payments.")
    tenant = (await db.execute(select(User).where(User.id == pay.tenant_id))).scalar_one_or_none()

    pdf_bytes = _render("receipt", lambda: generate_rent_receipt_pdf(
        tenant_name=tenant.full_name if tenant else current_user.full_name,
        property_address=prop.address if prop else "N/A",
        amount=pay.amount,
        month=pay.month or "",
        payment_date=local_date_of(pay.payment_date).isoformat(),
    ))
    return _download(pdf_bytes, "application/pdf", f"receipt_{payment_id}.pdf")


@router.get("/lease/{app_id}/pdf")
async def lease_agreement_pdf(
    app_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    mongo = get_mongo_db()
    app = await mongo["rental_applications"].find_one({"_id": ObjectId(app_id)})
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
    if app.get("status") != "approved":
        raise HTTPException(status_code=400, detail="Lease only available for approved applications")

    # Get owner name
    owner_name = "Property Owner"
    if app.get("property_id"):
        prop_res = await db.execute(select(Property).where(Property.id == app["property_id"]))
        prop = prop_res.scalar_one_or_none()
        if prop and prop.owner_id:
            owner_res = await db.execute(select(User).where(User.id == prop.owner_id))
            owner = owner_res.scalar_one_or_none()
            if owner:
                owner_name = owner.full_name

    start_date = datetime.utcnow().strftime("%d %B %Y")
    pdf_bytes = generate_lease_pdf(
        tenant_name=app.get("tenant_name", current_user.full_name),
        owner_name=owner_name,
        property_address=app.get("property_address", "N/A"),
        property_city=app.get("property_city", ""),
        rent_amount=float(app.get("rent_amount", 0)),
        start_date=start_date,
    )
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="lease_{app_id}.pdf"'},
    )
