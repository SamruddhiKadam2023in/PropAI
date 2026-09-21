"""End to end: a bill that finishes reading becomes an expense on the tenant's property, so the Cost Analysis fills itself.
Uses a throwaway tenant, a throwaway property and throwaway bills; everything created is removed."""
import os, subprocess, sys, time, warnings
import requests
warnings.filterwarnings("ignore")

API = os.environ.get("API", "http://localhost:8000")
ASSETS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets")
T1, T2, PW = "exptest_tenant@example.com", "exptest_noproperty@example.com", "ExpTest-Pass-1"
results = []


def check(name, ok, detail=""):
    results.append(bool(ok))
    print(("PASS " if ok else "FAIL ") + name + (f"  [{str(detail)[:170]}]" if detail != "" else ""))


def pg(sql):
    return subprocess.run(["docker", "exec", "-i", "property_postgres", "psql", "-U", "postgres", "-d", "property_management", "-At"],
                          capture_output=True, text=True, input=sql, encoding="utf-8").stdout.strip()


def upload(h, name, mime):
    with open(os.path.join(ASSETS, name), "rb") as fh:
        r = requests.post(f"{API}/documents/upload", headers=h, files={"file": (name, fh, mime)})
    assert r.status_code == 201, r.text
    doc = r.json()
    for _ in range(60):
        if doc["status"] not in ("pending", "processing"):
            break
        time.sleep(2)
        doc = requests.get(f"{API}/documents/{doc['id']}", headers=h).json()
    return doc


def expenses_for(doc_id):
    rows = pg(f"select lower(category::text), amount, to_char(expense_date,'YYYY-MM-DD'), month, property_id from expenses where document_id={doc_id}")
    return [r.split("|") for r in rows.splitlines() if r]


mgr = {"Authorization": "Bearer " + requests.post(f"{API}/auth/login", json={"email": "rajesh@propai.in", "password": "PropAI@2024"}).json()["access_token"]}
prop_id = None
try:
    for email in (T1, T2):
        assert requests.post(f"{API}/auth/users", headers=mgr, json={"email": email, "full_name": "Exp Test", "password": PW, "role": "tenant"}).status_code == 201
    t1 = {"Authorization": "Bearer " + requests.post(f"{API}/auth/login", json={"email": T1, "password": PW}).json()["access_token"]}
    t2 = {"Authorization": "Bearer " + requests.post(f"{API}/auth/login", json={"email": T2, "password": PW}).json()["access_token"]}
    prop_id = int(pg(f"""insert into properties (title, address, city, state, pincode, property_type, rent_amount, is_available, owner_id, tenant_id)
        select 'EXPTEST flat', 'Test road', 'Mumbai', 'Maharashtra', '400001', 'apartment', 1000, false,
               (select id from users where email='rajesh@propai.in'), (select id from users where email='{T1}') returning id;""").splitlines()[0])

    print("== 1. A read bill becomes an expense ==")
    d = upload(t1, "electricity_bill.png", "image/png")
    ex = expenses_for(d["id"])
    check("electricity bill (Rs 2450, 05/12/2025) read", d["status"] == "completed" and d["extracted_data"].get("amount") == 2450.0, (d["status"], d["extracted_data"].get("amount")))
    check("exactly one expense was created for it: electricity, 2450, 2025-12-05, month 2025-12, on the tenant's property",
          len(ex) == 1 and ex[0][0] == "electricity" and float(ex[0][1]) == 2450.0 and ex[0][2] == "2025-12-05" and ex[0][3] == "2025-12" and ex[0][4] == str(prop_id), ex)
    dash = requests.get(f"{API}/analytics/dashboard/{prop_id}", headers=t1)
    check("the tenant's Cost Analysis now shows it", dash.status_code == 200 and "2450" in dash.text, dash.status_code)

    print("== 2. Correcting the bill updates its expense ==")
    fix = requests.patch(f"{API}/documents/{d['id']}/correct", headers=t1, json={"amount": 2500.0})
    ex = expenses_for(d["id"])
    check("a corrected amount updates the same expense (still one row)", fix.status_code == 200 and len(ex) == 1 and float(ex[0][1]) == 2500.0, ex)
    fix = requests.patch(f"{API}/documents/{d['id']}/correct", headers=t1, json={"document_type": "other"})
    check("changing the type to something that is not a utility bill removes the expense", fix.status_code == 200 and expenses_for(d["id"]) == [], expenses_for(d["id"]))
    fix = requests.patch(f"{API}/documents/{d['id']}/correct", headers=t1, json={"document_type": "electricity_bill"})
    check("...and setting it back brings the expense back", len(expenses_for(d["id"])) == 1)

    print("== 3. Other bills, and bills that must NOT create an expense ==")
    w = upload(t1, "water_bill.jpg", "image/jpeg")
    ew = expenses_for(w["id"])
    check("water bill (Rs 640, 03/12/2025) becomes a water expense", len(ew) == 1 and ew[0][0] == "water" and float(ew[0][1]) == 640.0 and ew[0][3] == "2025-12", ew)
    g = upload(t1, "blank.png", "image/png")
    check("a blank / unreadable picture creates NO expense", expenses_for(g["id"]) == [], (g["status"], expenses_for(g["id"])))
    n = upload(t2, "electricity_bill.png", "image/png")
    check("a tenant with no property gets no expense (nowhere to record it)", n["status"] == "completed" and expenses_for(n["id"]) == [], n["status"])

    print("== 4. Deleting a bill removes its expense ==")
    check("delete the electricity bill", requests.delete(f"{API}/documents/{d['id']}", headers=t1).status_code == 204)
    check("its expense is gone (and the delete did not fail on the link)", expenses_for(d["id"]) == [])
    check("the water expense is untouched", len(expenses_for(w["id"])) == 1)
finally:
    pg(f"""delete from expenses where property_id={prop_id or 0} or document_id in (select id from documents where user_id in (select id from users where email in ('{T1}','{T2}')));
           delete from documents where user_id in (select id from users where email in ('{T1}','{T2}'));
           delete from properties where title='EXPTEST flat';
           delete from users where email in ('{T1}','{T2}');""")
    check("cleanup: no throwaway rows left", pg(f"select (select count(*) from users where email in ('{T1}','{T2}')) + (select count(*) from properties where title='EXPTEST flat')") == "0")

print(f"\n{sum(results)}/{len(results)} passed")
sys.exit(0 if all(results) else 1)
