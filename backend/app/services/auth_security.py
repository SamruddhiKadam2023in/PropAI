"""
Redis-backed authentication safeguards: login throttling, email one-time codes, and rotating refresh tokens.

Failure policy: the throttle fails OPEN (a Redis outage must not lock everybody out; it is logged), while codes and refresh
tokens fail CLOSED (without Redis they simply cannot be issued or checked).
"""
import hashlib
import hmac
import logging
import secrets
from typing import Optional, Tuple

from fastapi import HTTPException
from redis.exceptions import RedisError

from app.config import settings
from app.database import get_redis

logger = logging.getLogger(__name__)


def _redis():
    client = get_redis()
    if client is None:
        raise HTTPException(status_code=503, detail="Authentication service is temporarily unavailable. Please try again.")
    return client


def too_many(message: str, retry_after: int) -> HTTPException:
    return HTTPException(status_code=429, detail=message, headers={"Retry-After": str(max(int(retry_after), 1))})


# ── Login throttling: N wrong passwords per (email, IP) per window ─────────────────────────────────────────────────────
def _fail_key(email: str, ip: str) -> str:
    return f"login_fail:{email}:{ip}"


async def login_retry_after(email: str, ip: str) -> int:
    """Seconds the caller must wait, or 0 if this (email, IP) may try."""
    try:
        client = get_redis()
        if client is None:
            return 0
        count = await client.get(_fail_key(email, ip))
        if count and int(count) >= settings.LOGIN_MAX_FAILURES:
            return max(await client.ttl(_fail_key(email, ip)), 1)
    except RedisError as exc:
        logger.error("login throttle unavailable (allowing): %s", exc)
    return 0


async def record_login_failure(email: str, ip: str) -> None:
    try:
        client = get_redis()
        if client is None:
            return
        key = _fail_key(email, ip)
        pipe = client.pipeline()
        pipe.incr(key)
        pipe.expire(key, settings.LOGIN_WINDOW_SECONDS, nx=True)      # the window starts at the first failure
        await pipe.execute()
    except RedisError as exc:
        logger.error("login throttle unavailable (not counting): %s", exc)


async def clear_login_failures(email: str, ip: str) -> None:
    try:
        client = get_redis()
        if client is not None:
            await client.delete(_fail_key(email, ip))
    except RedisError:
        pass


# ── Email one-time codes ───────────────────────────────────────────────────────────────────────────────────────────────
# Each purpose has its own namespace ("otp" = email verification, "pwreset" = password reset), so a code issued for one
# purpose can never be redeemed for the other and their cooldowns/caps are independent.
def _otp_hash(email: str, code: str, ns: str = "otp") -> str:
    return hmac.new(settings.SECRET_KEY.encode(), f"{ns}:{email}:{code}".encode(), hashlib.sha256).hexdigest()


async def otp_may_be_sent(email: str, ns: str = "otp") -> None:
    """Raises 429 while the resend cooldown or the hourly send cap is in force."""
    client = _redis()
    cooldown = await client.ttl(f"{ns}_cd:{email}")
    if cooldown and cooldown > 0:
        raise too_many(f"Please wait {cooldown} seconds before requesting another code.", cooldown)
    sent = await client.get(f"{ns}_sent:{email}")
    if sent and int(sent) >= settings.OTP_MAX_SENDS_PER_HOUR:
        raise too_many("Too many codes requested. Please try again later.", await client.ttl(f"{ns}_sent:{email}"))


async def start_cooldown(email: str, ns: str = "otp") -> None:
    client = _redis()
    await client.set(f"{ns}_cd:{email}", "1", ex=settings.OTP_RESEND_COOLDOWN_SECONDS)


