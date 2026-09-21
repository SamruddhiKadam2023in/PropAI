"""
Bill field extraction from positioned OCR text (see hybrid_ocr.py).

Pure Python: no OCR, no image libraries, so every rule here is unit-testable from saved OCR output.

Design rules (learned from real Maharashtra / Delhi bills):
  * Anchor on LABELS, in English and Marathi, matched fuzzily (OCR turns "देयक" into "देवक").
  * The same value is read several times (several OCR passes). Agreement between passes is evidence: candidates are pooled and voted.
  * Say what a number is NOT as loudly as what it is: an amount after the due date, a security deposit, a tariff rate, an advert
    ("UP TO Rs 1000 on your bill payment") or a component of the total must never win.
  * Dates: the bill date beats the due, reading, connection and print dates. A month/day/year print stamp is ignored.
"""
import re
from datetime import date as _date
from difflib import SequenceMatcher
from functools import lru_cache
from typing import Any, Dict, List, Optional, Tuple

from app.ml.hybrid_ocr import Line

DEVANAGARI = re.compile(r"[ऀ-ॿ]")
_DIGITS = str.maketrans("०१२३४५६७८९", "0123456789")


def ascii_digits(text: str) -> str:
    return text.translate(_DIGITS)


@lru_cache(maxsize=20000)
def _compact(text: str) -> str:
    """Lower-case, digits-normalised, letters/Devanagari only - the form used for fuzzy label matching."""
    return re.sub(r"[^a-z\u0900-\u097F]", "", ascii_digits(text).lower())


@lru_cache(maxsize=4096)
def _bigrams(compact: str) -> frozenset:
    return frozenset(compact[i:i + 2] for i in range(len(compact) - 1))


