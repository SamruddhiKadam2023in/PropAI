"""
OCR Pipeline — Layer 3, AI/ML Pipeline.
Dual-engine architecture as per project specification:
  - Tesseract OCR  → structured/printed documents (fast, high precision)
  - EasyOCR        → handwritten / noisy documents (deep learning, robust)
  - engine="auto"  → runs Tesseract; if confidence < 0.50 switches to EasyOCR

Flow: image file → OpenCV preprocessing → OCR engine → returns {text, confidence, ocr_engine}
"""
import cv2
import numpy as np
import pytesseract
import logging
import os
from typing import Dict, Any, Tuple, Optional

logger = logging.getLogger(__name__)

# ── Lazy-load EasyOCR reader (models download at first use, ~100 MB) ──────────

_easyocr_reader = None


def _get_easyocr():
    global _easyocr_reader
    if _easyocr_reader is None:
        try:
            import easyocr
            _easyocr_reader = easyocr.Reader(["en"], gpu=False, verbose=False)
            logger.info("EasyOCR reader initialised (CPU mode).")
        except ImportError:
            logger.warning("EasyOCR not installed. Install with: pip install easyocr")
        except Exception as e:
            logger.error(f"EasyOCR init failed: {e}")
    return _easyocr_reader


def run_easyocr(image_path: str) -> Tuple[str, float]:
    """Run EasyOCR on the original image (best for handwritten/noisy docs)."""
    reader = _get_easyocr()
    if reader is None:
        return "", 0.0
    try:
        results = reader.readtext(image_path, detail=1)
        words, confs = [], []
        for (_, word, conf) in results:
            if word.strip():
                words.append(word)
                confs.append(float(conf))
        text = " ".join(words)
        confidence = sum(confs) / len(confs) if confs else 0.0
        return text, round(confidence, 4)
    except Exception as e:
        logger.error(f"EasyOCR failed: {e}")
        return "", 0.0


# ── PDF → image conversion ───────────────────────────────────────────────────

def pdf_to_image(pdf_path: str) -> Optional[np.ndarray]:
    """Convert first page of a PDF to a numpy image array."""
    try:
        import pypdfium2 as pdfium
        pdf = pdfium.PdfDocument(pdf_path)
        page = pdf[0]
        bitmap = page.render(scale=2.0, rotation=0)
        pil_img = bitmap.to_pil()
        img_array = np.array(pil_img.convert("RGB"))
        return cv2.cvtColor(img_array, cv2.COLOR_RGB2BGR)
    except ImportError:
        pass
    # Fallback: try Pillow for PDF
    try:
        from PIL import Image
        img = Image.open(pdf_path)
        img_array = np.array(img.convert("RGB"))
        return cv2.cvtColor(img_array, cv2.COLOR_RGB2BGR)
    except Exception:
        return None


# ── Image loading (handles both images and PDFs) ──────────────────────────────

def load_image(image_path: str) -> np.ndarray:
    """Load image from path; converts PDF first page to image if needed."""
    if image_path.lower().endswith(".pdf"):
        img = pdf_to_image(image_path)
        if img is not None:
            return img
        raise ValueError(f"Cannot convert PDF to image: {image_path}")
    img = cv2.imread(image_path)
    if img is None:
        raise ValueError(f"Cannot read image: {image_path}")
    return img


# ── Multi-strategy preprocessing ─────────────────────────────────────────────

