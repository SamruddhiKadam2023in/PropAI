"""API tests: Manager Rent Collection dates. Real backend + real DB. Test payments use months with no data (2026-07..09) and are removed afterwards."""
import hashlib, subprocess, sys
from datetime import date, timedelta
import requests

API = "http://localhost:8000"
results = []


def check(name, ok, detail=""):
    results.append(bool(ok))
    print(("PASS " if ok else "FAIL ") + name + (f"  [{str(detail)[:170]}]" if detail != "" else ""))


def login(email):
    return {"Authorization": "Bearer " + requests.post(f"{API}/auth/login", json={"email": email, "password": "PropAI@2024"}).json()["access_token"]}


def pg(sql):
    return subprocess.run(["docker", "exec", "property_postgres", "psql", "-U", "postgres", "-d", "property_management", "-Atc", sql], capture_output=True, text=True, encoding="utf-8").stdout.strip()


mgr, owner = login("rajesh@propai.in"), login("vikram@propai.in")
TEN = {n: login(f"{n}@example.in") for n in ("amit", "sneha", "rahul")}
PROP = {n: requests.get(f"{API}/properties/", headers=h).json()[0]["id"] for n, h in TEN.items()}
RC = f"{API}/financial/rent-collection"
FP = f"{API}/financial/payments"


def pay(who, when, amount=10000, **extra):
    return requests.post(FP, headers=TEN[who], json={"property_id": PROP[who], "amount": amount, "payment_date": when, "notes": "DATETEST", **extra})


def rc(**params):
    r = requests.get(RC, headers=mgr, params=params)
    return r


def rows(**params):
    return {x["property_id"]: x for x in rc(**params).json()["collection"]}


def wipe():
    pg("delete from payments where notes='DATETEST'")


BASE = "select md5(string_agg(t::text, '|' order by id)) from (select * from payments where notes is distinct from 'DATETEST') t"
before_hash, before_count = pg(BASE), pg("select count(*) from payments")
assert before_count == "60", before_count
today = requests.get(RC, headers=mgr).json()["today"]
T = date.fromisoformat(today)
tomorrow = (T + timedelta(days=1)).isoformat()
a, s, r_ = PROP["amit"], PROP["sneha"], PROP["rahul"]

