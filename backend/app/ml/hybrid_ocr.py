"""
Hybrid OCR - English + Marathi bills, small or photographed images.

Why this exists: the original pipeline reads a page once, at its native size, as one block of words. On real Indian utility bills
(dense tables, small fonts, Devanagari labels, 500-700 px screenshots) that lost most of the text and, worse, separated labels from
their values. This engine instead

  1. upscales small images (and shrinks huge ones) to a reading-friendly size, straightens and cleans them;
  2. reads them several ways in parallel (English for reliable numbers, English+Marathi for Devanagari labels; a "block" layout
     and a "sparse" layout that suits table cells);
  3. rebuilds every pass as VISUAL ROWS split into CELLS (columns), so "Total Payable Amount ......... 1257" stays one line;
  4. stops early once the caller says the text is good enough, and always respects a time budget.

It returns positioned text only. Turning text into fields (type, amount, date, address) is bill_extractor's job.
"""
import logging
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from statistics import median
from typing import Callable, Dict, List, Optional, Tuple

import cv2
import numpy as np
import pytesseract

from app.config import settings

logger = logging.getLogger(__name__)

# Each Tesseract run is single-threaded; we run several passes side by side. Letting every run also spawn its own OpenMP threads
# oversubscribes the CPU and made one bill take anywhere from 16 s to 160 s. Set before any Tesseract process starts.
os.environ.setdefault("OMP_THREAD_LIMIT", "1")

MAX_PAGES = 3                 # a bill is 1-2 pages; more is a scanned booklet
TARGET_WIDTH = 2300           # px the page is scaled to before reading
MIN_SCALE, MAX_SCALE = 0.5, 4.0
MIN_WORD_CONF = 30            # words below this are noise for confidence purposes
DEFAULT_BUDGET_SECONDS = 60.0
LITE_TARGET_WIDTH = 1600        # lite mode reads a smaller picture: less memory and far less CPU
PASS_TIMEOUT_SECONDS = 40      # one Tesseract run that takes longer than this is killed (a stuck run must never hold a bill hostage)

_langs_cache: Optional[set] = None


def available_languages() -> set:
    """Tesseract language packs installed in this container (cached)."""
    global _langs_cache
    if _langs_cache is None:
        try:
            _langs_cache = set(pytesseract.get_languages(config=""))
        except Exception as exc:
            logger.warning("Could not list Tesseract languages (%s); assuming English only.", exc)
            _langs_cache = {"eng"}
    return _langs_cache


def language_string(want: Optional[Tuple[str, ...]] = None) -> str:
    """The configured languages (OCR_LANGUAGES, default 'eng+mar') that are installed - never a language Tesseract can't load."""
    if want is None:
        want = tuple(p.strip() for p in settings.OCR_LANGUAGES.replace(",", "+").split("+") if p.strip()) or ("eng",)
    have = available_languages()
    chosen = [l for l in want if l in have]
    return "+".join(chosen) if chosen else "eng"


# ── Data ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

@dataclass
class Cell:
    text: str
    x0: int
    x1: int
    conf: float = 0.0


@dataclass
class Line:
    cells: List[Cell]
    y: int                     # vertical centre in page pixels
    height: int
    page: int = 0
    source: str = ""           # which pass produced it, e.g. "eng/psm11/clahe"

    @property
    def text(self) -> str:
        return "  ".join(c.text for c in self.cells)

    @property
    def x0(self) -> int:
        return min(c.x0 for c in self.cells)

    def to_dict(self) -> dict:
        return {"y": self.y, "h": self.height, "page": self.page, "src": self.source,
                "cells": [{"t": c.text, "x0": c.x0, "x1": c.x1, "c": round(c.conf, 1)} for c in self.cells]}

    @staticmethod
    def from_dict(d: dict) -> "Line":
        return Line([Cell(c["t"], c["x0"], c["x1"], c.get("c", 0.0)) for c in d["cells"]], d["y"], d["h"], d.get("page", 0), d.get("src", ""))


@dataclass
class HybridOcrResult:
    lines: List[Line] = field(default_factory=list)          # every pass, all pages, de-duplicated
    confidence: float = 0.0                                   # mean confidence of readable words, 0-1
    languages: str = "eng"
    passes: List[str] = field(default_factory=list)
    pages: int = 0
    width: int = 0                                            # pixel width of the first page as uploaded
    elapsed: float = 0.0
    stopped_early: bool = False
    error: Optional[str] = None

    @property
    def text(self) -> str:
        return "\n".join(l.text for l in self.lines)


# ── Loading and cleaning ──────────────────────────────────────────────────────────────────────────────────────────────