def _deskew(gray: np.ndarray) -> np.ndarray:
    """
    Straighten a slightly skewed page. The angle is measured on the text (ink) pixels.
    OpenCV >= 4.5 reports minAreaRect angles in (0, 90], so normalise to (-45, 45];
    the previous formula assumed the old (-90, 0] range and rotated straight pages by 90 degrees.
    Implausible angles are ignored rather than applied.
    """
    try:
        _, thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)  # ink = 255
        coords = np.column_stack(np.where(thresh > 0))[:, ::-1].astype(np.float32)          # (x, y)
        if len(coords) < 100:
            return gray
        angle = cv2.minAreaRect(coords)[-1]
        if angle > 45:
            angle -= 90
        if 0.5 < abs(angle) <= 15:
            h, w = gray.shape[:2]
            M = cv2.getRotationMatrix2D((w // 2, h // 2), angle, 1.0)
            gray = cv2.warpAffine(gray, M, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    except Exception:
        pass
    return gray


def preprocess_strategies(image_path: str) -> list:
    """
    Return list of preprocessed images to try in order.
    Strategy 0: plain grayscale (safest)
    Strategy 1: OTSU global threshold
    Strategy 2: CLAHE + adaptive threshold (good for uneven lighting)
    """
    img = load_image(image_path)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    gray = _deskew(gray)

    strategies = []

    # Strategy 0: plain grayscale — Tesseract handles this well for clean prints
    strategies.append(gray)

    # Strategy 1: OTSU global threshold
    _, otsu = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    strategies.append(otsu)

    # Strategy 2: denoise → CLAHE → adaptive threshold (good for noisy scans)
    denoised = cv2.fastNlMeansDenoising(gray, h=10)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    enhanced = clahe.apply(denoised)
    adaptive = cv2.adaptiveThreshold(
        enhanced, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 11, 2,
    )
    strategies.append(adaptive)

    return strategies


def preprocess_image(image_path: str) -> np.ndarray:
    """Legacy: returns single preprocessed image (strategy 0 = grayscale)."""
    return preprocess_strategies(image_path)[0]


# ── Tesseract OCR ────────────────────────────────────────────────────────────

def run_tesseract(img: np.ndarray) -> Tuple[str, float]:
    """Run Tesseract on a pre-processed numpy image. Returns (text, confidence)."""
    try:
        config = "--oem 3 --psm 6"
        data = pytesseract.image_to_data(img, config=config, output_type=pytesseract.Output.DICT)

        words, confs = [], []
        for i, word in enumerate(data["text"]):
            c = data["conf"][i]
            if c > 0 and word.strip():
                words.append(word)
                confs.append(c / 100.0)

        text = " ".join(words)
        confidence = sum(confs) / len(confs) if confs else 0.0
        return text, confidence

    except Exception as e:
        logger.error(f"Tesseract failed: {e}")
        return "", 0.0


# ── Main pipeline ─────────────────────────────────────────────────────────────

def run_ocr_pipeline(image_path: str, engine: str = "auto") -> Dict[str, Any]:
    """
    Dual-engine OCR pipeline.
    engine="auto"      → Tesseract first; switches to EasyOCR if confidence < 0.50
    engine="tesseract" → Tesseract only (fast, printed docs)
    engine="easyocr"   → EasyOCR only (handwritten / noisy docs)
    """
    result: Dict[str, Any] = {
        "text":         "",
        "confidence":   0.0,
        "ocr_engine":   "tesseract",
        "preprocessed": False,
        "error":        None,
    }

    if not os.path.exists(image_path):
        result["error"] = "File not found"
        return result

    try:
        result["preprocessed"] = True

        if engine == "easyocr":
            text, conf = run_easyocr(image_path)
            result.update({"text": text, "confidence": conf, "ocr_engine": "easyocr"})
        else:
            # Multi-strategy Tesseract: try all preprocessing strategies, keep best
            strategies = preprocess_strategies(image_path)
            best_text, best_conf, best_strategy = "", 0.0, 0
            for i, preprocessed in enumerate(strategies):
                t, c = run_tesseract(preprocessed)
                if c > best_conf:
                    best_text, best_conf, best_strategy = t, c, i
            result.update({
                "text":       best_text,
                "confidence": best_conf,
                "ocr_engine": f"tesseract-s{best_strategy}",
            })
            logger.info(f"Best preprocessing strategy: {best_strategy} (conf={best_conf:.2f})")

            # Auto-fallback to EasyOCR if Tesseract still low
            if engine == "auto" and best_conf < 0.50:
                etext, econf = run_easyocr(image_path)
                if econf > best_conf:
                    result.update({"text": etext, "confidence": econf, "ocr_engine": "easyocr"})
                    logger.info(f"EasyOCR improved confidence {best_conf:.2f}→{econf:.2f}")

    except Exception as e:
        logger.error(f"OCR pipeline error: {e}")
        result["error"] = str(e)

    return result
