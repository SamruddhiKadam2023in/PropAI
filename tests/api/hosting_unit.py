"""Unit tests for the hosting features: Neon-style database addresses, the MongoDB copy of uploads, and the first-Manager bootstrap.

Runs INSIDE the backend container (it imports app.*):
    docker exec -i property_backend python - < tests/api/hosting_unit.py
tests/run_all.py does this for you. Uses a throw-away Postgres database and a unique file key; both are removed.
"""
import asyncio
import os
import sys
import uuid
from urllib.parse import urlsplit

import asyncpg
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

results = []


def check(name, ok, detail=""):
    results.append(bool(ok))
    print(("PASS " if ok else "FAIL ") + name + (f"  [{str(detail)[:170]}]" if detail != "" else ""))


from app.config import Settings, settings  # noqa: E402

print("== 1. Database addresses from Neon / Render / Supabase ==")
mk = lambda url: Settings(DATABASE_URL=url).DATABASE_URL
check("postgres:// -> asyncpg driver", mk("postgres://u:p@h:5432/db") == "postgresql+asyncpg://u:p@h:5432/db", mk("postgres://u:p@h:5432/db"))
neon = "postgresql://user:pw@ep-cool-123.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"
check("Neon address: sslmode=require becomes ssl=require and channel_binding is dropped",
      mk(neon) == "postgresql+asyncpg://user:pw@ep-cool-123.ap-southeast-1.aws.neon.tech/neondb?ssl=require", mk(neon))
check("an address that is already asyncpg-style is left alone", mk("postgresql+asyncpg://u:p@h/db?ssl=require") == "postgresql+asyncpg://u:p@h/db?ssl=require")
check("no query string: untouched", mk("postgresql://u:p@h/db") == "postgresql+asyncpg://u:p@h/db")


async def ssl_param_accepted():
    """asyncpg must understand the rewritten ?ssl=require: the local Postgres has no SSL, so the ONLY acceptable failure is 'rejected SSL'."""
    parts = urlsplit(settings.DATABASE_URL)
    url = f"postgresql://{parts.username}:{parts.password}@{parts.hostname}:{parts.port or 5432}{parts.path}?sslmode=require&channel_binding=require"
    engine = create_async_engine(Settings(DATABASE_URL=url).DATABASE_URL)
    try:
        async with engine.connect():
            return True, "connected"
    except Exception as exc:                                  # noqa: BLE001
        return ("SSL" in str(exc).upper() or "ssl" in str(exc)), f"{type(exc).__name__}: {exc}"
    finally:
        await engine.dispose()


ok, detail = asyncio.run(ssl_param_accepted())
check("asyncpg accepts the rewritten address (it tries SSL; only the local server refuses)", ok, detail)

print("== 2. MongoDB copy of uploaded files ==")
from app.database import connect_databases, disconnect_databases, get_mongo_db  # noqa: E402
from app.services import file_mirror  # noqa: E402


