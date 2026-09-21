"""
Calendar-date handling for rent. A rent payment's "date" and "month" are calendar concepts in the business's own timezone
(APP_TIMEZONE, default Asia/Kolkata) - NOT properties of a UTC instant. Deriving them from UTC shifted early-morning payments
into the previous day/month.
"""
import re
from datetime import date, datetime, time, timedelta, timezone
from typing import Optional, Tuple, Union
from zoneinfo import ZoneInfo

from app.config import settings

MONTH_RE = re.compile(r"^(\d{4})-(0[1-9]|1[0-2])$")
EARLIEST_YEAR = 2000


def app_tz() -> ZoneInfo:
    return ZoneInfo(settings.APP_TIMEZONE)


def local_today() -> date:
    return datetime.now(app_tz()).date()


def to_local(value: datetime) -> datetime:
    """An aware datetime is converted to the business timezone; a naive one is taken to already be in it."""
    return value.astimezone(app_tz()) if value.tzinfo else value.replace(tzinfo=app_tz())


def local_date_of(value: datetime) -> date:
    return to_local(value).date()


def payment_instant(value: Union[date, datetime]) -> datetime:
    """
    What to store for a chosen payment date. A plain calendar date becomes local noon (safely inside the day whatever offset
    it is later viewed with); a naive datetime is read as local time; an aware one is kept as the instant it names.
    """
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=app_tz())
    return datetime.combine(value, time(12, 0), tzinfo=app_tz())


def day_bounds_utc(day: date) -> Tuple[datetime, datetime]:
    """[start, end) of a LOCAL calendar day, as UTC instants - the correct way to compare a date against timestamptz."""
    start = datetime.combine(day, time.min, tzinfo=app_tz())
    end = datetime.combine(day + timedelta(days=1), time.min, tzinfo=app_tz())
    return start.astimezone(timezone.utc), end.astimezone(timezone.utc)


def valid_month(value: Optional[str]) -> Optional[str]:
    if value is None or value == "":
        return None
    if not MONTH_RE.match(value) or int(value[:4]) < EARLIEST_YEAR:
        raise ValueError("Month must look like 2026-09 (year-month).")
    return value
