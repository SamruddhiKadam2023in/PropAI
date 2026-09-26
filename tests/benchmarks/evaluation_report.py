"""
Offline evaluation report - NOT a pass/fail test. A one-off script that computes REAL accuracy numbers for
the project report (Table 1.1: WER for OCR, F1 for document-type classification, MAE/RMSE for cost
forecasting), instead of the invented "expected accuracy range" figures currently in that table.

Every number here comes from a real code path plus either a real bill image or real database history -
nothing is invented for this script. Each part prints its own methodology and honest limitations (sample
size, what was excluded and why) - read those before quoting a number.

Run inside the backend container (it needs app.ml.*, app.database, and a live Postgres connection):
    docker cp tests/assets/bills property_backend:/tmp/bills
    docker exec -i property_backend python - < tests/benchmarks/evaluation_report.py
"""
import asyncio
import re
from collections import defaultdict

# ── Part A: OCR Word Error Rate ────────────────────────────────────────────────

def word_error_rate(reference: str, hypothesis: str) -> dict:
    """Standard WER = word-level edit distance / reference word count. Lowercased, punctuation stripped."""
    ref = re.sub(r"[^\w\s]", " ", reference.lower()).split()
    hyp = re.sub(r"[^\w\s]", " ", hypothesis.lower()).split()
    n, m = len(ref), len(hyp)
    d = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n + 1):
        d[i][0] = i
    for j in range(m + 1):
        d[0][j] = j
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            d[i][j] = d[i - 1][j - 1] if ref[i - 1] == hyp[j - 1] else 1 + min(d[i - 1][j], d[i][j - 1], d[i - 1][j - 1])
    return {"wer": round(d[n][m] / n, 4) if n else 0.0, "edits": d[n][m], "reference_words": n}


# Manually transcribed by reading tests/assets/bills/bses_delhi.png directly (best-effort; a few small
# digits/amounts may be misread by eye on a compressed sample image - this is a human transcript, not a
# machine-verified one).
REFERENCE_BSES_DELHI = """
BSES Rajdhani Power Limited Electricity Bill
MR RAKESH SHARMA
H NO 34, GALI 3, SAMPLE NAGAR, DELHI 110062
Consumer 100000000 Meter 1234567 Sanctioned Load 3.00 kW Tariff Domestic
Bill Date 14-09-2024 CA No 100000001 Bill Basis Actual Cycle No 29
Customer Care Centre 19123 39 99 99 99
Meter No Type Previous Reading Current Reading Multiplier Units
1234567 KWH 33450.00 33490.00 1.00 040
Billing Details
Energy Charges 2076.00 Fixed Charges 400.00 PPAC 120.00 Electricity Tax 10.00 Pension Trust Surcharge 44.00
Past Dues Refunds Subsidy Arrears 0.00 Late Payment Surcharge 0.00 Total Payable Amount 2866.00
Bill Amount Payable Rs 2866.00
Security Deposit with DISCOM 2000.00 Interest accrued on security deposit applied in the bill Late payment
surcharge is 1.5 percent per month It is applicable on the company website
IMPORTANT MESSAGE Please keep your mobile number and email updated to ensure your bill and payment reminders
"""

print("=== Part A: OCR Word Error Rate ===")
print("Sample: bses_delhi.png - the ONE fully-English real bill in tests/assets/bills. The other two real")
print("samples are Marathi-mixed; they were excluded because hand-transcribing Devanagari script for 'ground")
print("truth' risks introducing my own transcription errors, which would make the reference unreliable.")
print("n=1: this is a small, directional data point, not a statistically robust benchmark - a real one would")
print("need dozens of independently ground-truthed bills.\n")

from app.ml.bill_pipeline import analyze_bill

result = analyze_bill("/tmp/bills/bses_delhi.png", budget_seconds=60)
wer = word_error_rate(REFERENCE_BSES_DELHI, result["text"])
print(f"WER: {wer['wer']:.1%}  ({wer['edits']} edits / {wer['reference_words']} reference words)")
print(f"OCR engine confidence: {result['ocr_confidence']:.2f} | engine: {result['ocr_engine']}")
print("Note: this sample is the test suite's OWN deliberately-hard case (its expected end-to-end status is")
print("'flagged', i.e. the system already expects this one to need human review) - so a high WER here is an")
print("honest, expected result on a hard case, not representative of a typical/clean bill.")

# ── Part B: Document-type classification (Precision / Recall / F1) ────────────

print("\n=== Part B: Document-Type Classification (Precision / Recall / F1) ===")

from app.ml.bill_extractor import extract_core
from app.ml.hybrid_ocr import Cell, Line


def kind(text):
    return extract_core([Line([Cell(text, 10, 10 + 8 * len(text), 80.0)], 100, 20, 0, "t")])["document_type"]


