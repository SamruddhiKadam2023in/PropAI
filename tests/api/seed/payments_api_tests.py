"""API tests: Tenant Payments + Transaction History. Real backend, real DB. Temporary rows/users are removed at the end."""
import io, json, re, subprocess, sys, warnings
import pypdfium2 as pdfium, requests
warnings.filterwarnings("ignore")

API = "http://localhost:8000"
results = []


def check(name, ok, detail=""):
    results.append(bool(ok))
    print(("PASS " if ok else "FAIL ") + name + (f"  [{str(detail)[:170]}]" if detail != "" else ""))


def login(email):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": "PropAI@2024"})
    return {"Authorization": "Bearer " + r.json()["access_token"]}


def sh(*a, stdin=None):
    return subprocess.run(list(a), capture_output=True, text=True, input=stdin, encoding="utf-8").stdout.strip()


def pg(sql):
    return sh("docker", "exec", "-i", "property_postgres", "psql", "-U", "postgres", "-d", "property_management", "-At", stdin=sql)


def mongo(js):
    return sh("docker", "exec", "-i", "property_mongodb", "mongosh", "-u", "mongo", "-p", "mongo123", "--authenticationDatabase", "admin", "--quiet", "--eval", f'const d=db.getSiblingDB("property_management"); {js}')


def pdf_text(b):
    pdf = pdfium.PdfDocument(b)
    return " ".join(pdf[i].get_textpage().get_text_bounded() for i in range(len(pdf))).replace("\r\n", " ").replace("\n", " ")


owner, priya, mgr = login("vikram@propai.in"), login("priya@propai.in"), login("rajesh@propai.in")
amit, sneha, rahul = login("amit@example.in"), login("sneha@example.in"), login("rahul@example.in")
P, S = f"{API}/financial/payments", f"{API}/financial/payments/summary"
ORIG = "select md5(string_agg(t::text, '|' order by id)) from (select id, amount, payment_date, status, month, notes, receipt_url, created_at, tenant_id, property_id from payments where notes is distinct from 'PAYTEST') t"
T0 = __import__('datetime').datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%S')
before_hash, before_count = pg(ORIG), pg("select count(*) from payments")
assert before_count == "60", before_count
today = requests.get(S, headers=amit).json()["today"]
TX = re.compile(r"^TXN-\d{6}$")
temp_users, orig_p6 = [], pg("select tenant_id, is_available from properties where id=6")