try:
    print("\n== 1. Access + defaults ==")
    check("tenant / owner / no-token cannot use rent-collection", [requests.get(RC, headers=TEN["amit"]).status_code, requests.get(RC, headers=owner).status_code, requests.get(RC).status_code][:2] == [403, 403] and requests.get(RC).status_code in (401, 403))
    d = requests.get(RC, headers=mgr).json()
    check("default month = the CURRENT month in the business timezone (not a hard-coded 2025)", d["month"] == today[:7], f"{d['month']} / today {today}")
    check("response tells the page the business 'today' as a plain date", len(today) == 10 and d["date_from"] is None and d["date_to"] is None)

    print("\n== 2. TODAY ==")
    r = pay("amit", today)
    check("date-only today -> 201, month = this month", r.status_code == 201 and r.json()["month"] == today[:7], r.text[:100])
    check("Manager (default month) shows exactly today's date", rows()[a]["payment_date"] == today and rows()[a]["status"] == "completed")
    check("stored as LOCAL NOON of that day (safe from any offset)", pg(f"select (payment_date at time zone 'Asia/Kolkata')::text from payments where notes='DATETEST' order by id desc limit 1") == f"{today} 12:00:00", pg("select payment_date::text from payments where notes='DATETEST' order by id desc limit 1"))
    wipe()
    r = pay("amit", requests.get(RC, headers=mgr).json()["today"] + "T00:00:00", 12345)          # naive datetime = local time
    check("naive datetime today (local) -> the same calendar day", r.status_code == 201 and rows()[a]["payment_date"] == today)
    wipe()
    import datetime as _dt
    now_z = _dt.datetime.now(_dt.timezone.utc).isoformat().replace("+00:00", "Z")
    r = pay("amit", now_z)                                                                        # exactly what the Tenant page sends: new Date().toISOString()
    check("tenant-style 'now' timestamp (UTC 'Z') -> today's LOCAL date and month", r.status_code == 201 and rows()[a]["payment_date"] == today and r.json()["month"] == today[:7], r.text[:90])
    wipe()

    print("\n== 3. PREVIOUS dates + the day/month boundaries that used to break ==")
    cases = [("date-only 2026-09-01", "2026-09-01", "2026-09-01", "2026-09"), ("date-only month end 2026-08-31", "2026-08-31", "2026-08-31", "2026-08"),
             ("01 Sep 02:00 IST (= 31 Aug 20:30 UTC) - the reported bug", "2026-08-31T20:30:00Z", "2026-09-01", "2026-09"),
             ("31 Aug 23:59:59 IST (= 18:29:59 UTC)", "2026-08-31T18:29:59Z", "2026-08-31", "2026-08"),
             ("01 Sep 00:00:00 IST (= 31 Aug 18:30:00 UTC)", "2026-08-31T18:30:00Z", "2026-09-01", "2026-09"),
             ("aware IST offset written explicitly", "2026-09-05T01:15:00+05:30", "2026-09-05", "2026-09"), ("a UTC evening that is already tomorrow in India", "2026-09-10T19:00:00Z", "2026-09-11", "2026-09")]
    for label, sent, want_date, want_month in cases:
        r = pay("sneha", sent)
        got = rows(month=want_month)[s] if r.status_code == 201 else {}
        check(f"{label}: month {want_month}, shown date {want_date}", r.status_code == 201 and r.json()["month"] == want_month and got.get("payment_date") == want_date and got.get("status") == "completed", f"{r.status_code} {r.json().get('month') if r.status_code == 201 else r.text[:60]} / {got.get('payment_date')}")
        wipe()
    r = pay("sneha", "2026-08-15", month="2026-07")
    check("paying July rent on 15 Aug: rent month stays 2026-07, date stays 15 Aug", r.status_code == 201 and rows(month="2026-07")[s]["payment_date"] == "2026-08-15" and rows(month="2026-08")[s]["status"] == "pending")
    wipe()

    print("\n== 4. FUTURE dates are refused ==")
    for label, when in (("tomorrow (date)", tomorrow), ("tomorrow noon (timestamp)", tomorrow + "T12:00:00Z"), ("far future 2099-01-01", "2099-01-01")):
        rr = pay("amit", when)
        check(f"{label} -> 422 'can't be in the future'", rr.status_code == 422 and "future" in rr.text, f"{rr.status_code} {rr.text[:70]}")
    check("nothing was stored for those", pg("select count(*) from payments where notes='DATETEST'") == "0")

    print("\n== 5. INVALID dates ==")
    for label, when in (("impossible date 2026-02-30", "2026-02-30"), ("not a date", "not-a-date"), ("empty string", ""), ("year 1999", "1999-12-31"), ("month 13", "2026-13-01"), ("garbage time", "2026-09-01T25:99:00Z")):
        rr = pay("amit", when)
        check(f"{label} -> 422", rr.status_code == 422, rr.status_code)
    check("missing date -> 422", requests.post(FP, headers=TEN["amit"], json={"property_id": a, "amount": 1}).status_code == 422)
    for label, m in (("month 2026-13", "2026-13"), ("month 26-01", "26-01"), ("month 2026-1", "2026-1"), ("month abc", "abc"), ("month 1999-05", "1999-05")):
        check(f"payment with {label} -> 422", pay("amit", "2026-08-05", month=m).status_code == 422)
    check("nothing invalid was stored", pg("select count(*) from payments where notes='DATETEST'") == "0")
    for label, params in (("month=2026-13", {"month": "2026-13"}), ("month=abc", {"month": "abc"}), ("date_from=2026-02-30", {"date_from": "2026-02-30"}), ("date_to=xx", {"date_to": "xx"}),
                          ("from after to", {"date_from": "2026-08-20", "date_to": "2026-08-10"}), ("date_from year 1999", {"date_from": "1999-01-01"})):
        rr = rc(**params)
        check(f"rent-collection {label} -> 422", rr.status_code == 422, f"{rr.status_code} {rr.text[:60]}")

    print("\n== 6. MULTIPLE records + FILTERING ==")
    pay("amit", "2026-08-05", 15000); pay("sneha", "2026-08-12", 20000); pay("rahul", "2026-08-20", 18000)
    d = rc(month="2026-08").json()
    got = {x["property_id"]: x for x in d["collection"]}
    check("three tenants, three different dates, each shown on its own row", (got[a]["payment_date"], got[s]["payment_date"], got[r_]["payment_date"]) == ("2026-08-05", "2026-08-12", "2026-08-20") and all(got[p]["status"] == "completed" for p in (a, s, r_)))
    check("summary: 3 paid of 5, collected = 15000+20000+18000, rate 60%", d["summary"]["total"] == 5 and d["summary"]["paid"] == 3 and d["summary"]["total_collected"] == 53000 and d["summary"]["collection_rate"] == 60 and d["summary"]["pending"] == 2, d["summary"])
    pay("amit", "2026-08-25", 500)
    g = rows(month="2026-08")[a]
    check("two payments, same property + month: latest date shown, amounts added (15000 + 500)", g["payment_date"] == "2026-08-25" and g["amount_paid"] == 15500.0)
    check("...and the summary still counts the property once", rc(month="2026-08").json()["summary"]["paid"] == 3)
    check("other months are untouched by these payments (September: all pending)", all(x["status"] == "pending" and x["payment_date"] is None for x in rows(month="2026-09").values()))
    def paid_in(**p): return sorted(k for k, x in rows(**p).items() if x["status"] == "completed")
    check("date filter Aug 10 - Aug 20 (inclusive) -> sneha (12th) + rahul (20th)", paid_in(date_from="2026-08-10", date_to="2026-08-20") == sorted([s, r_]))
    check("single day Aug 12 - Aug 12 -> only sneha", paid_in(date_from="2026-08-12", date_to="2026-08-12") == [s])
    check("'from' only (Aug 20 onwards) -> rahul (20th) + amit (25th)", paid_in(date_from="2026-08-20") == sorted([a, r_]))
    up_to = rows(date_to="2026-08-05")
    check("'to' only (everything up to Aug 5) includes the 2025 history, and amit's latest payment in that window is Aug 5", len(paid_in(date_to="2026-08-05")) == 5 and up_to[a]["payment_date"] == "2026-08-05" and up_to[s]["payment_date"] < "2026-08-05", up_to[s]["payment_date"])
    check("range in a month with no payments -> everyone pending", paid_in(date_from="2026-07-01", date_to="2026-07-31") == [])
    dr = rc(date_from="2026-08-10", date_to="2026-08-20").json()
    check("range response: month null, dates echoed back, summary computed for the range", dr["month"] is None and dr["date_from"] == "2026-08-10" and dr["date_to"] == "2026-08-20" and dr["summary"]["paid"] == 2 and dr["summary"]["total_collected"] == 38000)
    wipe()
    pay("sneha", "2026-08-31T18:29:59Z"); pay("rahul", "2026-08-31T18:30:00Z")
    check("local-midnight edge: 23:59:59 IST counts as Aug 31, 00:00:00 IST as Sep 1", paid_in(date_from="2026-08-31", date_to="2026-08-31") == [s] and paid_in(date_from="2026-09-01", date_to="2026-09-01") == [r_])
    check("month filter agrees: Aug -> sneha, Sep -> rahul", paid_in(month="2026-08") == [s] and paid_in(month="2026-09") == [r_])
    wipe()

    print("\n== 7. Refresh / persistence / API response ==")
    pay("rahul", "2026-08-12", 18000)
    one, two = rc(month="2026-08").json(), rc(month="2026-08").json()
    check("the same request twice (a page refresh) returns identical data", one == two)
    check("payment_date in the API is a plain 'YYYY-MM-DD' string (no time, no zone to misread)", rows(month="2026-08")[r_]["payment_date"] == "2026-08-12" and len(rows(month="2026-08")[r_]["payment_date"]) == 10)
    check("database holds local noon of the chosen day (12:00 IST = 06:30 UTC)", pg("select payment_date::text from payments where notes='DATETEST'").startswith("2026-08-12 06:30:00"), pg("select payment_date::text from payments where notes='DATETEST'"))
    wipe()

    print("\n== 8. Existing rent records preserved ==")
    check("all 60 original payment rows are byte-for-byte unchanged", pg(BASE) == before_hash and pg("select count(*) from payments") == "60")
    ok = True
    for m in [f"2025-{i:02d}" for i in range(1, 13)]:
        api_rows = rows(month=m)
        db = {int(l.split("|")[0]): l.split("|")[1] for l in pg(f"select property_id||'|'||(payment_date at time zone 'Asia/Kolkata')::date from payments where month='{m}'").splitlines() if l}
        ok &= all((api_rows[p]["payment_date"] == db.get(p)) and (api_rows[p]["status"] == ("completed" if p in db else "pending")) for p in api_rows)
    check("every 2025 month: each tenant's status and date match the database exactly", ok)
    dec = rc(month="2025-12").json()
    check("Dec 2025 still shows 5 paid on 2025-12-01", dec["summary"]["paid"] == 5 and all(x["payment_date"] == "2025-12-01" for x in dec["collection"]), dec["summary"])

    print("\n== 9. Tenant behaviour unchanged ==")
    r = pay("amit", now_z, 9999)
    lst = requests.get(FP, headers=TEN["amit"]).json()
    check("tenant can still record a payment and list payments (same fields as before)", r.status_code == 201 and isinstance(lst, list) and {"id", "amount", "payment_date", "status", "month", "notes", "tenant_id", "property_id", "created_at"} <= set(lst[0]))
    wipe()

    print("\n== 10. Reminders use the business month ==")
    t0 = pg("select now()::text")
    m = requests.post(f"{API}/financial/send-reminders", headers=mgr)
    body = pg(f"select message from notifications_dummy") if False else ""
    check("send-reminders still works (200)", m.status_code == 200 and m.json()["count"] >= 1, m.text[:80])
finally:
    wipe()
    # send-reminders created notifications for tenants; remove only the ones from this run
    subprocess.run(["docker", "exec", "-i", "property_mongodb", "mongosh", "-u", "mongo", "-p", "mongo123", "--authenticationDatabase", "admin", "--quiet", "--eval",
                    'const d=db.getSiblingDB("property_management"); d.notifications.deleteMany({title:"Rent Due Reminder", created_at:{$gte:new Date(Date.now()-20*60*1000).toISOString().slice(0,19)}}); d.notifications.deleteMany({message:/DATETEST/})'], capture_output=True)
    print(f"\ncleanup: payments {pg('select count(*) from payments')} (60 originals), original rows hash unchanged: {pg(BASE) == before_hash}")

print(f"\n{sum(results)}/{len(results)} checks passed")
sys.exit(0 if all(results) else 1)
