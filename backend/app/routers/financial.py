from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List, Optional
from collections import defaultdict
from datetime import datetime, date

from app.database import get_db, get_mongo_db
from app.models.agreement import Agreement, AgreementStatus
from app.models.financial import Payment, Expense, PaymentStatus
from app.models.property_model import Property
from app.models.user import User, UserRole
from app.schemas.financial import (
    PAYMENT_TYPE_LABELS, PaymentCreate, PaymentResponse, TransactionOut,
    ExpenseCreate, ExpenseResponse,
)
from app.utils.dependencies import get_current_user, require_roles
from app.services.agreements import EARLY_EXIT, current_agreement, evaluate, money, paid_towards
from app.services.expense_import import build_template, parse_expense_rows, read_spreadsheet, MAX_ROWS
from app.utils.cache import invalidate_pattern
from app.utils.dates import EARLIEST_YEAR, day_bounds_utc, local_date_of, local_today, payment_instant, valid_month

router = APIRouter(prefix="/financial", tags=["Financial"])


# ── Payments ──────────────────────────────────────────────────────────────────

def _transaction_id(payment_id: int) -> str:
    return f"TXN-{payment_id:06d}"


async def _agreement_refs(tenant_ids) -> dict:
    """(tenant_id, property_id) -> 'LEASE-XXXXXX', only where the tenant has an APPROVED rental application (the app's lease record)."""
    ids = list({t for t in tenant_ids if t})
    if not ids:
        return {}
    try:
        cursor = get_mongo_db()["rental_applications"].find({"tenant_id": {"$in": ids}, "status": "approved"}, {"tenant_id": 1, "property_id": 1})
        return {(a["tenant_id"], a["property_id"]): f"LEASE-{str(a['_id'])[-6:].upper()}" for a in await cursor.to_list(length=500)}
    except Exception:
        return {}


async def _transactions(db: AsyncSession, payments: List[Payment]) -> List[TransactionOut]:
    props = {}
    if payments:
        res = await db.execute(select(Property).where(Property.id.in_({p.property_id for p in payments})))
        props = {p.id: p for p in res.scalars().all()}
    refs = await _agreement_refs([p.tenant_id for p in payments])
    out = []
    for p in payments:
        prop = props.get(p.property_id)
        base = PaymentResponse.model_validate(p).model_dump()
        out.append(TransactionOut(
            **base,
            transaction_id=_transaction_id(p.id),
            payment_type_label=PAYMENT_TYPE_LABELS.get(p.payment_type, "Other"),
            payment_day=local_date_of(p.payment_date).isoformat(),
            property_title=prop.title if prop else None,
            property_address=", ".join(x for x in (prop.address, prop.city) if x) if prop else None,
            agreement_ref=refs.get((p.tenant_id, p.property_id)),
            receipt_available=p.status == PaymentStatus.COMPLETED,
        ))
    return out