def load_pages(path: str) -> List[np.ndarray]:
    """Up to MAX_PAGES pages as BGR arrays. PDFs are rendered; images are read as they are."""
    if path.lower().endswith(".pdf"):
        import pypdfium2 as pdfium
        pdf = pdfium.PdfDocument(path)
        out = []
        for i in range(min(len(pdf), MAX_PAGES)):
            pil = pdf[i].render(scale=2.5).to_pil().convert("RGB")
            out.append(cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR))
        if not out:
            raise ValueError("Cannot convert PDF to image: it has no pages.")
        return out
    img = cv2.imread(path, cv2.IMREAD_UNCHANGED)
    if img is None:
        raise ValueError(f"Cannot read image: {path}")
    if img.ndim == 2:
        img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    elif img.shape[2] == 4:                                   # transparent PNG: flatten onto white, not black
        alpha = img[:, :, 3:4].astype(np.float32) / 255.0
        img = (img[:, :, :3] * alpha + 255 * (1 - alpha)).astype(np.uint8)
    return [img]


def _deskew(gray: np.ndarray) -> np.ndarray:
    from app.ml.ocr_pipeline import _deskew as deskew          # one implementation of skew correction in the project
    return deskew(gray)


def prepare(page: np.ndarray, lite: bool = False) -> Dict[str, np.ndarray]:
    """The picture variants we may read: 'clahe' (contrast-boosted grey), 'otsu' (black/white), 'adaptive' (uneven light).
    Lite mode uses a smaller picture, skips the slow denoising and builds only the two variants it can use."""
    gray = cv2.cvtColor(page, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape[:2]
    scale = max(MIN_SCALE, min(MAX_SCALE, (LITE_TARGET_WIDTH if lite else TARGET_WIDTH) / float(w)))
    if abs(scale - 1.0) > 0.05:
        gray = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC if scale > 1 else cv2.INTER_AREA)
    gray = _deskew(gray)
    if lite or gray.size >= 6_000_000:
        gray = cv2.GaussianBlur(gray, (3, 3), 0)
    else:
        gray = cv2.fastNlMeansDenoising(gray, h=7)
    clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8)).apply(gray)
    _, otsu = cv2.threshold(clahe, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    if lite:
        return {"clahe": clahe, "otsu": otsu}
    adaptive = cv2.adaptiveThreshold(clahe, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 41, 12)
    return {"clahe": clahe, "otsu": otsu, "adaptive": adaptive}


# ── Reading one picture one way ───────────────────────────────────────────────────────────────────────────────────────

def _words(image: np.ndarray, lang: str, psm: int) -> List[dict]:
    started = time.time()
    data = pytesseract.image_to_data(image, lang=lang, config=f"--oem 3 --psm {psm}", output_type=pytesseract.Output.DICT, timeout=PASS_TIMEOUT_SECONDS)
    logger.info("Tesseract pass lang=%s psm=%s took %.1fs", lang, psm, time.time() - started)
    words = []
    for i, text in enumerate(data["text"]):
        text = (text or "").strip()
        if not text:
            continue
        try:
            conf = float(data["conf"][i])
        except (TypeError, ValueError):
            conf = -1.0
        if conf < 0:
            continue
        words.append({"t": text, "c": conf, "x0": int(data["left"][i]), "x1": int(data["left"][i] + data["width"][i]),
                      "y": int(data["top"][i] + data["height"][i] / 2), "h": int(data["height"][i])})
    return words


def words_to_lines(words: List[dict], page: int, source: str) -> List[Line]:
    """
    Group words into visual rows (same baseline, whatever block Tesseract put them in), then split each row into cells wherever
    there is a wide horizontal gap - that is how table columns are recovered.
    """
    if not words:
        return []
    med_h = median(w["h"] for w in words) or 10
    rows: List[List[dict]] = []
    for w in sorted(words, key=lambda w: w["y"]):
        if rows and abs(w["y"] - median(x["y"] for x in rows[-1])) <= 0.55 * med_h:
            rows[-1].append(w)
        else:
            rows.append([w])
    lines = []
    for row in rows:
        row.sort(key=lambda w: w["x0"])
        cells, cur = [], [row[0]]
        for w in row[1:]:
            if w["x0"] - cur[-1]["x1"] > 1.8 * med_h:          # a column gap, not a word space
                cells.append(cur)
                cur = [w]
            else:
                cur.append(w)
        cells.append(cur)
        line_cells = [Cell(" ".join(w["t"] for w in c), c[0]["x0"], c[-1]["x1"], sum(w["c"] for w in c) / len(c)) for c in cells]
        lines.append(Line(line_cells, int(median(w["y"] for w in row)), int(median(w["h"] for w in row)), page, source))
    return lines


def _norm_key(text: str) -> str:
    return re.sub(r"[^0-9a-zऀ-ॿ]", "", text.lower())


def _merge(existing: List[Line], new: List[Line], keep_all: bool = False) -> List[Line]:
    """Keep every distinct line; drop a line whose normalised text an earlier pass already produced.
    Lite mode (keep_all) keeps repeats too: with only a few passes, 'two passes read the same amount' is its evidence that a digit is right."""
    if keep_all:
        return list(existing) + [l for l in new if len(_norm_key(l.text)) >= 2]
    seen = {_norm_key(l.text) for l in existing}
    out = list(existing)
    for line in new:
        key = _norm_key(line.text)
        if len(key) >= 2 and key not in seen:
            seen.add(key)
            out.append(line)
    return out


def _confidence(words: List[dict]) -> float:
    good = [w["c"] for w in words if w["c"] >= MIN_WORD_CONF and re.search(r"[A-Za-z0-9ऀ-ॿ]", w["t"])]
    return (sum(good) / len(good) / 100.0) if good else 0.0


# ── The engine ────────────────────────────────────────────────────────────────────────────────────────────────────────

def run_hybrid_ocr(path: str, budget_seconds: float = DEFAULT_BUDGET_SECONDS,
                   sufficient: Optional[Callable[[List[Line]], bool]] = None, workers: Optional[int] = None) -> HybridOcrResult:
    """
    Read a bill. `sufficient(lines)` lets the caller stop early once it has what it needs (e.g. type + amount + date found).
    Never raises for OCR trouble: returns whatever was read, with `error` set if nothing was.
    """
    started = time.time()
    result = HybridOcrResult(languages=language_string())
    try:
        pages = load_pages(path)
    except Exception as exc:
        result.error = str(exc)
        return result
    result.pages = len(pages)
    result.width = int(pages[0].shape[1]) if pages else 0
    lite = bool(settings.OCR_LITE_MODE)
    workers = 1 if lite else (workers or max(1, min(4, os.cpu_count() or 1)))
    lang_all = result.languages
    has_mar = "mar" in lang_all

    # (name, language, psm, picture). Ordered by value: the first wave is the best general-purpose reading.
    plan = [
        [("eng/psm6/clahe", "eng", 6, "clahe"), ("eng/psm11/clahe", "eng", 11, "clahe")]
        + ([(f"{lang_all}/psm6/clahe", lang_all, 6, "clahe")] if has_mar else []),
        [("eng/psm6/otsu", "eng", 6, "otsu"), ("eng/psm11/adaptive", "eng", 11, "adaptive")]
        + ([(f"{lang_all}/psm11/otsu", lang_all, 11, "otsu")] if has_mar else []),
    ]
    if lite:                                   # one pass per step, English+Marathi first, and stop as soon as the essentials are read
        first = (f"{lang_all}/psm6/clahe", lang_all, 6, "clahe") if has_mar else ("eng/psm6/clahe", "eng", 6, "clahe")
        plan = [[first], [("eng/psm11/clahe", "eng", 11, "clahe")], [("eng/psm6/otsu", "eng", 6, "otsu")]]

    all_words_by_pass: Dict[str, List[dict]] = {}
    deadline = started + budget_seconds
    for page_no, page in enumerate(pages):
        try:
            pictures = prepare(page, lite)
        except Exception as exc:
            logger.warning("Preparing page %s failed: %s", page_no + 1, exc)
            continue
        for wave_no, wave in enumerate(plan):
            if time.time() > started + budget_seconds * 0.65 and wave_no > 0:
                result.stopped_early = True
                break
            pool = ThreadPoolExecutor(max_workers=workers)
            try:
                futures = {name: pool.submit(_words, pictures[pic], lang, psm) for (name, lang, psm, pic) in wave}
                for name, fut in futures.items():
                    try:
                        words = fut.result(timeout=max(5.0, deadline - time.time()))
                    except Exception as exc:
                        logger.warning("OCR pass %s failed or ran out of time: %s", name, exc or type(exc).__name__)
                        continue
                    if not words:
                        continue
                    all_words_by_pass[f"{page_no}:{name}"] = words
                    result.lines = _merge(result.lines, words_to_lines(words, page_no, name), keep_all=lite)
                    result.passes.append(f"p{page_no + 1}:{name}")
            finally:
                pool.shutdown(wait=False, cancel_futures=True)   # never block past the budget waiting for a slow pass
            if sufficient and result.lines and sufficient(result.lines):
                result.stopped_early = wave_no < len(plan) - 1
                break

    if all_words_by_pass:
        result.confidence = round(max(_confidence(w) for w in all_words_by_pass.values()), 4)
    elif not result.error:
        result.error = "Tesseract did not extract any text."
    result.elapsed = round(time.time() - started, 2)
    return result
