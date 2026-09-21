from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import faulthandler
import logging
import os
import signal

from app.config import settings
from app.database import create_tables, connect_databases, disconnect_databases
from app.services import file_mirror
from app.services.bootstrap import ensure_bootstrap_manager
from app.routers import auth, properties, documents, financial, analytics, reports
from app.routers import notifications, messages, config as config_router, maintenance, service_providers, agreements

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)
logger = logging.getLogger(__name__)

try:                                   # diagnostics: `kill -USR1 <pid>` prints what every thread is doing (find a stuck job)
    faulthandler.register(signal.SIGUSR1, all_threads=True)
except (AttributeError, ValueError, OSError):
    pass

app = FastAPI(
    title=settings.APP_NAME,
    description="AI-Driven Financial Analytics for Property Management",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# ── CORS ─────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_origin_regex=settings.ALLOWED_ORIGIN_REGEX or None,
    allow_credentials=True,
    expose_headers=["Content-Disposition", "Retry-After"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Static files ──────────────────────────────────────────────────────────────
# Only property photos are public. Uploaded documents (bills, receipts, …) are
# private: they are served exclusively by the authenticated GET /documents/{id}/file.
PROPERTY_IMAGES_DIR = os.path.join(settings.UPLOAD_DIR, "properties")
os.makedirs(PROPERTY_IMAGES_DIR, exist_ok=True)
app.mount("/uploads/properties", StaticFiles(directory=PROPERTY_IMAGES_DIR), name="property-images")

# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(auth.router)
app.include_router(properties.router)
app.include_router(documents.router)
app.include_router(financial.router)
app.include_router(analytics.router)
app.include_router(reports.router)
app.include_router(notifications.router)
app.include_router(messages.router)
app.include_router(config_router.router)
app.include_router(maintenance.router)
app.include_router(service_providers.router)
app.include_router(agreements.router)


# ── Lifecycle ─────────────────────────────────────────────────────────────────
@app.on_event("startup")
async def startup():
    logger.info("Starting up...")
    if not settings.DEBUG:
        problems = settings.production_problems()
        if problems:
            raise RuntimeError("Refusing to start with unsafe settings: " + "; ".join(problems))
        if not settings.SMTP_HOST:
            logger.warning("SMTP_HOST is empty: sign-up and password-reset emails cannot be sent.")
        if settings.cors_origins == ["http://localhost:3000", "http://127.0.0.1:3000"] and not settings.ALLOWED_ORIGIN_REGEX:
            logger.warning("Only localhost may call this API. Set FRONTEND_URL to the website's address.")
    await connect_databases()
    await create_tables()
    await file_mirror.restore_all()
    await ensure_bootstrap_manager()
    logger.info(f"{settings.APP_NAME} ready.")


@app.on_event("shutdown")
async def shutdown():
    await disconnect_databases()
    logger.info("Shutdown complete.")


# ── Root + health check ──────────────────────────────────────────────────────────────
@app.get("/", include_in_schema=False)
async def root():
    return {"app": settings.APP_NAME, "status": "ok", "docs": "/docs"}


@app.get("/health", tags=["Health"])
async def health():
    return {"status": "ok", "app": settings.APP_NAME}
