import json
from typing import Optional, Any
from app.database import get_redis


async def get_cache(key: str) -> Optional[Any]:
    redis = get_redis()
    if not redis:
        return None
    value = await redis.get(key)
    return json.loads(value) if value else None


async def set_cache(key: str, value: Any, ttl: int = 300) -> None:
    redis = get_redis()
    if not redis:
        return
    await redis.setex(key, ttl, json.dumps(value, default=str))


async def delete_cache(key: str) -> None:
    redis = get_redis()
    if not redis:
        return
    await redis.delete(key)


async def invalidate_pattern(pattern: str) -> None:
    """Delete all keys matching a pattern (e.g. 'dashboard:*')."""
    redis = get_redis()
    if not redis:
        return
    keys = await redis.keys(pattern)
    if keys:
        await redis.delete(*keys)
