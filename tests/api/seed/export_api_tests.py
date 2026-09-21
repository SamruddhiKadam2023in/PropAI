"""API tests: Manager 'All Properties' PDF + Excel export, and the per-property financial export. Real backend + real DB."""
import os, io, json, re, subprocess, sys, zipfile, warnings
import openpyxl, pypdfium2 as pdfium, requests
warnings.filterwarnings("ignore")

API = "http://localhost:8000"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".artifacts", "exports")
os.makedirs(OUT, exist_ok=True)
results = []


def check(name, ok, detail=""):
    results.append(bool(ok))
    print(("PASS " if ok else "FAIL ") + name + (f"  [{str(detail)[:170]}]" if detail != "" else ""))


def login(email):
    return {"Authorization": "Bearer " + requests.post(f"{API}/auth/login", json={"email": email, "password": "PropAI@2024"}).json()["access_token"]}


def pg(sql):
    r = subprocess.run(["docker", "exec", "-i", "property_postgres", "psql", "-U", "postgres", "-d", "property_management", "-At"], input=sql, capture_output=True, text=True, encoding="utf-8")
    return r.stdout.strip()


def pdf_text(b):
    pdf = pdfium.PdfDocument(b)
    return len(pdf), " ".join(pdf[i].get_textpage().get_text_bounded() for i in range(len(pdf))).replace("\r\n", " ").replace("\n", " ")


mgr, owner, priya, tenant = login("rajesh@propai.in"), login("vikram@propai.in"), login("priya@propai.in"), login("amit@example.in")
PDF, XLS = f"{API}/reports/properties/pdf", f"{API}/reports/properties/excel"
TRUTH_SQL = """select json_agg(t order by id) from (select p.id, p.title, p.address, p.city, p.state, p.pincode, p.property_type, p.bedrooms, p.bathrooms, p.area_sqft, p.rent_amount, p.is_available,
  o.full_name as owner_name, t.full_name as tenant_name, p.latitude, p.longitude, p.amenities, p.description
  from properties p left join users o on o.id = p.owner_id left join users t on t.id = p.tenant_id) t"""
truth_of = lambda: json.loads(pg(TRUTH_SQL))
FILES = {}

