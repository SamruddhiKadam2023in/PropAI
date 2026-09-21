from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_
from typing import List, Optional
from datetime import datetime
import os, shutil

from app.database import get_db, get_mongo_db
from app.services import file_mirror
from app.services.property_listings import generate_listings
from app.models.property_model import Property
from app.models.user import User, UserRole
from app.schemas.property import PropertyCreate, PropertyUpdate, PropertyResponse
from app.utils.dependencies import get_current_user, require_roles
from app.utils.cache import get_cache, set_cache, invalidate_pattern

router = APIRouter(prefix="/properties", tags=["Properties"])


@router.post("/", response_model=PropertyResponse, status_code=201)
async def create_property(
    body: PropertyCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.OWNER, UserRole.MANAGER)),
):
    prop = Property(**body.model_dump(), owner_id=current_user.id)
    db.add(prop)
    await db.commit()
    await db.refresh(prop)
    await invalidate_pattern("properties:*")
    return prop


@router.get("/", response_model=List[PropertyResponse])
async def list_properties(
    city: str = None,
    available: bool = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    cache_key = f"properties:{current_user.id}:{city}:{available}"
    cached = await get_cache(cache_key)
    if cached:
        return cached

    q = select(Property)
    if city:
        q = q.where(Property.city.ilike(f"%{city}%"))
    if available is not None:
        q = q.where(Property.is_available == available)
    if current_user.role == UserRole.OWNER:
        q = q.where(Property.owner_id == current_user.id)
    elif current_user.role == UserRole.TENANT:
        q = q.where(Property.tenant_id == current_user.id)

    result = await db.execute(q)
    props = result.scalars().all()
    data = [PropertyResponse.model_validate(p).model_dump() for p in props]
    await set_cache(cache_key, data, ttl=120)
    return props


# ── These MUST come before /{prop_id} so FastAPI doesn't consume them as ints ──

@router.get("/search", response_model=List[PropertyResponse])
async def search_available_properties(
    city: Optional[str] = None,
    bedrooms: Optional[int] = None,
    max_rent: Optional[float] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Search available properties for rent — accessible to all roles."""
    q = select(Property).where(Property.is_available == True)
    if city:
        q = q.where(or_(
            Property.city.ilike(f"%{city}%"),
            Property.state.ilike(f"%{city}%"),
            Property.address.ilike(f"%{city}%"),
        ))
    if bedrooms:
        q = q.where(Property.bedrooms == bedrooms)
    if max_rent:
        q = q.where(Property.rent_amount <= max_rent)
    q = q.order_by(Property.rent_amount)
    result = await db.execute(q)
    return result.scalars().all()


@router.get("/listings")
async def external_listings(
    city: str,
    bedrooms: Optional[int] = None,
    max_rent: Optional[float] = None,
    current_user: User = Depends(get_current_user),
):
    """Generate realistic rental listings for any Indian city."""
    results = generate_listings(city, bedrooms=bedrooms, max_rent=max_rent)
    return results


@router.get("/my-applications")
async def my_applications(current_user: User = Depends(get_current_user)):
    """List current user's rental applications from MongoDB."""
    mongo = get_mongo_db()
    col = mongo["rental_applications"]
    cursor = col.find({"tenant_id": current_user.id}, {"_id": 0}).sort("applied_at", -1)
    return await cursor.to_list(length=50)


@router.get("/owner-applications")
async def owner_applications(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.OWNER, UserRole.MANAGER)),
):
    """List all rental applications for properties owned by this owner."""
    res = await db.execute(select(Property).where(Property.owner_id == current_user.id))
    prop_ids = [p.id for p in res.scalars().all()]
    if not prop_ids:
        return []
    mongo = get_mongo_db()
    cursor = mongo["rental_applications"].find(
        {"property_id": {"$in": prop_ids}, "source": {"$ne": "propai_listing"}},
    ).sort("applied_at", -1)
    apps = await cursor.to_list(length=100)
    for a in apps:
        a["_id"] = str(a["_id"])
    return apps


@router.get("/all-applications")
async def all_applications(
    current_user: User = Depends(require_roles(UserRole.MANAGER)),
):
    """Manager: list all rental applications across all properties."""
    mongo = get_mongo_db()
    cursor = mongo["rental_applications"].find(
        {"source": {"$ne": "propai_listing"}},
    ).sort("applied_at", -1)
    apps = await cursor.to_list(length=200)
    for a in apps:
        a["_id"] = str(a["_id"])
    return apps


