from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from motor.motor_asyncio import AsyncIOMotorClient
import redis.asyncio as aioredis
from app.config import settings
import logging

logger = logging.getLogger(__name__)

# ── PostgreSQL ──────────────────────────────────────────────────────────────
engine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.DEBUG,
    pool_pre_ping=True,
    pool_size=10,
    max_overflow=20,
)
AsyncSessionLocal = async_sessionmaker(
    engine, class_=AsyncSession, expire_on_commit=False
)


class Base(DeclarativeBase):
    pass


# ── MongoDB ─────────────────────────────────────────────────────────────────
mongo_client: AsyncIOMotorClient = None
mongo_db = None


def get_mongo_client() -> AsyncIOMotorClient:
    return mongo_client


def get_mongo_db():
    return mongo_db


# ── Redis ────────────────────────────────────────────────────────────────────
redis_client: aioredis.Redis = None


def get_redis() -> aioredis.Redis:
    return redis_client


# ── Session dependency ───────────────────────────────────────────────────────
async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()


# ── Startup / shutdown helpers ───────────────────────────────────────────────
async def connect_databases():
    global mongo_client, mongo_db, redis_client

    mongo_client = AsyncIOMotorClient(settings.MONGODB_URL)
    mongo_db = mongo_client.property_management
    logger.info("MongoDB connected.")

    redis_client = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
    logger.info("Redis connected.")


async def disconnect_databases():
    global mongo_client, redis_client
    if mongo_client:
        mongo_client.close()
    if redis_client:
        await redis_client.aclose()


async def create_tables():
    # Import all models so Base knows about them before create_all
    from app.models import user, property_model, document, financial, service_provider, agreement  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("Database tables created.")
