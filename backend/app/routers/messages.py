"""
Messaging — tenant ↔ owner in-platform messaging (MongoDB).
Use-case diagram: "Message property owner" (tenant) / reply (owner).
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
from bson import ObjectId

from app.database import get_db, get_mongo_db
from app.models.user import User, UserRole
from app.models.property_model import Property
from app.utils.dependencies import get_current_user
from app.utils.phone import normalize_phone

router = APIRouter(prefix="/messages", tags=["Messages"])


async def _tenant_contact_ids(db: AsyncSession, tenant: User) -> set:
    """The only people a tenant may contact: the owner(s) of the properties they rent."""
    res = await db.execute(select(Property.owner_id).where(Property.tenant_id == tenant.id))
    return {owner_id for owner_id in res.scalars().all() if owner_id}


class MessageCreate(BaseModel):
    to_user_id: int
    subject: Optional[str] = "Property Query"
    body: str


@router.get("/contacts")
async def get_contacts(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return list of users this person can message."""
    from app.models.user import User as UserModel
    contacts = []

    if current_user.role == UserRole.TENANT:
        # Tenant → their property owner. The phone number (normalised to E.164, or null when
        # unusable) is only ever included for these authorised contacts, and only for tenants.
        owner_ids = list(await _tenant_contact_ids(db, current_user))
        if owner_ids:
            res2 = await db.execute(
                select(UserModel).where(UserModel.id.in_(owner_ids))
            )
            for u in res2.scalars().all():
                contacts.append({
                    "id": u.id, "name": u.full_name, "role": u.role, "email": u.email,
                    "phone": normalize_phone(u.phone),
                })

    elif current_user.role == UserRole.OWNER:
        # Owner → all their tenants
        res = await db.execute(
            select(Property).where(
                Property.owner_id == current_user.id,
                Property.tenant_id != None,
            )
        )
        props = res.scalars().all()
        tenant_ids = list({p.tenant_id for p in props if p.tenant_id})
        if tenant_ids:
            res2 = await db.execute(
                select(UserModel).where(UserModel.id.in_(tenant_ids))
            )
            for u in res2.scalars().all():
                contacts.append({"id": u.id, "name": u.full_name, "role": u.role, "email": u.email})

    elif current_user.role == UserRole.MANAGER:
        # Manager → all users
        res = await db.execute(select(UserModel).where(UserModel.id != current_user.id))
        for u in res.scalars().all():
            contacts.append({"id": u.id, "name": u.full_name, "role": u.role, "email": u.email})

    return contacts


@router.get("/")
async def get_messages(
    with_user_id: Optional[int] = None,
    current_user: User = Depends(get_current_user),
):
    """Get messages. Optionally filter by conversation partner."""
    mongo = get_mongo_db()
    col = mongo["messages"]

    if with_user_id:
        query = {
            "$or": [
                {"from_id": current_user.id, "to_id": with_user_id},
                {"from_id": with_user_id,    "to_id": current_user.id},
            ]
        }
    else:
        query = {
            "$or": [
                {"from_id": current_user.id},
                {"to_id":   current_user.id},
            ]
        }

    cursor = col.find(query, {"_id": 1, "from_id": 1, "from_name": 1, "from_role": 1,
                               "to_id": 1, "to_name": 1, "subject": 1, "body": 1,
                               "read": 1, "created_at": 1}).sort("created_at", -1)
    docs = await cursor.to_list(length=100)
    for d in docs:
        d["id"] = str(d.pop("_id"))
    return docs


@router.post("/")
async def send_message(
    body: MessageCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Send a message to another user."""
    from app.models.user import User as UserModel
    res = await db.execute(select(UserModel).where(UserModel.id == body.to_user_id))
    recipient = res.scalar_one_or_none()
    if current_user.role == UserRole.TENANT and (
        not recipient or recipient.id not in await _tenant_contact_ids(db, current_user)
    ):
        # Same answer whether or not the user exists, so ids can't be probed.
        raise HTTPException(status_code=403, detail="You can only message the owner of your property.")
    if not recipient:
        raise HTTPException(status_code=404, detail="Recipient not found")

    mongo = get_mongo_db()
    col = mongo["messages"]
    await col.insert_one({
        "from_id":   current_user.id,
        "from_name": current_user.full_name,
        "from_role": current_user.role,
        "to_id":     recipient.id,
        "to_name":   recipient.full_name,
        "to_role":   recipient.role,
        "subject":   body.subject or "Property Query",
        "body":      body.body,
        "read":      False,
        "created_at": datetime.utcnow().isoformat(),
    })

    # Notify recipient
    from app.routers.notifications import push_notification
    await push_notification(
        recipient.id,
        "new_message",
        f"New message from {current_user.full_name}",
        body.body[:120],
    )

    return {"ok": True, "to": recipient.full_name}


@router.patch("/{msg_id}/read")
async def mark_message_read(msg_id: str, current_user: User = Depends(get_current_user)):
    mongo = get_mongo_db()
    col = mongo["messages"]
    try:
        await col.update_one(
            {"_id": ObjectId(msg_id), "to_id": current_user.id},
            {"$set": {"read": True}},
        )
    except Exception:
        pass
    return {"ok": True}


@router.get("/unread-count")
async def unread_message_count(current_user: User = Depends(get_current_user)):
    mongo = get_mongo_db()
    col = mongo["messages"]
    count = await col.count_documents({"to_id": current_user.id, "read": False})
    return {"count": count}