async def _managed_application(db: AsyncSession, app_id: str, user: User) -> dict:
    """The application, if the caller may act on it: a Manager on any, an Owner only on applications for their own properties."""
    from bson import ObjectId
    from bson.errors import InvalidId
    try:
        oid = ObjectId(app_id)
    except (InvalidId, TypeError):
        raise HTTPException(status_code=404, detail="Application not found")
    app = await get_mongo_db()["rental_applications"].find_one({"_id": oid})
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
    if user.role == UserRole.OWNER:
        owned = (await db.execute(select(Property.id).where(Property.owner_id == user.id))).scalars().all()
        if app.get("property_id") not in owned:
            raise HTTPException(status_code=404, detail="Application not found")   # someone else's application looks like a missing one
    return app


@router.patch("/applications/{app_id}/approve")
async def approve_application(
    app_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.OWNER, UserRole.MANAGER)),
):
    """Approve a rental application — assigns tenant to property."""
    from bson import ObjectId
    mongo = get_mongo_db()
    col = mongo["rental_applications"]
    app = await _managed_application(db, app_id, current_user)

    # Assign tenant to property in PostgreSQL
    prop_id = app.get("property_id")
    tenant_id = app.get("tenant_id")
    if prop_id and tenant_id:
        res = await db.execute(select(Property).where(Property.id == prop_id))
        prop = res.scalar_one_or_none()
        if prop:
            prop.tenant_id = tenant_id
            prop.is_available = False
            from app.services.agreements import create_agreement
            from app.utils.dates import local_today
            await create_agreement(db, prop, tenant_id, local_today())     # the rent and 12-month term that later fix what is owed
            await db.commit()
            await invalidate_pattern("properties:*")   # so the new tenant sees their home immediately

    # Update application status
    await col.update_one({"_id": ObjectId(app_id)}, {"$set": {"status": "approved"}})
    # Reject all other pending applications for same property
    if prop_id:
        await col.update_many(
            {"property_id": prop_id, "status": "pending", "_id": {"$ne": ObjectId(app_id)}},
            {"$set": {"status": "rejected"}}
        )

    # Notify tenant
    from app.routers.notifications import push_notification
    if tenant_id and app:
        await push_notification(
            tenant_id, "approved",
            "Application Approved!",
            f"Congratulations! Your application for '{app.get('property_title')}' has been approved."
        )
    return {"message": "Application approved"}


@router.patch("/applications/{app_id}/reject")
async def reject_application(
    app_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.OWNER, UserRole.MANAGER)),
):
    """Reject a rental application."""
    from bson import ObjectId
    from app.routers.notifications import push_notification
    mongo = get_mongo_db()
    app = await _managed_application(db, app_id, current_user)
    await mongo["rental_applications"].update_one(
        {"_id": ObjectId(app_id)}, {"$set": {"status": "rejected"}}
    )
    if app and app.get("tenant_id"):
        await push_notification(
            app["tenant_id"], "rejected",
            "Application Update",
            f"Your application for '{app.get('property_title')}' was not approved this time."
        )
    return {"message": "Application rejected"}


@router.post("/enquiry")
async def submit_enquiry(
    body: dict,
    current_user: User = Depends(get_current_user),
):
    """Save a tenant enquiry for a PropAI listing into MongoDB."""
    mongo = get_mongo_db()
    await mongo["rental_applications"].insert_one({
        "property_id":      None,
        "property_title":   body.get("property_title", ""),
        "property_address": body.get("property_address", ""),
        "property_city":    body.get("property_city", ""),
        "rent_amount":      body.get("rent_amount", 0),
        "bedrooms":         body.get("bedrooms"),
        "area_sqft":        body.get("area_sqft"),
        "tenant_id":        current_user.id,
        "tenant_name":      current_user.full_name,
        "tenant_email":     current_user.email,
        "tenant_phone":     current_user.phone or "",
        "message":          body.get("message", ""),
        "source":           body.get("source", "propai_listing"),
        "status":           "enquiry",
        "applied_at":       datetime.utcnow().isoformat(),
    })
    return {"message": "Enquiry submitted successfully", "status": "enquiry"}


