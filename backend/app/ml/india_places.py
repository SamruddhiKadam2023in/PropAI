"""
Indian place knowledge for address extraction: PIN prefix -> state, major cities (with Marathi names), well-known suburbs.

Deliberately data, not code: extend the dictionaries below to cover more places. A place that is not listed is still returned as read
from the bill; this list only lets us fill in the city/state/suburb columns reliably and repair OCR damage ("NNAVI MUMBAI").
"""
from typing import Dict, List, Optional, Tuple

# ── PIN code -> state ─────────────────────────────────────────────────────────────────────────────────────────────────
_PIN_PREFIX_STATE: List[Tuple[str, str]] = [
    ("11", "Delhi"), ("12", "Haryana"), ("13", "Haryana"), ("14", "Punjab"), ("15", "Punjab"), ("16", "Punjab"), ("17", "Himachal Pradesh"),
    ("18", "Jammu and Kashmir"), ("19", "Jammu and Kashmir"), ("244", "Uttarakhand"), ("246", "Uttarakhand"), ("247", "Uttarakhand"),
    ("248", "Uttarakhand"), ("249", "Uttarakhand"), ("262", "Uttarakhand"), ("263", "Uttarakhand"),
    ("20", "Uttar Pradesh"), ("21", "Uttar Pradesh"), ("22", "Uttar Pradesh"), ("23", "Uttar Pradesh"), ("24", "Uttar Pradesh"),
    ("25", "Uttar Pradesh"), ("26", "Uttar Pradesh"), ("27", "Uttar Pradesh"), ("28", "Uttar Pradesh"),
    ("30", "Rajasthan"), ("31", "Rajasthan"), ("32", "Rajasthan"), ("33", "Rajasthan"), ("34", "Rajasthan"),
    ("36", "Gujarat"), ("37", "Gujarat"), ("38", "Gujarat"), ("39", "Gujarat"),
    ("403", "Goa"), ("40", "Maharashtra"), ("41", "Maharashtra"), ("42", "Maharashtra"), ("43", "Maharashtra"), ("44", "Maharashtra"),
    ("45", "Madhya Pradesh"), ("46", "Madhya Pradesh"), ("47", "Madhya Pradesh"), ("48", "Madhya Pradesh"), ("49", "Chhattisgarh"),
    ("50", "Telangana"), ("51", "Andhra Pradesh"), ("52", "Andhra Pradesh"), ("53", "Andhra Pradesh"),
    ("56", "Karnataka"), ("57", "Karnataka"), ("58", "Karnataka"), ("59", "Karnataka"),
    ("60", "Tamil Nadu"), ("61", "Tamil Nadu"), ("62", "Tamil Nadu"), ("63", "Tamil Nadu"), ("64", "Tamil Nadu"),
    ("67", "Kerala"), ("68", "Kerala"), ("69", "Kerala"), ("70", "West Bengal"), ("71", "West Bengal"), ("72", "West Bengal"),
    ("73", "West Bengal"), ("74", "West Bengal"), ("75", "Odisha"), ("76", "Odisha"), ("77", "Odisha"), ("78", "Assam"),
    ("80", "Bihar"), ("81", "Bihar"), ("82", "Jharkhand"), ("83", "Jharkhand"), ("84", "Bihar"), ("85", "Bihar"),
]


def state_from_pin(pin: str) -> Optional[str]:
    """Longest matching prefix wins (403xxx is Goa, other 40xxxx is Maharashtra)."""
    best = None
    for prefix, state in _PIN_PREFIX_STATE:
        if pin.startswith(prefix) and (best is None or len(prefix) > len(best[0])):
            best = (prefix, state)
    return best[1] if best else None


def valid_pin(pin: str) -> bool:
    return len(pin) == 6 and pin.isdigit() and state_from_pin(pin) is not None