@router.post("/payments", response_model=PaymentResponse, status_code=201)
async def create_payment(
    body: PaymentCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.TENANT)),
):
    """A tenant records a payment they made for a property they rent (no gateway - this is a record, not a charge)."""
    agreement_id = None
    if body.agreement_id is not None:
        # Paying off what is still owed after leaving early: only the tenant's own terminated / abandoned agreement, only rent,
        # and never more than the balance the server computes - so nothing can be over-collected or bypassed from the browser.
        agreement = (await db.execute(select(Agreement).where(Agreement.id == body.agreement_id, Agreement.tenant_id == current_user.id))).scalar_one_or_none()
        if agreement is None or agreement.property_id != body.property_id:
            raise HTTPException(status_code=403, detail="That agreement isn't linked to your account.")
        if agreement.status not in EARLY_EXIT:
            raise HTTPException(status_code=409, detail="This agreement has no outstanding balance to settle.")
        if body.payment_type != "rent":
            raise HTTPException(status_code=422, detail="Only rent can be paid towards an outstanding agreement balance.")
        owed = evaluate(agreement, (await paid_towards(db, [agreement.id])).get(agreement.id, 0), local_today())["abandonment_outstanding"]
        if owed <= 0:
            raise HTTPException(status_code=409, detail="Nothing is outstanding on this agreement.")
        if money(body.amount) > money(owed):
            raise HTTPException(status_code=422, detail=f"That is more than the ₹{owed:,.2f} outstanding on this agreement.")
        agreement_id = agreement.id
    else:
        own = await db.execute(select(Property.id).where(Property.id == body.property_id, Property.tenant_id == current_user.id))
        if own.scalar_one_or_none() is None:
            raise HTTPException(status_code=403, detail="That property isn't linked to your account.")
    paid_at = payment_instant(body.payment_date)
    paid_on = local_date_of(paid_at)          # the calendar day in the business timezone - never the UTC day
    if paid_on.year < EARLIEST_YEAR:
        raise HTTPException(status_code=422, detail=f"The payment date must be in {EARLIEST_YEAR} or later.")
    if paid_on > local_today():
        raise HTTPException(status_code=422, detail="The payment date can't be in the future.")
    try:
        month = valid_month(body.month) or paid_on.strftime("%Y-%m")
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    if agreement_id is None and body.payment_type == "rent":
        running = await current_agreement(db, current_user.id, body.property_id)
        if running and running.start_date.strftime("%Y-%m") <= month <= running.end_date.strftime("%Y-%m"):
            agreement_id = running.id      # ordinary rent counts towards the agreement whose term covers that month
    payment = Payment(
        amount=body.amount,
        payment_date=paid_at,
        status=PaymentStatus.COMPLETED,
        month=month,
        payment_type=body.payment_type,
        notes=(body.notes or "").strip() or None,
        tenant_id=current_user.id,
        property_id=body.property_id,
        agreement_id=agreement_id,
    )
    db.add(payment)
    await db.commit()
    await db.refresh(payment)
    await invalidate_pattern(f"dashboard:{current_user.id}:*")

    try:   # confirmation for the payer; never allowed to fail the payment itself
        from app.routers.notifications import push_notification
        try:
            period = datetime.strptime(month, "%Y-%m").strftime("%B %Y")
        except (TypeError, ValueError):
            period = month or "this month"
        await push_notification(
            current_user.id, "payment_confirmed", "Payment recorded",
            f"Your payment of ₹{int(round(body.amount)):,} for {period} has been recorded. Thank you!",
        )
    except Exception:
        pass
    return payment


