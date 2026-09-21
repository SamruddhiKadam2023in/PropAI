"""Rental agreements and the early-exit (terminated / abandoned) outstanding-rent rule. All figures are computed here, never sent by a client."""
from datetime import date
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.agreement import Agreement, AgreementStatus
from app.models.property_model import Property
from app.models.user import User, UserRole
from app.services.agreements import (
    DEFAULT_TERM_MONTHS, EARLY_EXIT, MAX_TERM_MONTHS, create_agreement, evaluate, paid_towards,
)
from app.utils.cache import invalidate_pattern
from app.utils.dates import EARLIEST_YEAR, local_today
from app.utils.dependencies import get_current_user, require_roles

router = APIRouter(prefix="/agreements", tags=["Agreements"])
STAFF = (UserRole.OWNER, UserRole.MANAGER)


class AgreementCreate(BaseModel):
    property_id: int
    start_date: date
    term_months: int = Field(default=DEFAULT_TERM_MONTHS, ge=1, le=MAX_TERM_MONTHS)
    monthly_rent: Optional[float] = Field(default=None, gt=0, le=10_000_000)     # defaults to the property's rent


class AgreementEnd(BaseModel):
    status: Literal["terminated", "abandoned"]
    terminated_on: Optional[date] = None                                          # the day the tenant left; defaults to today
    reason: Optional[str] = Field(default=None, max_length=500)


def _ref(agreement_id: int) -> str:
    return f"AGR-{agreement_id:06d}"


async def _shape(db: AsyncSession, rows) -> List[dict]:
    """rows: (Agreement, Property, User-tenant) tuples -> API dicts with the server-computed figures."""
    paid = await paid_towards(db, [a.id for a, _, _ in rows])
    today = local_today()
    out = []
    for a, prop, tenant in rows:
        info = evaluate(a, paid.get(a.id, 0), today)
        out.append({
            "id": a.id, "reference": _ref(a.id),
            "tenant_id": a.tenant_id, "tenant_name": tenant.full_name if tenant else None, "tenant_email": tenant.email if tenant else None,
            "property_id": a.property_id, "property_title": prop.title if prop else None,
            "property_address": ", ".join(x for x in (prop.address, prop.city) if x) if prop else None,
            "start_date": a.start_date.isoformat(), "end_date": a.end_date.isoformat(),
            "terminated_on": a.terminated_on.isoformat() if a.terminated_on else None,
            "termination_reason": a.termination_reason,
            "can_end_early": a.status == AgreementStatus.ACTIVE.value and today <= a.end_date,
            "today": today.isoformat(),
            **info,
        })
    return out


def _base_query():
    return (select(Agreement, Property, User)
            .join(Property, Property.id == Agreement.property_id)
            .join(User, User.id == Agreement.tenant_id))


def _scope(q, user: User):
    """A tenant sees only their own agreements; an owner only those on their own properties; a manager everything."""
    if user.role == UserRole.TENANT:
        return q.where(Agreement.tenant_id == user.id)
    if user.role == UserRole.OWNER:
        return q.where(Property.owner_id == user.id)
    return q


async def _load_visible(db: AsyncSession, agreement_id: int, user: User) -> dict:
    rows = (await db.execute(_scope(_base_query(), user).where(Agreement.id == agreement_id))).all()
    if not rows:
        raise HTTPException(status_code=404, detail="Agreement not found.")     # also what a stranger gets: existence isn't revealed
    return (await _shape(db, [tuple(rows[0])]))[0]


