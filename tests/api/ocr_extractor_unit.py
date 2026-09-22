"""Unit tests for the bill reader's RULES (no OCR run needed): amount / date / type / vendor / address extraction.

Runs INSIDE the backend container (it imports app.ml.*):
    docker cp tests/assets/bills property_backend:/tmp/bills
    docker exec -i property_backend python - < tests/api/ocr_extractor_unit.py
tests/run_all.py does both steps for you.
"""
import json, os, sys, time

from app.ml.address_extractor import extract_address
from app.ml.bill_extractor import ascii_digits, extract_amount, extract_core, extract_dates, find_dates
from app.ml.bill_pipeline import analyze_bill
from app.ml.hybrid_ocr import Cell, Line, extract_pdf_text_lines, language_string, available_languages, words_to_lines
from app.ml.india_places import state_from_pin, transliterate_text, valid_pin

results = []
BILLS = "/tmp/bills"


def check(name, ok, detail=""):
    results.append(bool(ok))
    print(("PASS " if ok else "FAIL ") + name + (f"  [{str(detail)[:170]}]" if detail != "" else ""))


def L(*cells, y=100, h=20, src="t"):
    """A row of (text, x0, x1) cells, or plain strings placed left to right."""
    out, x = [], 10
    for c in cells:
        text, x0, x1 = c if isinstance(c, tuple) else (c, x, x + 8 * len(c))
        out.append(Cell(text, x0, x1, 80.0))
        x = x1 + 60
    return Line(out, y, h, 0, src)


print("== 1. The three SAMPLE bills (invented data; saved OCR readings) ==")
expected = json.load(open(f"{BILLS}/expected.json", encoding="utf-8"))
for name, exp in expected.items():
    lines = [Line.from_dict(d) for d in json.load(open(f"{BILLS}/{name}.ocr.json", encoding="utf-8"))["lines"]]
    t0 = time.time()
    core, addr = extract_core(lines), extract_address(lines)
    dt = time.time() - t0
    for key, want in exp.get("core", {}).items():
        check(f"{name}: {key} = {want!r}", core.get(key) == want, core.get(key))
    for key, want in exp.get("address", {}).items():
        got = addr.get(key)
        check(f"{name}: address.{key} {'contains' if isinstance(want, str) and key == 'place' else '='} {want!r}",
              (want.lower() in (got or "").lower()) if key == "place" else got == want, got)
    for key in exp.get("must_be_empty", []):
        val = core.get(key) if key in core else addr.get(key)
        check(f"{name}: {key} is left EMPTY (unreadable image: no guessing)", val in (None, ""), val)
    check(f"{name}: extraction is fast (< 10 s)", dt < 10, f"{dt:.2f}s")

print("== 2. Amount: what must NOT be picked ==")
rows = [L("Bill Amount", ("1730.00", 300, 360), y=100), L("After due date", ("1750.00", 300, 360), y=140),
        L("Security Deposit", ("3000.00", 300, 360), y=180), L("UP TO Rs 1000 on your bill payment PhonePe scratch card", y=220),
        L("Rate (Per KL)", ("59.42", 300, 340), y=260)]
