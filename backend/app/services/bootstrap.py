"""
Creates the very first Manager from environment settings, for hosts that give no shell (free Hugging Face Spaces).

Set BOOTSTRAP_MANAGER_EMAIL, BOOTSTRAP_MANAGER_NAME and BOOTSTRAP_MANAGER_PASSWORD once. It only acts when the database has NO
Manager at all; once a Manager exists it does nothing. Delete the three settings after your first sign-in.
"""
import logging

from sqlalchemy import select

from app.config import settings
from app.database import AsyncSessionLocal
from app.models.user import User, UserRole
from app.schemas.user import _check_password
from app.utils.security import hash_password

logger = logging.getLogger(__name__)


async def ensure_bootstrap_manager() -> bool:
    email = (settings.BOOTSTRAP_MANAGER_EMAIL or "").strip().lower()
    password = settings.BOOTSTRAP_MANAGER_PASSWORD or ""
    if not email or not password:
        return False
    try:
        _check_password(password)
    except ValueError as exc:
        logger.error("BOOTSTRAP_MANAGER_PASSWORD rejected: %s", exc)
        return False
    async with AsyncSessionLocal() as db:
        if (await db.execute(select(User.id).where(User.role == UserRole.MANAGER).limit(1))).first():
            logger.info("A Manager already exists; the BOOTSTRAP_MANAGER_* settings are ignored (you can delete them).")
            return False
        if (await db.execute(select(User.id).where(User.email == email))).first():
            logger.error("BOOTSTRAP_MANAGER_EMAIL belongs to a non-manager account; nothing created.")
            return False
        db.add(User(email=email, full_name=(settings.BOOTSTRAP_MANAGER_NAME or "Manager").strip(), hashed_password=hash_password(password),
                    role=UserRole.MANAGER, is_active=True, email_verified=True))
        await db.commit()
    logger.info("First Manager %s created from BOOTSTRAP_MANAGER_* settings. Sign in, then delete those settings.", email)
    return True