@router.post("/{prop_id}/apply")
async def apply_for_rent(
    prop_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Submit a rental application — stored in MongoDB, notifies owner + all managers."""
    res = await db.execute(select(Property).where(Property.id == prop_id))
    prop = res.scalar_one_or_none()
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")
    if not prop.is_available:
        raise HTTPException(status_code=400, detail="Property is not available")

    mongo = get_mongo_db()
    col = mongo["rental_applications"]

    existing = await col.find_one({"property_id": prop_id, "tenant_id": current_user.id, "status": "pending"})
    if existing:
        raise HTTPException(status_code=400, detail="You already applied for this property")

    await col.insert_one({
        "property_id":      prop_id,
        "property_title":   prop.title,
        "property_address": prop.address,
        "property_city":    prop.city,
        "rent_amount":      float(prop.rent_amount),
        "tenant_id":        current_user.id,
        "tenant_name":      current_user.full_name,
        "tenant_email":     current_user.email,
        "tenant_phone":     current_user.phone or "",
        "status":           "pending",
        "applied_at":       datetime.utcnow().isoformat(),
    })

    # Notify property owner
    from app.routers.notifications import push_notification
    notif_msg = f"{current_user.full_name} applied to rent '{prop.title}' (₹{int(prop.rent_amount):,}/mo)"
    if prop.owner_id:
        await push_notification(prop.owner_id, "new_application", "New Rental Application", notif_msg)

    # Notify all managers
    mgr_res = await db.execute(select(User).where(User.role == UserRole.MANAGER, User.is_active == True))
    for mgr in mgr_res.scalars().all():
        await push_notification(mgr.id, "new_application", "New Rental Application", notif_msg)

    return {"message": f"Application submitted for '{prop.title}'", "status": "pending"}


@router.post("/{prop_id}/upload-image")
async def upload_property_image(
    prop_id: int,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.OWNER, UserRole.MANAGER)),
):
    result = await db.execute(select(Property).where(Property.id == prop_id))
    prop = result.scalar_one_or_none()
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")

    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in [".jpg", ".jpeg", ".png", ".webp"]:
        raise HTTPException(status_code=400, detail="Only JPG, PNG, WEBP allowed")

    img_dir = "uploads/properties"
    os.makedirs(img_dir, exist_ok=True)
    filename = f"prop_{prop_id}{ext}"
    filepath = os.path.join(img_dir, filename)

    with open(filepath, "wb") as f:
        shutil.copyfileobj(file.file, f)

    await file_mirror.save(filepath)
    prop.image_url = f"/uploads/properties/{filename}"
    await db.commit()
    await invalidate_pattern("properties:*")
    return {"image_url": prop.image_url}


@router.get("/{prop_id}", response_model=PropertyResponse)
async def get_property(
    prop_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(Property).where(Property.id == prop_id))
    prop = result.scalar_one_or_none()
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")
    return prop


@router.patch("/{prop_id}", response_model=PropertyResponse)
async def update_property(
    prop_id: int,
    body: PropertyUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.OWNER, UserRole.MANAGER)),
):
    result = await db.execute(select(Property).where(Property.id == prop_id))
    prop = result.scalar_one_or_none()
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")
    if current_user.role == UserRole.OWNER and prop.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your property")

    old_rent = prop.rent_amount
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(prop, field, value)
    await db.commit()
    await db.refresh(prop)
    await invalidate_pattern("properties:*")

    if prop.tenant_id and prop.rent_amount != old_rent:   # tell the tenant about a rent change
        from app.routers.notifications import push_notification
        await push_notification(
            prop.tenant_id, "property_update", "Rent updated",
            f"The monthly rent for '{prop.title}' changed from ₹{int(old_rent):,} to ₹{int(prop.rent_amount):,}.",
        )
    return prop


@router.delete("/{prop_id}", status_code=204)
async def delete_property(
    prop_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.OWNER, UserRole.MANAGER)),
):
    result = await db.execute(select(Property).where(Property.id == prop_id))
    prop = result.scalar_one_or_none()
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")
    if current_user.role == UserRole.OWNER and prop.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your property")
    await db.delete(prop)
    await db.commit()
    await invalidate_pattern("properties:*")
