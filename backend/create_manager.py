"""
Creates the first Manager account on a fresh (production) database. Unlike seed.py it never deletes anything.

    docker exec -it property_backend python create_manager.py you@example.com "Your Name"

The password is asked for on the screen (not stored in shell history). On a host without an interactive terminal, set
MANAGER_PASSWORD in the environment instead. If the email already exists nothing is changed.
"""
import asyncio
import getpass
import os
import sys

from sqlalchemy import select

from app.database import AsyncSessionLocal, create_tables
from app.models.user import User, UserRole
from app.schemas.user import _check_password
from app.utils.security import hash_password


async def main(email: str, name: str, password: str) -> None:
    await create_tables()
    async with AsyncSessionLocal() as db:
        if (await db.execute(select(User).where(User.email == email))).scalar_one_or_none():
            raise SystemExit(f"{email} already exists - nothing changed.")
        db.add(User(email=email, full_name=name, hashed_password=hash_password(password), role=UserRole.MANAGER,
                    is_active=True, email_verified=True))
        await db.commit()
    print(f"Manager {email} created. Sign in, then create owners and tenants from the Manager dashboard.")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        raise SystemExit('Usage: python create_manager.py you@example.com "Your Name"')
    email, name = sys.argv[1].strip().lower(), sys.argv[2].strip()
    password = os.environ.get("MANAGER_PASSWORD") or getpass.getpass("Password for the new Manager: ")
    try:
        _check_password(password)
    except Exception as exc:                       # the same password rules as the sign-up form
        raise SystemExit(f"Password rejected: {getattr(exc, 'args', [exc])[0]}")
    asyncio.run(main(email, name, password))