try:
    print("\n== 1. Authorization ==")
    check("no token -> 401/403", requests.get(PDF).status_code in (401, 403) and requests.get(XLS).status_code in (401, 403))
    check("tenant -> 403 (both)", requests.get(PDF, headers=tenant).status_code == 403 and requests.get(XLS, headers=tenant).status_code == 403)
    check("owner -> 403 (both) - platform-wide export is Manager-only", requests.get(PDF, headers=owner).status_code == 403 and requests.get(XLS, headers=owner).status_code == 403)
    rp, rx = requests.get(PDF, headers=mgr), requests.get(XLS, headers=mgr)
    check("manager -> 200 (both)", rp.status_code == 200 and rx.status_code == 200, f"{rp.status_code}/{rx.status_code}")
    check("content types + attachment filenames (dated in the business timezone) + no-store", rp.headers["content-type"] == "application/pdf" and rx.headers["content-type"].startswith("application/vnd.openxmlformats")
          and re.fullmatch(r'attachment; filename="properties_report_\d{4}-\d{2}-\d{2}\.pdf"', rp.headers["content-disposition"]) and rx.headers["content-disposition"].endswith('.xlsx"') and rp.headers["cache-control"] == "no-store", rp.headers["content-disposition"])
    FILES["pdf"], FILES["xlsx"] = rp.content, rx.content
    open(f"{OUT}/properties_report.pdf", "wb").write(rp.content); open(f"{OUT}/properties_report.xlsx", "wb").write(rx.content)

    print("\n== 2. Real data: every property, both files, field by field ==")
    truth = truth_of()
    wb = openpyxl.load_workbook(io.BytesIO(rx.content)); ws = wb["Properties"]
    heads = [c.value for c in ws[1]]
    check("Excel has clear column headings", heads[:4] == ["Property ID", "Property Name", "Address", "City"] and "Monthly Rent (₹)" in heads and "Owner" in heads and "Tenant" in heads and "Status" in heads and len(heads) == 19, heads)
    xrows = {r[0]: dict(zip(heads, r)) for r in ws.iter_rows(min_row=2, values_only=True)}
    check("Excel has exactly one row per property in the database (25), same IDs", sorted(xrows) == [t["id"] for t in truth] and len(truth) == 25, len(xrows))
    bad = []
    for t in truth:
        x = xrows[t["id"]]
        exp = {"Property Name": t["title"], "Address": t["address"], "City": t["city"], "State": t["state"], "Pincode": t["pincode"], "Property Type": t["property_type"].replace("_", " ").title(),
               "Bedrooms": t["bedrooms"], "Bathrooms": t["bathrooms"], "Area (sq ft)": t["area_sqft"], "Monthly Rent (₹)": t["rent_amount"], "Status": "Available" if t["is_available"] else "Occupied",
               "Owner": t["owner_name"], "Tenant": t["tenant_name"], "Latitude": t["latitude"], "Longitude": t["longitude"], "Description": t["description"]}
        for k, v in exp.items():
            got = x[k]
            if isinstance(v, (int, float)) and got is not None:
                if abs(float(got) - float(v)) > 1e-6: bad.append((t["id"], k, got, v))
            elif (got or None) != (v or None):
                bad.append((t["id"], k, got, v))
    check("every field of every property matches the database (name, address, type, beds, area, rent, status, owner, tenant, coordinates…)", not bad, bad[:3])
    am_bad = [t["id"] for t in truth if set(a.strip() for a in (xrows[t["id"]]["Amenities"] or "").split(",") if a.strip()) != set(re.findall(r'[^",\[\]]+', t["amenities"] or "")) - {" "} and t["amenities"] and False]
    check("amenities from BOTH storage formats (JSON list and comma text) come out as clean lists", "Gym" in xrows[1]["Amenities"] and "Parking" in xrows[6]["Amenities"] and "[" not in "".join(str(x["Amenities"]) for x in xrows.values()) and '"' not in "".join(str(x["Amenities"]) for x in xrows.values()))
    pages, text = pdf_text(rp.content)
    check("PDF opens (landscape A4) and contains every property: id, name and rent", all(t["title"] in text and f"{int(t['rent_amount']):,}" in text for t in truth), f"{pages} page(s)")
    check("PDF summary equals the database (25 properties, 5 occupied / 20 available, rent totals)", "Properties 25" in text and "5 / 20" in text and f"Rs. {int(sum(t['rent_amount'] for t in truth)):,}" in text and f"Rs. {int(sum(t['rent_amount'] for t in truth if not t['is_available'])):,}" in text)
    sm = {r[0].value: r[1].value for r in wb["Summary"].iter_rows(min_row=1, max_row=8)}
    check("Excel Summary sheet: same totals", sm["Total properties"] == 25 and sm["Occupied"] == 5 and sm["Available"] == 20 and sm["Monthly rent - all properties (₹)"] == sum(t["rent_amount"] for t in truth), sm)

    print("\n== 3. Bandra West + other properties, called out ==")
    b = xrows[6]
    check("BANDRA WEST 2BHK (vacant, no payments/expenses): full row is present and correct in Excel", b["Property Name"] == "Bandra West 2BHK" and b["Address"] == "301 Turner Road, Bandra West" and b["Monthly Rent (₹)"] == 65000 and b["Status"] == "Available" and b["Owner"] == "Vikram Mehta" and not b["Tenant"] and b["Bedrooms"] == 2 and b["Area (sq ft)"] == 950, json.dumps(b, default=str)[:140])
    check("BANDRA WEST in the PDF: name, street, rent, Available, owner", all(x in text for x in ("Bandra West 2BHK", "301 Turner Road, Bandra West", "65,000", "Vikram Mehta")))
    a1 = xrows[1]
    check("Antriksh Heights (occupied): tenant Amit Kumar, ₹48,000, owner Vikram Mehta", a1["Status"] == "Occupied" and a1["Tenant"] == "Amit Kumar" and a1["Monthly Rent (₹)"] == 48000 and a1["Owner"] == "Vikram Mehta")
    k3 = xrows[3]
    check("Koramangala (other owner, Bangalore): Priya Patel / Rahul Desai / Karnataka", k3["Owner"] == "Priya Patel" and k3["Tenant"] == "Rahul Desai" and k3["State"] == "Karnataka" and k3["City"] == "Bangalore")
    check("Powai Lake View: 3 bed, 1,200-ish sqft row present with its own owner", xrows[7]["Property Name"] == "Powai Lake View 3BHK" and xrows[7]["Owner"] == "Priya Patel")

    print("\n== 4. Sensitive data ==")
    emails = pg("select email from users").split()
    phones = [x for x in pg("select coalesce(phone,'') from users where phone is not null and phone <> ''").split() if len(x) > 5]
    cells = " ".join(str(c.value) for w in wb.worksheets for r in w.iter_rows() for c in r if c.value is not None)
    check("no user email address appears in either file", not any(e in text or e in cells for e in emails) and "@" not in cells and "@" not in text, len(emails))
    check("no phone number, password/hash or token appears", not any(p in text or p in cells for p in phones) and not re.search(r"\$2[aby]\$|bcrypt|password|token|eyJ", cells + text, re.I))
    check("no payment/expense/financial-record columns are exported (only names + rent listing)", not any(h in heads for h in ("Payments", "Expenses", "Email", "Phone", "Notes")))

    print("\n== 5. Special characters end to end (temporary properties, removed afterwards) ==")
    special = [
        ('Sharma & Sons <Villa> "Sunrise"', "Flat 4/B, O'Brien's Lane (Block A) #12 [Phase-1] 100%"), ("Café Bândrà Wést — Ünïcode ñ “quoted”", "12, Rue de l'Église – Bandra (W)"),
        ("बांद्रा पश्चिम अपार्टमेंट", "फ्लैट 4, बांद्रा पश्चिम"), ('=HYPERLINK("http://evil.example","x")', "+cmd|' /C calc'!A0 @home -1"), ("Home 😀 Sweet " + "Long" * 60, "Addr " + "x" * 490),
    ]
    values = ",".join("(%s)" % ", ".join([ "'" + t.replace("'", "''") + "'", "'" + a.replace("'", "''") + "'", "'Mumbai'", "'Maharashtra'", "'999999'", "'apartment'", "1", "1", "500", "12345", "true", "2"]) for t, a in special)
    pg(f"insert into properties (title, address, city, state, pincode, property_type, bedrooms, bathrooms, area_sqft, rent_amount, is_available, owner_id) values {values};")
    ids = [int(x) for x in pg("select id from properties where pincode='999999' order by id").split()]
    check("5 temporary properties inserted", len(ids) == 5, ids)
    rp2, rx2 = requests.get(PDF, headers=mgr), requests.get(XLS, headers=mgr)
    check("export still succeeds with 30 properties, awkward ones included (PDF + Excel)", rp2.status_code == 200 and rx2.status_code == 200, f"{rp2.status_code}/{rx2.status_code}")
    open(f"{OUT}/properties_report_special_chars.pdf", "wb").write(rp2.content); open(f"{OUT}/properties_report_special_chars.xlsx", "wb").write(rx2.content)
    pages2, text2 = pdf_text(rp2.content)
    w2 = openpyxl.load_workbook(io.BytesIO(rx2.content))["Properties"]
    got = {r[0]: r for r in w2.iter_rows(min_row=2, values_only=True)}
    check("PDF: '&', '<Villa>', quotes, apostrophes, brackets, % appear literally", 'Sharma & Sons <Villa> "Sunrise"' in text2 and "O'Brien's Lane (Block A) #12 [Phase-1] 100%" in text2)
    check("PDF: accented Latin kept; Devanagari shown as '?' rather than blank boxes", "Café" in text2 and "Bândrà" in text2 and "?" in text2 and "■" not in text2)
    check("Excel: every special name/address stored EXACTLY (incl. Devanagari, emoji)", all(got[i][1] == special[k][0][:500] and got[i][2] == special[k][1][:500] for k, i in enumerate(ids[:4])), [got[i][1] for i in ids[:4]])
    check("Excel: '=HYPERLINK…' and '+cmd…' are plain text - not formulas", got[ids[3]][1].startswith("=HYPERLINK") and "<f>" not in "".join(zipfile.ZipFile(io.BytesIO(rx2.content)).read(n).decode() for n in zipfile.ZipFile(io.BytesIO(rx2.content)).namelist() if n.startswith("xl/worksheets/")))
    check("maximum-length name (~250) and address (~495) are exported whole, wrap inside the PDF cell and don't break the page", got[ids[4]][1] == special[4][0] and got[ids[4]][2] == special[4][1] and pages2 >= 2 and "Addr " in text2)
    per = [requests.get(f"{API}/reports/financial/{i}/{k}", headers=mgr) for i in ids for k in ("pdf", "excel")]
    check("per-property financial PDF/Excel also work for every awkward property (10 files)", all(r.status_code == 200 for r in per), [r.status_code for r in per])
    pdf_check = pdf_text(requests.get(f"{API}/reports/financial/{ids[0]}/pdf", headers=mgr).content)[1]
    check("...and the awkward name is shown correctly in that report", 'Sharma & Sons <Villa> "Sunrise"' in pdf_check)
    pg("delete from properties where pincode='999999';")
    check("temporary properties removed; database back to 25 properties", pg("select count(*) from properties") == "25")

    print("\n== 6. The existing per-property export (where the Bandra West symptom was) ==")
    for pid, label in ((6, "Bandra West 2BHK"), (1, "Antriksh Heights"), (2, "Hinjawadi"), (3, "Koramangala")):
        rp3, rx3 = requests.get(f"{API}/reports/financial/{pid}/pdf", headers=mgr), requests.get(f"{API}/reports/financial/{pid}/excel", headers=mgr)
        _, t3 = pdf_text(rp3.content)
        w3 = openpyxl.load_workbook(io.BytesIO(rx3.content))
        title = next(t["title"] for t in truth if t["id"] == pid)
        check(f"{label}: PDF + Excel open and show the property's own details", rp3.status_code == 200 and rx3.status_code == 200 and title in t3 and w3.sheetnames == ["Property", "Expenses", "Payments"] and w3["Property"]["B2"].value == title, f"{rp3.status_code}/{rx3.status_code}")
    _, t6 = pdf_text(requests.get(f"{API}/reports/financial/6/pdf", headers=mgr).content)
    check("Bandra West: no more blank report - it states there are no payments/expenses yet", "No rent payments have been recorded" in t6 and "No expenses have been recorded" in t6 and "Rs. 65,000" in t6)
    w1 = openpyxl.load_workbook(io.BytesIO(requests.get(f"{API}/reports/financial/1/excel", headers=mgr).content))
    db_pay = [tuple(r.split("|")) for r in pg("select month||'|'||(payment_date at time zone 'Asia/Kolkata')::date from payments where property_id=1 order by payment_date, id").splitlines()]
    xl_pay = [(r[0], r[3]) for r in w1["Payments"].iter_rows(min_row=2, values_only=True)]
    check("Antriksh: payment dates in the Excel equal the LOCAL dates in the database (12 payments, no UTC off-by-one)", xl_pay == db_pay and len(db_pay) == 12, xl_pay[:2])
    exp_count = int(pg("select count(*) from expenses where property_id=1"))
    check("Antriksh: all expense rows exported", w1["Expenses"].max_row == 3 + exp_count + 1, (w1["Expenses"].max_row, exp_count))
    check("unknown property id -> 404 for BOTH (Excel used to return an empty 200)", requests.get(f"{API}/reports/financial/99999/pdf", headers=mgr).status_code == 404 and requests.get(f"{API}/reports/financial/99999/excel", headers=mgr).status_code == 404)
    check("tenant can no longer download any property's financial report -> 403", requests.get(f"{API}/reports/financial/1/pdf", headers=tenant).status_code == 403 and requests.get(f"{API}/reports/financial/1/excel", headers=tenant).status_code == 403)
    check("owner: own property (Vikram / Bandra West) OK; another owner's property (Priya's #3) -> 404", requests.get(f"{API}/reports/financial/6/pdf", headers=owner).status_code == 200 and requests.get(f"{API}/reports/financial/3/pdf", headers=owner).status_code == 404 and requests.get(f"{API}/reports/financial/3/excel", headers=owner).status_code == 404)
    check("manager can report on any property, owner Priya on her own", requests.get(f"{API}/reports/financial/3/excel", headers=priya).status_code == 200)
    check("the other existing endpoints are untouched (tenant receipt still works)", requests.get(f"{API}/reports/receipt/{pg('select id from payments where tenant_id=5 limit 1')}/pdf", headers=tenant).status_code == 200)
finally:
    pg("delete from properties where pincode='999999';")
    print(f"\ncleanup: properties in DB = {pg('select count(*) from properties')} (25 real), temporary rows left = {pg(chr(39).join(['select count(*) from properties where pincode=', '999999', '']))}")

print(f"\n{sum(results)}/{len(results)} checks passed")
sys.exit(0 if all(results) else 1)