try:
    print("\n== 1. Schema + authorization ==")
    check("payments.payment_type exists, NOT NULL, default 'rent'; all 60 existing rows are 'rent'", pg("select data_type||'|'||is_nullable||'|'||column_default from information_schema.columns where table_name='payments' and column_name='payment_type'") == "character varying|NO|'rent'::character varying" and pg("select count(*) from payments where payment_type='rent'") == "60")
    check("no token -> 401/403", requests.get(P).status_code in (401, 403) and requests.get(S).status_code in (401, 403))
    check("owner / manager cannot use the tenant summary (403) or record tenant payments (403)", all(requests.get(S, headers=h).status_code == 403 for h in (owner, mgr)) and all(requests.post(P, headers=h, json={"amount": 1, "payment_date": today, "property_id": 1}).status_code == 403 for h in (owner, mgr)))

    print("\n== 2. Existing tenant (Amit) - real data ==")
    r = requests.get(P, headers=amit)
    rows = r.json()
    db = pg("select id||'|'||amount||'|'||status||'|'||month||'|'||notes||'|'||property_id||'|'||(payment_date at time zone 'Asia/Kolkata')::date from payments where tenant_id=5 order by payment_date desc, id desc").splitlines()
    check("200 and exactly Amit's 12 transactions, all tenant_id 5", r.status_code == 200 and len(rows) == 12 and {x["tenant_id"] for x in rows} == {5}, len(rows))
    check("every row equals the database (id, amount, status, month, note, property, LOCAL date) in newest-first order",
          [f"{x['id']}|{x['amount']:g}|{x['status'].upper()}|{x['month']}|{x['notes']}|{x['property_id']}|{x['payment_day']}" for x in rows] == db, rows[0])
    x = rows[0]
    check("Transaction ID TXN-000012, Rent, Completed, property + address, no agreement (Amit has none), receipt available", x["transaction_id"] == "TXN-000012" and TX.match(x["transaction_id"]) and x["payment_type"] == "rent" and x["payment_type_label"] == "Rent"
          and x["status"] == "completed" and x["property_title"].startswith("Antriksh Heights") and "Andheri West" in x["property_address"] and x["agreement_ref"] is None and x["receipt_available"] is True)
    check("transaction IDs are unique and derived from the row id", len({y["transaction_id"] for y in rows}) == 12 and all(y["transaction_id"] == f"TXN-{y['id']:06d}" for y in rows))
    check("payment_day is a plain YYYY-MM-DD; payment_date kept for compatibility", all(re.fullmatch(r"\d{4}-\d{2}-\d{2}", y["payment_day"]) and "T" in y["payment_date"] for y in rows))
    su = requests.get(S, headers=amit).json()
    c = su["properties"][0]
    check("summary: current month, Antriksh Heights rent ₹48,000, nothing paid, outstanding ₹48,000, status 'unpaid'", su["period"] == today[:7] and c["title"].startswith("Antriksh") and c["current"] == {"month": today[:7], "rent_due": 48000.0, "paid": 0, "pending": 0, "balance": 48000.0, "status": "unpaid"}, c["current"])
    check("summary: last payment = TXN-000012 on 2025-12-01 (₹48,000); totals 12 / 12 / ₹5,76,000", c["last_payment"]["transaction_id"] == "TXN-000012" and c["last_payment"]["payment_day"] == "2025-12-01" and su["totals"] == {"transactions": 12, "completed": 12, "total_paid": 576000.0, "pending_amount": 0}, su["totals"])

    print("\n== 3. A tenant only sees their OWN transactions ==")
    sn = requests.get(P, headers=sneha).json()
    check("Sneha's list = her 12 (tenant 6), no overlap with Amit's", len(sn) == 12 and {y["tenant_id"] for y in sn} == {6} and not ({y["id"] for y in sn} & {y["id"] for y in rows}))
    check("asking for another tenant's property_id returns nothing (Amit -> property 2)", requests.get(P, headers=amit, params={"property_id": 2}).json() == [])
    check("Amit's summary contains only his property", [p["property_id"] for p in requests.get(S, headers=amit).json()["properties"]] == [1] and [p["property_id"] for p in requests.get(S, headers=rahul).json()["properties"]] == [3])
    sn_id, am_id = sn[0]["id"], rows[0]["id"]
    check("Amit cannot download Sneha's receipt (404) but can download his own (200 PDF)", requests.get(f"{API}/reports/receipt/{sn_id}/pdf", headers=amit).status_code == 404 and requests.get(f"{API}/reports/receipt/{am_id}/pdf", headers=amit).headers.get("content-type") == "application/pdf")
    rc = requests.get(f"{API}/reports/receipt/{am_id}/pdf", headers=amit)
    check("Amit's receipt opens and names Amit Kumar, ₹48,000, Antriksh address, December 2025", rc.content[:4] == b"%PDF" and all(w in pdf_text(rc.content) for w in ("Amit Kumar", "48,000", "A-304", "2025-12")), pdf_text(rc.content)[:100])
    rm = requests.get(f"{API}/reports/receipt/{am_id}/pdf", headers=mgr)
    check("manager can fetch it, and it names the TENANT (not the manager)", rm.status_code == 200 and "Amit Kumar" in pdf_text(rm.content) and "Rajesh" not in pdf_text(rm.content))
    check("owner of that property (Vikram) 200; another owner (Priya) 404; unknown id 404", requests.get(f"{API}/reports/receipt/{am_id}/pdf", headers=owner).status_code == 200 and requests.get(f"{API}/reports/receipt/{am_id}/pdf", headers=priya).status_code == 404 and requests.get(f"{API}/reports/receipt/999999/pdf", headers=amit).status_code == 404)

    print("\n== 4. Recording payments (no gateway - a record) ==")
    made = requests.post(P, headers=amit, json={"property_id": 1, "amount": 1234.5, "payment_type": "maintenance", "payment_date": today, "notes": "PAYTEST"})
    check("201: maintenance charge recorded, completed, dated today", made.status_code == 201 and made.json()["payment_type"] == "maintenance" and made.json()["status"] == "completed" and made.json()["amount"] == 1234.5, made.text[:110])
    top = requests.get(P, headers=amit).json()[0]
    check("it appears at the top of the history with its own Transaction ID, purpose label and today's date", top["id"] == made.json()["id"] and top["payment_type_label"] == "Maintenance charge" and top["payment_day"] == today and TX.match(top["transaction_id"]))
    check("a maintenance charge does NOT count towards the month's rent", requests.get(S, headers=amit).json()["properties"][0]["current"]["paid"] == 0)
    requests.post(P, headers=amit, json={"property_id": 1, "amount": 20000, "payment_date": today, "notes": "PAYTEST"})
    cur = requests.get(S, headers=amit).json()["properties"][0]["current"]
    check("rent ₹20,000 -> 'partial': paid 20,000, outstanding 28,000", cur["status"] == "partial" and cur["paid"] == 20000 and cur["balance"] == 28000, cur)
    requests.post(P, headers=amit, json={"property_id": 1, "amount": 28000, "payment_date": today, "notes": "PAYTEST"})
    cur = requests.get(S, headers=amit).json()["properties"][0]["current"]
    check("rent ₹28,000 more -> 'paid': outstanding 0", cur["status"] == "paid" and cur["balance"] == 0 and cur["paid"] == 48000, cur)
    requests.post(P, headers=amit, json={"property_id": 1, "amount": 5000, "payment_date": today, "notes": "PAYTEST"})
    cur = requests.get(S, headers=amit).json()["properties"][0]["current"]
    check("overpaying never shows a negative outstanding (0), status stays 'paid'", cur["status"] == "paid" and cur["balance"] == 0 and cur["paid"] == 53000, cur)
    tk = requests.post(P, headers=amit, json={"property_id": 1, "amount": 100, "payment_date": "2026-08-31T20:30:00Z", "notes": "PAYTEST"}).json()
    check("a 01 Sep 02:00 IST payment is stored as 01 Sep (local day) and counts for September", tk["month"] == "2026-09" and next(y for y in requests.get(P, headers=amit).json() if y["id"] == tk["id"])["payment_day"] == "2026-09-01")
    check("history grew by exactly the payments I made; the 12 original rows are untouched", len(requests.get(P, headers=amit).json()) == 12 + 5 and pg(ORIG) == before_hash)
    bad = {"amount 0": {"amount": 0}, "negative amount": {"amount": -50}, "amount above 1 crore": {"amount": 10_000_001}, "amount not a number": {"amount": "lots"}, "missing amount": {"amount": None},
           "unknown type": {"payment_type": "bribe"}, "note over 500 characters": {"notes": "x" * 501}, "future date": {"payment_date": "2099-01-01"}, "bad month": {"month": "2026-13"}}
    for label, over in bad.items():
        body = {"property_id": 1, "amount": 100, "payment_date": today, **over}
        if over.get("amount", 1) is None: body.pop("amount")
        rr = requests.post(P, headers=amit, json=body)
        check(f"{label} -> 422", rr.status_code == 422, rr.status_code)
    check("recording for a property that is NOT theirs (Sneha's #2) or that doesn't exist -> 403", requests.post(P, headers=amit, json={"property_id": 2, "amount": 100, "payment_date": today}).status_code == 403 and requests.post(P, headers=amit, json={"property_id": 99999, "amount": 100, "payment_date": today}).status_code == 403)
    check("nothing invalid was stored", len(requests.get(P, headers=amit).json()) == 17)
    pg("delete from payments where notes='PAYTEST'")
    check("test payments removed; Amit is back to 12", len(requests.get(P, headers=amit).json()) == 12)

    print("\n== 5. Tenant with a property but NO transactions ==")
    pg("insert into users (email, full_name, hashed_password, role, is_active) select 'ptest_empty@example.in', 'Empty Tenant', hashed_password, 'TENANT', true from users where id=5; insert into users (email, full_name, hashed_password, role, is_active) select 'ptest_noprop@example.in', 'Nohome Tenant', hashed_password, 'TENANT', true from users where id=5;")
    ids = dict(x.split("|") for x in pg("select email||'|'||id from users where email like 'ptest_%'").splitlines())
    empty_id, noprop_id = int(ids["ptest_empty@example.in"]), int(ids["ptest_noprop@example.in"])
    pg(f"update properties set tenant_id={empty_id}, is_available=false where id=6;")
    empty, noprop = login("ptest_empty@example.in"), login("ptest_noprop@example.in")
    check("history is an empty list (200)", requests.get(P, headers=empty).status_code == 200 and requests.get(P, headers=empty).json() == [])
    e = requests.get(S, headers=empty).json()
    check("summary: Bandra West rent ₹65,000 fully outstanding, no last payment, all totals zero", e["properties"][0]["title"] == "Bandra West 2BHK" and e["properties"][0]["current"]["balance"] == 65000.0 and e["properties"][0]["current"]["status"] == "unpaid" and e["properties"][0]["last_payment"] is None and e["totals"] == {"transactions": 0, "completed": 0, "total_paid": 0, "pending_amount": 0}, e["totals"])
    print("== 6. Tenant with NO property ==")
    n = requests.get(S, headers=noprop).json()
    check("summary: no properties, zero totals; history empty", n["properties"] == [] and n["totals"]["transactions"] == 0 and requests.get(P, headers=noprop).json() == [])
    check("cannot record a payment against any property (403)", requests.post(P, headers=noprop, json={"property_id": 6, "amount": 100, "payment_date": today}).status_code == 403)

    print("\n== 7. Multiple transactions, every status ==")
    pg(f"""insert into payments (amount, payment_date, status, month, payment_type, notes, tenant_id, property_id) values
      (65000, '2026-07-05 06:30:00+00', 'COMPLETED', '2026-07', 'rent', 'PAYTEST', {empty_id}, 6),
      (65000, '2026-08-04 06:30:00+00', 'COMPLETED', '2026-08', 'rent', 'PAYTEST', {empty_id}, 6),
      (130000, '2026-06-01 06:30:00+00', 'COMPLETED', '2026-06', 'security_deposit', 'PAYTEST', {empty_id}, 6),
      (4200, '2026-09-10 06:30:00+00', 'COMPLETED', '2026-09', 'utility', 'PAYTEST', {empty_id}, 6),
      (65000, '2026-09-12 06:30:00+00', 'PENDING', '{today[:7]}', 'rent', 'PAYTEST', {empty_id}, 6),
      (65000, '2026-09-13 06:30:00+00', 'FAILED', '{today[:7]}', 'rent', 'PAYTEST', {empty_id}, 6),
      (1500, '2026-09-14 06:30:00+00', 'COMPLETED', '2026-09', 'late_fee', 'PAYTEST', {empty_id}, 6);""")
    lst = requests.get(P, headers=empty).json()
    check("7 transactions, newest first, mixed statuses and purposes", len(lst) == 7 and [x["payment_day"] for x in lst] == sorted([x["payment_day"] for x in lst], reverse=True) and {x["status"] for x in lst} == {"completed", "pending", "failed"} and {x["payment_type"] for x in lst} == {"rent", "security_deposit", "utility", "late_fee"}, [x["payment_day"] for x in lst])
    check("receipt only for completed payments; pending/failed -> receipt_available false and 409 on request", all(x["receipt_available"] == (x["status"] == "completed") for x in lst)
          and all(requests.get(f"{API}/reports/receipt/{x['id']}/pdf", headers=empty).status_code == 409 for x in lst if x["status"] != "completed") and all(requests.get(f"{API}/reports/receipt/{x['id']}/pdf", headers=empty).status_code == 200 for x in lst if x["status"] == "completed"))
    su = requests.get(S, headers=empty).json()
    check("summary: pending ₹65,000 shown separately, failed ignored; completed rent this month = 0, outstanding still 65,000", su["properties"][0]["current"]["pending"] == 65000 and su["properties"][0]["current"]["paid"] == 0 and su["properties"][0]["current"]["balance"] == 65000)
    check("summary totals: 7 transactions, 5 completed, ₹65k+65k+1.3L+4.2k+1.5k = ₹2,65,700 paid, pending ₹65,000", su["totals"] == {"transactions": 7, "completed": 5, "total_paid": 265700.0, "pending_amount": 65000.0}, su["totals"])
    check("last payment = the latest COMPLETED one (late fee, 14 Sep), not the pending/failed", su["properties"][0]["last_payment"]["payment_type"] == "late_fee" and su["properties"][0]["last_payment"]["payment_day"] == "2026-09-14")
    check("limit works and is bounded (5 rows; 0 and 1001 -> 422)", len(requests.get(P, headers=empty, params={"limit": 5}).json()) == 5 and requests.get(P, headers=empty, params={"limit": 0}).status_code == 422 and requests.get(P, headers=empty, params={"limit": 1001}).status_code == 422)

    print("\n== 8. Agreement reference (only where an approved rental application exists) ==")
    app_id = mongo(f'const r=d.rental_applications.insertOne({{tenant_id:{empty_id}, property_id:6, tenant_name:"Empty Tenant", status:"approved", applied_at:new Date().toISOString()}}); print(r.insertedId.toString())')
    lst = requests.get(P, headers=empty).json()
    want = "LEASE-" + app_id[-6:].upper()
    check("rows for that property show the agreement reference", all(x["agreement_ref"] == want for x in lst) and requests.get(S, headers=empty).json()["properties"][0]["agreement_ref"] == want, want)
    mongo(f'd.rental_applications.deleteMany({{tenant_id:{empty_id}}})')
    check("without an approved application there is none (null)", all(x["agreement_ref"] is None for x in requests.get(P, headers=empty).json()))

    print("\n== 9. Nothing else changed ==")
    check("the 60 original payment rows are unchanged", pg(ORIG) == before_hash)
    rcx = requests.get(f"{API}/financial/rent-collection", headers=mgr)
    check("Manager rent collection still works (other module untouched)", rcx.status_code == 200 and rcx.json()["summary"]["total"] == 6, rcx.json()["summary"])
finally:
    pg("delete from payments where notes='PAYTEST';")
    pg(f"update properties set tenant_id=NULL, is_available=true where id=6;")
    pg("delete from users where email like 'ptest_%';")
    mongo('d.rental_applications.deleteMany({tenant_name:"Empty Tenant"})')
    mongo('d.notifications.deleteMany({title:"Payment recorded", created_at:{$gte:"'+T0+'"}})')
    print(f"\ncleanup: payments {pg('select count(*) from payments')} (60 originals) | temp users {pg('select count(*) from users where email like chr(112)||chr(116)||chr(101)||chr(115)||chr(116)||chr(95)||chr(37)')} | Bandra West tenant/available: {pg('select coalesce(tenant_id::text, chr(110)||chr(117)||chr(108)||chr(108))||chr(47)||is_available from properties where id=6')} (was {orig_p6})")

print(f"\n{sum(results)}/{len(results)} checks passed")
sys.exit(0 if all(results) else 1)
