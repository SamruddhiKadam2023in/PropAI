"""
Address extraction from positioned OCR text (see hybrid_ocr.py). Pure Python.

How it works
  1. Find every 6-digit Indian PIN (validated against real PIN prefixes) inside a cell that reads like an address.
  2. Take the block of left-aligned lines stacked directly ABOVE it - bills print "name / building / area, city - PIN" that way - using the
     recovered column geometry so text from the neighbouring column (amounts, dates, wards) is left out.
  3. Every OCR pass produces its own candidate; candidates that agree on the PIN vote together and the cleanest, best-supported block wins.
  4. If there is no PIN, fall back to the lines under an "Address" / "पत्ता" label.
  5. Parse the winner into place / suburb / city / state / pincode, and keep the consumer's name separately.
"""
import re
from collections import defaultdict
from difflib import SequenceMatcher
from typing import Any, Dict, List, Optional, Tuple

from app.ml.bill_extractor import _compact, ascii_digits, fuzzy_score
from app.ml.hybrid_ocr import Line
from app.ml.india_places import CITIES, SUBURBS, state_from_pin, transliterate_text, valid_pin

_PIN = re.compile(r"(?<!\d)([1-9]\d{2})\s?(\d{3})(?!\d)")
_GLUED_PIN = re.compile(r"(?<!\d)([1-9]\d{5})\1(?!\d)")
_NOT_ADDRESS = re.compile(r"(?i)\b(gstin|ifsc|a/c|account|bill\s*no|consumer\s*no|meter|phone|mobile|e-?mail|due\s*date|bill\s*date|scan|qr\s*code|barcode|www|http)\b|@")
_LABEL = re.compile(r"(?i)(name\s*&?\s*address|consumer\s*address|billing\s*address|service\s*address|customer\s*address|^address\b|पत्ता|नाव)")
_AUTHORITY = ("municipal", "office", "engineer", "corporation", "department", "commissioner", "helpline", "toll free", "head office", "registered office",
              "division", "customer care", "care centre", "collection centre", "ward office")
_KEYWORDS = ("flat", "plot", "road", " rd", "nagar", "society", "soc", "heights", "station", "chs", "building", "bldg", "sector", "street", "lane", "near", "opp",
             "house", "wing", "floor", "colony", "marg", "complex", "tower", "apartment", "apt", "chawl", "wadi", "village", "taluka", "dist", "sec ", "block",
             "phase", "pvt", "ltd", "no.", "no-")


def _fix_pin_text(text: str) -> str:
    return _GLUED_PIN.sub(lambda m: m.group(1), ascii_digits(text))


def _garbage_ratio(text: str) -> float:
    if not text:
        return 1.0
    ok = sum(1 for c in text if c.isalnum() or c in " ,.-/&:;()'#")
    return 1.0 - ok / len(text)


def _pins_in(text: str) -> List[str]:
    out = []
    for m in _PIN.finditer(_fix_pin_text(text)):
        pin = m.group(1) + m.group(2)
        if valid_pin(pin):
            out.append(pin)
    return out


def _place_hits(text: str) -> Tuple[Optional[str], Optional[str]]:
    """(suburb, city) named in the text. Exact alias first, then fuzzy for OCR damage; longest alias wins ('Navi Mumbai' over 'Mumbai')."""
    suburb = city = None
    for canon, (c, aliases) in SUBURBS.items():
        for a in sorted(aliases, key=len, reverse=True):
            ca = _compact(a)
            if ca and (ca in _compact(text) or (len(ca) >= 6 and fuzzy_score(text, a) >= 0.88)):
                suburb, city = canon, c
                break
        if suburb:
            break
    best = None
    for canon, (state, aliases) in CITIES.items():
        for a in aliases:
            ca = _compact(a)
            if ca and (ca in _compact(text) or (len(ca) >= 6 and fuzzy_score(text, a) >= 0.88)):
                if best is None or len(ca) > best[0]:
                    best = (len(ca), canon)
    if best and (not city or len(_compact(best[1])) > len(_compact(city))):
        city = best[1]
    return suburb, city


def _block_score(lines_text: List[str], pin: Optional[str], rel_y: float = 0.0, labelled: bool = False) -> float:
    text = " ".join(lines_text)
    suburb, city = _place_hits(text)
    score = (40 if pin else 0) + (12 if city else 0) + (10 if suburb else 0)
    score += min(sum(1 for k in _KEYWORDS if k in text.lower()), 5) * 4 + min(len(lines_text), 4) * 3
    score -= int(_garbage_ratio(text) * 60)
    low = text.lower()
    score -= 70 * min(sum(1 for w in _AUTHORITY if w in low), 2)         # the issuer's own office, not the consumer
    if rel_y > 0.78:                                                    # footer of the page: contact / payment details
        score -= 35
    elif rel_y < 0.6:
        score += 8
    if labelled:                                                        # printed directly under a "Name & Address" style label
        score += 25
    return score