# ── Cities: canonical -> (state, aliases). Aliases include Marathi spellings. ───────────────────────────────────────────
CITIES: Dict[str, Tuple[str, List[str]]] = {
    "Navi Mumbai": ("Maharashtra", ["navi mumbai", "नवी मुंबई"]),
    "Mumbai": ("Maharashtra", ["mumbai", "bombay", "मुंबई"]),
    "Thane": ("Maharashtra", ["thane", "ठाणे"]),
    "Pune": ("Maharashtra", ["pune", "पुणे"]),
    "Pimpri-Chinchwad": ("Maharashtra", ["pimpri chinchwad", "pimpri-chinchwad", "पिंपरी चिंचवड"]),
    "Nagpur": ("Maharashtra", ["nagpur", "नागपूर"]),
    "Nashik": ("Maharashtra", ["nashik", "नाशिक"]),
    "Aurangabad": ("Maharashtra", ["aurangabad", "sambhajinagar", "औरंगाबाद", "छत्रपती संभाजीनगर"]),
    "Kolhapur": ("Maharashtra", ["kolhapur", "कोल्हापूर"]),
    "Solapur": ("Maharashtra", ["solapur", "सोलापूर"]),
    "Panvel": ("Maharashtra", ["panvel", "पनवेल"]),
    "Kalyan": ("Maharashtra", ["kalyan", "कल्याण"]),
    "Dombivli": ("Maharashtra", ["dombivli", "dombivali", "डोंबिवली"]),
    "Bhiwandi": ("Maharashtra", ["bhiwandi", "भिवंडी"]),
    "Vasai-Virar": ("Maharashtra", ["vasai", "virar", "वसई", "विरार"]),
    "Mira-Bhayandar": ("Maharashtra", ["mira road", "bhayandar", "mira bhayandar", "मीरा", "भाईंदर"]),
    "Delhi": ("Delhi", ["new delhi", "delhi", "दिल्ली"]),
    "Gurugram": ("Haryana", ["gurugram", "gurgaon"]),
    "Noida": ("Uttar Pradesh", ["noida"]),
    "Ghaziabad": ("Uttar Pradesh", ["ghaziabad"]),
    "Lucknow": ("Uttar Pradesh", ["lucknow"]),
    "Jaipur": ("Rajasthan", ["jaipur"]),
    "Ahmedabad": ("Gujarat", ["ahmedabad"]),
    "Surat": ("Gujarat", ["surat"]),
    "Vadodara": ("Gujarat", ["vadodara", "baroda"]),
    "Indore": ("Madhya Pradesh", ["indore"]),
    "Bhopal": ("Madhya Pradesh", ["bhopal"]),
    "Bengaluru": ("Karnataka", ["bengaluru", "bangalore"]),
    "Hyderabad": ("Telangana", ["hyderabad", "secunderabad"]),
    "Chennai": ("Tamil Nadu", ["chennai", "madras"]),
    "Kolkata": ("West Bengal", ["kolkata", "calcutta"]),
    "Goa": ("Goa", ["panaji", "margao", "vasco"]),
}

# ── Suburbs / localities: canonical -> (city, aliases) ──────────────────────────────────────────────────────────────────
SUBURBS: Dict[str, Tuple[str, List[str]]] = {
    # Navi Mumbai
    "Airoli": ("Navi Mumbai", ["airoli", "ऐरोली"]), "Vashi": ("Navi Mumbai", ["vashi", "वाशी"]), "Nerul": ("Navi Mumbai", ["nerul", "नेरुळ"]),
    "CBD Belapur": ("Navi Mumbai", ["cbd belapur", "belapur", "बेलापूर"]), "Kopar Khairane": ("Navi Mumbai", ["kopar khairane", "koparkhairane", "कोपरखैरणे", "कोपर खैरणे"]),
    "Ghansoli": ("Navi Mumbai", ["ghansoli", "घणसोली"]), "Sanpada": ("Navi Mumbai", ["sanpada", "सानपाडा"]), "Turbhe": ("Navi Mumbai", ["turbhe", "तुर्भे"]),
    "Juinagar": ("Navi Mumbai", ["juinagar"]), "Seawoods": ("Navi Mumbai", ["seawoods"]), "Kharghar": ("Navi Mumbai", ["kharghar", "खारघर"]),
    "Ulwe": ("Navi Mumbai", ["ulwe"]), "Mahape": ("Navi Mumbai", ["mahape"]),
    # Panvel belt
    "Kamothe": ("Panvel", ["kamothe"]), "Kalamboli": ("Panvel", ["kalamboli"]), "Taloja": ("Panvel", ["taloja"]),
    # Mumbai
    "Govandi": ("Mumbai", ["govandi", "गोवंडी"]), "Andheri": ("Mumbai", ["andheri", "अंधेरी"]), "Bandra": ("Mumbai", ["bandra", "वांद्रे"]),
    "Borivali": ("Mumbai", ["borivali", "बोरीवली"]), "Kandivali": ("Mumbai", ["kandivali", "कांदिवली"]), "Malad": ("Mumbai", ["malad", "मालाड"]),
    "Goregaon": ("Mumbai", ["goregaon", "गोरेगाव"]), "Kurla": ("Mumbai", ["kurla", "कुर्ला"]), "Ghatkopar": ("Mumbai", ["ghatkopar", "घाटकोपर"]),
    "Chembur": ("Mumbai", ["chembur", "चेंबूर"]), "Mulund": ("Mumbai", ["mulund", "मुलुंड"]), "Bhandup": ("Mumbai", ["bhandup", "भांडुप"]),
    "Powai": ("Mumbai", ["powai", "पवई"]), "Vikhroli": ("Mumbai", ["vikhroli", "विक्रोळी"]), "Dadar": ("Mumbai", ["dadar", "दादर"]),
    "Worli": ("Mumbai", ["worli", "वरळी"]), "Colaba": ("Mumbai", ["colaba", "कुलाबा"]), "Juhu": ("Mumbai", ["juhu"]), "Vile Parle": ("Mumbai", ["vile parle"]),
    "Santacruz": ("Mumbai", ["santacruz", "santa cruz"]), "Dahisar": ("Mumbai", ["dahisar"]), "Sion": ("Mumbai", ["sion"]), "Mankhurd": ("Mumbai", ["mankhurd"]),
    "Deonar": ("Mumbai", ["deonar"]), "Wadala": ("Mumbai", ["wadala"]), "Byculla": ("Mumbai", ["byculla"]),
    # Thane district
    "Majiwada": ("Thane", ["majiwada"]), "Ghodbunder Road": ("Thane", ["ghodbunder"]), "Kalwa": ("Thane", ["kalwa"]), "Mumbra": ("Thane", ["mumbra"]),
    # Pune
    "Wakad": ("Pune", ["wakad"]), "Hinjewadi": ("Pune", ["hinjewadi", "hinjawadi"]), "Kothrud": ("Pune", ["kothrud"]), "Aundh": ("Pune", ["aundh"]),
    "Hadapsar": ("Pune", ["hadapsar"]), "Baner": ("Pune", ["baner"]), "Viman Nagar": ("Pune", ["viman nagar"]), "Kharadi": ("Pune", ["kharadi"]),
    # Bengaluru / Hyderabad / Chennai
    "Koramangala": ("Bengaluru", ["koramangala"]), "Indiranagar": ("Bengaluru", ["indiranagar"]), "Whitefield": ("Bengaluru", ["whitefield"]),
    "HSR Layout": ("Bengaluru", ["hsr layout"]), "Madhapur": ("Hyderabad", ["madhapur"]), "Gachibowli": ("Hyderabad", ["gachibowli"]),
    "Anna Nagar": ("Chennai", ["anna nagar"]), "Adyar": ("Chennai", ["adyar"]),
    # Delhi
    "Dwarka": ("Delhi", ["dwarka"]), "Rohini": ("Delhi", ["rohini"]), "Saket": ("Delhi", ["saket"]), "Lajpat Nagar": ("Delhi", ["lajpat nagar"]),
    "Janakpuri": ("Delhi", ["janakpuri"]), "Vasant Kunj": ("Delhi", ["vasant kunj"]), "Mayur Vihar": ("Delhi", ["mayur vihar"]),
}

