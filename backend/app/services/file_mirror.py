"""
Optional copy of every uploaded file inside MongoDB, for hosts whose disk is wiped when the app restarts (free Hugging Face Spaces).

With MIRROR_UPLOADS_TO_MONGO=true:
  * every file saved under UPLOAD_DIR (bills, property photos) is also stored in the `file_mirror` collection,
  * on start-up every mirrored file that is missing from the disk is written back, so nothing changes for the rest of the app,
  * deleting a file deletes its copy.
With the setting off (the default, and on any server with a persistent disk) all of this does nothing.
"""
import logging
import os
from datetime import datetime, timezone
from typing import Optional

from bson import Binary

from app.config import settings
from app.database import get_mongo_db

logger = logging.getLogger(__name__)
COLLECTION = "file_mirror"
MAX_RESTORE_BYTES = 400 * 1024 * 1024        # safety limit for one start-up restore


def enabled() -> bool:
    return bool(settings.MIRROR_UPLOADS_TO_MONGO)


def _root() -> str:
    return os.path.realpath(settings.UPLOAD_DIR)


def key_for(path: str) -> Optional[str]:
    """'uploads/documents/5/ab.png' -> 'documents/5/ab.png' (None if the path is outside the uploads folder)."""
    real = os.path.realpath(path)
    if not real.startswith(_root() + os.sep):
        return None
    return os.path.relpath(real, _root()).replace(os.sep, "/")


async def save(path: Optional[str]) -> None:
    """Copy a file that was just written to disk into MongoDB. Never raises: the upload itself has already succeeded."""
    if not enabled() or not path:
        return
    key = key_for(path)
    if not key or not os.path.isfile(path):
        return
    try:
        with open(path, "rb") as fh:
            data = fh.read()
        await get_mongo_db()[COLLECTION].replace_one(
            {"_id": key}, {"_id": key, "data": Binary(data), "size": len(data), "saved_at": datetime.now(timezone.utc)}, upsert=True
        )
    except Exception:
        logger.warning("Could not mirror %s to MongoDB", key, exc_info=True)


async def delete(path: Optional[str]) -> None:
    if not enabled() or not path:
        return
    key = key_for(path)
    if not key:
        return
    try:
        await get_mongo_db()[COLLECTION].delete_one({"_id": key})
    except Exception:
        logger.warning("Could not remove the MongoDB copy of %s", key, exc_info=True)


async def restore_all() -> int:
    """Write every mirrored file that is missing on disk back to UPLOAD_DIR. Returns how many were restored."""
    if not enabled():
        return 0
    restored, total = 0, 0
    try:
        async for item in get_mongo_db()[COLLECTION].find({}):
            key = str(item["_id"])
            target = os.path.realpath(os.path.join(_root(), *key.split("/")))
            if not target.startswith(_root() + os.sep) or os.path.exists(target):
                continue
            data = bytes(item["data"])
            total += len(data)
            if total > MAX_RESTORE_BYTES:
                logger.warning("File restore stopped at %d MB (safety limit)", MAX_RESTORE_BYTES // (1024 * 1024))
                break
            os.makedirs(os.path.dirname(target), exist_ok=True)
            with open(target, "wb") as fh:
                fh.write(data)
            restored += 1
    except Exception:
        logger.warning("Restoring uploaded files from MongoDB failed", exc_info=True)
    if restored:
        logger.info("Restored %d uploaded file(s) from MongoDB", restored)
    return restored