async def issue_otp(email: str, ns: str = "otp") -> str:
    """Creates a fresh code (replacing any earlier one) and returns it. Only a keyed hash is stored, never the code."""
    client = _redis()
    code = "".join(str(secrets.randbelow(10)) for _ in range(settings.OTP_LENGTH))
    key = f"{ns}:{email}"
    pipe = client.pipeline()
    pipe.delete(key)
    pipe.hset(key, mapping={"h": _otp_hash(email, code, ns), "n": 0})
    pipe.expire(key, settings.OTP_TTL_SECONDS)
    pipe.set(f"{ns}_cd:{email}", "1", ex=settings.OTP_RESEND_COOLDOWN_SECONDS)
    pipe.incr(f"{ns}_sent:{email}")
    pipe.expire(f"{ns}_sent:{email}", 3600, nx=True)
    await pipe.execute()
    return code


async def verify_otp(email: str, code: str, ns: str = "otp") -> Tuple[str, int]:
    """('ok'|'invalid'|'locked'|'expired', attempts_left). A code is single-use and burns after too many wrong guesses."""
    client = _redis()
    key = f"{ns}:{email}"
    stored = await client.hget(key, "h")
    if not stored:
        return "expired", 0
    attempts = await client.hincrby(key, "n", 1)             # counted BEFORE comparing, so parallel guesses can't outrun the cap
    if attempts > settings.OTP_MAX_ATTEMPTS:
        await client.delete(key)
        return "locked", 0
    if hmac.compare_digest(stored, _otp_hash(email, code.strip(), ns)):
        await client.delete(key)
        return "ok", 0
    if attempts >= settings.OTP_MAX_ATTEMPTS:
        await client.delete(key)
        return "locked", 0
    return "invalid", settings.OTP_MAX_ATTEMPTS - attempts


async def clear_all_login_failures(email: str) -> None:
    """After a password reset the person must be able to sign in straight away, from any IP."""
    try:
        client = get_redis()
        if client is not None:
            async for key in client.scan_iter(match=f"login_fail:{email}:*"):
                await client.delete(key)
    except RedisError:
        pass


# ── Refresh tokens: opaque, stored hashed, rotated on every use, reuse revokes the whole session set ─────────────────────
def _sha(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


async def issue_refresh_token(user_id: int) -> str:
    client = _redis()
    token = secrets.token_urlsafe(48)
    digest, ttl = _sha(token), settings.REFRESH_TOKEN_EXPIRE_DAYS * 86400
    pipe = client.pipeline()
    pipe.set(f"rt:{digest}", str(user_id), ex=ttl)
    pipe.sadd(f"user_rt:{user_id}", digest)
    pipe.expire(f"user_rt:{user_id}", ttl)
    await pipe.execute()
    return token


async def consume_refresh_token(token: str) -> Optional[int]:
    """Returns the user id and invalidates the token (rotation). A token that was already used revokes every session of that user."""
    client = _redis()
    digest, ttl = _sha(token), settings.REFRESH_TOKEN_EXPIRE_DAYS * 86400
    pipe = client.pipeline(transaction=True)
    pipe.get(f"rt:{digest}")
    pipe.delete(f"rt:{digest}")
    user_id, _ = await pipe.execute()
    if user_id is None:
        replayed = await client.get(f"rt_used:{digest}")
        if replayed:                                          # someone is replaying a rotated token: assume theft
            await revoke_all_refresh_tokens(int(replayed))
            logger.warning("refresh token replay detected; revoked all sessions of user %s", replayed)
        return None
    await client.set(f"rt_used:{digest}", user_id, ex=ttl)
    await client.srem(f"user_rt:{user_id}", digest)
    return int(user_id)


async def revoke_refresh_token(token: str) -> None:
    client = _redis()
    digest = _sha(token)
    user_id = await client.get(f"rt:{digest}")
    await client.delete(f"rt:{digest}")
    if user_id:
        await client.srem(f"user_rt:{user_id}", digest)


async def revoke_all_refresh_tokens(user_id: int) -> None:
    client = _redis()
    digests = await client.smembers(f"user_rt:{user_id}")
    if digests:
        await client.delete(*[f"rt:{d}" for d in digests])
    await client.delete(f"user_rt:{user_id}")
