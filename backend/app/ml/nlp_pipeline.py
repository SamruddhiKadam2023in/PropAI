"""
NLP Pipeline — spaCy NER + TF-IDF document classification + regex extraction.
Algorithm 2 from the project specification:
  Step 1: TF-IDF vectorizer classifies document type (invoice / bill / receipt)
  Step 2: spaCy NER extracts amount, date, vendor entities
  Step 3: Confidence score = weighted average of extraction success
"""
import re
import logging
import numpy as np
from typing import Dict, Any, Optional, List, Tuple
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

logger = logging.getLogger(__name__)

# Lazy-load spaCy model
_nlp = None


def _get_nlp():
    global _nlp
    if _nlp is None:
        try:
            import spacy
            _nlp = spacy.load("en_core_web_sm")
            logger.info("spaCy model loaded.")
        except OSError:
            try:
                import subprocess, sys
                subprocess.run([sys.executable, "-m", "spacy", "download", "en_core_web_sm"], check=True)
                import spacy
                _nlp = spacy.load("en_core_web_sm")
            except Exception as e:
                logger.error(f"spaCy unavailable: {e}")
    return _nlp


# ── TF-IDF training corpus ────────────────────────────────────────────────────

TFIDF_CORPUS: Dict[str, List[str]] = {
    "electricity_bill": [
        "electricity bill meter reading units kwh power supply consumer number MSEDCL BSES Tata Power",
        "electric charges payment due date meter reading units consumed energy",
        "power bill consumer account electricity board units consumed monthly",
        "MSEDCL electricity supply consumer no meter reading kwh units tariff",
        "BSES Rajdhani power supply electricity bill payment due current month",
    ],
    "water_bill": [
        "water bill MCGM BWSSB water supply charges water consumption kiloliters kl",
        "water charges account number water board municipal corporation water tax",
        "water connection consumer water supply charges monthly kl consumed",
    ],
    "gas_bill": [
        "gas bill LPG cylinder piped gas Mahanagar Gas MGL connection consumer natural",
        "gas charges natural gas pipeline meter reading consumption units cubic",
        "MGL Mahanagar Gas piped natural gas bill payment monthly consumption",
    ],
    "rent_receipt": [
        "rent receipt rental payment tenant landlord monthly rent received from property",
        "rent paid rental agreement tenant name property address payment receipt acknowledged",
        "received from tenant rent amount month year property landlord signature",
        "monthly rent payment received residential property tenant name receipt",
    ],
    "invoice": [
        "invoice bill to vendor tax invoice GST IGST CGST SGST payment due amount",
        "tax invoice bill vendor payment terms invoice number date GST registration",
        "invoice number date vendor name bill to ship to amount GST total payable",
        "commercial invoice payment due date vendor customer purchase order total",
    ],
}

# ── Lazy-initialised TF-IDF model ─────────────────────────────────────────────

_tfidf_vec: Optional[TfidfVectorizer] = None
_tfidf_matrix = None
_tfidf_labels: List[str] = []


def _init_tfidf():
    global _tfidf_vec, _tfidf_matrix, _tfidf_labels
    corpus, labels = [], []
    for doc_type, samples in TFIDF_CORPUS.items():
        for s in samples:
            corpus.append(s.lower())
            labels.append(doc_type)
    _tfidf_vec = TfidfVectorizer(ngram_range=(1, 2), min_df=1, sublinear_tf=True)
    _tfidf_matrix = _tfidf_vec.fit_transform(corpus)
    _tfidf_labels = labels
    logger.info("TF-IDF classifier initialised.")


def classify_with_tfidf(text: str) -> Tuple[str, float]:
    """Returns (document_type, confidence_score) using TF-IDF cosine similarity."""
    global _tfidf_vec, _tfidf_matrix, _tfidf_labels
    if _tfidf_vec is None:
        _init_tfidf()
    try:
        vec = _tfidf_vec.transform([text.lower()])
        sims = cosine_similarity(vec, _tfidf_matrix)[0]
        best_idx = int(np.argmax(sims))
        score = float(sims[best_idx])
        if score < 0.05:
            return "other", 0.0
        return _tfidf_labels[best_idx], round(score, 4)
    except Exception as e:
        logger.error(f"TF-IDF classification error: {e}")
        return "other", 0.0


# ── Fallback keyword scorer (used when TF-IDF is disabled) ────────────────────

