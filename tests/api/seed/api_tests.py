import hashlib, os, sys, time
import requests

API = "http://localhost:8000"
A = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "assets")
PW = "PropAI@2024"
results = []


def check(name, cond, detail=""):
    results.append(bool(cond))
    print(("PASS " if cond else "FAIL ") + name + (f"  [{detail}]" if detail else ""))


def login(email):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": PW})
    r.raise_for_status()
    d = r.json()
    return {"Authorization": f"Bearer {d['access_token']}"}, d["user"]


def upload(h, name, filename=None, ctype=None, prop=None, data=None):
    body = data if data is not None else open(os.path.join(A, name), "rb").read()
    files = {"file": (filename or name, body, ctype) if ctype else (filename or name, body)}
    return requests.post(f"{API}/documents/upload", headers=h, files=files, data={"property_id": prop} if prop else None)


def wait_done(h, doc_id, timeout=90):
    t0 = time.time()
    while time.time() - t0 < timeout:
        d = requests.get(f"{API}/documents/{doc_id}", headers=h).json()
        if d["status"] not in ("pending", "processing"):
            return d, round(time.time() - t0, 1)
        time.sleep(1)
    return d, timeout


amit, amit_u = login("amit@example.in")      # tenant A (property 1, owner vikram)
sneha, sneha_u = login("sneha@example.in")   # tenant B (property 2)
vikram, _ = login("vikram@propai.in")        # owner of tenant A's property
priya, _ = login("priya@propai.in")          # owner of an unrelated property
rajesh, _ = login("rajesh@propai.in")        # manager
created = []

print("\n== 1. Upload validation (invalid files are rejected gracefully, nothing stored) ==")
r = requests.post(f"{API}/documents/upload", files={"file": ("a.png", b"x")})
check("unauthenticated upload rejected", r.status_code in (401, 403), r.status_code)
r = upload(amit, "disguised.png", ctype="image/png")
check("executable renamed .png (declared image/png) -> 415", r.status_code == 415, f"{r.status_code} {r.json().get('detail')}")
r = upload(amit, "notes.txt", ctype="text/plain")
check("text file -> 415 with friendly message", r.status_code == 415 and "PDF, JPG, PNG or WebP" in r.json()["detail"], r.json().get("detail"))
r = upload(amit, "empty.png", ctype="image/png")
check("empty file -> 400", r.status_code == 400 and "empty" in r.json()["detail"].lower(), r.json().get("detail"))
r = upload(amit, "toobig.png", ctype="image/png")
check("file over 10 MB -> 413", r.status_code == 413, f"{r.status_code} {r.json().get('detail')}")
r = upload(amit, "garbage.png", ctype="image/png")
check("PNG with garbage body rejected at upload (400, friendly)", r.status_code == 400 and "corrupted" in r.json()["detail"], f"{r.status_code} {r.json().get('detail')}")
r = upload(amit, "electricity_bill.png", prop=2)  # sneha's property
check("attaching to another tenant's property -> 400", r.status_code == 400, r.json().get("detail"))
docs_dir = requests.get(f"{API}/documents/", headers=amit).json()
check("rejected uploads created no records", len(docs_dir) == 0, f"{len(docs_dir)} docs")

print("\n== 2. Valid uploads + OCR ==")
r = upload(amit, "electricity_bill.png", filename="../../etc/My Electricity Bill.png", ctype="image/png")
check("PNG bill accepted (201) with traversal-style filename", r.status_code == 201, r.status_code)
bill = r.json(); created.append((amit, bill["id"]))
check("filename sanitised (no path parts)", bill["filename"] == "My Electricity Bill.png", bill["filename"])
check("file_url is an API path, not a disk path", bill["file_url"] == f"/documents/{bill['id']}/file", bill["file_url"])
check("new upload is pending/processing", bill["status"] in ("pending", "processing"), bill["status"])
check("auto-linked to tenant's own property (id 1)", bill["property_id"] == 1, bill["property_id"])
d, secs = wait_done(amit, bill["id"])
ex = d.get("extracted_data") or {}
print(f"     -> status={d['status']} type={d['document_type']} confidence={d['confidence_score']} amount={ex.get('amount')} date={ex.get('date')} vendor={ex.get('vendor')} ({secs}s)")
check("OCR finished (completed or needs-review)", d["status"] in ("completed", "flagged"), d["status"])
check("classified as electricity bill", d["document_type"] == "electricity_bill", d["document_type"])
check("extracted a plausible amount (2450)", ex.get("amount") in (2450.0, 2450), ex.get("amount"))
check("extracted the date", ex.get("date") is not None, ex.get("date"))
check("extracted the vendor (Tata Power)", (ex.get("vendor") or "").lower() == "tata power", ex.get("vendor"))
check("raw OCR text captured", "electricity" in (d.get("raw_ocr_text") or "").lower())
check("internal marker not leaked", "_processing_started_at" not in ex)