@router.get("")
async def list_agreements(
    status: Optional[Literal["active", "completed", "terminated", "abandoned", "outstanding"]] = None,
    property_id: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Agreements visible to the caller, newest first. status=outstanding keeps only early exits that still owe money."""
    q = _scope(_base_query(), current_user)
    if property_id:
        q = q.where(Agreement.property_id == property_id)
    rows = (await db.execute(q.order_by(Agreement.start_date.desc(), Agreement.id.desc()))).all()
    items = await _shape(db, [tuple(r) for r in rows])
    if status == "outstanding":
        items = [i for i in items if i["settlement"] == "outstanding"]
    elif status:
        items = [i for i in items if i["status"] == status]
    return {
        "items": items,
        "totals": {
            "agreements": len(items),
            "early_exits": sum(1 for i in items if i["status"] in EARLY_EXIT),
            "with_outstanding": sum(1 for i in items if i["settlement"] == "outstanding"),
            "outstanding_total": round(sum(i["abandonment_outstanding"] for i in items), 2),
        },
    }


@router.get("/{agreement_id}")
async def get_agreement(agreement_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    return await _load_visible(db, agreement_id, current_user)


async def _managed_property(db: AsyncSession, property_id: int, user: User) -> Property:
    prop = (await db.execute(select(Property).where(Property.id == property_id))).scalar_one_or_none()
    if prop is None:
        raise HTTPException(status_code=404, detail="Property not found.")
    if user.role == UserRole.OWNER and prop.owner_id != user.id:
        raise HTTPException(status_code=403, detail="You can only manage agreements on your own properties.")
    return prop


@router.post("", status_code=201)
async def record_agreement(
    body: AgreementCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*STAFF)),
):
    """Records the agreement for the property's current tenant (the rent and term that fix what they owe)."""
    prop = await _managed_property(db, body.property_id, current_user)
    if prop.tenant_id is None:
        raise HTTPException(status_code=409, detail="This property has no tenant, so there is nobody to record an agreement for.")
    today = local_today()
    if body.start_date.year < EARLIEST_YEAR:
        raise HTTPException(status_code=422, detail=f"The start date must be in {EARLIEST_YEAR} or later.")
    if body.start_date > today:
        raise HTTPException(status_code=422, detail="The start date can't be in the future.")
    running = (await db.execute(
        select(Agreement).where(Agreement.property_id == prop.id, Agreement.tenant_id == prop.tenant_id,
                                Agreement.status == AgreementStatus.ACTIVE.value, Agreement.end_date >= today)
    )).scalars().first()
    if running:
        raise HTTPException(status_code=409, detail=f"{_ref(running.id)} is still running for this tenant. End it before recording a new one.")
    agreement = await create_agreement(db, prop, prop.tenant_id, body.start_date, body.term_months, body.monthly_rent)
    await db.commit()
    return await _load_visible(db, agreement.id, current_user)


@router.post("/{agreement_id}/end")
async def end_agreement_early(
    agreement_id: int,
    body: AgreementEnd,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*STAFF)),
):
    """
    The tenant has left before the term ended. Marks the agreement terminated/abandoned and frees the property. The rent still
    owed is NOT stored - it is recomputed from the agreement and its payments every time it is read.
    """
    agreement = (await db.execute(select(Agreement).where(Agreement.id == agreement_id).with_for_update())).scalar_one_or_none()
    if agreement is None:
        raise HTTPException(status_code=404, detail="Agreement not found.")
    prop = await _managed_property(db, agreement.property_id, current_user)

    today = local_today()
    if agreement.status in EARLY_EXIT:
        raise HTTPException(status_code=409, detail=f"{_ref(agreement.id)} has already been recorded as {agreement.status}.")
    if agreement.status != AgreementStatus.ACTIVE.value or today > agreement.end_date:
        raise HTTPException(status_code=409, detail="This agreement's term has already ended, so it can't be ended early.")
    left_on = body.terminated_on or today
    if left_on > today:
        raise HTTPException(status_code=422, detail="The day the tenant left can't be in the future.")
    if left_on < agreement.start_date:
        raise HTTPException(status_code=422, detail="The tenant can't leave before the agreement started.")
    if left_on >= agreement.end_date:
        raise HTTPException(status_code=422, detail="The agreement ends on or before that day, so this isn't an early exit.")

    agreement.status = body.status
    agreement.terminated_on = left_on
    agreement.termination_reason = (body.reason or "").strip() or None
    agreement.terminated_by = current_user.id
    if prop.tenant_id == agreement.tenant_id:        # the home is free again; never disturb a newer tenant
        prop.tenant_id = None
        prop.is_available = True
    await db.commit()
    await invalidate_pattern("properties:*")
    await invalidate_pattern(f"dashboard:{agreement.tenant_id}:*")

    shaped = await _load_visible(db, agreement.id, current_user)
    try:   # tell the tenant what they still owe; a notification failure must never undo the termination
        from app.routers.notifications import push_notification
        owed = shaped["abandonment_outstanding"]
        detail = (f"You still owe ₹{int(round(owed)):,} under this agreement." if owed > 0 else "Nothing further is owed under this agreement.")
        await push_notification(
            agreement.tenant_id, "agreement_ended", f"Agreement {shaped['status_label'].lower()}",
            f"Your agreement {shaped['reference']} for '{prop.title}' was recorded as {shaped['status']}. {detail}",
        )
    except Exception:
        pass
    return shaped
