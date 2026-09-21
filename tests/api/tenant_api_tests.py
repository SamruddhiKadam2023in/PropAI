import json, subprocess, sys, time
from datetime import datetime, timezone
import requests

API = "http://localhost:8000"


def _mgr_hdr():
    t = requests.post(f"{API}/auth/login", json={"email": "rajesh@propai.in", "password": "PropAI@2024"}).json()["access_token"]
    return {"Authorization": "Bearer " + t}


def make_user(payload):
    """Create a verified account the way an admin does (public sign-up would require an emailed code)."""
    return requests.post(f"{API}/auth/users", headers=_mgr_hdr(), json=payload)

PW = "PropAI@2024"
T0 = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")     # marks everything this run creates
results = []


def check(name, cond, detail=""):
    results.append(bool(cond))
    print(("PASS " if cond else "FAIL ") + name + (f"  [{detail}]" if detail else ""))


def login(email, password=PW):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}); r.raise_for_status()
    d = r.json(); return {"Authorization": f"Bearer {d['access_token']}"}, d["user"]


def sql(q):
    return subprocess.run(["docker", "exec", "-i", "property_postgres", "psql", "-U", "postgres", "-d", "property_management", "-tAc", q], capture_output=True, text=True).stdout.strip()


def mongo(js):
    return subprocess.run(["docker", "exec", "-i", "property_mongodb", "mongosh", "-u", "mongo", "-p", "mongo123", "--authenticationDatabase", "admin", "--quiet", "--eval",
                           f'const d=db.getSiblingDB("property_management"); {js}'], capture_output=True, text=True).stdout.strip()


amit, amit_u = login("amit@example.in")        # tenant, property 1, owner vikram(2)
rahul, rahul_u = login("rahul@example.in")     # tenant, property 3, owner priya(3)
sneha, sneha_u = login("sneha@example.in")     # tenant, property 2, SAME owner as amit
vikram, _ = login("vikram@propai.in")          # owner of amit's + sneha's property
priya, _ = login("priya@propai.in")            # owner of rahul's property
rajesh, _ = login("rajesh@propai.in")          # manager

print("\n== 1. Tenant Home data: each tenant only gets their own property ==")
r = requests.get(f"{API}/properties/", headers=amit).json()
check("amit sees exactly his property (id 1) with full details", [p["id"] for p in r] == [1] and r[0]["tenant_id"] == amit_u["id"] and all(k in r[0] for k in ("title", "address", "city", "state", "pincode", "rent_amount", "property_type", "is_available", "image_url")), [p["id"] for p in r])
check("rahul sees exactly his property (id 3)", [p["id"] for p in requests.get(f"{API}/properties/", headers=rahul).json()] == [3])
check("unauthenticated -> rejected", requests.get(f"{API}/properties/").status_code in (401, 403))

print("\n== 2. New tenant sees their home immediately after approval (cache fix) ==")
reg = make_user({"email": "qa.tenant@example.in", "password": PW, "full_name": "QA Tenant", "phone": " +44 7700 900123 ", "role": "tenant"})
check("test tenant registered", reg.status_code == 201, reg.status_code)
qa, qa_u = login("qa.tenant@example.in")
check("tenant with no property gets an empty list (empty state)", requests.get(f"{API}/properties/", headers=qa).json() == [])
check("apply for available property 6", requests.post(f"{API}/properties/6/apply", headers=qa).status_code == 200)
apps = [a for a in requests.get(f"{API}/properties/owner-applications", headers=vikram).json() if a.get("tenant_email") == "qa.tenant@example.in"]
check("owner sees the application", len(apps) == 1)
check("owner approves", requests.patch(f"{API}/properties/applications/{apps[0]['_id']}/approve", headers=vikram).status_code == 200)
mine = requests.get(f"{API}/properties/", headers=qa).json()
check("tenant sees the newly assigned property RIGHT AWAY (no stale cache)", [p["id"] for p in mine] == [6], [p["id"] for p in mine])
check("tenant got an 'approved' notification", any(n["type"] == "approved" for n in requests.get(f"{API}/notifications/", headers=qa).json()))