r = extract_amount(rows)
check("bill amount beats late amount, deposit, advert and rate", r["amount"] == 1730.0, r["amount"])
rows = [L("Water Charges", ("713", 300, 330), y=100), L("Sewerage Charges", ("499", 300, 330), y=140), L("Total Payable Amount", ("1257", 300, 340), y=180)]
check("'Total Payable Amount' beats its components", extract_amount(rows)["amount"] == 1257.0)
rows = [L("देयक रक्कम :", ("१७३०.००", 300, 380), y=100)]
check("Marathi label and Devanagari digits: देयक रक्कम १७३०.०० -> 1730.0", extract_amount(rows)["amount"] == 1730.0, extract_amount(rows)["amount"])
rows = [L("Consumer No", ("000012345678", 300, 400), y=100), L("Rate (Per KL)", ("59.42", 300, 340), y=140), L("Pincode", ("400708", 300, 360), y=180)]
check("only ids, rates and a pincode -> amount stays EMPTY rather than a guess", extract_amount(rows)["amount"] is None, extract_amount(rows)["amount"])
rows = [L("Total Payable", ("1,25,000.50", 300, 420), y=100)]
check("Indian digit grouping 1,25,000.50 -> 125000.5", extract_amount(rows)["amount"] == 125000.5, extract_amount(rows)["amount"])
rows = [L("Amount Payable", ("1730,00", 300, 380), y=100)]
check("OCR comma-as-decimal 1730,00 -> 1730.0", extract_amount(rows)["amount"] == 1730.0, extract_amount(rows)["amount"])
rows = [L("Bill Amount", ("1730.00", 300, 360), y=100, src="a"), L("Bill Amount", ("1730.00", 300, 360), y=100, src="b"), L("Bill Amount", ("1720.00", 300, 360), y=100, src="c")]
check("a value most OCR passes agree on beats a lone misread (1730 x2 vs 1720)", extract_amount(rows)["amount"] == 1730.0)

print("== 3. Dates ==")
check("dd-mm-yyyy with OCR spaces and Devanagari digits", [d for d, _ in find_dates("१० - १२ - २०१९ and 3 / 11 / 22")] == ["10-12-2019"], find_dates("१० - १२ - २०१९ and 3 / 11 / 22"))
check("impossible dates are rejected (31-02-2020, 15-13-2020, year 2099)", find_dates("31-02-2020 15-13-2020 01-01-2099") == [])
rows = [L("देवक दिनांक", ("10-12-2019", 200, 300), y=100), L("देय दिनांक", ("30-12-2019", 200, 300), y=140)]
d = extract_dates(rows)
check("garbled 'देवक दिनांक' is the BILL date and 'देय दिनांक' the DUE date (one letter apart)", d["bill_date"] == "10-12-2019" and d["due_date"] == "30-12-2019", d)
rows = [L("Bill Date", ("11-03-2022", 200, 300), y=100), L("Bill Process Date", ("3/11/22 3:37 PM", 200, 320), y=140)]
check("a m/d/yy print stamp is ignored", extract_dates(rows)["date"] == "11-03-2022", extract_dates(rows))
rows = [L("Bill Period", ("09-02-2022 to 10-03-2022", 200, 400), y=100), L("Due Date", ("10-04-2022", 200, 300), y=140), L(("11-03-2022", 200, 300), y=180),
        L(("09-02-2022", 200, 300), ("10-03-2022", 400, 500), y=220)]
d = extract_dates(rows)
check("no readable label: the date between period end and due date is the bill date (11-03-2022)", d["date"] == "11-03-2022" and d["bill_period"] == "09-02-2022 to 10-03-2022", d)
rows = [L("Reading Date", ("06-12-2019", 200, 300), y=100), L("Connection Date", ("10-07-2018", 200, 300), y=140), L("Due Date", ("30-12-2019", 200, 300), y=180)]
check("reading / connection dates are never the bill date", extract_dates(rows)["date"] in ("30-12-2019", None) and extract_dates(rows)["bill_date"] is None, extract_dates(rows))

print("== 4. Type and vendor ==")
def kind(text):
    return extract_core([L(text, y=100)])
