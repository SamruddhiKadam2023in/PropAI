from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Annotated, List, Literal, Optional

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, StringConstraints, model_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db, get_mongo_db
from app.models.property_model import Property
from app.models.user import User, UserRole
from app.routers.notifications import push_notification
from app.services.maintenance_costs import PROVIDER_TYPES, build_service_block, money
from app.utils.dependencies import get_current_user, require_roles

router = APIRouter(prefix="/maintenance", tags=["Maintenance"])

CATEGORIES = ("plumbing", "electrical", "appliance", "furniture", "pest_control", "cleaning", "structural", "other")

# Owner-side bookkeeping. Never returned to tenants or managers, so their responses stay exactly as before.
OWNER_ONLY_FIELDS = ("service", "source")

Money = Annotated[float, Field(ge=0, le=10_000_000)]


class MaintenanceCreate(BaseModel):
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=120)]
    description: Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)] = ""
    urgency: Literal["low", "medium", "high"] = "medium"
    category: Literal[CATEGORIES] = "other"
    property_id: Optional[int] = None


class ChargeLine(BaseModel):
    label: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]
    amount: Money


class ServiceUpdate(BaseModel):
    provider_name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=120)]
    provider_type: Literal[PROVIDER_TYPES] = "independent"
    service_type: Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=80)]
    scheduled_date: date
    completed_date: Optional[date] = None
    service_fee: Money
    additional_charges: List[ChargeLine] = Field(default_factory=list, max_length=10)
    payment_status: Literal["pending", "paid"] = "pending"
    invoice_no: Optional[Annotated[str, StringConstraints(strip_whitespace=True, max_length=40)]] = None

    @model_validator(mode="after")
    def _dates_make_sense(self):
        if self.completed_date and self.completed_date < self.scheduled_date:
            raise ValueError("The completion date can't be before the service date.")
        return self


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _serialize(doc: dict, owner_view: bool = False) -> dict:
    """API shape of a request (adds `id`, drops Mongo's `_id`; older records without a category read as 'other')."""
    doc = dict(doc)
    doc["id"] = str(doc.pop("_id"))
    doc.setdefault("category", "other")
    if owner_view:
        doc.setdefault("source", "tenant")
    else:
        for field in OWNER_ONLY_FIELDS:
            doc.pop(field, None)
    return doc


async def _owned_property_ids(db: AsyncSession, owner: User) -> List[int]:
    res = await db.execute(select(Property.id).where(Property.owner_id == owner.id))
    return list(res.scalars().all())


@router.post("/")
async def create_request(
    body: MaintenanceCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.TENANT)),
):
    """A tenant raises a request for a property they rent."""
    q = select(Property).where(Property.tenant_id == current_user.id)
    if body.property_id is not None:
        q = q.where(Property.id == body.property_id)
    prop = (await db.execute(q.order_by(Property.id))).scalars().first()
    if prop is None:
        if body.property_id is not None:
            raise HTTPException(status_code=403, detail="That property isn't linked to your account.")
        raise HTTPException(status_code=400, detail="You don't have a rented property to raise a request for.")

    now = _now()
    doc = {
        "tenant_id":      current_user.id,
        "tenant_name":    current_user.full_name,
        "property_id":    prop.id,
        "property_title": prop.title,
        "title":          body.title,
        "description":    body.description,
        "urgency":        body.urgency,
        "category":       body.category,
        "status":         "open",
        "created_at":     now,
        "updated_at":     now,
    }
    result = await get_mongo_db()["maintenance_requests"].insert_one(doc)
    doc["_id"] = result.inserted_id

    if prop.owner_id:
        await push_notification(
            prop.owner_id, "maintenance",
            "New Maintenance Request",
            f"{current_user.full_name} raised a {body.urgency} priority issue: {body.title}",
        )
    await push_notification(
        current_user.id, "maintenance",
        "Maintenance request received",
        f"We've sent your request '{body.title}' to the property owner.",
    )

    return {"message": "Request submitted", "id": str(result.inserted_id), "request": _serialize(doc)}