async def mirror_tests():
    await connect_databases()
    settings.MIRROR_UPLOADS_TO_MONGO = True
    folder = os.path.join(settings.UPLOAD_DIR, "mirrortest_" + uuid.uuid4().hex[:8])
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, "bill.bin")
    payload = os.urandom(300_000)
    open(path, "wb").write(payload)
    key = file_mirror.key_for(path)
    try:
        check("key is relative to the uploads folder", key and not key.startswith("uploads") and key.endswith("/bill.bin"), key)
        await file_mirror.save(path)
        doc = await get_mongo_db()[file_mirror.COLLECTION].find_one({"_id": key})
        check("save() stores the bytes in MongoDB", doc is not None and bytes(doc["data"]) == payload and doc["size"] == 300_000)
        os.remove(path)
        n = await file_mirror.restore_all()
        check("after the disk is wiped, restore_all() brings the file back, byte for byte",
              n >= 1 and os.path.isfile(path) and open(path, "rb").read() == payload, n)
        n2 = await file_mirror.restore_all()
        check("a second restore does not touch files that already exist", n2 == 0, n2)
        await file_mirror.delete(path)
        check("delete() removes the MongoDB copy", await get_mongo_db()[file_mirror.COLLECTION].find_one({"_id": key}) is None)
        outside = "/tmp/outside.bin"
        open(outside, "wb").write(b"x")
        check("a file outside the uploads folder is never mirrored", file_mirror.key_for(outside) is None)
        await get_mongo_db()[file_mirror.COLLECTION].insert_one({"_id": "../../../tmp/evil_" + key[-6:], "data": b"evil", "size": 4})
        await file_mirror.restore_all()
        check("a tampered '../' key is never written outside the uploads folder", not os.path.exists("/tmp/evil_" + key[-6:]))
        settings.MIRROR_UPLOADS_TO_MONGO = False
        await file_mirror.save(path)
        check("with the setting OFF nothing is copied", await get_mongo_db()[file_mirror.COLLECTION].find_one({"_id": key}) is None)
    finally:
        settings.MIRROR_UPLOADS_TO_MONGO = False
        await get_mongo_db()[file_mirror.COLLECTION].delete_many({"_id": {"$regex": "mirrortest_|evil_"}})
        for f in os.listdir(folder) if os.path.isdir(folder) else []:
            os.remove(os.path.join(folder, f))
        if os.path.isdir(folder):
            os.rmdir(folder)
        await disconnect_databases()


asyncio.run(mirror_tests())

print("== 3. First Manager from settings (no shell needed) ==")
from app.database import Base  # noqa: E402
from app.models.user import User, UserRole  # noqa: E402
from app.services import bootstrap  # noqa: E402
from sqlalchemy import select  # noqa: E402


async def bootstrap_tests():
    parts = urlsplit(settings.DATABASE_URL.replace("+asyncpg", ""))
    admin = await asyncpg.connect(user=parts.username, password=parts.password, host=parts.hostname, port=parts.port or 5432, database="postgres")
    dbname = "bootstrap_" + uuid.uuid4().hex[:8]
    await admin.execute(f'CREATE DATABASE "{dbname}"')
    engine = create_async_engine(f"postgresql+asyncpg://{parts.username}:{parts.password}@{parts.hostname}:{parts.port or 5432}/{dbname}")
    try:
        from app.models import user, property_model, document, financial, service_provider, agreement  # noqa: F401
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        Session = async_sessionmaker(engine, expire_on_commit=False)
        bootstrap.AsyncSessionLocal = Session
        old = (settings.BOOTSTRAP_MANAGER_EMAIL, settings.BOOTSTRAP_MANAGER_NAME, settings.BOOTSTRAP_MANAGER_PASSWORD)

        settings.BOOTSTRAP_MANAGER_EMAIL, settings.BOOTSTRAP_MANAGER_PASSWORD = "", ""
        check("nothing configured -> nothing happens", await bootstrap.ensure_bootstrap_manager() is False)

        settings.BOOTSTRAP_MANAGER_EMAIL, settings.BOOTSTRAP_MANAGER_PASSWORD = "First.Manager@Example.com", "short"
        check("a weak password is refused (same rules as sign-up)", await bootstrap.ensure_bootstrap_manager() is False)

        settings.BOOTSTRAP_MANAGER_NAME, settings.BOOTSTRAP_MANAGER_PASSWORD = "First Manager", "Strong-Pass-2026"
        check("on an empty database the first Manager is created", await bootstrap.ensure_bootstrap_manager() is True)
        async with Session() as db:
            u = (await db.execute(select(User).where(User.email == "first.manager@example.com"))).scalar_one_or_none()
        from app.utils.security import verify_password
        check("...as an active, verified MANAGER with the given name and a hashed password",
              u and u.role == UserRole.MANAGER and u.is_active and u.email_verified and u.full_name == "First Manager"
              and u.hashed_password != "Strong-Pass-2026" and verify_password("Strong-Pass-2026", u.hashed_password), u and u.role)

        settings.BOOTSTRAP_MANAGER_EMAIL = "second@example.com"
        check("once a Manager exists the settings are ignored (no second account)", await bootstrap.ensure_bootstrap_manager() is False)
        async with Session() as db:
            count = len((await db.execute(select(User))).scalars().all())
        check("exactly one user exists", count == 1, count)
        settings.BOOTSTRAP_MANAGER_EMAIL, settings.BOOTSTRAP_MANAGER_NAME, settings.BOOTSTRAP_MANAGER_PASSWORD = old
    finally:
        await engine.dispose()
        await admin.execute(f'DROP DATABASE "{dbname}" WITH (FORCE)')
        await admin.close()