DOC_KEYWORDS: Dict[str, List[str]] = {
    "electricity_bill": ["electricity", "electric", "power", "msedcl", "bses",
                         "tata power", "units", "kwh", "meter reading", "consumer no"],
    "water_bill":       ["water", "mcgm", "bwssb", "water supply", "water charges", "kl"],
    "gas_bill":         ["gas", "lpg", "mahanagar gas", "mgl", "cylinder", "piped gas"],
    "rent_receipt":     ["rent", "rental", "tenant", "landlord", "monthly rent",
                         "received from", "rent receipt"],
    "invoice":          ["invoice", "bill to", "payment due", "vendor", "tax invoice",
                         "gst", "igst", "cgst", "sgst"],
}

KNOWN_VENDORS = [
    "MSEDCL", "BSES Rajdhani", "BSES Yamuna", "Tata Power",
    "MCGM", "BWSSB", "Mahanagar Gas", "MGL",
]


# ── Extraction helpers ──────────────────────────────────────────────────────

def _extract_amount(text: str) -> Optional[float]:
    patterns = [
        r"(?:total\s*amount|net\s*payable|amount\s*due|total\s*due|payable)\s*[:\-]?\s*(?:₹|rs\.?|inr)?\s*([\d,]+(?:\.\d{1,2})?)",
        r"(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d{1,2})?)",
        r"([\d,]+\.\d{2})",  # fallback: decimal numbers
    ]
    amounts: List[float] = []
    for pattern in patterns:
        for m in re.findall(pattern, text, re.IGNORECASE):
            try:
                val = float(m.replace(",", ""))
                if 1.0 <= val <= 10_000_000:
                    amounts.append(val)
            except ValueError:
                continue
    if not amounts:
        return None
    # Prefer the first high-priority pattern match (largest in priority group)
    return max(amounts)


def _extract_date(text: str) -> Optional[str]:
    date_patterns = [
        r"\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b",
        r"\b(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})\b",
        r"\b(\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{2,4})\b",
        r"\b((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})\b",
    ]
    for pattern in date_patterns:
        m = re.search(pattern, text, re.IGNORECASE)
        if m:
            return m.group(1)

    nlp = _get_nlp()
    if nlp:
        doc = nlp(text[:600])
        for ent in doc.ents:
            if ent.label_ == "DATE":
                return ent.text
    return None


def _extract_vendor(text: str) -> Optional[str]:
    text_up = text.upper()
    for vendor in KNOWN_VENDORS:
        if vendor.upper() in text_up:
            return vendor

    nlp = _get_nlp()
    if nlp:
        doc = nlp(text[:600])
        orgs = [ent.text for ent in doc.ents if ent.label_ == "ORG"]
        if orgs:
            return orgs[0]
    return None


def _classify_type(text: str) -> Tuple[str, float]:
    """TF-IDF primary classification with keyword fallback."""
    doc_type, tfidf_score = classify_with_tfidf(text)
    if tfidf_score >= 0.1:
        return doc_type, tfidf_score

    # Keyword fallback
    text_lo = text.lower()
    scores = {
        dtype: sum(1 for kw in kws if kw in text_lo)
        for dtype, kws in DOC_KEYWORDS.items()
    }
    best_score = max(scores.values())
    if best_score == 0:
        return "other", 0.0
    return max(scores, key=scores.get), min(best_score / 5.0, 0.9)


# ── Main pipeline ─────────────────────────────────────────────────────────────

def run_nlp_pipeline(text: str) -> Dict[str, Any]:
    """
    Run NLP extraction on raw OCR text.
    Returns: {document_type, amount, date, vendor, entities, confidence}
    """
    result: Dict[str, Any] = {
        "document_type": "other",
        "amount": None,
        "date": None,
        "vendor": None,
        "entities": [],
        "confidence": 0.0,
        "error": None,
    }

    if not text or len(text.strip()) < 5:
        return result

    try:
        doc_type, type_conf = _classify_type(text)
        result["document_type"] = doc_type
        result["tfidf_score"] = type_conf

        result["amount"] = _extract_amount(text)
        result["date"] = _extract_date(text)
        result["vendor"] = _extract_vendor(text)

        nlp = _get_nlp()
        if nlp:
            doc = nlp(text[:1000])
            result["entities"] = [
                {"text": ent.text, "label": ent.label_}
                for ent in doc.ents
            ]

        # Confidence: weighted average of entity extraction + TF-IDF classification
        n_found = sum(1 for v in [result["amount"], result["date"], result["vendor"]] if v is not None)
        entity_conf = n_found / 3.0
        result["confidence"] = round(entity_conf * 0.7 + type_conf * 0.3, 4)

    except Exception as e:
        logger.error(f"NLP pipeline error: {e}")
        result["error"] = str(e)

    return result