@router.get("/")
async def list_requests(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    mongo = get_mongo_db()
    owner_view = current_user.role == UserRole.OWNER
    limit = 100

    if current_user.role == UserRole.TENANT:
        query = {"tenant_id": current_user.id}
    elif owner_view:
        # Owners see the requests (and service records) for their own properties.
        query = {"property_id": {"$in": await _owned_property_ids(db, current_user)}}
        limit = 500
    else:
        query = {}

    docs = await mongo["maintenance_requests"].find(query).sort("created_at", -1).to_list(length=limit)
    return [_serialize(d, owner_view) for d in docs]


@router.get("/summary")
async def owner_summary(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.OWNER)),
):
    """Counts and money totals across the owner's maintenance records (computed on the server)."""
    query = {"property_id": {"$in": await _owned_property_ids(db, current_user)}}
    docs = await get_mongo_db()["maintenance_requests"].find(query).to_list(length=2000)

    zero = Decimal("0.00")
    by_status, by_category, by_property = {}, {}, {}
    billed = paid = zero
    with_service = 0
    for d in docs:
        by_status[d.get("status", "open")] = by_status.get(d.get("status", "open"), 0) + 1
        svc = d.get("service")
        if not svc:
            continue
        with_service += 1
        total = money(svc.get("total_amount", 0))
        billed += total
        if svc.get("payment_status") == "paid":
            paid += total
        cat = by_category.setdefault(d.get("category", "other"), {"count": 0, "total": zero})
        cat["count"] += 1
        cat["total"] += total
        prop = by_property.setdefault(d.get("property_id"), {"property_title": d.get("property_title"), "count": 0, "total": zero})
        prop["count"] += 1
        prop["total"] += total

    return {
        "records": len(docs),
        "records_with_service": with_service,
        "by_status": {s: by_status.get(s, 0) for s in ("open", "in_progress", "resolved")},
        "total_billed": float(billed),
        "paid": float(paid),
        "pending": float(billed - paid),
        "by_category": sorted(
            ({"category": k, "count": v["count"], "total": float(v["total"])} for k, v in by_category.items()),
            key=lambda x: -x["total"],
        ),
        "by_property": sorted(
            ({"property_id": k, "property_title": v["property_title"], "count": v["count"], "total": float(v["total"])} for k, v in by_property.items()),
            key=lambda x: -x["total"],
        ),
    }


class StatusUpdate(BaseModel):
    status: Literal["open", "in_progress", "resolved"] = "in_progress"


@router.patch("/{req_id}/status")
async def update_status(
    req_id: str,
    body: StatusUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.OWNER, UserRole.MANAGER)),
):
    """Moves a request between open / in progress / resolved: a Manager for any request, an Owner only on their own properties."""
    try:
        oid = ObjectId(req_id)
    except (InvalidId, TypeError):
        raise HTTPException(status_code=404, detail="Request not found")
    mongo = get_mongo_db()
    req = await mongo["maintenance_requests"].find_one({"_id": oid})
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    if current_user.role == UserRole.OWNER and req.get("property_id") not in await _owned_property_ids(db, current_user):
        raise HTTPException(status_code=404, detail="Request not found")      # someone else's request looks the same as a missing one

    new_status = body.status
    await mongo["maintenance_requests"].update_one(
        {"_id": oid},
        {"$set": {"status": new_status, "updated_at": _now()}},
    )

    label = {"in_progress": "In Progress", "resolved": "Resolved", "open": "Reopened"}.get(new_status, new_status)
    if req.get("tenant_id"):
        await push_notification(
            req["tenant_id"], "maintenance",
            f"Maintenance Update — {label}",
            f"Your request '{req.get('title')}' has been marked as {label}.",
        )
    return {"message": f"Status updated to {new_status}"}


@router.patch("/{req_id}/service")
async def update_service(
    req_id: str,
    body: ServiceUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.OWNER)),
):
    """
    The property owner records who did the work and what it cost. The total is always calculated
    here (service fee + additional charges); any total sent by a client is ignored.
    Tenants never see this data.
    """
    try:
        oid = ObjectId(req_id)
    except (InvalidId, TypeError):
        raise HTTPException(status_code=404, detail="Request not found")

    col = get_mongo_db()["maintenance_requests"]
    req = await col.find_one({"_id": oid})
    if not req or req.get("property_id") not in await _owned_property_ids(db, current_user):
        raise HTTPException(status_code=404, detail="Request not found")      # someone else's request looks the same as a missing one

    service = build_service_block(
        provider_name=body.provider_name, provider_type=body.provider_type, service_type=body.service_type,
        scheduled_date=body.scheduled_date, completed_date=body.completed_date, service_fee=body.service_fee,
        additional_charges=[c.model_dump() for c in body.additional_charges],
        payment_status=body.payment_status, invoice_no=body.invoice_no,
    )
    service["updated_at"] = _now()          # deliberately not the request's own updated_at, which tenants can see
    await col.update_one({"_id": oid}, {"$set": {"service": service}})
    return {"message": "Service details saved", "request": _serialize(await col.find_one({"_id": oid}), owner_view=True)}