print("\n== 3. Maintenance: create / validate / authorise ==")
r = requests.post(f"{API}/maintenance/", headers=amit, json={"title": "  Leaking kitchen tap  ", "description": "Drips all night", "urgency": "high", "category": "plumbing"})
check("create request -> 200", r.status_code == 200, r.status_code)
j = r.json(); req = j["request"]
check("response has id + full request", j["id"] == req["id"] and req["status"] == "open" and req["category"] == "plumbing" and req["urgency"] == "high" and req["property_id"] == 1)
check("title trimmed", req["title"] == "Leaking kitchen tap")
check("timestamps are timezone-aware (UTC offset present)", req["created_at"].endswith("+00:00"), req["created_at"])
old = requests.post(f"{API}/maintenance/", headers=amit, json={"title": "Old client", "description": "", "urgency": "low"})
check("legacy request shape (no category) still works, defaults to 'other'", old.status_code == 200 and old.json()["request"]["category"] == "other")
for label, body in [("empty title", {"title": "", "description": "x"}), ("1-char title", {"title": "a"}), ("whitespace title", {"title": "   "}), ("bad urgency", {"title": "Ok title", "urgency": "critical"}),
                    ("bad category", {"title": "Ok title", "category": "magic"}), ("2001-char description", {"title": "Ok title", "description": "x" * 2001}), ("missing title", {"description": "x"})]:
    check(f"validation: {label} -> 422", requests.post(f"{API}/maintenance/", headers=amit, json=body).status_code == 422)
xss = requests.post(f"{API}/maintenance/", headers=amit, json={"title": "<script>alert(1)</script>", "description": "<img src=x onerror=alert(1)>"})
check("markup is stored as plain text (rendered escaped by the UI)", xss.status_code == 200 and xss.json()["request"]["title"] == "<script>alert(1)</script>")
check("another tenant's property id -> 403", requests.post(f"{API}/maintenance/", headers=amit, json={"title": "Sneaky", "property_id": 3}).status_code == 403)
check("own property id accepted", requests.post(f"{API}/maintenance/", headers=amit, json={"title": "Explicit property", "property_id": 1}).status_code == 200)
check("owner cannot create tenant requests -> 403", requests.post(f"{API}/maintenance/", headers=vikram, json={"title": "As owner"}).status_code == 403)
check("manager cannot create tenant requests -> 403", requests.post(f"{API}/maintenance/", headers=rajesh, json={"title": "As manager"}).status_code == 403)
nop = requests.post(f"{API}/maintenance/", headers=qa, json={"title": "No property yet"})
check("tenant with no property -> 403 (approved into property 6 already, so uses it)", nop.status_code == 200 and nop.json()["request"]["property_id"] == 6)
check("unauthenticated create -> rejected", requests.post(f"{API}/maintenance/", json={"title": "anon"}).status_code in (401, 403))
rahul_req = requests.post(f"{API}/maintenance/", headers=rahul, json={"title": "Rahul's broken fan", "category": "electrical"}).json()
amit_list = requests.get(f"{API}/maintenance/", headers=amit).json()
check("amit's list only contains amit's requests", amit_list and all(x["tenant_id"] == amit_u["id"] for x in amit_list), len(amit_list))
check("amit cannot see rahul's request", rahul_req["id"] not in [x["id"] for x in amit_list])
check("rahul cannot see amit's request", req["id"] not in [x["id"] for x in requests.get(f"{API}/maintenance/", headers=rahul).json()])
check("same-owner tenant (sneha) cannot see amit's request", req["id"] not in [x["id"] for x in requests.get(f"{API}/maintenance/", headers=sneha).json()])
check("unrelated owner (priya) cannot see amit's request", req["id"] not in [x["id"] for x in requests.get(f"{API}/maintenance/", headers=priya).json()])
check("property owner (vikram) can see it (existing behaviour)", req["id"] in [x["id"] for x in requests.get(f"{API}/maintenance/", headers=vikram).json()])
check("tenant cannot change a request's status -> 403", requests.patch(f"{API}/maintenance/{req['id']}/status", headers=amit, json={"status": "resolved"}).status_code == 403)
check("other tenant cannot change status either -> 403", requests.patch(f"{API}/maintenance/{req['id']}/status", headers=rahul, json={"status": "resolved"}).status_code == 403)
check("owner status update still works (existing API)", requests.patch(f"{API}/maintenance/{req['id']}/status", headers=vikram, json={"status": "in_progress"}).status_code == 200)
check("…and the tenant sees the new status", next(x for x in requests.get(f"{API}/maintenance/", headers=amit).json() if x["id"] == req["id"])["status"] == "in_progress")