# ── Devanagari -> Latin (best effort, for names the lists above do not know) ────────────────────────────────────────────
_CONS = {"क": "k", "ख": "kh", "ग": "g", "घ": "gh", "ङ": "n", "च": "ch", "छ": "chh", "ज": "j", "झ": "jh", "ञ": "n", "ट": "t", "ठ": "th", "ड": "d", "ढ": "dh",
         "ण": "n", "त": "t", "थ": "th", "द": "d", "ध": "dh", "न": "n", "प": "p", "फ": "ph", "ब": "b", "भ": "bh", "म": "m", "य": "y", "र": "r", "ल": "l", "व": "v",
         "श": "sh", "ष": "sh", "स": "s", "ह": "h", "ळ": "l"}
_VOWELS = {"अ": "a", "आ": "a", "इ": "i", "ई": "i", "उ": "u", "ऊ": "u", "ए": "e", "ऐ": "ai", "ओ": "o", "औ": "au", "ऑ": "o", "ऋ": "ru"}
_MATRAS = {"ा": "a", "ि": "i", "ी": "i", "ु": "u", "ू": "u", "े": "e", "ै": "ai", "ो": "o", "ौ": "au", "ृ": "ru", "ॅ": "e", "ॉ": "o"}


def transliterate_word(word: str) -> str:
    """Rough Devanagari -> Latin: good enough to make a name readable and searchable, not a linguistic transliteration."""
    out, i = [], 0
    while i < len(word):
        ch = word[i]
        if ch in _CONS:
            out.append(_CONS[ch])
            nxt = word[i + 1] if i + 1 < len(word) else ""
            if nxt in _MATRAS:
                out.append(_MATRAS[nxt]); i += 2; continue
            if nxt == "्":
                i += 2; continue
            if i + 1 < len(word) and word[i + 1] in "ंँः":
                out.append("a")
            elif i + 1 < len(word):                       # inherent 'a' inside a word; dropped at the end (schwa deletion)
                out.append("a")
        elif ch in _VOWELS:
            out.append(_VOWELS[ch])
        elif ch in "ंँ":
            out.append("n")
        elif ch == "ः":
            out.append("h")
        elif ch.isascii():
            out.append(ch)
        i += 1
    return "".join(out)


def transliterate_text(text: str) -> str:
    import re
    return re.sub(r"[ऀ-ॿ]+", lambda m: transliterate_word(m.group(0)).title(), text)
