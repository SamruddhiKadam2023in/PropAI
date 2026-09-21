"""Repair contacts: maintenance / repair professionals an Owner or Manager can call or WhatsApp."""
from decimal import Decimal
from typing import Annotated, List, Literal, Optional

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, EmailStr, Field, StringConstraints
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db, get_mongo_db
from app.models.property_model import Property
from app.models.service_provider import ServiceProvider
from app.models.user import User, UserRole
from app.services.provider_directory import SERVICE_CATEGORIES, suggest_category
from app.utils.dependencies import require_roles
from app.utils.phone import normalize_phone

router = APIRouter(prefix="/service-providers", tags=["Service Providers"])

STAFF = (UserRole.OWNER, UserRole.MANAGER)          # tenants never reach this data
MAX_PER_USER = 200
Category = Literal["plumber", "electrician", "ac_technician", "carpenter", "cleaning", "locksmith", "handyman"]
Text = lambda lo, hi: Annotated[str, StringConstraints(strip_whitespace=True, min_length=lo, max_length=hi)]


class ProviderIn(BaseModel):
    name: Text(2, 150)
    category: Category
    phone: Text(5, 30)
    whatsapp: Optional[Text(0, 30)] = None
    email: Optional[EmailStr] = None
    service_area: Text(2, 150)
    availability: Optional[Text(0, 80)] = None
    visit_charge: Optional[Annotated[float, Field(ge=0, le=100000)]] = None
    status: Literal["available", "unavailable"] = "available"
    description: Optional[Text(0, 500)] = None
    problem_types: List[Text(1, 40)] = Field(default_factory=list, max_length=8)


def _out(p: ServiceProvider, viewer: User) -> dict:
    """Only what the screen needs. The creator's id is never returned."""
    return {
        "id": p.id, "name": p.name, "category": p.category, "category_label": SERVICE_CATEGORIES.get(p.category, p.category),
        "phone": p.phone, "whatsapp": p.whatsapp, "email": p.email, "service_area": p.service_area, "availability": p.availability,
        "visit_charge": float(p.visit_charge) if p.visit_charge is not None else None, "status": p.status,
        "description": p.description, "problem_types": p.problem_types or [], "is_demo": bool(p.is_demo),
        "editable": (not p.is_demo) and p.created_by == viewer.id,
    }


def _visible(viewer: User):
    return or_(ServiceProvider.is_demo.is_(True), ServiceProvider.created_by == viewer.id)


def _clean(body: ProviderIn) -> dict:
    phone = normalize_phone(body.phone)
    if not phone:
        raise HTTPException(422, "Enter a valid phone number, e.g. 98765 43210 or +91 98765 43210.")
    whatsapp = None
    if body.whatsapp:
        whatsapp = normalize_phone(body.whatsapp)
        if not whatsapp:
            raise HTTPException(422, "Enter a valid WhatsApp number, or leave it empty.")
    problems, seen = [], set()
    for item in body.problem_types:
        if item.lower() not in seen:
            seen.add(item.lower()); problems.append(item)
    return {
        "name": body.name, "category": body.category, "phone": phone, "whatsapp": whatsapp, "email": body.email,
        "service_area": body.service_area, "availability": body.availability or None,
        "visit_charge": Decimal(str(body.visit_charge)).quantize(Decimal("0.01")) if body.visit_charge is not None else None,
        "status": body.status, "description": body.description or None, "problem_types": problems,
    }


@router.get("/categories")
async def categories(_: User = Depends(require_roles(*STAFF))):
    return {"categories": [{"key": k, "label": v} for k, v in SERVICE_CATEGORIES.items()]}


