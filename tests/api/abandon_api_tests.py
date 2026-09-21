"""API tests: tenant agreement abandonment rule. Real backend + DB. Every user/property/agreement/payment/notification made here is removed."""
import json, subprocess, sys, warnings
from datetime import date, timedelta
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
    print(("PASS " if ok else "FAIL ") + name + (f"  [{str(detail)[:190]}]" if detail != "" else ""))


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
BASE = {t: pg(f"select count(*) from {t}") for t in ("users", "properties", "payments", "agreements")}
TODAY = date.fromisoformat(pg("select (now() at time zone 'Asia/Kolkata')::date"))
PW = "Abandon@2026"
tenants, props, hdr = {}, {}, {}
RENT = 10000
try:
    # ---------- setup: 5 tenants, 5 properties (owner vikram) ----------
    for i in range(1, 6):
        email = f"abn_t{i}@example.com"
        r = make_user({"email": email, "full_name": f"Abandon Test {i}", "password": PW, "role": "tenant"})
        assert r.status_code == 201, r.text
        hdr[i], tenants[i] = login(email, PW)
        r = requests.post(f"{API}/properties/", headers=owner, json={
            "title": f"ABN-TEST home {i}", "address": f"{i} Test Lane", "city": "Pune", "state": "MH", "pincode": "411001",
            "property_type": "apartment", "bedrooms": 2, "bathrooms": 1, "area_sqft": 900, "rent_amount": RENT})
        assert r.status_code == 201, r.text
        props[i] = r.json()["id"]

    def approve(i):
        assert requests.post(f"{API}/properties/{props[i]}/apply", headers=hdr[i]).status_code == 200
        apps = requests.get(f"{API}/properties/owner-applications", headers=owner).json()
        app = next(a for a in apps if a["tenant_id"] == tenants[i] and a["status"] == "pending")
        return requests.patch(f"{API}/properties/applications/{app['_id']}/approve", headers=owner)

    def mine(i):
        return requests.get(f"{API}/agreements", headers=hdr[i]).json()

    def one(i, aid, h=None):
        return requests.get(f"{API}/agreements/{aid}", headers=h or hdr[i])

    def pay(i, amount, ptype="rent", month=None, agreement_id=None, prop=None, extra=None):
        body = {"amount": amount, "payment_date": TODAY.isoformat(), "property_id": prop or props[i], "payment_type": ptype}
        if month: body["month"] = month
        if agreement_id: body["agreement_id"] = agreement_id
        body.update(extra or {})
        return requests.post(f"{API}/financial/payments", headers=hdr[i], json=body)

    def month_n(n):
        idx = TODAY.year * 12 + TODAY.month - 1 + n
        return f"{idx // 12}-{idx % 12 + 1:02d}"

    # ---------- approval starts an agreement ----------
    for i in (2, 3, 4, 5):
        r = approve(i)
        check(f"approve T{i} -> 200", r.status_code == 200, r.text)
    ag = {}
    for i in (2, 3, 4, 5):
        items = mine(i)["items"]
        ag[i] = items[0] if items else None
        check(f"T{i}: approval created one agreement", len(items) == 1)
    a5 = ag[5]
    expected_end = date(TODAY.year + 1, TODAY.month, TODAY.day) - timedelta(days=1)
    check("approval agreement: rent snapshot, 12-month term, starts today, ends a year less a day",
          a5["monthly_rent"] == RENT and a5["term_months"] == 12 and a5["start_date"] == TODAY.isoformat() and a5["end_date"] == expected_end.isoformat(),
          f"{a5['start_date']} -> {a5['end_date']}")
    check("contract total = rent x 12", a5["contract_total"] == RENT * 12, a5["contract_total"])

    # ================= CASE 1: agreement completed normally =================
    pg(f"update properties set tenant_id={tenants[1]}, is_available=false where id={props[1]}")
    r = requests.post(f"{API}/agreements", headers=owner, json={"property_id": props[1], "start_date": "2024-01-01", "term_months": 12})
    a1 = r.json()
    check("C1: record a past 12-month agreement -> 201", r.status_code == 201, r.text[:150])
    check("C1: term ran out -> status 'completed'", a1["status"] == "completed" and a1["end_date"] == "2024-12-31", (a1["status"], a1["end_date"]))
    check("C1: NO abandonment outstanding even with zero paid", a1["abandonment_outstanding"] == 0 and a1["paid"] == 0 and a1["settlement"] == "not_applicable", a1)
    r = requests.post(f"{API}/agreements/{a1['id']}/end", headers=owner, json={"status": "abandoned"})
    check("C1: can't be ended early once the term is over -> 409", r.status_code == 409, r.text)
    check("C1: unchanged after the refused attempt", one(1, a1["id"]).json()["abandonment_outstanding"] == 0)
    s = requests.get(f"{API}/financial/payments/summary", headers=hdr[1]).json()
    check("C1: tenant summary shows 0 outstanding", s["outstanding_total"] == 0, s["outstanding_total"])

    # ================= CASE 5: agreement still active =================
    check("C5: active agreement -> abandonment outstanding 0", a5["status"] == "active" and a5["abandonment_outstanding"] == 0 and a5["settlement"] == "not_applicable", a5["status"])
    check("C5: can be ended early (flag) and has days remaining", a5["can_end_early"] and a5["days_remaining"] > 300, a5["days_remaining"])
    check("C5: tenant paying rent doesn't trigger it", pay(5, RENT).status_code == 201)
    a5 = one(5, a5["id"]).json()
    check("C5: after payment still 0 outstanding, paid 10000", a5["abandonment_outstanding"] == 0 and a5["paid"] == RENT, (a5["abandonment_outstanding"], a5["paid"]))
    r = requests.post(f"{API}/agreements/{a5['id']}/end", headers=hdr[5], json={"status": "abandoned"})
    check("C5: tenant cannot end their own agreement (403)", r.status_code == 403, r.text)
    check("C5: property still the tenant's", pg(f"select tenant_id from properties where id={props[5]}") == str(tenants[5]))
    r = pay(5, 100, agreement_id=a5["id"])
    check("C5: settling an active agreement is refused (409)", r.status_code == 409, r.text)
    s = requests.get(f"{API}/financial/payments/summary", headers=hdr[5]).json()
    check("C5: summary outstanding_total 0; card carries the agreement", s["outstanding_total"] == 0 and s["properties"][0]["agreement"]["id"] == a5["id"])
    r = requests.post(f"{API}/agreements/{a5['id']}/end", headers=owner, json={"status": "abandoned", "terminated_on": a5["end_date"]})
    check("C5: leave date after today (end date is in the future) refused (422)", r.status_code == 422, r.text)
    r = requests.post(f"{API}/agreements/{a5['id']}/end", headers=owner, json={"status": "abandoned", "terminated_on": (TODAY + timedelta(days=1)).isoformat()})
    check("C5: future leave date refused (422)", r.status_code == 422, r.text)
    r = requests.post(f"{API}/agreements/{a5['id']}/end", headers=owner, json={"status": "abandoned", "terminated_on": (TODAY - timedelta(days=1)).isoformat()})
    check("C5: leave date before the agreement started refused (422)", r.status_code == 422, r.text)
    r = requests.post(f"{API}/agreements/{a5['id']}/end", headers=owner, json={"status": "evicted"})
    check("C5: unknown status refused (422)", r.status_code == 422)
    r = requests.post(f"{API}/agreements/{a5['id']}/end", headers=owner, json={"status": "abandoned", "reason": "x" * 501})
    check("C5: 501-char reason refused (422)", r.status_code == 422)
    check("C5: still active after every refused attempt", one(5, a5["id"]).json()["status"] == "active")

    # ================= CASE 2: tenant leaves early, nothing paid =================
    a2 = ag[2]
    r = requests.post(f"{API}/agreements/{a2['id']}/end", headers=priya, json={"status": "abandoned"})
    check("C2: another owner can't end it (403)", r.status_code == 403, r.text)
    r = requests.post(f"{API}/agreements/{a2['id']}/end", headers=owner, json={"status": "abandoned", "reason": "Left without notice"})
    e2 = r.json()
    check("C2: owner records abandonment -> 200", r.status_code == 200, r.text[:160])
    check("C2: status abandoned / label / leave date", e2["status"] == "abandoned" and e2["status_label"] == "Abandoned" and e2["terminated_on"] == TODAY.isoformat(), (e2["status"], e2["terminated_on"]))
    check("C2: outstanding = rent x 12 exactly (no penalty added)", e2["abandonment_outstanding"] == RENT * 12 and e2["paid"] == 0 and e2["settlement"] == "outstanding", e2["abandonment_outstanding"])
    check("C2: reason kept", e2["termination_reason"] == "Left without notice")
    p = requests.get(f"{API}/properties/{props[2]}", headers=owner).json()
    check("C2: property freed (no tenant, available)", p["tenant_id"] is None and p["is_available"] is True, (p["tenant_id"], p["is_available"]))
    r = requests.post(f"{API}/agreements/{a2['id']}/end", headers=owner, json={"status": "abandoned"})
    check("C2: ending twice -> 409", r.status_code == 409, r.text)
    s = requests.get(f"{API}/financial/payments/summary", headers=hdr[2]).json()
    check("C2: tenant summary: outstanding_total 120000; no rented property card but the agreement is listed",
          s["outstanding_total"] == RENT * 12 and s["properties"] == [] and s["agreements"][0]["settlement"] == "outstanding", (s["outstanding_total"], len(s["properties"])))
    n = json.loads(mongo(f"print(JSON.stringify(d.notifications.find({{user_id:{tenants[2]},type:'agreement_ended'}}).toArray()))") or "[]")
    check("C2: tenant notified with the amount", len(n) == 1 and "120,000" in n[0]["message"], n[0]["message"] if n else "")
    requests.patch(f"{API}/properties/{props[2]}", headers=owner, json={"rent_amount": 99999})
    check("C2: raising the property's rent afterwards doesn't change the agreement (snapshot)", one(2, a2["id"]).json()["abandonment_outstanding"] == RENT * 12)
    r = requests.patch(f"{API}/agreements/{a2['id']}", headers=hdr[2], json={"abandonment_outstanding": 0})
    check("C2: no endpoint lets a tenant edit an agreement (405)", r.status_code == 405, r.status_code)
    r = requests.post(f"{API}/agreements/{a2['id']}/end", headers=hdr[2], json={"status": "terminated"})
    check("C2: tenant can't 'un-abandon' via the end endpoint (403)", r.status_code == 403)
    r = pay(2, 5, extra={"abandonment_outstanding": 0, "outstanding": 0})
    check("C2: paying a property they no longer rent without agreement_id -> 403", r.status_code == 403, r.text)
    lst = requests.get(f"{API}/agreements?status=outstanding", headers=mgr).json()
    check("C2: manager list filter status=outstanding includes it", any(i["id"] == a2["id"] for i in lst["items"]) and lst["totals"]["outstanding_total"] >= RENT * 12, lst["totals"])
    lst_o = requests.get(f"{API}/agreements", headers=owner).json()["items"]
    lst_p = requests.get(f"{API}/agreements", headers=priya).json()["items"]
    check("C2: owner sees their tenant's row with tenant name; other owner sees none of ours", any(i["id"] == a2["id"] and i["tenant_name"] == "Abandon Test 2" for i in lst_o) and not any(i["id"] in (a2["id"], a5["id"]) for i in lst_p))
    check("C2: another tenant gets 404 for it", one(3, a2["id"]).status_code == 404)
    check("C2: unauthenticated -> 401/403", requests.get(f"{API}/agreements").status_code in (401, 403))

    # ================= CASE 3: partly paid, then leaves =================
    a3 = ag[3]
    for k in range(3):
        assert pay(3, RENT, month=month_n(k)).status_code == 201
    assert pay(3, 20000, "security_deposit").status_code == 201
    assert pay(3, 500, "late_fee").status_code == 201
    check("C3: rent payments auto-linked to the agreement", one(3, a3["id"]).json()["paid"] == 30000, one(3, a3["id"]).json()["paid"])
    check("C3: still active -> outstanding 0 before leaving", one(3, a3["id"]).json()["abandonment_outstanding"] == 0)
    r = requests.post(f"{API}/agreements/{a3['id']}/end", headers=mgr, json={"status": "terminated", "reason": "Moved out early"})
    e3 = r.json()
    check("C3: manager records termination -> 200", r.status_code == 200, r.text[:150])
    check("C3: outstanding = 120000 - 30000 = 90000 (deposit and late fee NOT counted as rent)", e3["abandonment_outstanding"] == 90000 and e3["paid"] == 30000 and e3["status"] == "terminated", (e3["abandonment_outstanding"], e3["paid"]))
    r = pay(3, 40000, agreement_id=a3["id"])
    check("C3: pay 40000 towards the balance -> 201", r.status_code == 201, r.text)
    check("C3: payment linked to the agreement", r.json()["agreement_id"] == a3["id"])
    c = one(3, a3["id"]).json()
    check("C3: balance falls to 50000, not re-charged", c["abandonment_outstanding"] == 50000 and c["paid"] == 70000 and c["settlement"] == "outstanding", (c["abandonment_outstanding"], c["paid"]))
    r = pay(3, 50000.01, agreement_id=a3["id"])
    check("C3: over-paying the balance is refused (422)", r.status_code == 422, r.text)
    check("C3: security_deposit towards the balance refused (422)", pay(3, 100, "security_deposit", agreement_id=a3["id"]).status_code == 422)
    check("C3: another tenant can't pay into it (403)", pay(2, 100, agreement_id=a3["id"], prop=props[3]).status_code == 403)
    check("C3: mismatched property refused (403)", pay(3, 100, agreement_id=a3["id"], prop=props[4]).status_code == 403)
    check("C3: zero amount refused (422)", pay(3, 0, agreement_id=a3["id"]).status_code == 422)
    check("C3: balance unchanged after the refused attempts", one(3, a3["id"]).json()["abandonment_outstanding"] == 50000)

    # ================= CASE 4: everything applicable paid =================
    r = pay(3, 50000, agreement_id=a3["id"])
    check("C4a: pay the last 50000 -> 201", r.status_code == 201, r.text)
    c = one(3, a3["id"]).json()
    check("C4a: outstanding 0 and settled", c["abandonment_outstanding"] == 0 and c["settlement"] == "settled" and c["paid"] == 120000, (c["abandonment_outstanding"], c["settlement"]))
    r = pay(3, 1, agreement_id=a3["id"])
    check("C4a: nothing left to pay -> 409", r.status_code == 409, r.text)
    s = requests.get(f"{API}/financial/payments/summary", headers=hdr[3]).json()
    check("C4a: tenant summary outstanding_total 0", s["outstanding_total"] == 0, s["outstanding_total"])
    txns = requests.get(f"{API}/financial/payments", headers=hdr[3]).json()
    rent_total = sum(t["amount"] for t in txns if t["payment_type"] == "rent")
    check("C4a: ledger lists each payment once (3 rent + 2 settlements + deposit + fee = 7; rent 120000)", len(txns) == 7 and rent_total == 120000, (len(txns), rent_total))

    a4 = ag[4]
    for k in range(12):
        assert pay(4, RENT, month=month_n(k)).status_code == 201
    check("C4b: 12 monthly payments all linked", one(4, a4["id"]).json()["paid"] == 120000)
    r = requests.post(f"{API}/agreements/{a4['id']}/end", headers=owner, json={"status": "terminated"})
    e4 = r.json()
    check("C4b: leaves after paying everything -> outstanding 0, settled", r.status_code == 200 and e4["abandonment_outstanding"] == 0 and e4["settlement"] == "settled", e4.get("abandonment_outstanding"))
    n = json.loads(mongo(f"print(JSON.stringify(d.notifications.find({{user_id:{tenants[4]},type:'agreement_ended'}}).toArray()))") or "[]")
    check("C4b: notification says nothing further owed", len(n) == 1 and "Nothing further" in n[0]["message"], n[0]["message"] if n else "")

    # ---------- agreement recording validation ----------
    r = requests.post(f"{API}/agreements", headers=owner, json={"property_id": props[5], "start_date": TODAY.isoformat()})
    check("REC: second running agreement for same tenant -> 409", r.status_code == 409, r.text)
    check("REC: tenant can't record agreements (403)", requests.post(f"{API}/agreements", headers=hdr[5], json={"property_id": props[5], "start_date": TODAY.isoformat()}).status_code == 403)
    check("REC: other owner can't (403)", requests.post(f"{API}/agreements", headers=priya, json={"property_id": props[5], "start_date": TODAY.isoformat()}).status_code == 403)
    check("REC: vacant property -> 409", requests.post(f"{API}/agreements", headers=owner, json={"property_id": props[2], "start_date": TODAY.isoformat()}).status_code == 409)
    check("REC: unknown property -> 404", requests.post(f"{API}/agreements", headers=owner, json={"property_id": 99999999, "start_date": TODAY.isoformat()}).status_code == 404)
    check("REC: future start refused (422)", requests.post(f"{API}/agreements", headers=owner, json={"property_id": props[1], "start_date": (TODAY + timedelta(days=2)).isoformat()}).status_code == 422)
    check("REC: term 0 / 121 refused (422)", all(requests.post(f"{API}/agreements", headers=owner, json={"property_id": props[1], "start_date": "2024-01-01", "term_months": t}).status_code == 422 for t in (0, 121)))
    check("REC: negative rent refused (422)", requests.post(f"{API}/agreements", headers=owner, json={"property_id": props[1], "start_date": "2024-01-01", "monthly_rent": -5}).status_code == 422)
    check("REC: unknown agreement id -> 404", requests.post(f"{API}/agreements/99999999/end", headers=owner, json={"status": "abandoned"}).status_code == 404)
    check("REC: renewing after a completed term is allowed (201)", requests.post(f"{API}/agreements", headers=owner, json={"property_id": props[1], "start_date": TODAY.isoformat()}).status_code == 201)

    # ---------- existing seeded data untouched ----------
    seeded = requests.get(f"{API}/agreements", headers=mgr).json()["items"]
    check("SEED: backfilled agreements for the 5 seeded tenancies are 'completed' with no abandonment outstanding",
          sum(1 for i in seeded if i["tenant_id"] in (5, 6, 7, 8, 9) and i["status"] == "completed" and i["abandonment_outstanding"] == 0) == 5)
finally:
    ids = ",".join(str(v) for v in tenants.values()) or "0"
    pids = ",".join(str(v) for v in props.values()) or "0"
    pg(f"delete from payments where tenant_id in ({ids}); delete from agreements where tenant_id in ({ids}) or property_id in ({pids}); "
       f"delete from properties where id in ({pids}); delete from users where id in ({ids});")
    if tenants:
        mongo(f"d.notifications.deleteMany({{user_id:{{$in:[{ids}]}}}}); d.rental_applications.deleteMany({{tenant_id:{{$in:[{ids}]}}}}); d.notifications.deleteMany({{message:/ABN-TEST/}});")
    after = {t: pg(f"select count(*) from {t}") for t in BASE}
    check("CLEANUP: users/properties/payments/agreements counts back to baseline", after == BASE, (BASE, after))

print(f"\n{sum(results)}/{len(results)} passed")
sys.exit(0 if all(results) else 1)
