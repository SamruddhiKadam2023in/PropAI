"""Authorization tests for POST /financial/expenses. Uses a throwaway property; everything created here is removed."""
import subprocess, sys, warnings
import requests
warnings.filterwarnings("ignore")
API = "http://localhost:8000"
results = []


def check(name, ok, detail=""):
    results.append(bool(ok))
    print(("PASS " if ok else "FAIL ") + name + (f"  [{str(detail)[:200]}]" if detail != "" else ""))


def pg(sql):
    return subprocess.run(["docker", "exec", "-i", "property_postgres", "psql", "-U", "postgres", "-d", "property_management", "-At"], capture_output=True, text=True, input=sql, encoding="utf-8").stdout.strip()


def login(email):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": "PropAI@2024"})
    return {"Authorization": "Bearer " + r.json()["access_token"]}


tenant, owner, priya, mgr = login("amit@example.in"), login("vikram@propai.in"), login("priya@propai.in"), login("rajesh@propai.in")
BASE = pg("select count(*) from expenses")
pid = None
try:
    r = requests.post(f"{API}/properties/", headers=owner, json={"title": "EXP-TEST home", "address": "1 Test", "city": "Pune", "state": "MH", "pincode": "411001", "property_type": "apartment", "rent_amount": 1000})
    pid = r.json()["id"]
    body = {"category": "electricity", "amount": 999, "expense_date": "2026-09-01T00:00:00", "property_id": pid, "vendor": "EXP-TEST"}

    r = requests.post(f"{API}/financial/expenses", headers=tenant, json=body)
    check("tenant cannot record an expense against a property (403)", r.status_code == 403, f"{r.status_code} {r.text[:80]}")
    r = requests.post(f"{API}/financial/expenses", headers=priya, json=body)
    check("another owner cannot record an expense on vikram's property (403)", r.status_code == 403, f"{r.status_code} {r.text[:80]}")
    r = requests.post(f"{API}/financial/expenses", headers=owner, json=body)
    check("the property's owner can (201)", r.status_code == 201, f"{r.status_code} {r.text[:80]}")
    r = requests.post(f"{API}/financial/expenses", headers=mgr, json=body)
    check("a manager can (201)", r.status_code == 201, f"{r.status_code} {r.text[:80]}")
    r = requests.post(f"{API}/financial/expenses", headers=owner, json={**body, "property_id": 99999999})
    check("unknown property -> 404, not a 500", r.status_code == 404, f"{r.status_code} {r.text[:80]}")
    n = pg(f"select count(*) from expenses where property_id={pid}")
    check("only the two permitted expenses were stored", n == "2", n)
finally:
    if pid:
        pg(f"delete from expenses where property_id={pid}; delete from properties where id={pid};")
    check("cleanup: expenses table back to baseline", pg("select count(*) from expenses") == BASE, BASE)
print(f"\n{sum(results)}/{len(results)} passed")
sys.exit(0 if all(results) else 1)
