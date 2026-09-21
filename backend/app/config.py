from pydantic import field_validator
from pydantic_settings import BaseSettings
from typing import Optional

DEFAULT_SECRET_KEY = "change-this-secret-key-in-production"


class Settings(BaseSettings):
    # Database
    DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres123@localhost:5432/property_management"
    MONGODB_URL: str = "mongodb://mongo:mongo123@localhost:27017"
    REDIS_URL: str = "redis://localhost:6379"

    # Auth
    SECRET_KEY: str = DEFAULT_SECRET_KEY
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15          # short-lived; the refresh token renews it
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # Sign-up hardening
    PASSWORD_MIN_LENGTH: int = 8
    LOGIN_MAX_FAILURES: int = 5                    # wrong passwords per (email, IP) ...
    LOGIN_WINDOW_SECONDS: int = 60                 # ... within this window -> HTTP 429
    OTP_LENGTH: int = 6
    OTP_TTL_SECONDS: int = 600                     # a code is valid for 10 minutes
    OTP_MAX_ATTEMPTS: int = 5                      # wrong guesses before the code is burned
    OTP_RESEND_COOLDOWN_SECONDS: int = 60
    OTP_MAX_SENDS_PER_HOUR: int = 5

    # Outgoing email (OTP codes). With SMTP_HOST empty, codes are written to the server log instead - fine for a demo,
    # never for production.
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USERNAME: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM: str = "PropAI <no-reply@propai.local>"
    SMTP_STARTTLS: bool = True                     # STARTTLS on port 587
    SMTP_SSL: bool = False                         # implicit TLS on port 465
    # Development only: with no SMTP configured, print codes in the server log instead of failing. Never enable in production.
    EMAIL_DEV_LOG_CODES: bool = False

    # File storage
    UPLOAD_DIR: str = "uploads"
    MAX_FILE_SIZE: int = 10 * 1024 * 1024  # 10MB

    # OCR / NLP
    CONFIDENCE_THRESHOLD: float = 0.65

    # Rent dates/months are calendar dates in this timezone (never derived from UTC)
    APP_TIMEZONE: str = "Asia/Kolkata"

    # Phone numbers stored without a country code are assumed to belong to this one
    DEFAULT_PHONE_COUNTRY_CODE: str = "91"

    # App
    APP_NAME: str = "AI Property Management"
    DEBUG: bool = False
    ALLOWED_ORIGINS: list = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]
    # The deployed website's address(es), comma separated, e.g. https://propai.onrender.com  (added to ALLOWED_ORIGINS)
    FRONTEND_URL: str = ""
    # Optional pattern for preview deployments, e.g. https://.*\.vercel\.app  (a "*" inside ALLOWED_ORIGINS does NOT work)
    ALLOWED_ORIGIN_REGEX: str = ""

    @field_validator("DATABASE_URL")
    @classmethod
    def _async_driver(cls, v: str) -> str:
        # Hosting providers hand out postgres:// or postgresql://; the async engine needs the asyncpg driver named.
        for prefix in ("postgres://", "postgresql://"):
            if v.startswith(prefix):
                return "postgresql+asyncpg://" + v[len(prefix):]
        return v

    @property
    def cors_origins(self) -> list:
        extra = [u.strip().rstrip("/") for u in self.FRONTEND_URL.split(",") if u.strip()]
        return list(dict.fromkeys([*self.ALLOWED_ORIGINS, *extra]))

    def production_problems(self) -> list:
        """Settings that are fine on a laptop but unsafe on the internet. Only checked when DEBUG is off."""
        problems = []
        if self.SECRET_KEY == DEFAULT_SECRET_KEY or len(self.SECRET_KEY) < 32:
            problems.append("SECRET_KEY is the placeholder or shorter than 32 characters (anyone could forge logins)")
        if self.EMAIL_DEV_LOG_CODES:
            problems.append("EMAIL_DEV_LOG_CODES is on (one-time codes would be written to the log)")
        return problems

    class Config:
        env_file = ".env"


settings = Settings()