@router.get("/")
async def list_providers(
    category: Optional[Category] = Query(None),
    status: Optional[Literal["available", "unavailable"]] = Query(None),
    q: Optional[str] = Query(None, max_length=80),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles(*STAFF)),
):
    stmt = select(ServiceProvider).where(_visible(user))
    if category:
        stmt = stmt.where(ServiceProvider.category == category)
    if status:
        stmt = stmt.where(ServiceProvider.status == status)
    if q and q.strip():
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(or_(func.lower(ServiceProvider.name).like(like), func.lower(ServiceProvider.service_area).like(like), func.lower(func.coalesce(ServiceProvider.description, "")).like(like)))
    rows = (await db.execute(stmt.order_by(ServiceProvider.status.asc(), func.lower(ServiceProvider.name)))).scalars().all()
    return {"providers": [_out(p, user) for p in rows]}


@router.get("/for-request/{request_id}")
async def for_request(request_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(require_roles(*STAFF))):
    """Maintenance request -> recommended service category -> providers who can be contacted for it."""
    try:
        doc = await get_mongo_db()["maintenance_requests"].find_one({"_id": ObjectId(request_id)})
    except (InvalidId, TypeError):
        doc = None
    if not doc:
        raise HTTPException(404, "Request not found")
    prop = None
    if doc.get("property_id") is not None:
        prop = (await db.execute(select(Property).where(Property.id == doc["property_id"]))).scalar_one_or_none()
    if user.role == UserRole.OWNER and (prop is None or prop.owner_id != user.id):
        raise HTTPException(404, "Request not found")          # someone else's request looks the same as a missing one

    key, how = suggest_category(doc.get("title", ""), doc.get("description", ""), doc.get("category"))
    rows = (await db.execute(select(ServiceProvider).where(_visible(user), ServiceProvider.category == key))).scalars().all()
    city = (prop.city or "").strip().lower() if prop else ""
    items = []
    for p in rows:
        item = _out(p, user)
        item["area_match"] = bool(city) and city in (p.service_area or "").lower()
        items.append(item)
    available = sorted((i for i in items if i["status"] == "available"), key=lambda i: (not i["area_match"], i["name"].lower()))
    return {
        "request": {"id": request_id, "title": doc.get("title"), "category": doc.get("category", "other"), "property_title": doc.get("property_title"), "city": prop.city if prop else None},
        "suggestion": {"category": key, "label": SERVICE_CATEGORIES[key], "source": how},
        "providers": available,
        "unavailable_count": len(items) - len(available),
    }


@router.post("/", status_code=201)
async def create_provider(body: ProviderIn, db: AsyncSession = Depends(get_db), user: User = Depends(require_roles(*STAFF))):
    count = (await db.execute(select(func.count()).select_from(ServiceProvider).where(ServiceProvider.created_by == user.id))).scalar_one()
    if count >= MAX_PER_USER:
        raise HTTPException(422, f"You can keep up to {MAX_PER_USER} providers. Remove one before adding another.")
    provider = ServiceProvider(created_by=user.id, is_demo=False, **_clean(body))
    db.add(provider)
    await db.commit()
    await db.refresh(provider)
    return _out(provider, user)


async def _editable(db: AsyncSession, user: User, provider_id: int) -> ServiceProvider:
    p = (await db.execute(select(ServiceProvider).where(ServiceProvider.id == provider_id, _visible(user)))).scalar_one_or_none()
    if not p:
        raise HTTPException(404, "Provider not found")
    if p.is_demo:
        raise HTTPException(409, "Demo providers are read-only.")
    return p


@router.put("/{provider_id}")
async def update_provider(provider_id: int, body: ProviderIn, db: AsyncSession = Depends(get_db), user: User = Depends(require_roles(*STAFF))):
    p = await _editable(db, user, provider_id)
    for key, value in _clean(body).items():
        setattr(p, key, value)
    await db.commit()
    await db.refresh(p)
    return _out(p, user)


@router.delete("/{provider_id}", status_code=204)
async def delete_provider(provider_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(require_roles(*STAFF))):
    await db.delete(await _editable(db, user, provider_id))
    await db.commit()
    return Response(status_code=204)
