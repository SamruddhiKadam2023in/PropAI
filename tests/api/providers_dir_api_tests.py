"""API tests: Owner -> Maintenance -> Service Providers (repair contacts). Real backend + real DB, nothing mocked."""
import json, subprocess, sys
import requests

API = "http://localhost:8000"
results = []


def check(name, ok, detail=""):
    results.append(bool(ok))
    print(("PASS " if ok else "FAIL ") + name + (f"  [{str(detail)[:190]}]" if detail != "" else ""))


def login(email):
    return {"Authorization": "Bearer " + requests.post(f"{API}/auth/login", json={"email": email, "password": "PropAI@2024"}).json()["access_token"]}


def sh(*a, stdin=None):
    return subprocess.run(list(a), capture_output=True, text=True, input=stdin, encoding="utf-8").stdout.strip()


def pg(sql):
    return sh("docker", "exec", "property_postgres", "psql", "-U", "postgres", "-d", "property_management", "-Atc", sql)


def mongo(js):
    return sh("docker", "exec", "-i", "property_mongodb", "mongosh", "-u", "mongo", "-p", "mongo123", "--authenticationDatabase", "admin", "--quiet", "--eval", f'const d=db.getSiblingDB("property_management"); {js}')


owner, priya, manager, tenant = login("vikram@propai.in"), login("priya@propai.in"), login("rajesh@propai.in"), login("amit@example.in")
B = f"{API}/service-providers"
FIELDS = {"id", "name", "category", "category_label", "phone", "whatsapp", "email", "service_area", "availability", "visit_charge", "status", "description", "problem_types", "is_demo", "editable"}
new = {"name": "TEST Ravi Plumbing", "category": "plumber", "phone": "98765 43210", "whatsapp": "+91 98765 43211", "email": "ravi@example.com", "service_area": "Mumbai / Thane",
       "availability": "8:00 AM – 6:00 PM", "visit_charge": 350, "status": "available", "description": "Leaks and drains.", "problem_types": ["Tap leakage", "tap leakage", "Drain clearing"]}
made_providers, made_requests = [], []
demo_before = pg("select count(*) from service_providers where is_demo")
assert demo_before == "17", f"expected 17 demo providers, found {demo_before}"

