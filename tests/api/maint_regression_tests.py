"""Regression: tenant maintenance request -> owner status + service fees, with authorization. Real backend + DB; everything created here is removed."""
import json, subprocess, sys, warnings
import requests
warnings.filterwarnings("ignore")
API = "http://localhost:8000"
results = []


def check(name, ok, detail=""):
    results.append(bool(ok))
    print(("PASS " if ok else "FAIL ") + name + (f"  [{str(detail)[:220]}]" if detail != "" else ""))


def sh(*a, stdin=None):
    return subprocess.run(list(a), capture_output=True, text=True, input=stdin, encoding="utf-8").stdout.strip()


def mongo(js):
    return sh("docker", "exec", "-i", "property_mongodb", "mongosh", "-u", "mongo", "-p", "mongo123", "--authenticationDatabase", "admin", "--quiet", "--eval", f'const d=db.getSiblingDB("property_management"); {js}')


def login(email):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": "PropAI@2024"})
    return {"Authorization": "Bearer " + r.json()["access_token"]}


tenant, sneha, owner, priya, mgr = login("amit@example.in"), login("sneha@example.in"), login("vikram@propai.in"), login("priya@propai.in"), login("rajesh@propai.in")
T0 = sh("python", "-c", "from datetime import datetime,timezone;print(datetime.now(timezone.utc).isoformat())")
BASE = mongo("print(d.maintenance_requests.countDocuments({}))")
rid = None
try:
    r = requests.post(f"{API}/maintenance/", headers=tenant, json={"title": "REG-TEST leaking tap", "description": "kitchen", "urgency": "high", "category": "plumbing"})
    check("tenant raises a request for their own property -> 200", r.status_code == 200, r.text[:100])
    rid = r.json()["id"]
    check("tenant response carries no owner-only fields", "service" not in r.json()["request"] and "source" not in r.json()["request"])
    check("tenant can't raise one for a property they don't rent (403)", requests.post(f"{API}/maintenance/", headers=tenant, json={"title": "xx", "property_id": 6}).status_code == 403)
    check("title too short -> 422", requests.post(f"{API}/maintenance/", headers=tenant, json={"title": "x"}).status_code == 422)
    check("bad urgency -> 422", requests.post(f"{API}/maintenance/", headers=tenant, json={"title": "ok title", "urgency": "extreme"}).status_code == 422)
    check("owner can't raise requests (403)", requests.post(f"{API}/maintenance/", headers=owner, json={"title": "ok title"}).status_code == 403)

    ids = lambda h: [x["id"] for x in requests.get(f"{API}/maintenance/", headers=h).json()]
    check("owner of the property sees it; another owner does not", rid in ids(owner) and rid not in ids(priya))
    check("the tenant sees it; another tenant does not", rid in ids(tenant) and rid not in ids(sneha))
    check("manager sees everything", rid in ids(mgr))

    svc = {"provider_name": "Sharma Plumbing", "provider_type": "independent", "service_type": "Tap repair", "scheduled_date": "2026-09-10", "completed_date": "2026-09-11",
           "service_fee": 800.5, "additional_charges": [{"label": "Washer", "amount": 120}, {"label": "Visit", "amount": 200.25}], "payment_status": "pending", "total_amount": 1}
    r = requests.patch(f"{API}/maintenance/{rid}/service", headers=owner, json=svc)
    s = r.json().get("request", {}).get("service", {})
    check("owner saves service details -> 200", r.status_code == 200, r.text[:100])
    check("total is computed by the server (800.50 + 120 + 200.25 = 1120.75), client total ignored", s.get("total_amount") == 1120.75 and s.get("additional_total") == 320.25, s.get("total_amount"))
    check("tenant cannot save service details (403)", requests.patch(f"{API}/maintenance/{rid}/service", headers=tenant, json=svc).status_code == 403)
    check("manager cannot save service details (403, owner-only)", requests.patch(f"{API}/maintenance/{rid}/service", headers=mgr, json=svc).status_code == 403)
    check("another owner cannot (404, existence hidden)", requests.patch(f"{API}/maintenance/{rid}/service", headers=priya, json=svc).status_code == 404)
    check("malformed id -> 404, not 500", requests.patch(f"{API}/maintenance/not-an-id/service", headers=owner, json=svc).status_code == 404)
    check("negative fee -> 422", requests.patch(f"{API}/maintenance/{rid}/service", headers=owner, json={**svc, "service_fee": -1}).status_code == 422)
    check("fee over limit -> 422", requests.patch(f"{API}/maintenance/{rid}/service", headers=owner, json={**svc, "service_fee": 10_000_001}).status_code == 422)
    check("completion before service date -> 422", requests.patch(f"{API}/maintenance/{rid}/service", headers=owner, json={**svc, "completed_date": "2026-09-01"}).status_code == 422)
    check("11 additional charges -> 422", requests.patch(f"{API}/maintenance/{rid}/service", headers=owner, json={**svc, "additional_charges": [{"label": "a", "amount": 1}] * 11}).status_code == 422)
    check("missing provider name -> 422", requests.patch(f"{API}/maintenance/{rid}/service", headers=owner, json={k: v for k, v in svc.items() if k != "provider_name"}).status_code == 422)
    tl = [x for x in requests.get(f"{API}/maintenance/", headers=tenant).json() if x["id"] == rid][0]
    check("tenant's copy never contains fees / service data", "service" not in tl and "1120.75" not in json.dumps(tl))
    ml = [x for x in requests.get(f"{API}/maintenance/", headers=mgr).json() if x["id"] == rid][0]
    check("manager's copy doesn't contain owner-side service data either", "service" not in ml)

    # ---- status updates ----
    r = requests.patch(f"{API}/maintenance/{rid}/status", headers=owner, json={"status": "in_progress"})
    check("owner marks it in progress -> 200", r.status_code == 200, r.text[:80])
    check("tenant cannot change the status (403)", requests.patch(f"{API}/maintenance/{rid}/status", headers=tenant, json={"status": "resolved"}).status_code == 403)
    r = requests.patch(f"{API}/maintenance/{rid}/status", headers=priya, json={"status": "resolved"})
    check("ANOTHER owner cannot change the status of a request on someone else's property (403/404)", r.status_code in (403, 404), r.status_code)
    r = requests.patch(f"{API}/maintenance/{rid}/status", headers=owner, json={"status": "banana"})
    check("an invalid status value is rejected (422/400)", r.status_code in (400, 422), r.status_code)
    r = requests.patch(f"{API}/maintenance/not-an-id/status", headers=owner, json={"status": "resolved"})
    check("malformed id on status -> 404, not 500", r.status_code == 404, r.status_code)
    now = [x for x in requests.get(f"{API}/maintenance/", headers=tenant).json() if x["id"] == rid][0]
    check("status is still in_progress after the refused attempts", now["status"] == "in_progress", now["status"])
finally:
    if rid:
        mongo(f'd.maintenance_requests.deleteOne({{_id: ObjectId("{rid}")}})')
    mongo(f'd.notifications.deleteMany({{created_at:{{$gte:"{T0}"}}, message:/REG-TEST/}}); d.notifications.deleteMany({{created_at:{{$gte:"{T0}"}}, title:"Maintenance request received"}}); d.notifications.deleteMany({{created_at:{{$gte:"{T0}"}}, title:/Maintenance Update|New Maintenance Request/}});')
    check("cleanup: maintenance collection back to baseline", mongo("print(d.maintenance_requests.countDocuments({}))") == BASE, BASE)
print(f"\n{sum(results)}/{len(results)} passed")
sys.exit(0 if all(results) else 1)