def _aligned_text(line: Line, x0: int, tol: int) -> Optional[str]:
    """The cell of this row that starts in the same column as `x0` (text from other columns is not part of the address)."""
    cells = [c for c in line.cells if abs(c.x0 - x0) <= tol]
    return max(cells, key=lambda c: len(c.text)).text if cells else None


def _looks_like_address_line(text: str) -> bool:
    letters = sum(c.isalpha() for c in text)
    return letters >= 4 and _garbage_ratio(text) < 0.25 and not _NOT_ADDRESS.search(text)


def _candidates_from_pass(lines: List[Line]) -> List[Dict[str, Any]]:
    lines = sorted(lines, key=lambda l: (l.page, l.y))
    page_height: Dict[int, int] = {}
    for l in lines:
        page_height[l.page] = max(page_height.get(l.page, 1), l.y)
    out = []
    for i, line in enumerate(lines):
        for cell in line.cells:
            pins = _pins_in(cell.text)
            if not pins or not re.search(r"[A-Za-zऀ-ॿ]{3,}", cell.text) or _NOT_ADDRESS.search(cell.text):
                continue
            tol = max(30, 4 * line.height)
            block = [(_fix_pin_text(cell.text))]
            labelled = False
            j = i - 1
            while j >= 0 and len(block) < 5 and lines[j].page == line.page and (lines[j + 1].y - lines[j].y) <= 3.4 * max(line.height, lines[j].height):
                text = _aligned_text(lines[j], cell.x0, tol)
                if not text or not _looks_like_address_line(text):
                    break
                if _LABEL.search(text):
                    labelled = True
                    break
                block.insert(0, text)
                j -= 1
            pin = pins[-1]
            rel_y = line.y / float(page_height.get(line.page, 1) or 1)
            out.append({"lines": block, "pin": pin, "score": _block_score(block, pin, rel_y, labelled), "source": line.source})
    return out


def _candidates_from_label(lines: List[Line]) -> List[Dict[str, Any]]:
    """No PIN read: take the lines under an 'Address' label."""
    lines = sorted(lines, key=lambda l: (l.page, l.y))
    out = []
    for i, line in enumerate(lines):
        for cell in line.cells:
            if _LABEL.search(cell.text) and len(cell.text) <= 60:
                tol = max(30, 4 * line.height)
                block = []
                for nxt in lines[i + 1: i + 5]:
                    text = _aligned_text(nxt, cell.x0, tol) or (nxt.cells[0].text if nxt.cells else None)
                    if not text or not _looks_like_address_line(text) or _LABEL.search(text):
                        break
                    block.append(text)
                if block:
                    out.append({"lines": block, "pin": None, "score": _block_score(block, None), "source": line.source})
    return out


_CITY_ALIASES = {a for _, als in CITIES.values() for a in als if a.isascii()}


def _place_aliases() -> List[str]:
    return sorted({a for _, als in CITIES.values() for a in als if a.isascii()} | {a for _, als in SUBURBS.values() for a in als if a.isascii()}, key=len, reverse=True)


def _split_glued(token: str, aliases: List[str]) -> List[str]:
    """'ROADGOVANDI' -> ['ROAD', 'GOVANDI']: OCR often loses the space before a place name. Every split point is scored; the best wins."""
    if len(token) < 8 or not token.isalpha():
        return [token]
    known = {_compact(w) for a in aliases for w in a.split()} | set(_ADDRESS_WORDS)
    best = None
    for p in range(3, len(token) - 3):
        if _compact(token[:p]) not in known:      # only split after a real address / place word: 'RAMCHANDRA' must never become RAMCH + Bandra
            continue
        cr = _compact(token[p:])
        for a in aliases:
            ca = _compact(a)
            if len(ca) >= 5 and abs(len(ca) - len(cr)) <= 1:
                r = SequenceMatcher(None, cr, ca).ratio()
                if r >= 0.8 and (best is None or r > best[0]):
                    best = (r, p)
    return [token[:best[1]], token[best[1]:]] if best else [token]


_ADDRESS_WORDS = ("road", "station", "society", "heights", "nagar", "building", "colony", "street", "sector", "tower", "complex", "apartment", "plot", "flat",
                  "chawl", "wing", "floor", "lane", "marg", "village", "block", "phase", "pvt", "ltd", "chemical", "industrial", "estate", "east", "west", "north", "south")


def _alpha_tail(token: str) -> Tuple[str, str]:
    """'MUMBAI-400088' -> ('MUMBAI', '-400088'): repair the letters, never the digits attached to them."""
    m = re.match(r"^([A-Za-z]*)(.*)$", token)
    return (m.group(1), m.group(2)) if m else (token, "")


