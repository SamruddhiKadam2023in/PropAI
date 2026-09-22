"""
Bulk expense import: an Owner or Manager who has real bills OCR can't read reliably (an old photo, a scan too faint for
Tesseract) can instead enter their known date / category / amount in a spreadsheet and import it in one go, so the Cost
Analysis and forecast still have real numbers to work with. No OCR is involved: every row is exactly what was typed.

    report = parse_expense_rows(rows)   # rows: list of {"date": ..., "category": ..., "amount": ..., "vendor": ...}

Never raises on bad data: a row that can't be understood is reported, never guessed or silently dropped.
"""
import csv
import io
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from openpyxl import Workbook, load_workbook

from app.services.expense_sync import parse_bill_date  # the same lenient DD/MM/YYYY-style parser bills already use
from app.models.financial import ExpenseCategory

MAX_ROWS = 2000                                # a generous cap: a decade of daily entries, well past any real spreadsheet
TEMPLATE_HEADERS = ["date", "category", "amount", "vendor", "description"]
CATEGORY_ALIASES = {c.value: c for c in ExpenseCategory} | {
    "elec": ExpenseCategory.ELECTRICITY, "electric": ExpenseCategory.ELECTRICITY, "power": ExpenseCategory.ELECTRICITY,
    "wtr": ExpenseCategory.WATER, "lpg": ExpenseCategory.GAS, "png": ExpenseCategory.GAS, "piped gas": ExpenseCategory.GAS,
    "broadband": ExpenseCategory.INTERNET, "wifi": ExpenseCategory.INTERNET, "repair": ExpenseCategory.MAINTENANCE,
    "repairs": ExpenseCategory.MAINTENANCE,
}


@dataclass
class ParsedRow:
    row: int                                    # 1-based, counting the header as row 1 (matches what a spreadsheet shows)
    category: Optional[ExpenseCategory] = None
    amount: Optional[float] = None
    expense_date: Optional[datetime] = None
    vendor: Optional[str] = None
    description: Optional[str] = None
    error: Optional[str] = None


@dataclass
class ImportReport:
    total_rows: int = 0
    good: List[ParsedRow] = field(default_factory=list)
    bad: List[ParsedRow] = field(default_factory=list)


def _parse_amount(raw: Any) -> Optional[float]:
    if raw is None or raw == "":
        return None
    if isinstance(raw, (int, float)):
        value = float(raw)
    else:
        text = str(raw).strip().replace(",", "").replace("₹", "").replace("Rs.", "").replace("Rs", "").strip()
        try:
            value = float(text)
        except ValueError:
            return None
    return value if 0 < value < 10_000_000 else None


def _parse_date(raw: Any) -> Optional[datetime]:
    """Always returns a UTC-aware datetime (or None), matching what bills already produce via parse_bill_date."""
    if raw is None or raw == "":
        return None
    if isinstance(raw, datetime):
        return raw if raw.tzinfo else raw.replace(tzinfo=timezone.utc)
    from datetime import date as _date
    if isinstance(raw, _date):                                       # an Excel cell formatted as a date, not a datetime
        return datetime(raw.year, raw.month, raw.day, tzinfo=timezone.utc)
    text = str(raw).strip()
    found = parse_bill_date(text)
    if found:
        return found
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%Y/%m/%d"):                 # a couple of formats a spreadsheet might also use
        try:
            return datetime.strptime(text, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def _parse_category(raw: Any) -> Optional[ExpenseCategory]:
    if raw is None:
        return None
    return CATEGORY_ALIASES.get(str(raw).strip().lower())


def parse_expense_rows(rows: List[Dict[str, Any]]) -> ImportReport:
    """rows: dicts with (at least) date / category / amount keys, case-insensitive; vendor and description are optional."""
    report = ImportReport(total_rows=len(rows))
    for i, raw in enumerate(rows[:MAX_ROWS], start=2):               # row 1 is the header
        by_key = {str(k).strip().lower(): v for k, v in raw.items()}
        category = _parse_category(by_key.get("category"))
        amount = _parse_amount(by_key.get("amount"))
        when = _parse_date(by_key.get("date") or by_key.get("expense_date") or by_key.get("bill date"))
        vendor = str(by_key["vendor"]).strip()[:255] if by_key.get("vendor") not in (None, "") else None
        description = str(by_key["description"]).strip()[:1000] if by_key.get("description") not in (None, "") else None

        errors = []
        if category is None:
            errors.append(f"category '{by_key.get('category')}' is not one of {', '.join(c.value for c in ExpenseCategory)}")
        if amount is None:
            errors.append(f"amount '{by_key.get('amount')}' is not a usable positive number")
        if when is None:
            errors.append(f"date '{by_key.get('date')}' could not be understood (try DD/MM/YYYY)")

        parsed = ParsedRow(row=i, category=category, amount=amount, expense_date=when, vendor=vendor, description=description,
                           error="; ".join(errors) or None)
        (report.bad if errors else report.good).append(parsed)
    return report


def read_spreadsheet(filename: str, data: bytes) -> List[Dict[str, Any]]:
    """.xlsx or .csv -> a list of {column_name: value} dicts, one per data row. Raises ValueError with a plain-English reason."""
    name = filename.lower()
    if name.endswith(".xlsx"):
        try:
            wb = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
        except Exception as exc:
            raise ValueError("This doesn't look like a valid .xlsx file.") from exc
        ws = wb.active
        rows_iter = ws.iter_rows(values_only=True)
        try:
            header = [str(h).strip().lower() if h is not None else "" for h in next(rows_iter)]
        except StopIteration:
            return []
        return [dict(zip(header, row)) for row in rows_iter if any(v not in (None, "") for v in row)]
    if name.endswith(".csv"):
        try:
            text = data.decode("utf-8-sig")
        except UnicodeDecodeError:
            text = data.decode("latin-1")
        reader = csv.DictReader(io.StringIO(text))
        return [{(k or "").strip().lower(): v for k, v in row.items()} for row in reader if any((v or "").strip() for v in row.values())]
    raise ValueError("Only .xlsx or .csv files are accepted.")


def build_template() -> bytes:
    """A starter spreadsheet with the expected columns and one example row, ready to fill in and re-upload."""
    wb = Workbook()
    ws = wb.active
    ws.title = "Expenses"
    ws.append(TEMPLATE_HEADERS)
    ws.append(["05/12/2025", "electricity", 2450, "Tata Power", "December electricity bill"])
    for col, width in zip("ABCDE", (12, 14, 10, 20, 30)):
        ws.column_dimensions[col].width = width
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
