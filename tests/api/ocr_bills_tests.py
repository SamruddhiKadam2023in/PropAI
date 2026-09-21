"""End-to-end: sample bills (tests/assets/bills, all data invented) -> POST /documents/upload -> background OCR -> extracted fields, through the real API and database.
Uses a throwaway tenant (created by a Manager) so it does not depend on anyone's existing documents. Everything created is removed."""
import json, os, subprocess, sys, time, warnings
import requests
warnings.filterwarnings("ignore")

API = os.environ.get("API", "http://localhost:8000")
HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, "..", "assets")
BILLS = os.path.join(ASSETS, "bills")
results = []
EMAIL, PW = "ocrtest_tenant@example.com", "OcrTest-Pass-1"


def check(name, ok, detail=""):
    results.append(bool(ok))
    print(("PASS " if ok else "FAIL ") + name + (f"  [{str(detail)[:190]}]" if detail != "" else ""))


def pg(sql):
    return subprocess.run(["docker", "exec", "-i", "property_postgres", "psql", "-U", "postgres", "-d", "property_management", "-At"],
                          capture_output=True, text=True, input=sql, encoding="utf-8").stdout.strip()


def upload_and_wait(h, path, mime, limit=150):
    t0 = time.time()
    with open(path, "rb") as fh:
        r = requests.post(f"{API}/documents/upload", headers=h, files={"file": (os.path.basename(path), fh, mime)})
    assert r.status_code == 201, r.text
    doc = r.json()
    while doc["status"] in ("pending", "processing") and time.time() - t0 < limit:
        time.sleep(2)
        doc = requests.get(f"{API}/documents/{doc['id']}", headers=h).json()
    return doc, time.time() - t0


