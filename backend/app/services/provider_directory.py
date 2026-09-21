"""Service categories for repair contacts, and the mapping from a maintenance request to the right category."""
import re
from typing import Dict, List, Optional, Tuple

# key -> label. "handyman" is the catch-all for anything that isn't one of the specialist trades.
SERVICE_CATEGORIES: Dict[str, str] = {
    "plumber": "Plumber",
    "electrician": "Electrician",
    "ac_technician": "AC Technician",
    "carpenter": "Carpenter",
    "cleaning": "Cleaning Service",
    "locksmith": "Locksmith",
    "handyman": "General Handyman",
}

# The maintenance request's OWN category (routers/maintenance.py CATEGORIES) decides first - it is reused, not duplicated.
REQUEST_CATEGORY_TO_SERVICE: Dict[str, Optional[str]] = {
    "plumbing": "plumber", "electrical": "electrician", "furniture": "carpenter", "cleaning": "cleaning",
    "appliance": None,      # could be AC or anything else -> read the wording
    "pest_control": "handyman", "structural": "handyman", "other": None,
}

# Wording is only used when the request's category can't decide (e.g. "other"/"appliance"). First match wins.
_KEYWORDS: List[Tuple[str, "re.Pattern[str]"]] = [
    ("locksmith", re.compile(r"\block(s|ed|ing|smith)?\b|\bkeys?\b|\bpadlock|\bdeadbolt", re.I)),
    ("ac_technician", re.compile(r"\ba\.?c\.?\b|air[- ]?condition|\bcooling\b|\bcompressor|\bhvac\b", re.I)),
    ("electrician", re.compile(
        r"\bfans?\b|\blights?\b|\bbulbs?\b|\btube ?light|\bswitch(es|board)?\b|\bsockets?\b|\bwiring|\bwires?\b|\belectric\w*"
        r"|\bshort[- ]?circuit|\bmcb\b|\bfuse\b|\binverter|\bpower (cut|outage)|\bdoor ?bell", re.I)),
    ("plumber", re.compile(
        r"\btaps?\b|\bfaucet|\bleak\w*|\bpipes?\b|\bplumb\w*|\bdrain\w*|\bblock(age|ed)?\b|\bclog\w*|\bflush|\btoilet|\bsink\b"
        r"|\bwater\b|\bseepage|\bgeyser|\bshower", re.I)),
    ("carpenter", re.compile(r"\bdoors?\b|\bwindows?\b|\bfurniture|\bcupboard|\bwardrobe|\bcabinet|\bhinges?\b|\bwood\w*|\bcarpent\w*|\bdrawer|\bsofa", re.I)),
    ("cleaning", re.compile(r"\bclean\w*|\bsweep|\bmop\b|\bsanitis\w*|\bsanitiz\w*|\bdust\w*|\bdisinfect|\bhousekeeping", re.I)),
]


def suggest_category(title: str = "", description: str = "", request_category: Optional[str] = None) -> Tuple[str, str]:
    """Returns (service category key, how it was decided: "request_category" | "keywords" | "default")."""
    direct = REQUEST_CATEGORY_TO_SERVICE.get(request_category or "other")
    if direct:
        return direct, "request_category"
    for text in (title, f"{title} {description}"):
        for key, pattern in _KEYWORDS:
            if pattern.search(text or ""):
                return key, "keywords"
    return "handyman", "default"