# Drawn directly from tests/api/ocr_extractor_unit.py section 4 (the project's own existing, already-vetted
# labeled test cases) - not invented for this report.
CASES = [
    ("महावितरण BILL OF SUPPLY MSEDCL", "electricity_bill"),
    ("Municipal Corporation of Greater Mumbai water charges", "water_bill"),
    ("पाणी देयक जल आकार", "water_bill"),
    ("Mahanagar Gas Limited piped natural gas bill", "gas_bill"),
    ("BSES Rajdhani Power Limited Electricity Bill", "electricity_bill"),
    ("hello world 123", None),
    ("MCGM GAS BILL Gas Supply Charges piped natural gas", "gas_bill"),
    ("MCGM INTERNET BILL Internet Service Account No 55421", "water_bill"),
]
print(f"Dataset: n={len(CASES)}, the project's own existing labeled test cases - small but genuinely")
print("curated, not invented for this script.\n")

tp, fp, fn = defaultdict(int), defaultdict(int), defaultdict(int)
correct = 0
for text, expected in CASES:
    got = kind(text)
    ok = got == expected
    correct += ok
    print(("PASS " if ok else "FAIL ") + f"{text[:45]!r:<48} expected={str(expected):<18} got={got}")
    if expected is not None and got == expected:
        tp[expected] += 1
    else:
        if expected is not None:
            fn[expected] += 1
        if got is not None:
            fp[got] += 1

labels = sorted(set(e for _, e in CASES if e is not None) | set(tp) | set(fp) | set(fn))
print(f"\n{'class':<18}{'precision':>10}{'recall':>10}{'f1':>10}")
f1s = []
for label in labels:
    p = tp[label] / (tp[label] + fp[label]) if (tp[label] + fp[label]) else 0.0
    r = tp[label] / (tp[label] + fn[label]) if (tp[label] + fn[label]) else 0.0
    f1 = 2 * p * r / (p + r) if (p + r) else 0.0
    f1s.append(f1)
    print(f"{label:<18}{p:>10.2f}{r:>10.2f}{f1:>10.2f}")
macro_f1 = sum(f1s) / len(f1s) if f1s else 0.0
print(f"\nOverall accuracy: {correct}/{len(CASES)} = {correct / len(CASES):.1%}")
print(f"Macro-averaged F1: {macro_f1:.2f}")

# ── Part C: Cost forecast backtest (MAE / RMSE) ────────────────────────────────

print("\n=== Part C: Cost Forecast Backtest (MAE / RMSE) ===")
print("Method: real walk-forward backtest on the expense history already in the live database (seed data +")
print("any real usage since) - not synthetic. For each property+category with enough months, train")
print("forecast_next_month() on months 1..k and compare its prediction for month k+1 against the ACTUAL")
print("recorded amount, sliding k forward through the whole history. A category never used by a property is")
print("skipped (predicting/scoring an always-zero category is not a real forecasting case).\n")

from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.ml.regression_model import EXPENSE_CATEGORIES, forecast_next_month
from app.models.financial import Expense


async def backtest():
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(select(Expense).order_by(Expense.property_id, Expense.month))).scalars().all()

    by_property = defaultdict(dict)
    for e in rows:
        m = e.month or "unknown"
        cat = e.category.value if hasattr(e.category, "value") else str(e.category)
        by_property[e.property_id].setdefault(m, {c: 0.0 for c in EXPENSE_CATEGORIES})
        if cat in by_property[e.property_id][m]:
            by_property[e.property_id][m][cat] += e.amount

    errors_by_cat = defaultdict(list)
    n_predictions = 0
    for property_id, months in by_property.items():
        history = [dict(month=m, **vals) for m, vals in sorted(months.items())]
        if len(history) < 4:
            continue
        for k in range(3, len(history)):
            pred = forecast_next_month(history[:k])
            actual = history[k]
            for cat in EXPENSE_CATEGORIES:
                if actual[cat] == 0 and all(h[cat] == 0 for h in history[:k]):
                    continue
                errors_by_cat[cat].append(pred[cat] - actual[cat])
                n_predictions += 1
    return errors_by_cat, n_predictions


errors_by_cat, n_predictions = asyncio.run(backtest())

print(f"{'category':<14}{'n':>6}{'MAE':>10}{'RMSE':>10}")
all_errors = []
for cat in EXPENSE_CATEGORIES:
    errs = errors_by_cat.get(cat, [])
    if not errs:
        continue
    mae = sum(abs(e) for e in errs) / len(errs)
    rmse = (sum(e * e for e in errs) / len(errs)) ** 0.5
    all_errors.extend(errs)
    print(f"{cat:<14}{len(errs):>6}{mae:>10.2f}{rmse:>10.2f}")

overall_mae = sum(abs(e) for e in all_errors) / len(all_errors) if all_errors else 0.0
overall_rmse = (sum(e * e for e in all_errors) / len(all_errors)) ** 0.5 if all_errors else 0.0
print(f"\n{n_predictions} real backtested predictions across all properties/categories")
print(f"Overall MAE:  Rs {overall_mae:.2f}")
print(f"Overall RMSE: Rs {overall_rmse:.2f}")