check("MSEDCL / Mahavitaran -> electricity", kind("महावितरण BILL OF SUPPLY MSEDCL")["document_type"] == "electricity_bill" and kind("MSEDCL")["vendor"] == "MSEDCL")
check("MCGM municipal corporation -> water", kind("Municipal Corporation of Greater Mumbai water charges")["document_type"] == "water_bill")
check("Marathi 'पाणी देयक' -> water", kind("पाणी देयक जल आकार")["document_type"] == "water_bill")
check("Mahanagar Gas -> gas", kind("Mahanagar Gas Limited piped natural gas bill")["document_type"] == "gas_bill")
check("BSES Rajdhani -> electricity", kind("BSES Rajdhani Power Limited Electricity Bill")["vendor"] == "BSES Rajdhani")
check("unrecognisable text -> no type (the caller falls back to the classic classifier)", kind("hello world 123")["document_type"] is None)
check("a vendor's usual type never overrides what the bill's own words clearly state (MCGM defaults to water, but this one says GAS BILL)",
      kind("MCGM GAS BILL Gas Supply Charges piped natural gas")["document_type"] == "gas_bill", kind("MCGM GAS BILL Gas Supply Charges piped natural gas"))
check("...but a vendor's usual type IS still used when the text is silent/ambiguous (no internet_bill type exists yet, so this stays water - a known gap, not a crash)",
      kind("MCGM INTERNET BILL Internet Service Account No 55421")["document_type"] == "water_bill")
check("'duplicate bill' is flagged", kind("DUPLICATE BILL")["is_duplicate"] is True and kind("BILL")["is_duplicate"] is False)

print("== 5. Address ==")
def addr(*rows):
    return extract_address([L(*r, y=100 + 30 * i) if isinstance(r, tuple) else L(r, y=100 + 30 * i) for i, r in enumerate(rows)])
a = addr("RAMESH KUMAR", "FLAT 12, GREEN PARK SOCIETY, KOTHRUD", "PUNE - 411038")
check("English address: PIN 411038 -> Maharashtra, Pune, Kothrud", (a["pincode"], a["state"], a["city"], a["suburb"]) == ("411038", "Maharashtra", "Pune", "Kothrud"), a)
check("the name line is separated from the address", a["customer_name"] == "RAMESH KUMAR" and "RAMESH" not in (a["place"] or ""), a)
a = addr("सुनील कुलकर्णी", "फ्लॅट क्र. ४०१, साई कृपा अपार्टमेंट", "ऐरोली, नवी मुंबई - ४००७०८")
check("Marathi-script address with Devanagari digits: PIN 400708, Airoli, Navi Mumbai, Maharashtra", (a["pincode"], a["suburb"], a["city"], a["state"]) == ("400708", "Airoli", "Navi Mumbai", "Maharashtra"), a)
check("...and the place is transliterated to Latin letters (no Devanagari left)", a["place"] and not any("ऀ" <= c <= "ॿ" for c in a["place"]), a["place"])
a = addr("Assistant Engineer Water Works", "Municipal Office Building, Deonar", "Mumbai - 400043")
check("an authority's own office address in the same bill is not chosen when a consumer address exists",
      extract_address([L("SHRI A B DESHMUKH", y=100), L("STATION ROAD GOVANDI MUMBAI-400088", y=130), L("Assistant Engineer Municipal Office Deonar Mumbai 400043", y=900)])["pincode"] == "400088")
check("no PIN and no address label -> nothing invented", addr("Total Payable Amount 1257", "Due Date 10-04-2022")["place"] is None)
check("an invalid PIN prefix (999999) is not an address", extract_address([L("SOME PLACE MUMBAI 999999", y=100)])["pincode"] is None)
check("glued duplicate PIN '400088400088' is read as 400088", extract_address([L("STATION ROAD GOVANDI MUMBAI-400088400088", y=100)])["pincode"] == "400088")
check("PIN -> state: 400708 Maharashtra, 403001 Goa, 110001 Delhi, 560001 Karnataka, 600001 Tamil Nadu",
      [state_from_pin(p) for p in ("400708", "403001", "110001", "560001", "600001")] == ["Maharashtra", "Goa", "Delhi", "Karnataka", "Tamil Nadu"])