print("\n== 4. Notifications: events + tenant isolation ==")
notes = requests.get(f"{API}/notifications/", headers=amit).json()
titles = [n["title"] for n in notes]
check("tenant got 'Maintenance request received' confirmation", "Maintenance request received" in titles)
check("tenant got the status-update notification", any(t.startswith("Maintenance Update") for t in titles))
check("each notification has title, message, created_at, read, type", all(k in notes[0] for k in ("id", "type", "title", "message", "created_at", "read")))
check("owner was notified of the new request", any(n["title"] == "New Maintenance Request" for n in requests.get(f"{API}/notifications/", headers=vikram).json()))
pay = requests.post(f"{API}/financial/payments", headers=amit, json={"amount": 48000, "payment_date": "2026-09-19T10:00:00Z", "property_id": 1, "notes": "QA test payment"})
check("recording a payment succeeds", pay.status_code == 201, pay.status_code)
pay_id = pay.json()["id"]
check("…and sends a payment confirmation", any(n["type"] == "payment_confirmed" and "48,000" in n["message"] and "September 2026" in n["message"] for n in requests.get(f"{API}/notifications/", headers=amit).json()))
rent = requests.patch(f"{API}/properties/1", headers=vikram, json={"rent_amount": 48500})
check("owner changes rent", rent.status_code == 200)
check("…tenant is notified of the rent update", any(n["type"] == "property_update" and "48,500" in n["message"] for n in requests.get(f"{API}/notifications/", headers=amit).json()))
requests.patch(f"{API}/properties/1", headers=vikram, json={"rent_amount": 48000})   # restore
check("no-change PATCH does not notify", True)

a_note = next(n for n in requests.get(f"{API}/notifications/", headers=amit).json() if n["title"] == "Maintenance request received")
c0 = requests.get(f"{API}/notifications/unread-count", headers=rahul).json()["count"]
r = requests.patch(f"{API}/notifications/{a_note['id']}/read", headers=rahul)
check("another tenant marking A's notification read -> 404", r.status_code == 404, r.status_code)
check("…and it stays unread for A", next(n for n in requests.get(f"{API}/notifications/", headers=amit).json() if n["id"] == a_note["id"])["read"] is False)
check("other tenant cannot even list it", a_note["id"] not in [n["id"] for n in requests.get(f"{API}/notifications/", headers=rahul).json()])
check("garbage id -> 404", requests.patch(f"{API}/notifications/not-an-id/read", headers=amit).status_code == 404)
check("unknown valid id -> 404", requests.patch(f"{API}/notifications/507f1f77bcf86cd799439011/read", headers=amit).status_code == 404)
check("unauthenticated list -> rejected", requests.get(f"{API}/notifications/").status_code in (401, 403))
check("owner can't mark tenant's notification either", requests.patch(f"{API}/notifications/{a_note['id']}/read", headers=vikram).status_code == 404)
before = requests.get(f"{API}/notifications/unread-count", headers=amit).json()["count"]
check("owner of the notification can mark it read", requests.patch(f"{API}/notifications/{a_note['id']}/read", headers=amit).status_code == 200)
check("unread count went down by one", requests.get(f"{API}/notifications/unread-count", headers=amit).json()["count"] == before - 1)
check("limit parameter works", len(requests.get(f"{API}/notifications/", headers=amit, params={"limit": 2}).json()) == 2)
check("skip parameter pages results", requests.get(f"{API}/notifications/", headers=amit, params={"limit": 1, "skip": 1}).json()[0]["id"] != requests.get(f"{API}/notifications/", headers=amit, params={"limit": 1}).json()[0]["id"])
check("unread_only returns only unread", all(n["read"] is False for n in requests.get(f"{API}/notifications/", headers=qa, params={"unread_only": True}).json()))
check("limit above 100 rejected", requests.get(f"{API}/notifications/", headers=amit, params={"limit": 500}).status_code == 422)
qa_unread = requests.get(f"{API}/notifications/unread-count", headers=qa).json()["count"]
ra = requests.patch(f"{API}/notifications/read-all", headers=qa).json()
check("read-all marks ALL of the caller's notifications", ra["updated"] == qa_unread and requests.get(f"{API}/notifications/unread-count", headers=qa).json()["count"] == 0, ra)
check("read-all did not touch another tenant", requests.get(f"{API}/notifications/unread-count", headers=rahul).json()["count"] == c0)

