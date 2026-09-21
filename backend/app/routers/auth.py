from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import func, select
from typing import List, Optional

from app.config import settings
from app.database import get_db
from app.models.user import User, UserRole
from app.schemas.user import (
    ActiveUpdate, ChangePassword, ForgotPassword, ManagerCreateUser, RefreshRequest, RegistrationStarted, ResendOtp,
    ResetPassword, Token, UserCreate, UserLogin, UserResponse, UserUpdate, VerifyEmail,
)
from app.services import auth_security as sec
from app.services.email_service import email_delivery_available, send_otp_email
from app.utils.security import hash_password, verify_password, create_access_token
from app.utils.dependencies import get_current_user, require_roles

router = APIRouter(prefix="/auth", tags=["Authentication"])

# Public sign-up can only ever create these. Manager accounts come from an existing Manager (POST /auth/users) or the seed.
SELF_REGISTRATION_ROLES = (UserRole.TENANT, UserRole.OWNER)

# Compared against when the email is unknown, so "no such user" and "wrong password" take about the same time.
_DUMMY_HASH = hash_password("timing-equaliser-not-a-real-password")


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


async def _find_user(db: AsyncSession, email: str) -> Optional[User]:
    return (await db.execute(select(User).where(func.lower(User.email) == email.lower()))).scalar_one_or_none()


async def _session(user: User) -> Token:
    """A short-lived access token plus a rotating refresh token."""
    access = create_access_token({"sub": str(user.id), "role": user.role.value})
    return Token(
        access_token=access, refresh_token=await sec.issue_refresh_token(user.id), token_type="bearer",
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60, user=UserResponse.model_validate(user),
    )


async def _send_code(user: User) -> bool:
    code = await sec.issue_otp(user.email.lower())
    return await send_otp_email(user.email, user.full_name, code)


# ── Registration + email verification ──────────────────────────────────────────────────────────────────────────────────
@router.post("/register", response_model=RegistrationStarted, status_code=201)
async def register(body: UserCreate, db: AsyncSession = Depends(get_db)):
    """
    Public sign-up for tenants and owners. The account starts UNVERIFIED and no token is issued: the person must enter the code
    emailed to them (POST /auth/verify-email) first. The role is decided here, never trusted from the browser.
    """
    if body.role not in SELF_REGISTRATION_ROLES:
        raise HTTPException(status_code=403, detail="Manager accounts can't be created through sign-up. Ask an existing manager to add you.")

    email = str(body.email).lower()
    existing = await _find_user(db, email)
    if existing is not None and existing.email_verified:
        raise HTTPException(status_code=400, detail="Email already registered")
    await sec.otp_may_be_sent(email)              # before touching the account, so a refused request changes nothing

    if existing is None:
        user = User(email=email, full_name=body.full_name, phone=body.phone, role=body.role,
                    hashed_password=hash_password(body.password), is_active=True, email_verified=False)
        db.add(user)
    else:                                          # an earlier attempt that was never verified: the newest details win
        user = existing
        user.full_name, user.phone, user.role = body.full_name, body.phone, body.role
        user.hashed_password = hash_password(body.password)
    await db.commit()
    await db.refresh(user)

    sent = await _send_code(user)
    return RegistrationStarted(
        message="Account created. Enter the code we emailed you to verify your address." if sent
        else "Account created, but we couldn't send the email. Use 'Resend code' to try again.",
        email=email, email_sent=sent, expires_in=settings.OTP_TTL_SECONDS, resend_in=settings.OTP_RESEND_COOLDOWN_SECONDS,
    )


@router.post("/verify-email", response_model=Token)
async def verify_email(body: VerifyEmail, db: AsyncSession = Depends(get_db)):
    """Checks the emailed one-time code. On success the account is verified and the person is signed in."""
    email = str(body.email).lower()
    user = await _find_user(db, email)
    if user is None:                                # same answer as a wrong code: don't reveal which emails have accounts
        raise HTTPException(status_code=400, detail="That code is incorrect or has expired.")
    if user.email_verified:
        raise HTTPException(status_code=400, detail="This email is already verified. Please sign in.")

    result, left = await sec.verify_otp(email, body.otp)
    if result == "expired":
        raise HTTPException(status_code=400, detail="That code has expired. Request a new one.")
    if result == "locked":
        raise HTTPException(status_code=400, detail="Too many incorrect attempts. Request a new code.")
    if result == "invalid":
        raise HTTPException(status_code=400, detail=f"That code is incorrect. {left} attempt{'s' if left != 1 else ''} left.")

    user.email_verified = True
    await db.commit()
    await db.refresh(user)
    return await _session(user)


