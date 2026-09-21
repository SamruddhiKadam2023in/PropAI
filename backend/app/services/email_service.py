"""
Outgoing email for one-time codes.

With SMTP_HOST configured the message is sent over SMTP (STARTTLS on 587, or implicit TLS with SMTP_SSL=true).
With SMTP_HOST empty nothing is sent and the sign-up screen says so. For development only, EMAIL_DEV_LOG_CODES=true writes the
code to the server log instead; never enable that in production, since anyone with log access could read codes.
"""
import asyncio
import logging
import smtplib
import ssl
from email.message import EmailMessage
from html import escape

from app.config import settings

logger = logging.getLogger(__name__)


def smtp_configured() -> bool:
    return bool(settings.SMTP_HOST.strip())


def email_delivery_available() -> bool:
    """False when codes can neither be emailed nor (dev only) logged - i.e. the server's mail settings are missing."""
    return smtp_configured() or settings.EMAIL_DEV_LOG_CODES


def _send_sync(message: EmailMessage) -> None:
    context = ssl.create_default_context()
    if settings.SMTP_SSL:
        server = smtplib.SMTP_SSL(settings.SMTP_HOST, settings.SMTP_PORT, timeout=15, context=context)
    else:
        server = smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=15)
    try:
        if not settings.SMTP_SSL and settings.SMTP_STARTTLS:
            server.starttls(context=context)
        if settings.SMTP_USERNAME:
            server.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
        server.send_message(message)
    finally:
        try:
            server.quit()
        except Exception:
            pass


def build_otp_message(to: str, name: str, code: str, ttl_minutes: int, purpose: str = "verify") -> EmailMessage:
    reset = purpose == "reset"
    message = EmailMessage()
    message["Subject"] = f"{code} is your PropAI {'password reset' if reset else 'verification'} code"
    message["From"] = settings.SMTP_FROM
    message["To"] = to
    intro = ("Someone (hopefully you) asked to reset your PropAI password. Your reset code is:" if reset
             else "Your PropAI verification code is:")
    outro = ("If you didn't ask for this, ignore this email: your password will stay exactly as it is."
             if reset else "If you didn't create a PropAI account, you can ignore this email.")
    message.set_content(
        f"Hi {name},\n\n{intro} {code}\n\n"
        f"It expires in {ttl_minutes} minutes and can be used once. "
        f"Never share it with anyone - PropAI will never ask you for it.\n\n{outro}\n"
    )
    heading = "Reset your password" if reset else "Verify your email"
    lead = "use this code to reset your PropAI password:" if reset else "use this code to finish creating your PropAI account:"
    message.add_alternative(
        f"""<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;color:#111">
<h2 style="margin:0 0 12px">{heading}</h2>
<p>Hi {escape(name)}, {lead}</p>
<p style="font-size:32px;letter-spacing:8px;font-weight:bold;background:#f3f4f6;padding:16px;text-align:center;border-radius:8px">{escape(code)}</p>
<p>It expires in {ttl_minutes} minutes and can be used once. Never share it with anyone.</p>
<p style="color:#6b7280;font-size:13px">{outro}</p></div>""",
        subtype="html",
    )
    return message


async def send_otp_email(to: str, name: str, code: str, purpose: str = "verify") -> bool:
    """True when the code was handed to a mail server (or, in dev mode, written to the log); False if delivery failed."""
    if not smtp_configured():
        if settings.EMAIL_DEV_LOG_CODES:
            label = "password reset code" if purpose == "reset" else "verification code"
            logger.warning("[DEMO EMAIL - SMTP not configured] %s for %s is %s", label, to, code)
            return True
        logger.error("Email NOT sent to %s: SMTP is not configured (set SMTP_HOST, SMTP_USERNAME, SMTP_PASSWORD in backend/.env).", to)
        return False
    message = build_otp_message(to, name, code, settings.OTP_TTL_SECONDS // 60, purpose)
    try:
        await asyncio.to_thread(_send_sync, message)
        logger.info("%s email sent to %s", "Password reset" if purpose == "reset" else "Verification", to)
        return True
    except Exception as exc:                      # never let a mail outage break the request; the user can resend
        logger.error("Could not send %s email to %s: %s: %s", purpose, to, type(exc).__name__, exc)
        return False
