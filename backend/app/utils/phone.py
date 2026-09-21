"""Phone-number normalisation to E.164 (e.g. +919820222222) so tel:/sms:/wa.me links are always well-formed."""
import re
from typing import Optional

from app.config import settings

_E164 = re.compile(r"^\+[1-9]\d{7,14}$")


def normalize_phone(raw: Optional[str], default_country_code: Optional[str] = None) -> Optional[str]:
    """
    Return the number in E.164 form, or None when it can't be trusted to be dialable.

    * "+44 7700 900123" / "0044 7700 900123"  -> international form is kept as given
    * Indian numbers without a prefix ("98202 22222", "098202 22222", "91 98202 22222") -> "+919820222222"
    """
    if not raw:
        return None
    text = raw.strip()
    digits = re.sub(r"\D", "", text)
    if not digits:
        return None

    country = (default_country_code or settings.DEFAULT_PHONE_COUNTRY_CODE).lstrip("+")

    if text.startswith("+"):
        candidate = "+" + digits
    elif digits.startswith("00"):
        candidate = "+" + digits[2:]
    elif country == "91":
        local = digits
        if len(local) == 12 and local.startswith("91"):
            local = local[2:]
        elif len(local) == 11 and local.startswith("0"):
            local = local[1:]
        if len(local) != 10 or local[0] not in "6789":      # Indian mobile numbers start with 6-9
            return None
        candidate = "+91" + local
    else:
        candidate = "+" + country + digits.lstrip("0")

    return candidate if _E164.match(candidate) else None