@router.post("/resend-otp")
async def resend_otp(body: ResendOtp, db: AsyncSession = Depends(get_db)):
    """Sends a new code. The reply is identical whether or not the address is awaiting verification."""
    if not email_delivery_available():              # a server-wide fact, so it says nothing about any particular account
        raise HTTPException(status_code=503, detail="Email delivery isn't set up on the server yet, so verification codes can't be sent.")
    email = str(body.email).lower()
    await sec.otp_may_be_sent(email)
    user = await _find_user(db, email)
    if user is not None and not user.email_verified:
        await _send_code(user)
    else:
        await sec.start_cooldown(email)             # same cooldown, so timing and behaviour look the same
    return {"message": "If that account is waiting to be verified, a new code has been sent.",
            "expires_in": settings.OTP_TTL_SECONDS, "resend_in": settings.OTP_RESEND_COOLDOWN_SECONDS}


# ── Forgotten password ─────────────────────────────────────────────────────────────────────────────────────────────────
@router.post("/forgot-password")
async def forgot_password(body: ForgotPassword, db: AsyncSession = Depends(get_db)):
    """
    Emails a one-time reset code. The reply is identical whether or not the address has an account, so this can't be used to
    find out who is registered. Only verified, active accounts are actually sent a code.
    """
    if not email_delivery_available():
        raise HTTPException(status_code=503, detail="Email delivery isn't set up on the server yet, so reset codes can't be sent.")
    email = str(body.email).lower()
    await sec.otp_may_be_sent(email, ns="pwreset")
    user = await _find_user(db, email)
    if user is not None and user.is_active and user.email_verified:
        code = await sec.issue_otp(email, ns="pwreset")
        await send_otp_email(user.email, user.full_name, code, purpose="reset")
    else:
        await sec.start_cooldown(email, ns="pwreset")
    return {"message": "If an account exists for that email, we've sent it a reset code.",
            "expires_in": settings.OTP_TTL_SECONDS, "resend_in": settings.OTP_RESEND_COOLDOWN_SECONDS}


@router.post("/reset-password")
async def reset_password(body: ResetPassword, db: AsyncSession = Depends(get_db)):
    """Sets a new password when the emailed code is right. Every existing session is signed out."""
    email = str(body.email).lower()
    user = await _find_user(db, email)
    if user is None or not user.is_active or not user.email_verified:
        raise HTTPException(status_code=400, detail="That code is incorrect or has expired.")

    result, left = await sec.verify_otp(email, body.otp, ns="pwreset")
    if result == "expired":
        raise HTTPException(status_code=400, detail="That code has expired. Request a new one.")
    if result == "locked":
        raise HTTPException(status_code=400, detail="Too many incorrect attempts. Request a new code.")
    if result == "invalid":
        raise HTTPException(status_code=400, detail=f"That code is incorrect. {left} attempt{'s' if left != 1 else ''} left.")

    user.hashed_password = hash_password(body.new_password)
    await db.commit()
    await sec.revoke_all_refresh_tokens(user.id)       # anyone who had the old password loses their session
    await sec.clear_all_login_failures(email)
    return {"message": "Password updated. Please sign in with your new password."}


# ── Sign in / session ──────────────────────────────────────────────────────────────────────────────────────────────────
@router.post("/login", response_model=Token)
async def login(body: UserLogin, request: Request, db: AsyncSession = Depends(get_db)):
    email, ip = str(body.email).lower(), _client_ip(request)
    wait = await sec.login_retry_after(email, ip)
    if wait:
        raise sec.too_many(f"Too many failed sign-in attempts. Try again in {wait} seconds.", wait)

    user = await _find_user(db, email)
    password_ok = verify_password(body.password, user.hashed_password if user else _DUMMY_HASH)
    if not user or not password_ok:
        await sec.record_login_failure(email, ip)
        raise HTTPException(status_code=401, detail="Invalid email or password")
    await sec.clear_login_failures(email, ip)
    if not user.is_active:
        raise HTTPException(status_code=400, detail="Account is deactivated")
    if not user.email_verified:
        try:                                        # right password, unverified address: send a fresh code if the cooldown allows
            await sec.otp_may_be_sent(email)
            await _send_code(user)
        except HTTPException:
            pass
        raise HTTPException(status_code=403, detail={"code": "email_not_verified", "email": email,
                                                     "message": "Please verify your email address. We've sent you a code."})
    return await _session(user)