asyncio.run(bootstrap_tests())

print("== 4. Email over HTTPS (Brevo) for hosts that block SMTP ==")
import json  # noqa: E402
import threading  # noqa: E402
from http.server import BaseHTTPRequestHandler, HTTPServer  # noqa: E402
from app.services import email_service as es  # noqa: E402

captured = {"status": 201, "calls": []}


class FakeBrevo(BaseHTTPRequestHandler):
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        captured["calls"].append({"key": self.headers.get("api-key"), "path": self.path, "body": body})
        self.send_response(captured["status"])
        self.end_headers()
        self.wfile.write(b'{"messageId": "x"}' if captured["status"] < 300 else b'{"message": "Key not found"}')

    def log_message(self, *a):
        pass


server = HTTPServer(("127.0.0.1", 2626), FakeBrevo)
threading.Thread(target=server.serve_forever, daemon=True).start()


async def email_tests():
    keep = (settings.BREVO_API_KEY, settings.BREVO_API_URL, settings.SMTP_HOST, settings.SMTP_FROM, settings.EMAIL_DEV_LOG_CODES)
    try:
        settings.BREVO_API_URL, settings.SMTP_FROM, settings.SMTP_HOST, settings.EMAIL_DEV_LOG_CODES = "http://127.0.0.1:2626/v3/smtp/email", "PropAI <sender@example.org>", "", False
        settings.BREVO_API_KEY = ""
        check("no key, no SMTP: delivery is reported unavailable", es.email_delivery_available() is False)
        settings.BREVO_API_KEY = "test-key-123"
        check("with a Brevo key delivery is reported available", es.email_delivery_available() is True)
        ok = await es.send_otp_email("tenant@example.com", "Asha", "123456")
        c = captured["calls"][-1] if captured["calls"] else {}
        b = c.get("body", {})
        check("the code email is sent through the API (True)", ok is True and len(captured["calls"]) == 1)
        check("the API key travels in the api-key header", c.get("key") == "test-key-123")
        check("sender comes from SMTP_FROM, recipient and subject are right",
              b.get("sender") == {"name": "PropAI", "email": "sender@example.org"} and b.get("to") == [{"email": "tenant@example.com"}] and "123456" in b.get("subject", ""), b.get("sender"))
        check("both the HTML and the plain-text bodies contain the code", "123456" in b.get("htmlContent", "") and "123456" in b.get("textContent", "") and "Asha" in b.get("htmlContent", ""))
        ok = await es.send_otp_email("tenant@example.com", "Asha", "654321", purpose="reset")
        check("a password-reset email is sent the same way", ok is True and "reset" in captured["calls"][-1]["body"]["subject"].lower())
        captured["status"] = 401
        ok = await es.send_otp_email("tenant@example.com", "Asha", "111111")
        check("a rejected key returns False (no crash, user can retry)", ok is False)
        settings.BREVO_API_URL = "http://127.0.0.1:1/unreachable"
        ok = await es.send_otp_email("tenant@example.com", "Asha", "222222")
        check("an unreachable email service returns False (no crash)", ok is False)
    finally:
        settings.BREVO_API_KEY, settings.BREVO_API_URL, settings.SMTP_HOST, settings.SMTP_FROM, settings.EMAIL_DEV_LOG_CODES = keep


asyncio.run(email_tests())
server.shutdown()

print(f"\n{sum(results)}/{len(results)} passed")
sys.exit(0 if all(results) else 1)