def _repair_places(text: str) -> str:
    """
    Fix OCR damage in place words: 'GOVAND!' -> 'GOVANDI', 'NNAVI MUMBAI' -> 'Navi Mumbai', 'ROADGOVANDI' -> 'ROAD Govandi',
    'FOAD' -> 'ROAD'. An exact known word is never touched, and the CLOSEST alias wins, so 'MUMBAI' can not become 'Mumbra'.
    """
    text = re.sub(r"(?<=[A-Za-z])!", "I", text)
    aliases = _place_aliases()
    exact = {_compact(a) for a in aliases} | set(_ADDRESS_WORDS)
    pieces: List[List[str]] = []
    for t in text.split():
        alpha, tail = _alpha_tail(t)
        parts = _split_glued(alpha, aliases) if alpha else [alpha]
        for j, part in enumerate(parts):
            pieces.append([part, tail if j == len(parts) - 1 else ""])
    i = 0
    while i < len(pieces):
        best = None
        for a in aliases:
            n = len(a.split())
            if i + n > len(pieces):
                continue
            window = " ".join(x[0] for x in pieces[i:i + n])
            cw, ca = _compact(window), _compact(a)
            if len(ca) < 5 or not cw:
                continue
            if cw == ca:
                best = None
                break                                                    # already a correct place name
            r = SequenceMatcher(None, cw, ca).ratio()
            r += 0.01 if a in _CITY_ALIASES else 0.0                    # on a tie a major city beats a suburb (Mumbai over Mumbra)
            if r >= 0.85 and (best is None or r > best[0]):
                best = (r, n, a)
        if best:
            _, n, a = best
            tail = pieces[i + n - 1][1]
            pieces[i:i + n] = [[w, ""] for w in a.title().split()]
            pieces[i + len(a.split()) - 1][1] = tail
            i += len(a.split())
        else:
            i += 1
    out = []
    for word, tail in pieces:
        low = word.lower()
        if 4 <= len(word) <= 10 and low not in exact and word.isalpha():
            close = max(_ADDRESS_WORDS, key=lambda k: SequenceMatcher(None, low, k).ratio())
            if SequenceMatcher(None, low, close).ratio() >= 0.74 and abs(len(close) - len(low)) <= 1:
                word = close.upper() if word.isupper() else close.title()
        out.append(word + tail)
    return " ".join(out)


def _clean_place(lines_text: List[str]) -> str:
    text = ", ".join(t.strip(" ,;:-") for t in lines_text if t.strip(" ,;:-"))
    text = re.sub(r"(?<=[A-Za-z])!", "I", text)                         # OCR reads a capital I as '!': fix before symbols are stripped
    text = re.sub(r"\s*[;|]\s*", ", ", text)
    text = re.sub(r"[^\w\s,.\-/&()#'ऀ-ॿ]", "", text)
    text = re.sub(r"\s+", " ", text)
    text = re.sub(r"\s+,", ",", text)
    text = re.sub(r",\s*,", ",", text)
    return _repair_places(transliterate_text(text)).strip(" ,.-")


_ID_LINE = re.compile(r"\d{8,}|[A-Za-z]{2,}\d{5,}")          # a consumer / bill / connection number: never a name or an address


def _names_a_place(text: str) -> bool:
    """True when a WHOLE word (or two words) of the line is a known place: 'AIROLI, NAVI MUMBAI' yes, 'RAMCHANDRA KULKARNI' no."""
    known = {_compact(a) for a in _place_aliases()}
    toks = [_compact(t) for t in re.findall(r"[^\W\d_]+", text)]
    return any(t in known for t in toks) or any(a + b in known for a, b in zip(toks, toks[1:]))


def _looks_like_name(text: str) -> bool:
    """OCR garbage such as 'cresitsoft ereeore ara' is lower-case gibberish; printed names are UPPER or Title case."""
    if re.search(r"[ऀ-ॿ]", text):
        return True
    words = re.findall(r"[A-Za-z]+", text)
    return bool(words) and all(w.isupper() or w.istitle() for w in words)


def _split_name(block: List[str]) -> Tuple[Optional[str], List[str]]:
    """A first line with no digits and no address words, above further address lines, is the consumer / company name."""
    while len(block) >= 2 and _ID_LINE.search(block[0]):
        block = block[1:]
    if len(block) >= 2:
        first = block[0]
        digits_are_junk = not re.search(r"\d{2,}", first) and all(len(t) == 1 for t in re.findall(r"\d+", first))
        if digits_are_junk and not any(k in first.lower() for k in _KEYWORDS) and not _names_a_place(first):
            name = re.sub(r"[‘’`'\"]", "", transliterate_text(first)).strip(" ,;:-")
            rest = block[1:]
            while len(rest) >= 2 and _ID_LINE.search(rest[0]):        # a garbled label + id line right under a rejected name line
                rest = rest[1:]
            return (name if not re.search(r"\d", name) and _looks_like_name(first) else None), rest     # stray digits / gibberish = OCR misread: drop it
    return None, block