r = upload(amit, "water_bill.jpg", ctype="image/jpeg"); created.append((amit, r.json()["id"]))
wd, _ = wait_done(amit, r.json()["id"]); print(f"     -> JPG water bill: {wd['status']} {wd['document_type']} amount={(wd.get('extracted_data') or {}).get('amount')}")
check("JPG bill processed", wd["status"] in ("completed", "flagged"), wd["status"])
r = upload(amit, "gas_bill.pdf", ctype="application/pdf"); created.append((amit, r.json()["id"]))
gd, _ = wait_done(amit, r.json()["id"]); print(f"     -> PDF gas bill: {gd['status']} {gd['document_type']} amount={(gd.get('extracted_data') or {}).get('amount')}")
check("PDF bill processed", gd["status"] in ("completed", "flagged"), gd["status"])

print("\n== 3. Original document preserved & viewable ==")
orig = open(os.path.join(A, "electricity_bill.png"), "rb").read()
r = requests.get(f"{API}/documents/{bill['id']}/file", headers=amit)
check("view original -> 200 image/png", r.status_code == 200 and r.headers["content-type"] == "image/png", f"{r.status_code} {r.headers.get('content-type')}")
check("served bytes identical to upload (sha256)", hashlib.sha256(r.content).hexdigest() == hashlib.sha256(orig).hexdigest())
check("inline disposition + nosniff + private cache", "inline" in r.headers.get("content-disposition", "") and r.headers.get("x-content-type-options") == "nosniff" and "no-store" in r.headers.get("cache-control", ""), r.headers.get("content-disposition"))
r = requests.get(f"{API}/documents/{bill['id']}/file", headers=amit, params={"download": "true"})
from urllib.parse import unquote
check("download -> attachment with original name", "attachment" in r.headers.get("content-disposition", "") and "My Electricity Bill.png" in unquote(r.headers.get("content-disposition", "")), r.headers.get("content-disposition"))
r = requests.get(f"{API}/documents/{created[2][1]}/file", headers=amit)
check("PDF original served as application/pdf", r.headers["content-type"] == "application/pdf" and r.content[:5] == b"%PDF-")

print("\n== 4. Tenant isolation (tenant B / others cannot reach tenant A's documents) ==")
did = bill["id"]
check("B's list contains none of A's docs", not any(x["id"] in [c[1] for c in created] for x in requests.get(f"{API}/documents/", headers=sneha).json()))
for label, fn in [
    ("GET  /documents/{id}", lambda h: requests.get(f"{API}/documents/{did}", headers=h)),
    ("GET  /documents/{id}/file", lambda h: requests.get(f"{API}/documents/{did}/file", headers=h)),
    ("PATCH /documents/{id}/correct", lambda h: requests.patch(f"{API}/documents/{did}/correct", headers=h, json={"amount": 1})),
    ("POST /documents/{id}/reprocess", lambda h: requests.post(f"{API}/documents/{did}/reprocess", headers=h)),
    ("DELETE /documents/{id}", lambda h: requests.delete(f"{API}/documents/{did}", headers=h)),
]:
    r = fn(sneha)
    check(f"tenant B {label} -> 404", r.status_code == 404, r.status_code)
check("unrelated owner cannot read A's document", requests.get(f"{API}/documents/{did}", headers=priya).status_code == 404)
check("unrelated owner cannot read A's original file", requests.get(f"{API}/documents/{did}/file", headers=priya).status_code == 404)
check("no token -> file endpoint rejected", requests.get(f"{API}/documents/{did}/file").status_code in (401, 403))
check("garbage token -> file endpoint rejected", requests.get(f"{API}/documents/{did}/file", headers={"Authorization": "Bearer nope"}).status_code in (401, 403))
check("owner of A's property may read it (existing staff behaviour)", requests.get(f"{API}/documents/{did}", headers=vikram).status_code == 200)
check("manager may read it (existing staff behaviour)", requests.get(f"{API}/documents/{did}", headers=rajesh).status_code == 200)
check("non-existent id -> 404", requests.get(f"{API}/documents/999999", headers=amit).status_code == 404)
still = requests.get(f"{API}/documents/{did}", headers=amit)
check("A's document untouched after B's delete/correct attempts", still.status_code == 200 and (still.json()["extracted_data"] or {}).get("amount") != 1)

