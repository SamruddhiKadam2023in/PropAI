"""End-to-end: POST /financial/expenses/bulk-import (a spreadsheet of real bills OCR couldn't read -> expense rows, no OCR
involved) and GET /financial/expenses/bulk-import-template. Uses throwaway users and a throwaway property; everything
created here is removed."""
import io, subprocess, sys, warnings
import requests
from openpyxl import Workbook
warnings.filterwarnings("ignore")

API = "http://localhost:8000"
results = []
EMAIL_OWNER, EMAIL_OTHER, EMAIL_TENANT, PW = "expimport_owner@example.com", "expimport_other@example.com", "expimport_tenant@example.com", "ExpImport-Pass-1"


def check(name, ok, detail=""):
    results.append(bool(ok))
    print(("PASS " if ok else "FAIL ") + name + (f"  [{str(detail)[:200]}]" if detail != "" else ""))


def pg(sql):
    return subprocess.run(["docker", "exec", "-i", "property_postgres", "psql", "-U", "postgres", "-d", "property_management", "-At"],
                          capture_output=True, text=True, input=sql, encoding="utf-8").stdout.strip()


def xlsx_bytes(rows, header=("date", "category", "amount", "vendor", "description")):
    wb = Workbook()
    ws = wb.active
    ws.append(list(header))
    for r in rows:
        ws.append(r)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


