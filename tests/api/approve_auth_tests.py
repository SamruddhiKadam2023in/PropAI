"""Regression: who may approve / reject a rental application (which now also creates the agreement). Throwaway data only."""
import subprocess, sys, warnings
import requests
warnings.filterwarnings("ignore")
API = "http://localhost:8000"


def _mgr_hdr():
    t = requests.post(f"{API}/auth/login", json={"email": "rajesh@propai.in", "password": "PropAI@2024"}).json()["access_token"]
    return {"Authorization": "Bearer " + t}


def make_user(payload):
    """Create a verified account the way an admin does (public sign-up would require an emailed code)."""
    return requests.post(f"{API}/auth/users", headers=_mgr_hdr(), json=payload)

results = []


def check(name, ok, detail=""):
    results.append(bool(ok))
    print(("PASS " if ok else "FAIL ") + name + (f"  [{str(detail)[:200]}]" if detail != "" else ""))


def sh(*a, stdin=None):
    return subprocess.run(list(a), capture_output=True, text=True, input=stdin, encoding="utf-8").stdout.strip()


def pg(sql):
    return sh("docker", "exec", "-i", "property_postgres", "psql", "-U", "postgres", "-d", "property_management", "-At", stdin=sql)


def mongo(js):
    return sh("docker", "exec", "-i", "property_mongodb", "mongosh", "-u", "mongo", "-p", "mongo123", "--authenticationDatabase", "admin", "--quiet", "--eval", f'const d=db.getSiblingDB("property_management"); {js}')


def login(email, pw="PropAI@2024"):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": pw})
    return {"Authorization": "Bearer " + r.json()["access_token"]}, r.json()["user"]["id"]


owner, _ = login("vikram@propai.in")
priya, _ = login("priya@propai.in")
mgr, _ = login("rajesh@propai.in")
BASE = {t: pg(f"select count(*) from {t}") for t in ("users", "properties", "agreements")}
uid = pids = None
tenants, props = [], []
try:
    make_user({"email": "apv_t@example.com", "full_name": "Approve Test", "password": "Approve@2026", "role": "tenant"})
    th, tid = login("apv_t@example.com", "Approve@2026"); tenants.append(tid)
    for i in (1, 2, 3):
        r = requests.post(f"{API}/properties/", headers=owner, json={"title": f"APV-TEST home {i}", "address": f"{i} Lane", "city": "Pune", "state": "MH", "pincode": "411001", "property_type": "apartment", "rent_amount": 5000})
        props.append(r.json()["id"])

    def apply(pid):
        assert requests.post(f"{API}/properties/{pid}/apply", headers=th).status_code == 200
        apps = requests.get(f"{API}/properties/owner-applications", headers=owner).json()
        return next(a["_id"] for a in apps if a["tenant_id"] == tid and a["property_id"] == pid and a["status"] == "pending")

    a1 = apply(props[0])
    r = requests.patch(f"{API}/properties/applications/{a1}/approve", headers=priya)
    check("another owner cannot approve an application on vikram's property (403/404)", r.status_code in (403, 404), r.status_code)
    check("...and nothing changed: no tenant assigned, no agreement created", pg(f"select coalesce(tenant_id::text,'none') from properties where id={props[0]}") == "none" and pg(f"select count(*) from agreements where property_id={props[0]}") == "0")
    r = requests.patch(f"{API}/properties/applications/{a1}/reject", headers=priya)
    check("another owner cannot reject it either (403/404)", r.status_code in (403, 404), r.status_code)
    check("tenant cannot approve their own application (403)", requests.patch(f"{API}/properties/applications/{a1}/approve", headers=th).status_code == 403)
    check("malformed application id -> 404, not 500", requests.patch(f"{API}/properties/applications/not-an-id/approve", headers=owner).status_code == 404)
    check("unknown (well-formed) application id -> 404", requests.patch(f"{API}/properties/applications/000000000000000000000000/approve", headers=owner).status_code == 404)
    r = requests.patch(f"{API}/properties/applications/{a1}/approve", headers=owner)
    check("the property's owner approves -> 200, tenant assigned, one agreement", r.status_code == 200 and pg(f"select tenant_id from properties where id={props[0]}") == str(tid) and pg(f"select count(*) from agreements where property_id={props[0]}") == "1", r.text[:80])
    a2 = apply(props[1])
    r = requests.patch(f"{API}/properties/applications/{a2}/approve", headers=mgr)
    check("a manager can approve any application -> 200", r.status_code == 200, r.text[:80])
finally:
    ids = ",".join(map(str, tenants)) or "0"; pids = ",".join(map(str, props)) or "0"
    pg(f"delete from payments where tenant_id in ({ids}); delete from agreements where tenant_id in ({ids}) or property_id in ({pids}); delete from properties where id in ({pids}); delete from users where id in ({ids});")
    mongo(f'd.notifications.deleteMany({{$or:[{{user_id:{{$in:[{ids}]}}}},{{message:/APV-TEST|Approve Test/}}]}}); d.rental_applications.deleteMany({{tenant_id:{{$in:[{ids}]}}}});')
    after = {t: pg(f"select count(*) from {t}") for t in BASE}
    check("cleanup: users/properties/agreements back to baseline", after == BASE, after)
print(f"\n{sum(results)}/{len(results)} passed")
sys.exit(0 if all(results) else 1)
