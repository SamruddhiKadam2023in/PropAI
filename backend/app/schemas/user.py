import re
from pydantic import BaseModel, EmailStr, Field, field_validator
from typing import Optional
from datetime import datetime
from app.config import settings
from app.models.user import UserRole

# bcrypt only looks at the first 72 bytes, so a longer password would be silently truncated. Refuse it instead.
PASSWORD_MAX_BYTES = 72


def _check_password(value: str) -> str:
    if len(value) < settings.PASSWORD_MIN_LENGTH:
        raise ValueError(f"Password must be at least {settings.PASSWORD_MIN_LENGTH} characters.")
    if len(value.encode("utf-8")) > PASSWORD_MAX_BYTES:
        raise ValueError(f"Password is too long (at most {PASSWORD_MAX_BYTES} bytes).")
    if not value.strip():
        raise ValueError("Password can't be only spaces.")
    return value


class UserCreate(BaseModel):
    """Public self-registration. Only tenant / owner accounts can be created this way (enforced in the router)."""
    email: EmailStr
    full_name: str = Field(min_length=1, max_length=255)
    password: str
    phone: Optional[str] = Field(default=None, max_length=20)
    role: UserRole = UserRole.TENANT

    @field_validator("password")
    @classmethod
    def _password_policy(cls, v):
        return _check_password(v)

    @field_validator("full_name")
    @classmethod
    def _name_not_blank(cls, v):
        v = v.strip()
        if not v:
            raise ValueError("Name can't be blank.")
        return v


class ManagerCreateUser(UserCreate):
    """A Manager creating an account for someone else (any role). The account starts out verified."""


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class VerifyEmail(BaseModel):
    email: EmailStr
    otp: str = Field(min_length=1, max_length=12)


class ResendOtp(BaseModel):
    email: EmailStr


class ForgotPassword(BaseModel):
    email: EmailStr


class ResetPassword(BaseModel):
    email: EmailStr
    otp: str = Field(min_length=1, max_length=12)
    new_password: str

    @field_validator("new_password")
    @classmethod
    def _password_policy(cls, v):
        return _check_password(v)


class RefreshRequest(BaseModel):
    refresh_token: str = Field(min_length=10, max_length=200)


class UserResponse(BaseModel):
    id: int
    email: str
    full_name: str
    phone: Optional[str] = None
    role: UserRole
    is_active: bool
    email_verified: bool = True
    created_at: datetime

    model_config = {"from_attributes": True}


PHONE_CHARS = re.compile(r"^[+\d\s().-]+$")


class UserUpdate(BaseModel):
    """What a person may change about themselves. Email, role and active status are deliberately NOT here."""
    full_name: Optional[str] = Field(default=None, max_length=255)
    phone: Optional[str] = Field(default=None, max_length=20)      # "" clears it

    @field_validator("full_name")
    @classmethod
    def _name(cls, v):
        if v is None:
            return v
        v = v.strip()
        if not v:
            raise ValueError("Name can't be blank.")
        return v

    @field_validator("phone")
    @classmethod
    def _phone(cls, v):
        if v is None:
            return v
        v = v.strip()
        if v == "":
            return None                                            # explicit clear
        digits = sum(c.isdigit() for c in v)
        if not PHONE_CHARS.match(v) or not 7 <= digits <= 15:
            raise ValueError("Enter a valid phone number (7 to 15 digits; +, spaces, dashes and brackets are fine).")
        return v


class ChangePassword(BaseModel):
    current_password: str = Field(min_length=1, max_length=200)
    new_password: str

    @field_validator("new_password")
    @classmethod
    def _password_policy(cls, v):
        return _check_password(v)


class ActiveUpdate(BaseModel):
    is_active: bool


class Token(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str
    expires_in: int          # access token lifetime, seconds
    user: UserResponse


class RegistrationStarted(BaseModel):
    """Result of public registration: an unverified account exists and a code was sent - no token is issued yet."""
    message: str
    email: str
    verification_required: bool = True
    email_sent: bool
    expires_in: int          # how long the code stays valid, seconds
    resend_in: int           # seconds until another code may be requested


class TokenData(BaseModel):
    user_id: Optional[int] = None
    role: Optional[str] = None