def _consensus(cands: List[Dict[str, Any]], top: Optional[List[Dict[str, Any]]] = None) -> List[str]:
    """
    Lines are aligned from the PIN line upwards. For each position keep the reading that (a) agrees most with the other passes and
    (b) is made of real words once obvious OCR damage is repaired. A position only one weak reading supports is dropped.
    """
    depth = max(len(c["lines"]) for c in cands)
    chosen: List[str] = []
    vocab = {_compact(a) for a in _place_aliases()} | set(_ADDRESS_WORDS)
    for k in range(depth):                                           # k = 0 is the PIN line, 1 the line above it, ...
        pool = cands if k == 0 else (top or cands)                    # the PIN line: every pass; lines above it: only the strongest blocks
        readings = [c["lines"][-1 - k] for c in pool if len(c["lines"]) > k]
        if not readings:
            break
        if len(readings) == 1 and k > 0 and _garbage_ratio(readings[0]) > 0.05 and len(cands) > 1:
            continue
        fixed = {r: _repair_places(r) for r in readings}

        def agree(r):
            f = fixed[r]
            others = [fixed[x] for x in readings if x is not r]
            sim = sum(SequenceMatcher(None, _compact(f), _compact(o)).ratio() for o in others) / len(others) if others else 0.5
            words = [w for w in re.findall(r"[A-Za-z]+", f)]
            known = sum(1 for w in words if _compact(w) in vocab) / max(1, len(words))
            real = sum(1 for w in words if len(w) >= 3) / max(1, len(words))
            junk = sum(1 for t in r.split() if len(t) == 1 and t.isalnum()) / max(1, len(r.split()))
            return sim + 0.5 * known + 0.2 * real - 0.5 * junk - _garbage_ratio(r)
        chosen.insert(0, max(readings, key=agree))
    return chosen


def extract_address(lines: List[Line]) -> Dict[str, Any]:
    """{place, suburb, city, state, pincode, customer_name, confidence}; every value None when nothing address-like was read."""
    by_source: Dict[str, List[Line]] = defaultdict(list)
    for l in lines:
        by_source[l.source].append(l)
    cands: List[Dict[str, Any]] = []
    for source_lines in by_source.values():
        cands.extend(_candidates_from_pass(source_lines))
    if not cands:
        cands = _candidates_from_label(lines)
    empty = {"place": None, "suburb": None, "city": None, "state": None, "pincode": None, "pincode_votes": 0, "customer_name": None, "confidence": 0.0}
    if not cands:
        return empty

    groups: Dict[Optional[str], List[Dict[str, Any]]] = defaultdict(list)
    for c in cands:
        groups[c["pin"]].append(c)
    # The winning PIN is the one most passes agree on (then the best-scoring evidence).
    def evidence(k):
        if k is None:
            return (-1, -1)
        per_source: Dict[str, float] = {}
        for x in groups[k]:
            per_source[x["source"]] = max(per_source.get(x["source"], -999), x["score"])
        return (sum(per_source.values()) + 8 * len(per_source), max(per_source.values()))
    pin = max(groups, key=evidence)
    pincode_votes = len({c["source"] for c in groups[pin]}) if pin is not None else 0   # how many separate OCR passes agree on this PIN
    good = [c for c in groups[pin] if c["score"] >= max(x["score"] for x in groups[pin]) - 60]      # ignore far weaker readings of the same PIN
    name, address_lines = _split_name(_consensus(groups[pin], good))
    place = _clean_place(address_lines)
    suburb, city = _place_hits(place)
    state = state_from_pin(pin) if pin else None
    if not state and city:
        state = CITIES.get(city, (None,))[0]
    confidence = round(min(1.0, (0.5 if pin else 0.0) + (0.2 if city else 0.0) + (0.15 if suburb else 0.0) + (0.15 if len(address_lines) >= 2 or len(place) > 25 else 0.0)), 2)
    if len(place) < 5:
        return empty
    words = {re.sub(r"[^a-z]", "", k) for k in _KEYWORDS}
    has_evidence = bool(city or suburb) or any(w in words for w in re.findall(r"[a-z]+", place.lower()))
    compact = re.sub(r"\s", "", place)
    if not has_evidence or sum(ch.isalpha() for ch in compact) < 0.6 * len(compact):
        return empty                                   # digits and fragments that merely contain a valid-looking PIN are not an address
    return {"place": place, "suburb": suburb, "city": city, "state": state, "pincode": pin, "pincode_votes": pincode_votes, "customer_name": name, "confidence": confidence}