@router.get("/payments", response_model=List[TransactionOut])
async def list_payments(
    property_id: int = None,
    limit: int = Query(500, ge=1, le=1000),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Payment history, newest first. A tenant only ever receives their own transactions."""
    q = select(Payment)
    if current_user.role == UserRole.TENANT:
        q = q.where(Payment.tenant_id == current_user.id)
    if property_id:
        q = q.where(Payment.property_id == property_id)
    q = q.order_by(Payment.payment_date.desc(), Payment.id.desc()).limit(limit)
    result = await db.execute(q)
    return await _transactions(db, result.scalars().all())


@router.get("/payments/summary")
async def payment_summary(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.TENANT)),
):
    """
    What the tenant owes for the CURRENT month, per rented property, plus their overall totals.
    Only the current month is judged: the app has no lease start date or due day to say when earlier months fell due.
    """
    today = local_today()
    period = today.strftime("%Y-%m")
    props = (await db.execute(select(Property).where(Property.tenant_id == current_user.id).order_by(Property.id))).scalars().all()
    pays = (await db.execute(
        select(Payment).where(Payment.tenant_id == current_user.id).order_by(Payment.payment_date.desc(), Payment.id.desc())
    )).scalars().all()
    refs = await _agreement_refs([current_user.id])

    from app.routers.agreements import _base_query, _scope, _shape
    agreement_rows = (await db.execute(_scope(_base_query(), current_user).order_by(Agreement.start_date.desc(), Agreement.id.desc()))).all()
    agreements = await _shape(db, [tuple(r) for r in agreement_rows])
    agreement_by_property = {}
    for a in agreements:
        if a["status"] in ("active", "completed"):
            agreement_by_property.setdefault(a["property_id"], a)

    cards = []
    for prop in props:
        mine = [p for p in pays if p.property_id == prop.id]
        rent = float(prop.rent_amount or 0)
        paid = round(sum(p.amount for p in mine if p.month == period and p.status == PaymentStatus.COMPLETED and p.payment_type == "rent"), 2)
        pending = round(sum(p.amount for p in mine if p.month == period and p.status == PaymentStatus.PENDING and p.payment_type == "rent"), 2)
        last = next((p for p in mine if p.status == PaymentStatus.COMPLETED), None)
        cards.append({
            "property_id": prop.id, "title": prop.title, "address": ", ".join(x for x in (prop.address, prop.city) if x),
            "agreement_ref": refs.get((current_user.id, prop.id)),
            "agreement": agreement_by_property.get(prop.id),
            "current": {
                "month": period, "rent_due": rent, "paid": paid, "pending": pending, "balance": round(max(rent - paid, 0), 2),
                "status": "paid" if paid >= rent else ("partial" if paid > 0 else "unpaid"),
            },
            "last_payment": None if not last else {
                "transaction_id": _transaction_id(last.id), "payment_day": local_date_of(last.payment_date).isoformat(),
                "amount": last.amount, "month": last.month, "payment_type": last.payment_type,
            },
        })
    completed = [p for p in pays if p.status == PaymentStatus.COMPLETED]
    return {
        "today": today.isoformat(),
        "period": period,
        "properties": cards,
        "agreements": agreements,
        "outstanding_total": round(sum(a["abandonment_outstanding"] for a in agreements), 2),
        "totals": {
            "transactions": len(pays), "completed": len(completed),
            "total_paid": round(sum(p.amount for p in completed), 2),
            "pending_amount": round(sum(p.amount for p in pays if p.status == PaymentStatus.PENDING), 2),
        },
    }


# ── Expenses ──────────────────────────────────────────────────────────────────

@router.post("/expenses", response_model=ExpenseResponse, status_code=201)
async def create_expense(
    body: ExpenseCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.OWNER, UserRole.MANAGER)),
):
    """Records an expense against a property: a Manager for any property, an Owner only for their own."""
    prop = (await db.execute(select(Property).where(Property.id == body.property_id))).scalar_one_or_none()
    if prop is None:
        raise HTTPException(status_code=404, detail="Property not found.")
    if current_user.role == UserRole.OWNER and prop.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="You can only record expenses on your own properties.")
    month = body.month or body.expense_date.strftime("%Y-%m")
    expense = Expense(
        category=body.category,
        amount=body.amount,
        expense_date=body.expense_date,
        vendor=body.vendor,
        description=body.description,
        month=month,
        property_id=body.property_id,
        document_id=body.document_id,
    )
    db.add(expense)
    await db.commit()
    await db.refresh(expense)
    await invalidate_pattern(f"dashboard:*")
    return expense


@router.get("/expenses/bulk-import-template")
async def expenses_bulk_import_template(current_user: User = Depends(require_roles(UserRole.OWNER, UserRole.MANAGER))):
    """A starter .xlsx with the expected columns, ready to fill in and re-upload via /expenses/bulk-import."""
    return Response(
        content=build_template(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=propai_expenses_template.xlsx"},
    )


@router.post("/expenses/bulk-import")
async def bulk_import_expenses(
    property_id: int = Form(...),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.OWNER, UserRole.MANAGER)),
):
    """
    Records many expenses at once from a spreadsheet (date, category, amount, vendor, description) - for real bills OCR
    could not read reliably. Every usable row is imported; every row that could not be understood is reported back with
    its row number and the reason, never guessed or silently dropped. A Manager may import for any property; an Owner
    only for their own.
    """
    prop = (await db.execute(select(Property).where(Property.id == property_id))).scalar_one_or_none()
    if prop is None:
        raise HTTPException(status_code=404, detail="Property not found.")
    if current_user.role == UserRole.OWNER and prop.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="You can only import expenses for your own properties.")

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="The file is empty.")
    if len(data) > 5 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File is too large. The maximum size is 5 MB.")
    try:
        rows = read_spreadsheet(file.filename or "", data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if not rows:
        raise HTTPException(status_code=400, detail="No data rows were found (check the file has a header row plus at least one entry).")

    report = parse_expense_rows(rows)
    for parsed in report.good:
        db.add(Expense(
            category=parsed.category, amount=parsed.amount, expense_date=parsed.expense_date,
            vendor=parsed.vendor, description=parsed.description or "Bulk import",
            month=parsed.expense_date.strftime("%Y-%m"), property_id=property_id, document_id=None,
        ))
    if report.good:
        await db.commit()
        await invalidate_pattern("dashboard:*")

    return {
        "total_rows": report.total_rows,
        "imported": len(report.good),
        "skipped": [{"row": r.row, "reason": r.error} for r in report.bad],
        "truncated": report.total_rows > MAX_ROWS,
    }


@router.get("/rent-collection")
async def rent_collection(
    month: Optional[str] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.MANAGER)),
):
    """
    Monthly rent collection tracker - managers only.

    Filter by rent `month` (YYYY-MM, default: the current month in the business timezone) OR by the calendar days the money
    was received (`date_from` / `date_to`, inclusive, local dates). Dates are compared as local calendar days, and returned
    as plain "YYYY-MM-DD" strings, so no viewer's timezone can shift them.
    """
    try:
        month = valid_month(month)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    for d in (date_from, date_to):
        if d is not None and d.year < EARLIEST_YEAR:
            raise HTTPException(status_code=422, detail=f"Dates must be in {EARLIEST_YEAR} or later.")
    if date_from and date_to and date_from > date_to:
        raise HTTPException(status_code=422, detail="The 'from' date can't be after the 'to' date.")

    today = local_today()
    by_range = date_from is not None or date_to is not None
    if not by_range and not month:
        month = today.strftime("%Y-%m")

    prop_result = await db.execute(
        select(Property, User)
        .join(User, Property.tenant_id == User.id, isouter=True)
        .where(Property.tenant_id != None)
        .order_by(Property.id)
    )
    rows = prop_result.all()

    pay_query = select(Payment)
    if by_range:
        if date_from:
            pay_query = pay_query.where(Payment.payment_date >= day_bounds_utc(date_from)[0])
        if date_to:
            pay_query = pay_query.where(Payment.payment_date < day_bounds_utc(date_to)[1])
    else:
        pay_query = pay_query.where(Payment.month == month)
    by_property = defaultdict(list)
    for p in (await db.execute(pay_query)).scalars().all():
        by_property[p.property_id].append(p)

    collection = []
    for prop, tenant in rows:
        pays = by_property.get(prop.id, [])
        completed = [p for p in pays if p.status == PaymentStatus.COMPLETED]
        latest = max(completed or pays, key=lambda p: (p.payment_date, p.id)) if pays else None
        collection.append({
            "property_id":    prop.id,
            "property_title": prop.title,
            "city":           prop.city,
            "bedrooms":       prop.bedrooms,
            "rent_amount":    float(prop.rent_amount),
            "tenant_name":    tenant.full_name if tenant else "—",
            "tenant_email":   tenant.email if tenant else "—",
            "status":         PaymentStatus.COMPLETED.value if completed else (latest.status.value if latest else "pending"),
            "payment_date":   local_date_of(latest.payment_date).isoformat() if latest else None,
            "amount_paid":    float(sum(p.amount for p in completed)) if completed else None,
        })

    total     = len(collection)
    paid      = sum(1 for r in collection if r["status"] == "completed")
    collected = sum(r["amount_paid"] or 0 for r in collection if r["status"] == "completed")
    expected  = sum(r["rent_amount"] for r in collection)

    return {
        "month": None if by_range else month,
        "date_from": date_from.isoformat() if date_from else None,
        "date_to": date_to.isoformat() if date_to else None,
        "today": today.isoformat(),
        "collection": collection,
        "summary": {
            "total":            total,
            "paid":             paid,
            "pending":          total - paid,
            "collection_rate":  round(paid / total * 100) if total else 0,
            "total_collected":  collected,
            "total_expected":   expected,
        },
    }


@router.get("/expenses", response_model=List[ExpenseResponse])
async def list_expenses(
    property_id: int = None,
    month: str = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = select(Expense)
    if property_id:
        q = q.where(Expense.property_id == property_id)
    if month:
        q = q.where(Expense.month == month)
    q = q.order_by(Expense.expense_date.desc())
    result = await db.execute(q)
    return result.scalars().all()


@router.post("/send-reminders")
async def send_rent_reminders(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.MANAGER)),
):
    """Manager triggers rent due reminders for all active tenants."""
    from app.routers.notifications import push_notification

    res = await db.execute(
        select(Property).where(Property.tenant_id.isnot(None), Property.is_available == False)
    )
    properties = res.scalars().all()

    current_month = local_today().strftime("%B %Y")
    count = 0
    for prop in properties:
        if prop.tenant_id:
            await push_notification(
                prop.tenant_id, "rent_due",
                "Rent Due Reminder",
                f"Your rent of ₹{int(prop.rent_amount):,}/mo for '{prop.title}' is due for {current_month}. Please pay on time.",
            )
            count += 1

    return {"message": f"Reminders sent to {count} tenant(s)", "count": count}
