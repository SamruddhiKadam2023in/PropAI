"""
Shared building blocks for every PDF / Excel export, so the text-safety rules are implemented once.

Rules enforced here (each was a real defect in the older exports):
  * PDF text is escaped for ReportLab's mini-markup and limited to glyphs the embedded font really has - anything else becomes
    "?" instead of an empty "missing glyph" box. (The rupee sign and non-Latin scripts are not in the bundled font; use "Rs.".)
  * Excel text is always written as a string - never as a formula, whatever it starts with ("=", "+", "-", "@") - and characters
    Excel cannot store are removed instead of crashing the export.
"""
import os
import re
import unicodedata
from xml.sax.saxutils import escape

import reportlab
from openpyxl.cell.cell import ILLEGAL_CHARACTERS_RE
from reportlab.lib import colors
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

BLUE = colors.HexColor("#2563EB")
LIGHT_BLUE = colors.HexColor("#DBEAFE")
LIGHT_GRAY = colors.HexColor("#F3F4F6")
GRID = colors.HexColor("#D1D5DB")

FONT, FONT_BOLD = "PropAI", "PropAI-Bold"
_FONT_DIR = os.path.join(os.path.dirname(reportlab.__file__), "fonts")
for _name, _file in ((FONT, "Vera.ttf"), (FONT_BOLD, "VeraBd.ttf")):
    if _name not in pdfmetrics.getRegisteredFontNames():
        pdfmetrics.registerFont(TTFont(_name, os.path.join(_FONT_DIR, _file)))
pdfmetrics.registerFontFamily(FONT, normal=FONT, bold=FONT_BOLD, italic=FONT, boldItalic=FONT_BOLD)

_GLYPHS = pdfmetrics.getFont(FONT).face.charToGlyph
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]")
_WHITESPACE = re.compile(r"\s+")
MAX_TEXT = 500                       # one field can never blow up a page or a cell


def clean_text(value) -> str:
    """Plain, single-line, control-free text (None -> '')."""
    text = unicodedata.normalize("NFC", "" if value is None else str(value))
    text = _WHITESPACE.sub(" ", _CONTROL.sub("", text)).strip()
    return text if len(text) <= MAX_TEXT else text[: MAX_TEXT - 3] + "..."


def pdf_text(value) -> str:
    """Text that the PDF font can draw: unsupported characters become '?', never a blank box."""
    return "".join(ch if ord(ch) in _GLYPHS else "?" for ch in clean_text(value))


def pdf_markup(value) -> str:
    """pdf_text, escaped so '&', '<' and '>' in a property name cannot be read as ReportLab markup."""
    return escape(pdf_text(value))


def xl_text(value) -> str:
    """Text Excel can store (illegal XML characters removed)."""
    return ILLEGAL_CHARACTERS_RE.sub("", clean_text(value))


def set_text(cell, value) -> None:
    """Write text so Excel can never evaluate it as a formula."""
    cell.value = xl_text(value)
    cell.data_type = "s"


class NumberedCanvas(canvas.Canvas):
    """Adds 'Page x of y' and a footer to every page (needs a second pass to know the total)."""
    footer_label = "PropAI"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._saved = []

    def showPage(self):
        self._saved.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        total = len(self._saved)
        for state in self._saved:
            self.__dict__.update(state)
            width, _ = self._pagesize
            self.setFont(FONT, 8)
            self.setFillColor(colors.grey)
            self.drawString(0.5 * 72, 0.32 * 72, self.footer_label)
            self.drawRightString(width - 0.5 * 72, 0.32 * 72, f"Page {self._pageNumber} of {total}")
            super().showPage()
        super().save()