@router.post("/refresh", response_model=Token)
async def refresh(body: RefreshRequest, db: AsyncSession = Depends(get_db)):
    """Exchanges a refresh token for a new access token AND a new refresh token. The old refresh token stops working."""
    user_id = await sec.consume_refresh_token(body.refresh_token)
    if user_id is None:
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token")
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if user is None or not user.is_active or not user.email_verified:
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token")
    return await _session(user)


@router.post("/logout")
async def logout(body: RefreshRequest):
    """Revokes the given refresh token. Always succeeds, so a client can call it without caring about the token's state."""
    await sec.revoke_refresh_token(body.refresh_token)
    return {"message": "Signed out"}


@router.post("/change-password", response_model=Token)
async def change_password(
    body: ChangePassword,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Changes the signed-in person's password. Their OTHER devices are signed out (all refresh tokens are revoked) and this device
    gets a fresh session in the response. Guessing the current password counts against the same lockout as signing in, so a stolen
    access token can't be used to brute-force it.
    """
    email, ip = current_user.email.lower(), _client_ip(request)
    wait = await sec.login_retry_after(email, ip)
    if wait:
        raise sec.too_many(f"Too many failed attempts. Try again in {wait} seconds.", wait)
    if not verify_password(body.current_password, current_user.hashed_password):
        await sec.record_login_failure(email, ip)
        raise HTTPException(status_code=400, detail="Your current password is incorrect.")
    await sec.clear_login_failures(email, ip)
    if verify_password(body.new_password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="Choose a new password that is different from your current one.")

    current_user.hashed_password = hash_password(body.new_password)
    await db.commit()
    await db.refresh(current_user)
    await sec.revoke_all_refresh_tokens(current_user.id)
    return await _session(current_user)


@router.get("/me", response_model=UserResponse)
async def me(current_user: User = Depends(get_current_user)):
    return current_user


# ── Manager-only user administration ───────────────────────────────────────────────────────────────────────────────────
@router.post("/users", response_model=UserResponse, status_code=201)
async def create_user(
    body: ManagerCreateUser,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.MANAGER)),
):
    """A Manager creates an account for someone else, with any role (this is the only way to create another Manager)."""
    email = str(body.email).lower()
    if await _find_user(db, email) is not None:
        raise HTTPException(status_code=400, detail="Email already registered")
    user = User(email=email, full_name=body.full_name, phone=body.phone, role=body.role,
                hashed_password=hash_password(body.password), is_active=True, email_verified=True)
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


@router.patch("/users/{user_id}/active", response_model=UserResponse)
async def set_user_active(
    user_id: int,
    body: ActiveUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.MANAGER)),
):
    """
    A Manager switches an account off or back on. A deactivated person is refused on their very next request (the API checks the flag
    every time) and cannot refresh or sign in. Managers can't deactivate themselves, so the platform can never lose its last manager.
    """
    if user_id == current_user.id and not body.is_active:
        raise HTTPException(status_code=400, detail="You can't deactivate your own account.")
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found.")
    user.is_active = body.is_active
    await db.commit()
    await db.refresh(user)
    if not body.is_active:
        await sec.revoke_all_refresh_tokens(user.id)
    return user


@router.get("/users", response_model=List[UserResponse])
async def list_users(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.MANAGER, UserRole.OWNER)),
):
    """List all users — managers and owners only."""
    result = await db.execute(select(User).order_by(User.role, User.full_name))
    return result.scalars().all()


@router.patch("/me", response_model=UserResponse)
async def update_me(
    body: UserUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    sent = body.model_fields_set                      # tells "left out" apart from "explicitly cleared"
    if "full_name" in sent and body.full_name is not None:
        current_user.full_name = body.full_name
    if "phone" in sent:
        current_user.phone = body.phone               # "" or null clears it
    await db.commit()
    await db.refresh(current_user)
    return current_user