mgr = {"Authorization": "Bearer " + requests.post(f"{API}/auth/login", json={"email": "rajesh@propai.in", "password": "PropAI@2024"}).json()["access_token"]}
prop_id = None
try:
    for email in (EMAIL_OWNER, EMAIL_OTHER):
        assert requests.post(f"{API}/auth/users", headers=mgr, json={"email": email, "full_name": "Exp Import", "password": PW, "role": "owner"}).status_code == 201
    assert requests.post(f"{API}/auth/users", headers=mgr, json={"email": EMAIL_TENANT, "full_name": "Exp Import Tenant", "password": PW, "role": "tenant"}).status_code == 201
    owner = {"Authorization": "Bearer " + requests.post(f"{API}/auth/login", json={"email": EMAIL_OWNER, "password": PW}).json()["access_token"]}
    other = {"Authorization": "Bearer " + requests.post(f"{API}/auth/login", json={"email": EMAIL_OTHER, "password": PW}).json()["access_token"]}
    tenant = {"Authorization": "Bearer " + requests.post(f"{API}/auth/login", json={"email": EMAIL_TENANT, "password": PW}).json()["access_token"]}
    prop_id = int(pg(f"""insert into properties (title, address, city, state, pincode, property_type, rent_amount, is_available, owner_id, tenant_id)
        select 'EXPIMPORT flat', 'Test road', 'Mumbai', 'Maharashtra', '400001', 'apartment', 1000, false,
               (select id from users where email='{EMAIL_OWNER}'), (select id from users where email='{EMAIL_TENANT}') returning id;""").splitlines()[0])

    print("== 1. The downloadable template ==")
    r = requests.get(f"{API}/financial/expenses/bulk-import-template", headers=owner)
    check("an Owner can download the template", r.status_code == 200 and r.content[:2] == b"PK", r.status_code)  # .xlsx is a zip: starts with PK
    check("Tenants cannot (this is an Owner/Manager tool)", requests.get(f"{API}/financial/expenses/bulk-import-template", headers=tenant).status_code == 403)

    print("== 2. A real import: some good rows, some bad ones, reported precisely ==")
    data = xlsx_bytes([
        ["05/12/2025", "electricity", 2450, "Tata Power", "Dec bill"],
        ["03/12/2025", "WATER", "640.50", "", ""],
        ["not-a-date", "gas", 100, "", ""],           # bad date
        ["01/12/2025", "spaceship-fuel", 100, "", ""],  # bad category
        ["01/12/2025", "rent", "free", "", ""],          # bad amount
    ])
    r = requests.post(f"{API}/financial/expenses/bulk-import", headers=owner, data={"property_id": prop_id},
                      files={"file": ("bills.xlsx", data, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")})
    check("the request succeeds even though some rows are bad", r.status_code == 200, r.text)
    body = r.json()
    check("exactly the 2 good rows were imported, 3 bad ones reported with row numbers and reasons",
          body["total_rows"] == 5 and body["imported"] == 2 and len(body["skipped"]) == 3
          and {s["row"] for s in body["skipped"]} == {4, 5, 6} and all(s["reason"] for s in body["skipped"]), body)
    rows = pg(f"select lower(category::text), amount, to_char(expense_date,'YYYY-MM-DD'), vendor, document_id from expenses where property_id={prop_id} order by amount").splitlines()
    check("the two rows are real expense rows: electricity 2450 (Tata Power) and water 640.50, no document attached (not from a bill upload)",
          rows == ["water|640.5|2025-12-03||", "electricity|2450|2025-12-05|Tata Power|"], rows)
    dash = requests.get(f"{API}/analytics/dashboard/{prop_id}", headers=tenant)
    check("the tenant's Cost Analysis reflects the imported amounts too", dash.status_code == 200 and "2450" in dash.text and "640.5" in dash.text, dash.status_code)

    print("== 3. Permissions and bad input ==")
    check("an Owner cannot import into a property they don't own", requests.post(f"{API}/financial/expenses/bulk-import", headers=other, data={"property_id": prop_id},
          files={"file": ("b.xlsx", xlsx_bytes([["05/12/2025", "gas", 50, "", ""]]), "application/octet-stream")}).status_code == 403)
    check("a Tenant cannot import expenses at all", requests.post(f"{API}/financial/expenses/bulk-import", headers=tenant, data={"property_id": prop_id},
          files={"file": ("b.xlsx", xlsx_bytes([["05/12/2025", "gas", 50, "", ""]]), "application/octet-stream")}).status_code == 403)
    r = requests.post(f"{API}/financial/expenses/bulk-import", headers=owner, data={"property_id": prop_id},
                      files={"file": ("notes.txt", b"this is not a spreadsheet at all", "text/plain")})
    check("a non-spreadsheet file is rejected with a plain-English reason, not a crash", r.status_code == 400 and "xlsx" in r.text.lower(), r.text)
    r = requests.post(f"{API}/financial/expenses/bulk-import", headers=owner, data={"property_id": prop_id},
                      files={"file": ("empty.xlsx", xlsx_bytes([]), "application/octet-stream")})
    check("a spreadsheet with only a header row is rejected, not silently imported as zero rows", r.status_code == 400, r.text)
    check("a made-up property ID is rejected", requests.post(f"{API}/financial/expenses/bulk-import", headers=owner, data={"property_id": 999999999},
          files={"file": ("b.xlsx", xlsx_bytes([["05/12/2025", "gas", 50, "", ""]]), "application/octet-stream")}).status_code == 404)

    print("== 4. CSV works the same way as .xlsx ==")
    csv_bytes = "date,category,amount,vendor\n10/12/2025,internet,999,ACT Fibernet\n".encode()
    r = requests.post(f"{API}/financial/expenses/bulk-import", headers=owner, data={"property_id": prop_id},
                      files={"file": ("bills.csv", csv_bytes, "text/csv")})
    check("a .csv file imports exactly like .xlsx", r.status_code == 200 and r.json()["imported"] == 1, r.json() if r.status_code == 200 else r.text)
finally:
    pg(f"""delete from expenses where property_id={prop_id or 0};
           delete from properties where title='EXPIMPORT flat';
           delete from users where email in ('{EMAIL_OWNER}','{EMAIL_OTHER}','{EMAIL_TENANT}');""")
    check("cleanup: no throwaway rows left", pg(f"select (select count(*) from users where email in ('{EMAIL_OWNER}','{EMAIL_OTHER}','{EMAIL_TENANT}')) + (select count(*) from properties where title='EXPIMPORT flat')") == "0")

print(f"\n{sum(results)}/{len(results)} passed")
sys.exit(0 if all(results) else 1)