mgr = {"Authorization": "Bearer " + requests.post(f"{API}/auth/login", json={"email": "rajesh@propai.in", "password": "PropAI@2024"}).json()["access_token"]}
BASE_USERS = pg("select count(*) from users")
expected = json.load(open(os.path.join(BILLS, "expected.json"), encoding="utf-8"))
docs = []
try:
    r = requests.post(f"{API}/auth/users", headers=mgr, json={"email": EMAIL, "full_name": "OCR Test", "password": PW, "role": "tenant"})
    assert r.status_code == 201, r.text
    tenant = {"Authorization": "Bearer " + requests.post(f"{API}/auth/login", json={"email": EMAIL, "password": PW}).json()["access_token"]}

    print("== 1. Sample Maharashtra bills (Marathi + English) ==")
    slash = lambda v: v.replace("-", "/") if isinstance(v, str) else v
    for file, status in (("msedcl_airoli.png", "completed"), ("mcgm_water.png", "completed"), ("bses_delhi.png", "flagged")):
        name = file.rsplit(".", 1)[0]
        doc, secs = upload_and_wait(tenant, os.path.join(BILLS, file), "image/png")
        docs.append(doc["id"])
        ed, exp = doc.get("extracted_data") or {}, expected[name]
        check(f"{file}: status {status}", doc["status"] == status, f"{doc['status']} conf={doc['confidence_score']}")
        check(f"{file}: read by the hybrid English+Marathi engine", str(ed.get("ocr_engine", "")).startswith("hybrid(eng+mar)"), ed.get("ocr_engine"))
        check(f"{file}: finished within the time budget (< 90 s)", secs < 90, f"{secs:.0f}s")
        check(f"{file}: document type {exp['core']['document_type']}", doc["document_type"] == exp["core"]["document_type"], doc["document_type"])
        check(f"{file}: vendor {exp['core']['vendor']}", ed.get("vendor") == exp["core"]["vendor"], ed.get("vendor"))
        if "amount" in exp["core"]:
            check(f"{file}: amount {exp['core']['amount']}", ed.get("amount") == exp["core"]["amount"], ed.get("amount"))
            check(f"{file}: bill date {slash(exp['core']['date'])} (DD/MM/YYYY like the correction form)", ed.get("date") == slash(exp["core"]["date"]), ed.get("date"))
            check(f"{file}: due date {slash(exp['core']['due_date'])}", ed.get("due_date") == slash(exp["core"]["due_date"]), ed.get("due_date"))
            a, ea = ed.get("address") or {}, exp["address"]
            check(f"{file}: address PIN / suburb / city / state = {ea['pincode']} / {ea['suburb']} / {ea['city']} / {ea['state']}",
                  (a.get("pincode"), a.get("suburb"), a.get("city"), a.get("state")) == (ea["pincode"], ea["suburb"], ea["city"], ea["state"]), a)
            check(f"{file}: address text contains '{ea['place']}'", ea["place"].lower() in (a.get("place") or "").lower(), a.get("place"))
        else:
            check(f"{file}: unreadable image -> amount, date and address left EMPTY (no guessing), flagged for review",
                  ed.get("amount") is None and ed.get("date") is None and not (ed.get("address") or {}).get("place"), {k: ed.get(k) for k in ("amount", "date")})
    ed = (requests.get(f"{API}/documents/{docs[2]}", headers=tenant).json().get("extracted_data") or {})
    check("BSES: the reader says WHY - the picture is only 447 px wide (low_resolution)", ed.get("low_resolution") is True and ed.get("image_width") == 447, (ed.get("low_resolution"), ed.get("image_width")))
    ed = (requests.get(f"{API}/documents/{docs[0]}", headers=tenant).json().get("extracted_data") or {})
    check("MSEDCL: a readable bill is NOT marked low resolution", not ed.get("low_resolution"), ed.get("image_width"))
    ed = (requests.get(f"{API}/documents/{docs[1]}", headers=tenant).json().get("extracted_data") or {})
    check("MCGM: billing period and 'duplicate bill' recognised", ed.get("bill_period") == "09/02/2024 to 10/03/2024" and ed.get("is_duplicate") is True, (ed.get("bill_period"), ed.get("is_duplicate")))
    check("MSEDCL: the consumer's name is kept separately from the address", "SUNIL" in (requests.get(f"{API}/documents/{docs[0]}", headers=tenant).json()["extracted_data"].get("customer_name") or ""))

    print("== 2. English bills still work (the pipeline this replaced) ==")
    for file, mime, dtype, amount in (("electricity_bill.png", "image/png", "electricity_bill", 2450.0), ("water_bill.jpg", "image/jpeg", "water_bill", 640.0),
                                      ("gas_bill.pdf", "application/pdf", "gas_bill", 915.5)):
        doc, secs = upload_and_wait(tenant, os.path.join(ASSETS, file), mime)
        docs.append(doc["id"])
        ed = doc.get("extracted_data") or {}
        check(f"{file}: {dtype}, amount {amount}, completed", doc["document_type"] == dtype and ed.get("amount") == amount and doc["status"] == "completed", (doc["document_type"], ed.get("amount"), doc["status"]))
        check(f"{file}: date read as DD/MM/YYYY", isinstance(ed.get("date"), str) and len(ed["date"]) == 10 and ed["date"][2] == "/", ed.get("date"))

    print("== 3. The correction flow still overrides the reader ==")
    fix = requests.patch(f"{API}/documents/{docs[0]}/correct", headers=tenant, json={"amount": 1700.0, "vendor": "Mahavitaran"})
    ed = fix.json().get("extracted_data") or {}
    check("a user's correction wins; the address the reader found is kept", fix.status_code == 200 and ed.get("amount") == 1700.0 and ed.get("vendor") == "Mahavitaran" and (ed.get("address") or {}).get("pincode") == "400708", ed.get("amount"))
    rp = requests.post(f"{API}/documents/{docs[0]}/reprocess", headers=tenant)
    for _ in range(60):
        d = requests.get(f"{API}/documents/{docs[0]}", headers=tenant).json()
        if d["status"] not in ("pending", "processing"):
            break
        time.sleep(2)
    check("reprocess re-reads the bill but keeps the user's corrected amount", rp.status_code == 200 and d["extracted_data"].get("amount") == 1700.0 and (d["extracted_data"].get("address") or {}).get("pincode") == "400708", d["extracted_data"].get("amount"))

    print("== 4. Bad input still fails cleanly ==")
    doc, _ = upload_and_wait(tenant, os.path.join(ASSETS, "blank.png"), "image/png")
    docs.append(doc["id"])
    check("a blank page ends as failed/flagged with a message, never a crash or invented data", doc["status"] in ("failed", "flagged") and (doc["extracted_data"] or {}).get("amount") is None, doc["status"])
    doc, _ = upload_and_wait(tenant, os.path.join(ASSETS, "corrupt.png"), "image/png")
    docs.append(doc["id"])
    check("a corrupt image is accepted, then ends as failed/flagged with no invented data (no crash, not stuck processing)",
          doc["status"] in ("failed", "flagged") and (doc["extracted_data"] or {}).get("amount") is None, doc["status"])
finally:
    hd = tenant if "tenant" in dir() else None
    for i in docs:
        if hd:
            requests.delete(f"{API}/documents/{i}", headers=hd)
    pg(f"delete from documents where user_id in (select id from users where email='{EMAIL}'); delete from users where email='{EMAIL}';")
    check("cleanup: user count back to baseline", pg("select count(*) from users") == BASE_USERS)
    check("cleanup: no documents left for the test tenant", pg(f"select count(*) from documents where filename in ('msedcl_airoli.png','mcgm_water.png','bses_delhi.png') and user_id not in (select id from users)") == "0")

print(f"\n{sum(results)}/{len(results)} passed")
sys.exit(0 if all(results) else 1)