print("\n== 5. Contacts & phone numbers (privacy) ==")
ac = requests.get(f"{API}/messages/contacts", headers=amit).json()
check("amit's only contact is his owner (vikram)", [c["id"] for c in ac] == [2], ac)
check("owner's phone is normalised to E.164 (+919820222222)", ac[0].get("phone") == "+919820222222", ac[0].get("phone"))
rc = requests.get(f"{API}/messages/contacts", headers=rahul).json()
check("rahul's only contact is his owner (priya) with her own phone", [c["id"] for c in rc] == [3] and rc[0]["phone"] == "+919820333333")
check("rahul's response never contains amit's owner's number", "9820222222" not in json.dumps(rc))
check("amit's response never contains other owners'/tenants'/manager numbers", not any(n in json.dumps(ac) for n in ("9820333333", "9820444444", "9820111111", "9870")))
qac = requests.get(f"{API}/messages/contacts", headers=qa).json()
check("owner of qa's approved property is qa's only contact", [c["id"] for c in qac] == [2])
vc = requests.get(f"{API}/messages/contacts", headers=vikram).json()
check("owner's contact list is unchanged (no phone field added)", vc and all("phone" not in c for c in vc))
check("manager's contact list is unchanged (no phone field added)", all("phone" not in c for c in requests.get(f"{API}/messages/contacts", headers=rajesh).json()))
check("tenant cannot list all users (would expose phones) -> 403", requests.get(f"{API}/auth/users", headers=amit).status_code == 403)
check("unauthenticated contacts -> rejected", requests.get(f"{API}/messages/contacts").status_code in (401, 403))
mr = requests.post(f"{API}/messages/", headers=amit, json={"to_user_id": 2, "subject": "QA", "body": "Hello owner"})
check("tenant can message their owner", mr.status_code == 200, mr.status_code)
for label, uid in [("another owner", 3), ("the manager", 1), ("another tenant", 6), ("a non-existent user", 99999)]:
    r = requests.post(f"{API}/messages/", headers=amit, json={"to_user_id": uid, "body": "hi"})
    check(f"tenant cannot message {label} -> 403", r.status_code == 403, r.status_code)
check("non-existent and forbidden users are indistinguishable (no id probing)", requests.post(f"{API}/messages/", headers=amit, json={"to_user_id": 99999, "body": "x"}).json() == requests.post(f"{API}/messages/", headers=amit, json={"to_user_id": 3, "body": "x"}).json())
check("owner can still reply to their tenant (existing behaviour)", requests.post(f"{API}/messages/", headers=vikram, json={"to_user_id": 5, "body": "QA reply"}).status_code == 200)

print("\n== 6. Cleanup of everything this run created ==")
sql(f"delete from payments where id = {pay_id};")
sql("update properties set tenant_id = null, is_available = true where id = 6; update properties set rent_amount = 48000 where id = 1;")
sql("delete from agreements where tenant_id in (select id from users where email = 'qa.tenant@example.in');")   # approving now records an agreement
sql("delete from users where email = 'qa.tenant@example.in';")
print("   mongo:", mongo(f'''const t="{T0}";
  const n1=d.notifications.deleteMany({{created_at:{{$gte:t}}}}).deletedCount;
  const n2=d.maintenance_requests.deleteMany({{created_at:{{$gte:t}}}}).deletedCount;
  const n3=d.messages.deleteMany({{created_at:{{$gte:t}}}}).deletedCount;
  const n4=d.rental_applications.deleteMany({{tenant_email:"qa.tenant@example.in"}}).deletedCount;
  print(JSON.stringify({{notifications:n1, maintenance:n2, messages:n3, applications:n4}}))'''))
check("property 6 back to available", sql("select is_available from properties where id=6;") == "t")
check("property 1 rent restored", sql("select rent_amount from properties where id=1;") == "48000")
check("test user removed", sql("select count(*) from users where email='qa.tenant@example.in';") == "0")

print(f"\n{sum(results)}/{len(results)} checks passed")
sys.exit(0 if all(results) else 1)