check("PIN validity: 400708 yes, 999999 no, 12345 no", valid_pin("400708") and not valid_pin("999999") and not valid_pin("12345"))
check("transliteration: 'नवी मुंबई' has no Devanagari left", not any("ऀ" <= c <= "ॿ" for c in transliterate_text("नवी मुंबई पुणे ठाणे")), transliterate_text("नवी मुंबई पुणे ठाणे"))

print("== 6. OCR engine helpers ==")
have = available_languages()
lang = language_string()
check("language string only ever names installed languages (falls back to English)", all(p in have for p in lang.split("+")), f"{lang} of {sorted(have)}")
check("Marathi is installed in this image (eng+mar)", "mar" in have and lang == "eng+mar", sorted(have))
words = [{"t": "Total", "c": 90, "x0": 10, "x1": 60, "y": 100, "h": 20}, {"t": "Amount", "c": 90, "x0": 70, "x1": 140, "y": 101, "h": 20},
         {"t": "1257", "c": 90, "x0": 400, "x1": 450, "y": 99, "h": 20}, {"t": "Next", "c": 90, "x0": 10, "x1": 50, "y": 160, "h": 20}]
ls = words_to_lines(words, 0, "t")
check("words on one baseline become ONE row, split into 2 cells by the wide gap ('Total Amount' | '1257')", len(ls) == 2 and [c.text for c in ls[0].cells] == ["Total Amount", "1257"], [[c.text for c in l.cells] for l in ls])

print("== 7. PDFs with a real text layer (no OCR at all: bills downloaded straight from a utility's website) ==")
lines = extract_pdf_text_lines(f"{BILLS}/msedcl_text_layer.pdf")
check("a text-layer PDF returns Lines directly (no OCR run)", bool(lines))
core, addr = extract_core(lines), extract_address(lines)
check("Marathi labels in the PDF's own text are read exactly: type, vendor, amount, dates",
      core.get("document_type") == "electricity_bill" and core.get("vendor") == "MSEDCL" and core.get("amount") == 2480.0
      and core.get("date") == "12-03-2024" and core.get("due_date") == "28-03-2024", core)
check("...and the address, with no OCR damage at all", (addr.get("pincode"), addr.get("suburb"), addr.get("city")) == ("400708", "Airoli", "Navi Mumbai")
      and addr.get("customer_name") == "SUNIL RAMCHANDRA KULKARNI & SUMAN SUNIL KULKARNI", addr)

t0 = time.time()
r = analyze_bill(f"{BILLS}/msedcl_text_layer.pdf")
dt = time.time() - t0
check("analyze_bill() takes the text-layer path: engine 'pdf-text', full confidence, and it is near-instant",
      r["ocr_engine"] == "pdf-text" and r["confidence"] == 1.0 and dt < 5, (r["ocr_engine"], r["confidence"], f"{dt:.2f}s"))
check("nothing is ever mistaken for a low-resolution photo on this path", r["low_resolution"] is False and r["image_width"] is None, (r["low_resolution"], r["image_width"]))

check("extract_pdf_text_lines() on a PNG (not a PDF) returns None", extract_pdf_text_lines(f"{BILLS}/msedcl_airoli.png") is None)
_corrupt_pdf = "/tmp/corrupt_unit_test.pdf"
open(_corrupt_pdf, "wb").write(b"%PDF-1.4\n" + os.urandom(2000))
check("extract_pdf_text_lines() on a corrupt PDF returns None, never raises", extract_pdf_text_lines(_corrupt_pdf) is None)
os.remove(_corrupt_pdf)

r = analyze_bill(f"{BILLS}/not_a_bill.pdf")
check("a PDF with real text that is NOT a bill (a CV) finds no bill fields, and does not crash trying OCR on the rendered page instead",
      r["error"] is None and r["document_type"] is None and r["amount"] is None and (r["address"] or {}).get("pincode") is None, r)

print(f"\n{sum(results)}/{len(results)} passed")
sys.exit(0 if all(results) else 1)