try:
    print("\n== 1. Authorization ==")
    check("no token -> 401/403", requests.get(B + "/").status_code in (401, 403))
    codes = [requests.get(B + "/", headers=tenant).status_code, requests.get(B + "/categories", headers=tenant).status_code, requests.post(B + "/", headers=tenant, json=new).status_code,
             requests.put(B + "/1", headers=tenant, json=new).status_code, requests.delete(B + "/1", headers=tenant).status_code, requests.get(B + "/for-request/abc", headers=tenant).status_code]
    check("tenant: list / categories / create / update / delete / for-request all -> 403", codes == [403] * 6, codes)
    check("a tenant can't create rows (still only the 17 demo providers)", pg("select count(*) from service_providers") == "17")

    print("\n== 2. Demo providers come from the database ==")
    lst = requests.get(B + "/", headers=owner).json()["providers"]
    check("owner sees the 17 demo providers", len(lst) == 17 and all(p["is_demo"] for p in lst), len(lst))
    check("manager sees the same 17", len(requests.get(B + "/", headers=manager).json()["providers"]) == 17)
    check("exactly the needed fields - the creator's id is never exposed", all(set(p) == FIELDS for p in lst), sorted(set(lst[0]) ^ FIELDS))
    check("demo providers use obviously fake numbers (+91 00000 xxxxx) and are read-only", all(p["phone"].startswith("+9100000") and p["whatsapp"].startswith("+9100000") and p["editable"] is False for p in lst))
    by = {p["name"]: p for p in lst}
    r = by["Rajesh Plumbing Services"]
    check("example 1 matches your spec (Rajesh Plumbing Services)", r["category"] == "plumber" and "Mumbai / Navi Mumbai" in r["service_area"] and r["availability"] == "9:00 AM – 7:00 PM" and r["visit_charge"] == 500.0 and r["status"] == "available"
          and r["description"] == "Tap leakage, pipe blockage, water leakage and plumbing repairs." and r["problem_types"][:3] == ["Tap leakage", "Pipe blockage", "Water leakage"], json.dumps(r)[:150])
    a = by["ABC Electrical Services"]
    check("example 2 matches your spec (ABC Electrical Services)", a["category"] == "electrician" and a["availability"] == "10:00 AM – 8:00 PM" and a["visit_charge"] == 400.0 and a["description"] == "Fan, light, switch, socket and wiring repairs.")
    check("a second plumber is present (XYZ Plumbing)", "XYZ Plumbing" in by)
    check("no rating field (no rating system exists in this app)", not any("rating" in p for p in lst))
    for cat, n in (("plumber", 4), ("electrician", 3), ("ac_technician", 2), ("carpenter", 2), ("cleaning", 2), ("locksmith", 2), ("handyman", 2)):
        got = requests.get(B + "/", headers=owner, params={"category": cat}).json()["providers"]
        check(f"category filter '{cat}' -> {n}", len(got) == n and all(p["category"] == cat for p in got), len(got))
    av = requests.get(B + "/", headers=owner, params={"status": "available"}).json()["providers"]
    check("status filter: 'available' hides the unavailable one", len(av) == 16 and "Namma Bengaluru Plumbers" not in [p["name"] for p in av])
    check("search (name / area / description / problem type)", [p["name"] for p in requests.get(B + "/", headers=owner, params={"q": "geyser"}).json()["providers"]] == ["XYZ Plumbing"] and len(requests.get(B + "/", headers=owner, params={"q": "pune"}).json()["providers"]) >= 4)
    check("invalid category / status -> 422", requests.get(B + "/", headers=owner, params={"category": "astronaut"}).status_code == 422 and requests.get(B + "/", headers=owner, params={"status": "maybe"}).status_code == 422)
    cats = requests.get(B + "/categories", headers=owner).json()["categories"]
    check("7 service categories: Plumber, Electrician, AC Technician, Carpenter, Cleaning Service, Locksmith, General Handyman", [c["label"] for c in cats] == ["Plumber", "Electrician", "AC Technician", "Carpenter", "Cleaning Service", "Locksmith", "General Handyman"])

    print("\n== 3. Create / update / delete + privacy ==")
    r = requests.post(B + "/", headers=owner, json=new)
    p = r.json(); made_providers.append(p["id"])
    check("201; phones normalised to E.164, charge stored, problem types de-duplicated, editable", r.status_code == 201 and p["phone"] == "+919876543210" and p["whatsapp"] == "+919876543211" and p["visit_charge"] == 350.0 and p["problem_types"] == ["Tap leakage", "Drain clearing"] and p["editable"] is True and set(p) == FIELDS, r.text[:150])
    check("stored against the creator (Vikram = user 2), not demo", pg(f"select created_by||'|'||is_demo::text from service_providers where id={p['id']}") == "2|false")
    check("owner's list = 17 demo + 1 own", len(requests.get(B + "/", headers=owner).json()["providers"]) == 18)
    check("PRIVACY: Priya (other owner) does not see it", "TEST Ravi Plumbing" not in [x["name"] for x in requests.get(B + "/", headers=priya).json()["providers"]])
    check("PRIVACY: the manager does not see it either", "TEST Ravi Plumbing" not in [x["name"] for x in requests.get(B + "/", headers=manager).json()["providers"]])
    optional = requests.post(B + "/", headers=owner, json={"name": "TEST Minimal", "category": "handyman", "phone": "9876500099", "service_area": "Pune"})
    made_providers.append(optional.json().get("id"))
    check("only name, category, phone, area are required (WhatsApp, email, hours, charge optional -> null)", optional.status_code == 201 and optional.json()["whatsapp"] is None and optional.json()["visit_charge"] is None and optional.json()["email"] is None and optional.json()["status"] == "available", optional.text[:120])
    bad = {"name too short": {"name": "A"}, "invalid category": {"category": "astronaut"}, "invalid phone": {"phone": "12345"}, "invalid WhatsApp": {"whatsapp": "abc"},
           "bad email": {"email": "nope"}, "negative charge": {"visit_charge": -5}, "charge above 1,00,000": {"visit_charge": 100001}, "9 problem types": {"problem_types": [f"p{i}" for i in range(9)]},
           "no service area": {"service_area": ""}, "invalid status": {"status": "busy"}, "description > 500": {"description": "x" * 501}}
    for label, over in bad.items():
        rr = requests.post(B + "/", headers=owner, json={**new, **over})
        check(f"{label} -> 422", rr.status_code == 422, rr.status_code)
    check("nothing invalid was saved", pg("select count(*) from service_providers where not is_demo") == "2")
    pid = p["id"]
    r = requests.put(f"{B}/{pid}", headers=owner, json={**new, "name": "TEST Ravi & Sons", "status": "unavailable", "visit_charge": 400})
    check("owner edits their provider (name, status, charge)", r.status_code == 200 and r.json()["name"] == "TEST Ravi & Sons" and r.json()["status"] == "unavailable" and r.json()["visit_charge"] == 400.0)
    check("Priya can't edit / delete it -> 404", requests.put(f"{B}/{pid}", headers=priya, json=new).status_code == 404 and requests.delete(f"{B}/{pid}", headers=priya).status_code == 404)
    demo_id = lst[0]["id"]
    check("demo providers are read-only: edit / delete -> 409", requests.put(f"{B}/{demo_id}", headers=owner, json=new).status_code == 409 and requests.delete(f"{B}/{demo_id}", headers=owner).status_code == 409)
    check("...and they are unchanged", pg("select count(*) from service_providers where is_demo") == "17")
    mp = requests.post(B + "/", headers=manager, json={**new, "name": "TEST Manager Vendor"}); made_providers.append(mp.json().get("id"))
    check("manager can create their own; the owner can't see it", mp.status_code == 201 and "TEST Manager Vendor" not in [x["name"] for x in requests.get(B + "/", headers=owner).json()["providers"]])
    check("owner deletes their provider -> 204, then 404", requests.delete(f"{B}/{pid}", headers=owner).status_code == 204 and requests.delete(f"{B}/{pid}", headers=owner).status_code == 404)
    made_providers.remove(pid)

    print("\n== 4. Maintenance request -> recommended category -> providers ==")
    def raise_request(title, desc, cat):
        rr = requests.post(f"{API}/maintenance/", headers=tenant, json={"title": title, "description": desc, "urgency": "medium", "category": cat})
        made_requests.append(rr.json()["id"]); return rr.json()["id"]
    tap = raise_request("Bathroom tap is leaking", "Water is continuously leaking from the bathroom tap.", "plumbing")
    fr = requests.get(f"{B}/for-request/{tap}", headers=owner).json()
    names = [x["name"] for x in fr["providers"]]
    check("'Bathroom tap is leaking' (existing category: plumbing) -> Plumber, decided from the request's own category", fr["suggestion"] == {"category": "plumber", "label": "Plumber", "source": "request_category"}, fr["suggestion"])
    check("available plumbers listed (Rajesh + XYZ near Mumbai first), the unavailable one is counted not listed", names[:2] == ["Rajesh Plumbing Services", "XYZ Plumbing"] and "Namma Bengaluru Plumbers" not in names and fr["unavailable_count"] == 1, names)
    check("providers serving the property's city (Mumbai) are flagged and sorted first", [x["area_match"] for x in fr["providers"]][:2] == [True, True] and fr["request"]["city"] == "Mumbai" and not any(x["area_match"] for x in fr["providers"] if "Pune" in x["service_area"] and "Mumbai" not in x["service_area"]))
    check("each provider carries phone, WhatsApp, visit charge, availability", all(x["phone"] and x["whatsapp"] and x["visit_charge"] is not None and x["availability"] for x in fr["providers"]))
    cases = [("Fan is not working", "Bedroom ceiling fan", "other", "electrician", "keywords"), ("AC not cooling", "", "appliance", "ac_technician", "keywords"),
             ("Door lock is jammed", "", "other", "locksmith", "keywords"), ("Main door won't close", "", "furniture", "carpenter", "request_category"),
             ("Deep clean after move-out", "", "cleaning", "cleaning", "request_category"), ("Wall paint peeling", "", "structural", "handyman", "request_category"),
             ("Something odd", "please check", "other", "handyman", "default"), ("Bathroom issue", "the light in the bathroom flickers", "other", "electrician", "keywords")]
    for title, desc, cat, want, how in cases:
        rid = raise_request(title, desc, cat)
        s = requests.get(f"{B}/for-request/{rid}", headers=owner).json()["suggestion"]
        check(f"'{title}' [{cat}] -> {want} via {how}", s["category"] == want and s["source"] == how, s)
    check("a plumbing request titled about a lock still follows its own category (reuse, no second system)", requests.get(f"{B}/for-request/{raise_request('Lock issue', '', 'plumbing')}", headers=owner).json()["suggestion"]["category"] == "plumber")
    other_req = mongo('const r=d.maintenance_requests.insertOne({property_id:3, property_title:"Koramangala Premium", tenant_id:null, tenant_name:null, title:"TEST other owner request", description:"", urgency:"low", category:"other", status:"open", created_at:new Date().toISOString(), updated_at:new Date().toISOString()}); print(r.insertedId.toString())')
    made_requests.append(other_req)
    check("another owner's request -> 404 for Vikram; Priya can open it", requests.get(f"{B}/for-request/{other_req}", headers=owner).status_code == 404 and requests.get(f"{B}/for-request/{other_req}", headers=priya).status_code == 200)
    check("manager can open any request's provider list", requests.get(f"{B}/for-request/{tap}", headers=manager).status_code == 200)
    check("invalid request id -> 404", requests.get(f"{B}/for-request/not-an-id", headers=owner).status_code == 404)

    print("\n== 5. Tenant maintenance untouched ==")
    tl = requests.get(f"{API}/maintenance/", headers=tenant).json()
    check("tenant maintenance list still works and exposes nothing about providers", isinstance(tl, list) and all(not ({"service", "source", "provider"} & set(x)) for x in tl))
    check("tenant can still raise requests", requests.post(f"{API}/maintenance/", headers=tenant, json={"title": "TEST tenant ok", "description": "", "urgency": "low", "category": "other"}).status_code == 200)
    made_requests.append(mongo('print(d.maintenance_requests.find({title:"TEST tenant ok"},{_id:1}).toArray()[0]._id.toString())'))
finally:
    pg("delete from service_providers where name like 'TEST %'")
    for i in made_requests:
        mongo(f'd.maintenance_requests.deleteOne({{_id:ObjectId("{i}")}})')
    mongo('d.notifications.deleteMany({message:/Bathroom tap is leaking|Fan is not working|AC not cooling|Door lock is jammed|Main door won|Deep clean after|Wall paint peeling|Something odd|Bathroom issue|Lock issue|TEST tenant ok/})')
    print(f"\ncleanup: providers now {pg('select count(*) from service_providers')} (17 demo), real requests {mongo('print(d.maintenance_requests.countDocuments({}))')}")

print(f"\n{sum(results)}/{len(results)} checks passed")
sys.exit(0 if all(results) else 1)