print("\n== 5. Files are no longer public via static /uploads ==")
r = requests.get(f"{API}/uploads/documents/{amit_u['id']}/whatever.png")
check("/uploads/documents/... not served", r.status_code == 404, r.status_code)
r = requests.get(f"{API}/uploads/20260626_170914_Screenshot_2026-06-26_223900.png")
check("legacy public file URL now 404", r.status_code == 404, r.status_code)

print("\n== 6. OCR failure handling ==")
for fname, ctype, expect in [("corrupt.png", "image/png", "couldn't be opened"), ("corrupt.pdf", "application/pdf", "couldn't be opened"), ("blank.png", "image/png", "No readable text")]:
    r = upload(amit, fname, ctype=ctype)
    check(f"{fname} passes upload checks (201)", r.status_code == 201, r.status_code)
    if r.status_code != 201: continue
    created.append((amit, r.json()["id"]))
    fd, secs = wait_done(amit, r.json()["id"])
    check(f"{fname} -> status 'failed' with a friendly reason", fd["status"] == "failed" and expect.lower() in (fd.get("error_message") or "").lower(), f"{fd['status']}: {fd.get('error_message')} ({secs}s)")
    check(f"{fname} failure does not leak internals", "traceback" not in (fd.get("error_message") or "").lower() and "/app/" not in (fd.get("error_message") or ""))
    check(f"{fname} original still downloadable after failure", requests.get(f"{API}/documents/{fd['id']}/file", headers=amit).status_code == 200)
failed_id = created[-1][1]
r = requests.patch(f"{API}/documents/{failed_id}/correct", headers=amit, json={"amount": 5})
check("cannot edit a failed document -> 409", r.status_code == 409, r.status_code)
r = requests.post(f"{API}/documents/{failed_id}/reprocess", headers=amit)
check("retry accepted -> pending", r.status_code == 200 and r.json()["status"] == "pending", r.status_code)
rd, _ = wait_done(amit, failed_id)
check("retry finishes (deterministically failed again for blank image)", rd["status"] == "failed")
ok = requests.post(f"{API}/documents/{bill['id']}/reprocess", headers=amit)
check("re-running OCR on a good document works", ok.status_code == 200)
d2, _ = wait_done(amit, bill["id"])
check("…and it finishes again with the same amount", (d2.get("extracted_data") or {}).get("amount") in (2450.0, 2450), d2["status"])

print("\n== 7. Corrections ==")
r = requests.patch(f"{API}/documents/{bill['id']}/correct", headers=amit, json={"amount": 2500, "vendor": "Tata Power Ltd", "document_type": "electricity_bill"})
cj = r.json()
check("correct amount/vendor -> completed", r.status_code == 200 and cj["status"] == "completed" and cj["extracted_data"]["amount"] == 2500, r.status_code)
check("correction recorded separately", (cj["corrected_data"] or {}).get("vendor") == "Tata Power Ltd")
check("unknown document type rejected", requests.patch(f"{API}/documents/{bill['id']}/correct", headers=amit, json={"document_type": "bogus"}).status_code == 400)
check("negative amount rejected", requests.patch(f"{API}/documents/{bill['id']}/correct", headers=amit, json={"amount": -5}).status_code == 400)

print("\n== 8. Delete removes record + stored file ==")
if os.environ.get("KEEP") != "1":
    for h, i in created:
        r = requests.delete(f"{API}/documents/{i}", headers=h)
        assert r.status_code == 204, (i, r.status_code)
    check("all test documents deleted", requests.get(f"{API}/documents/", headers=amit).json() == [])
    check("deleted document's file endpoint -> 404", requests.get(f"{API}/documents/{bill['id']}/file", headers=amit).status_code == 404)

print(f"\n{sum(results)}/{len(results)} checks passed")
sys.exit(0 if all(results) else 1)
