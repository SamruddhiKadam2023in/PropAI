"""
Notification system — in-app notifications stored in MongoDB.
Every read/update is scoped to the authenticated user's own notifications.
"""
from datetime import datetime, timezone

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, HTTPException, Query

from app.database import get_mongo_db
from app.models.user import User
from app.utils.dependencies import get_current_user

router = APIRouter(prefix="/notifications", tags=["Notifications"])


@router.get("/")
async def get_notifications(
    unread_only: bool = False,
    limit: int = Query(50, ge=1, le=100),
    skip: int = Query(0, ge=0),
    current_user: User = Depends(get_current_user),
):
    query = {"user_id": current_user.id}
    if unread_only:
        query["read"] = False
    cursor = (
        get_mongo_db()["notifications"]
        .find(query, {"_id": 1, "type": 1, "title": 1, "message": 1, "read": 1, "created_at": 1})
        .sort("created_at", -1)
        .skip(skip)
        .limit(limit)
    )
    docs = await cursor.to_list(length=limit)
    for d in docs:
        d["id"] = str(d.pop("_id"))
    return docs


@router.get("/unread-count")
async def unread_count(current_user: User = Depends(get_current_user)):
    count = await get_mongo_db()["notifications"].count_documents({"user_id": current_user.id, "read": False})
    return {"count": count}


@router.patch("/read-all")
async def mark_all_read(current_user: User = Depends(get_current_user)):
    result = await get_mongo_db()["notifications"].update_many(
        {"user_id": current_user.id, "read": False},
        {"$set": {"read": True}},
    )
    return {"ok": True, "updated": result.modified_count}


@router.patch("/{notif_id}/read")
async def mark_read(notif_id: str, current_user: User = Depends(get_current_user)):
    try:
        oid = ObjectId(notif_id)
    except (InvalidId, TypeError):
        raise HTTPException(status_code=404, detail="Notification not found")
    result = await get_mongo_db()["notifications"].update_one(
        {"_id": oid, "user_id": current_user.id},          # someone else's notification never matches
        {"$set": {"read": True}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Notification not found")
    return {"ok": True}


# ── Utility function used internally ─────────────────────────────────────────

async def push_notification(user_id: int, notif_type: str, title: str, message: str):
    """Insert a notification into MongoDB."""
    await get_mongo_db()["notifications"].insert_one({
        "user_id":    user_id,
        "type":       notif_type,
        "title":      title,
        "message":    message,
        "read":       False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