@lru_cache(maxsize=200000)
def fuzzy_score(text: str, phrase: str) -> float:
    """
    0..1: how well `phrase` appears in `text` (1.0 = present verbatim), tolerating OCR damage.
    Fast path first: if too few of the phrase's letter pairs occur in the text at all, no window can be a close match, so the
    expensive comparison is skipped. Only windows starting near a shared letter pair are compared.
    """
    hay, needle = _compact(text), _compact(phrase)
    if not needle or len(hay) < max(2, int(len(needle) * 0.6)):
        return 0.0
    if needle in hay:
        return 1.0
    n = len(needle)
    if n < 4:                                    # too short to fuzz: require an exact hit
        return 0.0
    nb = _bigrams(needle)
    if not nb or len(nb & _bigrams(hay)) / len(nb) < 0.55:
        return 0.0
    starts = set()
    for i in range(len(hay) - 1):
        if hay[i:i + 2] in nb:
            for delta in (0, -1, -2, -(n // 3)):
                if i + delta >= 0:
                    starts.add(i + delta)
    best = 0.0
    for i in starts:
        for size in (n - 1, n, n + 1):
            if i + size <= len(hay) + 1:
                r = SequenceMatcher(None, hay[i:i + size], needle).ratio()
                if r > best:
                    best = r
    return best


def fuzzy_has(text: str, phrase: str, threshold: float = 0.78) -> bool:
    return fuzzy_score(text, phrase) >= threshold


def fuzzy_any(text: str, phrases: List[str], threshold: float = 0.78) -> bool:
    return any(fuzzy_score(text, p) >= threshold for p in phrases)


def best_score(text: str, phrases: List[str]) -> float:
    return max((fuzzy_score(text, p) for p in phrases), default=0.0)


# ── Vocabulary ────────────────────────────────────────────────────────────────────────────────────────────────────────

# (canonical vendor, document type it implies, aliases)
VENDORS: List[Tuple[str, str, List[str]]] = [
    ("MSEDCL", "electricity_bill", ["msedcl", "mahavitaran", "mahadiscom", "महावितरण", "mahavitarn"]),
    ("BSES Rajdhani", "electricity_bill", ["bses rajdhani", "bsesrajdhani"]),
    ("BSES Yamuna", "electricity_bill", ["bses yamuna"]),
    ("BSES", "electricity_bill", ["bses"]),
    ("Tata Power", "electricity_bill", ["tata power", "tatapower"]),
    ("Adani Electricity", "electricity_bill", ["adani electricity"]),
    ("BEST", "electricity_bill", ["brihanmumbai electric supply", "b.e.s.t"]),
    ("TPDDL", "electricity_bill", ["tpddl", "tata power delhi"]),
    ("BESCOM", "electricity_bill", ["bescom"]),
    ("TSSPDCL", "electricity_bill", ["tsspdcl"]),
    ("TANGEDCO", "electricity_bill", ["tangedco", "tneb"]),
    ("MCGM", "water_bill", ["mcgm", "municipal corporation of greater mumbai", "brihanmumbai mahanagarpalika", "बृहन्मुंबई महानगरपालिका", "बृहन्मुंबई"]),
    ("NMMC", "water_bill", ["nmmc", "navi mumbai municipal corporation", "नवी मुंबई महानगरपालिका"]),
    ("PMC", "water_bill", ["pune municipal corporation", "पुणे महानगरपालिका"]),
    ("TMC", "water_bill", ["thane municipal corporation", "ठाणे महानगरपालिका"]),
    ("BWSSB", "water_bill", ["bwssb"]),
    ("Delhi Jal Board", "water_bill", ["delhi jal board", "djb"]),
    ("Mahanagar Gas", "gas_bill", ["mahanagar gas", "mgl"]),
    ("Indraprastha Gas", "gas_bill", ["indraprastha gas", "igl"]),
    ("Adani Gas", "gas_bill", ["adani total gas", "adani gas"]),
]

# Words that identify the KIND of bill when no vendor is recognised. (phrase, weight)
TYPE_HINTS: Dict[str, List[Tuple[str, int]]] = {
    "electricity_bill": [("bill of supply", 3), ("electricity", 5), ("वीज", 5), ("विद्युत", 4), ("kwh", 4), ("unit consumed", 3), ("units consumed", 3),
                         ("मीटर क्रमांक", 2), ("meter number", 1), ("tariff", 2), ("consumer no", 1), ("energy charges", 4), ("वीज पुरवठा", 5), ("युनिट", 2),
                         ("sanctioned load", 4), ("मंजूर भार", 4), ("contract demand", 3), ("power factor", 3)],
    "water_bill": [("water charges", 6), ("water bill", 6), ("water supply", 5), ("जल आकार", 6), ("जलदेयक", 6), ("पाणी", 4), ("sewerage", 5), ("मलनिस्सारण", 4),
                   ("water meter", 5), ("जलमापक", 5), ("kilo litre", 3), ("(kl)", 3), ("per kl", 4), ("जलजोडणी", 4), ("water connection", 4), ("water works", 3)],
    "gas_bill": [("piped natural gas", 6), ("png", 3), ("gas bill", 6), ("गॅस", 4), ("scm", 3), ("cylinder", 2)],
    "rent_receipt": [("rent receipt", 8), ("rental receipt", 8), ("received rent", 5), ("landlord", 4), ("tenant", 3), ("भाडे पावती", 8), ("भाडे", 3), ("rent for the month", 6)],
}

# Amounts on a line that mentions any of these are NOT the payable amount.
LATE_WORDS = ["after due date", "after the due date", "after last date", "late payment", "late fee", "delayed payment", "penalty", "interest",
              "या तारखेनंतर", "या तारखे नंतर", "नंतर भरल्यास", "विलंब", "दंड", "if paid after"]
# "paid up to the due date" is the normal amount, not the late one - and in Marathi it differs from "after" by only a few letters (पर्यंत / नंतर)
BEFORE_WORDS = ["या तारखेपर्यंत", "तारखेपर्यंत भरल्यास", "on or before", "before due date", "before the due date", "if paid by", "if paid before", "up to due date"]
DEPOSIT_WORDS = ["security deposit", "सुरक्षा ठेव", "ठेव जमा", "deposit"]
AD_WORDS = ["phonepe", "scratch", "reward", "cashback", "up to", "download now", "coupon", "offer applicable", "get scratch", "terms & conditions"]
RATE_WORDS = ["rate per", "per kl", "per unit", "rate (per", "tariff", "kwh", "units", "reading", "consumption", "sanctioned load", "load"]
COMPONENT_WORDS = ["water charges", "sewerage", "meter rent", "additional charges", "previous outstanding", "credit amount", "excess credit",
                   "energy charges", "fixed charge", "wheeling", "electricity duty", "tax on sale", "fuel adjustment", "जमा रक्कम"]

# (label phrases, base score). Higher = more certainly the amount to pay for THIS bill.
AMOUNT_LABELS: List[Tuple[List[str], int]] = [
    (["total payable amount", "एकूण देय रक्कम", "total amount payable", "net amount payable", "net payable"], 130),
    (["payable amount", "amount payable", "bill amount payable", "देय रक्कम", "amount to be paid", "amount due", "total due"], 120),
    (["current bill amount", "bill amount", "देयक रक्कम", "चालू देयक रक्कम", "बिल रक्कम", "total bill", "current bill"], 105),
    (["net bill", "total amount", "amount payable by due date", "pay by due date"], 90),
]
WEAK_AMOUNT = ["amount", "payable", "रक्कम", "देय", "due", "bill", "रु", "rs", "₹", "pay", "देयक"]

BILL_DATE_LABELS = ["bill date", "date of issue", "issue date", "billing date", "bill dt", "देयक दिनांक", "देवक दिनांक", "बिल दिनांक", "देयक दिनाक", "date of bill",
                    "invoice date"]
DUE_DATE_LABELS = ["due date", "pay by", "last date", "payment due", "देय दिनांक", "अंतिम दिनांक", "देय दिनाक", "due dt", "pay before", "दैश दिनांक"]
OTHER_DATE_LABELS = ["reading date", "रिडिंग दिनांक", "वाचन दिनांक", "connection date", "supply date", "पुरवठा दिनांक", "installation", "process date", "printed",
                     "generated", "date of birth", "previous reading", "current reading", "मागील रिडिंग", "चालू रिडिंग", "चालु रिडिंग", "मागील रीडिंग", "चालू रीडिंग",
                     "payment date", "paid on", "receipt date", "bill period", "billing period", "कालावधी", "from", "period", "from date"]

_DATE_RE = re.compile(r"(?<!\d)(\d{1,2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{4})(?!\d)")
_AMOUNT_RE = re.compile(r"(?<![\d.,/-])(\d{1,3}(?:,\d{2,3})+|\d+)(?:[.,](\d{1,2}))?(?![\d/-])")


# ── Dates ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

def _valid_date(d: int, m: int, y: int) -> Optional[str]:
    if not (1 <= m <= 12 and 1 <= d <= 31 and 2000 <= y <= _date.today().year + 1):
        return None
    try:
        _date(y, m, d)
    except ValueError:
        return None
    return f"{d:02d}-{m:02d}-{y:04d}"


def find_dates(text: str) -> List[Tuple[str, int]]:
    """Every valid dd-mm-yyyy in the text, with the position where it starts (Devanagari digits and OCR spaces tolerated)."""
    found = []
    for m in _DATE_RE.finditer(ascii_digits(text)):
        value = _valid_date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        if value:
            found.append((value, m.start()))
    return found


def _date_obj(value: str) -> _date:
    d, m, y = value.split("-")
    return _date(int(y), int(m), int(d))


def extract_period(lines: List[Line]) -> Optional[str]:
    """'09-02-2022 to 10-03-2022' style billing period."""
    for line in sorted(lines, key=lambda l: (l.page, l.y)):
        text = ascii_digits(line.text)
        m = re.search(r"(\d{1,2}\s*[-/.]\s*\d{1,2}\s*[-/.]\s*\d{4})\s*(?:to|-|\u2013|ते)\s*(\d{1,2}\s*[-/.]\s*\d{1,2}\s*[-/.]\s*\d{4})", text, re.I)
        if m:
            a, b = find_dates(m.group(1))[:1], find_dates(m.group(2))[:1]
            if a and b and _date_obj(a[0][0]) <= _date_obj(b[0][0]):
                return f"{a[0][0]} to {b[0][0]}"
    return None


def _range_parts(lines: List[Line]) -> set:
    """Dates that only appear as an end of a 'from - to' range (billing periods, consumption history): never the bill date."""
    parts = set()
    for line in lines:
        text = ascii_digits(line.text)
        for m in re.finditer(r"(\d{1,2}\s*[-/.]\s*\d{1,2}\s*[-/.]\s*\d{4})\s*(?:to|-|\u2013|ते)\s*(\d{1,2}\s*[-/.]\s*\d{1,2}\s*[-/.]\s*\d{4})", text, re.I):
            for g in (m.group(1), m.group(2)):
                for value, _ in find_dates(g):
                    parts.add(value)
    return parts


def extract_dates(lines: List[Line]) -> Dict[str, Any]:
    """
    Bill date, due date and the rest, pooled and voted across every OCR pass.
    A labelled date is classified by the CLOSEST matching label (bill / due / other) - "देवक दिनांक" and "देय दिनांक" differ by one letter.
    A date with no readable label is placed by structure: never a range end, and it must fall inside [period end, due date].
    """
    ordered = sorted(lines, key=lambda l: (l.page, l.y))
    height = max((l.y for l in ordered), default=1)
    votes = {"bill": {}, "due": {}, "other": {}}
    plain: Dict[str, List[int]] = {}                       # value -> y positions where it appeared without any recognised label

    for line in ordered:
        for i, cell in enumerate(line.cells):
            found = find_dates(cell.text)
            label_cells = [cell.text] + ([line.cells[i - 1].text] if i > 0 else [])
            if not found and i + 1 < len(line.cells):        # label in this cell, date in the next one
                found = find_dates(line.cells[i + 1].text)
                label_cells = [cell.text]
            if not found:
                continue
            scores = {
                "bill": max(best_score(t, BILL_DATE_LABELS) for t in label_cells),
                "due": max(best_score(t, DUE_DATE_LABELS) for t in label_cells),
                "other": max(best_score(t, OTHER_DATE_LABELS) for t in label_cells),
            }
            kind, top = max(scores.items(), key=lambda kv: kv[1])
            runner_up = sorted(scores.values(), reverse=True)[1]
            for value, _ in found:
                if top >= 0.80 and top - runner_up >= 0.02:
                    votes[kind][value] = votes[kind].get(value, 0) + 1
                elif top < 0.80:
                    plain.setdefault(value, []).append(line.y)

    def best(kind: str, exclude=()) -> Optional[str]:
        pool = {k: v for k, v in votes[kind].items() if k not in exclude}
        return max(pool, key=lambda k: (pool[k], k)) if pool else None

    due = best("due")
    period = extract_period(lines)
    period_end = _date_obj(period.split(" to ")[1]) if period else None
    period_start = _date_obj(period.split(" to ")[0]) if period else None
    ranges = _range_parts(lines)

    bill, basis = best("bill", exclude=(due,) if due else ()), "bill date label"
    if not bill:
        claimed = set(votes["due"]) | set(votes["other"]) | ranges
        window = []
        for value, ys in plain.items():
            if value in claimed:
                continue
            d = _date_obj(value)
            if due and d > _date_obj(due):
                continue                                       # a bill is issued before it falls due
            if period_end and d < period_end:
                continue
            if period_start and d < period_start:
                continue
            window.append((len(ys), -min(ys), value))          # more repeats first, then nearer the top of the page
        if window:
            window.sort(reverse=True)
            bill, basis = window[0][2], "date placed by structure (no readable label)"
    result: Dict[str, Any] = {"bill_date": bill, "due_date": due, "date": None, "date_basis": None, "bill_period": period}
    if bill:
        result["date"], result["date_basis"] = bill, basis
    elif due:
        result["date"], result["date_basis"] = due, "due date only"
    return result


# ── Amount ────────────────────────────────────────────────────────────────────────────────────────────────────────────

def _numbers(text: str) -> List[Tuple[float, str, bool, int]]:
    """(value, raw, had_decimals, start) for plausible money numbers. Dates, phone/IDs and long digit runs are removed first."""
    t = ascii_digits(text)
    t = _DATE_RE.sub(lambda m: " " * len(m.group(0)), t)
    t = re.sub(r"\d{7,}", lambda m: " " * len(m.group(0)), t)          # consumer / meter / phone numbers
    t = re.sub(r"(?<=\d)\s+(?=\.\d{2}\b)", "", t)
    out = []
    for m in _AMOUNT_RE.finditer(t):
        whole, dec = m.group(1), m.group(2)
        try:
            value = float(whole.replace(",", "") + ("." + dec if dec else ""))
        except ValueError:
            continue
        if 1 <= value <= 5_000_000:
            out.append((value, m.group(0), dec is not None and len(dec) == 2, m.start()))
    return out


def extract_amount(lines: List[Line], doc_type: Optional[str] = None) -> Dict[str, Any]:
    """
    The amount to pay for this bill. A number takes its label from its own cell or the cell to its LEFT (side-by-side tables would
    otherwise lend it the neighbouring column's label). Exclusions (after-due-date, deposit, advert, rate, component) are judged on
    the whole row, and the WORST exclusion seen in any pass sticks, because only some passes read the Marathi words.
    """
    pool: Dict[float, Dict[str, Any]] = {}
    for line in lines:
        row_text = line.text
        late = fuzzy_any(row_text, LATE_WORDS, 0.85) and best_score(row_text, LATE_WORDS) > best_score(row_text, BEFORE_WORDS)
        deposit = fuzzy_any(row_text, DEPOSIT_WORDS, 0.85)
        ad = fuzzy_any(row_text, AD_WORDS, 0.85)
        for idx, cell in enumerate(line.cells):
            nums = _numbers(cell.text)
            if not nums:
                continue
            scope = cell.text if idx == 0 else line.cells[idx - 1].text + "  " + cell.text
            label_hit, base = None, 0
            for phrases, score in AMOUNT_LABELS:
                if fuzzy_any(scope, phrases, 0.80):
                    base, label_hit = score, phrases[0]
                    break
            weak = base == 0 and fuzzy_any(scope, WEAK_AMOUNT, 0.85)
            currency = bool(re.search(r"(?:rs\.?|inr|\u20b9|\u0930\u0941\.?)", scope.lower()))
            rate = fuzzy_any(scope, RATE_WORDS, 0.9) and not label_hit
            component = fuzzy_any(scope, COMPONENT_WORDS, 0.85) and (not label_hit or base < 120)
            for value, raw, has_dec, pos in nums:
                if value >= 100000 and not has_dec:              # a pincode or an id, not money
                    continue
                score = base + (25 if weak else 0) + (12 if currency else 0) + (6 if has_dec else 0)
                if not (base or weak or (has_dec and currency)):
                    continue
                penalty = (200 if late else 0) + (200 if deposit else 0) + (250 if ad else 0) + (90 if rate else 0) + (45 if component else 0)
                if doc_type == "electricity_bill" and value < 10 and not label_hit:
                    penalty += 60
                entry = pool.setdefault(round(value, 2), {"value": round(value, 2), "base": -10_000, "penalty": 0, "votes": 0, "label": None})
                entry["votes"] += 1
                entry["penalty"] = max(entry["penalty"], penalty)
                if score > entry["base"]:
                    entry["base"], entry["label"] = score, label_hit
    if not pool:
        return {"amount": None, "amount_label": None, "amount_votes": 0, "candidates": []}
    for e in pool.values():
        e["score"] = e["base"] - e["penalty"]
        e["total"] = e["score"] + min(e["votes"] - 1, 6) * 7          # agreement between passes is evidence
    ranked = sorted(pool.values(), key=lambda e: (e["total"], e["votes"], e["value"]), reverse=True)
    top = ranked[0]
    if top["score"] < 25 or (top["label"] is None and top["votes"] < 3):   # nothing convincing: leave it empty rather than guess
        return {"amount": None, "amount_label": None, "amount_votes": 0, "candidates": ranked[:4]}
    return {"amount": top["value"], "amount_label": top["label"], "amount_votes": top["votes"], "candidates": ranked[:4]}


# ── Type, vendor, flags ───────────────────────────────────────────────────────────────────────────────────────────────

def _present(phrase: str, whole: str, unique_lines: List[str], threshold: float = 0.86) -> bool:
    """Is `phrase` on the page? Exact hit on the whole compact text first; otherwise fuzzy, LINE BY LINE (short strings are fast)."""
    needle = _compact(phrase)
    if not needle:
        return False
    if needle in whole:
        return True
    if len(needle) < 6:
        return False
    return any(fuzzy_score(t, phrase) >= threshold for t in unique_lines)


def detect_vendor_and_type(lines: List[Line]) -> Dict[str, Any]:
    whole = _compact("\n".join(l.text for l in lines))
    seen, unique_lines = set(), []
    for l in lines:                                              # the same row read by several passes only needs checking once
        key = _compact(l.text)
        if len(key) >= 4 and key not in seen:
            seen.add(key)
            unique_lines.append(l.text)
    vendor, vendor_type, vendor_hits = None, None, 0
    for name, dtype, aliases in VENDORS:
        hits = sum(1 for a in aliases if len(_compact(a)) >= 3 and _present(a, whole, unique_lines))
        if hits > vendor_hits or (hits and vendor is None):
            vendor, vendor_type, vendor_hits = name, dtype, hits
    scores: Dict[str, int] = {}
    for dtype, hints in TYPE_HINTS.items():
        scores[dtype] = sum(weight for phrase, weight in hints if _present(phrase, whole, unique_lines))
    if vendor_type:
        scores[vendor_type] = scores.get(vendor_type, 0) + 8
    best = max(scores, key=scores.get) if scores else None
    if not best or scores[best] < 4:
        return {"document_type": None, "type_score": scores.get(best, 0) if best else 0, "vendor": vendor}
    return {"document_type": best, "type_score": scores[best], "vendor": vendor}


def is_duplicate_bill(lines: List[Line]) -> bool:
    return any(fuzzy_has(l.text, "duplicate bill", 0.86) or fuzzy_has(l.text, "प्रत", 0.99) and fuzzy_has(l.text, "duplicate", 0.86) for l in lines)


# ── Public entry points ───────────────────────────────────────────────────────────────────────────────────────────────

def extract_core(lines: List[Line]) -> Dict[str, Any]:
    kind = detect_vendor_and_type(lines)
    dates = extract_dates(lines)
    amount = extract_amount(lines, kind["document_type"])
    return {
        **kind, **dates, **amount,
        "is_duplicate": is_duplicate_bill(lines),
    }


def core_is_sufficient(lines: List[Line]) -> bool:
    """Used by the OCR engine to stop reading as soon as the essentials are clearly there."""
    try:
        core = extract_core(lines)
    except Exception:
        return False
    return bool(core["document_type"] and core["amount"] is not None and core["amount_votes"] >= 3 and core["date"] and core["date_basis"] == "bill date label")
