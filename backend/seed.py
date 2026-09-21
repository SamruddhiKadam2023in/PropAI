"""
Realistic seed — PropAI: Indian property management scenario
5 properties | 3 owners | 5 tenants | 1 manager | 12 months data
Run: docker exec property_backend python seed.py
"""
import asyncio
import random
import sys
from datetime import datetime, date

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy import text

from app.config import settings
from app.database import Base
from app.models.user import User, UserRole
from app.models.property_model import Property
from app.models.financial import Payment, Expense, PaymentStatus, ExpenseCategory
from app.utils.security import hash_password

PASSWORD = "PropAI@2024"

# ── Users ─────────────────────────────────────────────────────────────────────
MANAGER = {"full_name": "Rajesh Sharma",  "email": "rajesh@propai.in",  "phone": "9820111111"}

OWNERS = [
    {"full_name": "Vikram Mehta",  "email": "vikram@propai.in",  "phone": "9820222222"},
    {"full_name": "Priya Patel",   "email": "priya@propai.in",   "phone": "9820333333"},
    {"full_name": "Suresh Iyer",   "email": "suresh@propai.in",  "phone": "9820444444"},
]

TENANTS = [
    {"full_name": "Amit Kumar",  "email": "amit@example.in",  "phone": "9870111111"},
    {"full_name": "Sneha Singh", "email": "sneha@example.in", "phone": "9870222222"},
    {"full_name": "Rahul Desai", "email": "rahul@example.in", "phone": "9870333333"},
    {"full_name": "Anita Rao",   "email": "anita@example.in", "phone": "9870444444"},
    {"full_name": "Kiran Nair",  "email": "kiran@example.in", "phone": "9870555555"},
]

# ── Properties with 12-month realistic expense history (Jan–Dec 2025) ─────────
# Electricity is higher Apr–Jun (summer AC load)
PROPERTIES = [
    {
        "title":         "Antriksh Heights — 2BHK",
        "address":       "A-304, Antriksh Heights, New Link Road, Andheri West",
        "city":          "Mumbai",
        "state":         "Maharashtra",
        "pincode":       "400053",
        "property_type": "apartment",
        "bedrooms":      2,
        "bathrooms":     2,
        "area_sqft":     950.0,
        "rent_amount":   48000.0,
        "latitude":      19.1363,
        "longitude":     72.8296,
        "amenities":     '["Gym", "Swimming Pool", "24x7 Security", "2 Covered Parking"]',
        "description":   "Spacious 2BHK in prime Andheri West, 5 min walk from Versova Metro Station.",
        "owner_idx":     0,
        "tenant_idx":    0,
        "elec":   [1800, 1750, 2100, 2800, 3200, 2900, 2400, 2200, 1900, 1750, 1800, 2050],
        "water":  [310,  305,  325,  355,  385,  365,  345,  330,  315,  305,  295,  310],
        "gas":    [920,  870,  810,  710,  660,  690,  760,  810,  860,  910,  960,  1010],
        "net":    [999,  999,  999,  999,  999,  999,  999,  999,  999,  999,  999,  999],
        "maint":  [2000, 2000, 1500, 2500, 1500, 2000, 1500, 2000, 2500, 1500, 2000, 3000],
        "elec_vendor": "Tata Power",
        "water_vendor": "MCGM Water",
        "gas_vendor": "Mahanagar Gas Ltd",
        "net_vendor": "Jio Fiber",
        "maint_vendor": "Antriksh CHS",
    },
    {
        "title":         "Hinjawadi Tech Residency — 1BHK",
        "address":       "B-12, Tech Park Residency, Phase 1, Hinjawadi",
        "city":          "Pune",
        "state":         "Maharashtra",
        "pincode":       "411057",
        "property_type": "apartment",
        "bedrooms":      1,
        "bathrooms":     1,
        "area_sqft":     620.0,
        "rent_amount":   18500.0,
        "latitude":      18.5912,
        "longitude":     73.7389,
        "amenities":     '["Gym", "Cafeteria", "24x7 Security", "Wi-Fi Lobby"]',
        "description":   "Modern 1BHK studio near Infosys & Wipro campuses. Ideal for IT professionals.",
        "owner_idx":     0,
        "tenant_idx":    1,
        "elec":   [820,  790,  960,  1420, 1620, 1460, 1210, 1110, 910,  810,  830,  890],
        "water":  [185,  185,  205,  225,  255,  235,  215,  205,  195,  185,  178,  185],
        "gas":    [460,  440,  410,  360,  325,  345,  385,  410,  440,  465,  495,  515],
        "net":    [799,  799,  799,  799,  799,  799,  799,  799,  799,  799,  799,  799],
        "maint":  [800,  800,  600,  1000, 600,  800,  600,  800,  1000, 600,  800,  1200],
        "elec_vendor": "MSEDCL",
        "water_vendor": "PMC Water",
        "gas_vendor": "Adani Gas",
        "net_vendor": "Airtel Xstream",
        "maint_vendor": "Tech Park Society",
    },
    {
        "title":         "Koramangala Premium — 3BHK",
        "address":       "402, Brigade Residency, 8th Block, Koramangala",
        "city":          "Bangalore",
        "state":         "Karnataka",
        "pincode":       "560095",
        "property_type": "apartment",
        "bedrooms":      3,
        "bathrooms":     3,
        "area_sqft":     1450.0,
        "rent_amount":   55000.0,
        "latitude":      12.9279,
        "longitude":     77.6271,
        "amenities":     '["Club House", "Pool", "Gym", "Tennis Court", "3 Parking", "Power Backup"]',
        "description":   "Premium 3BHK in Koramangala, walking distance to Amazon & Flipkart offices.",
        "owner_idx":     1,
        "tenant_idx":    2,
        "elec":   [2820, 2710, 3210, 4520, 5230, 4820, 3920, 3520, 3010, 2720, 2830, 3120],
        "water":  [455,  455,  485,  525,  585,  555,  515,  495,  475,  455,  445,  455],
        "gas":    [1210, 1160, 1110, 955,  905,  955,  1055, 1110, 1160, 1210, 1285, 1360],
        "net":    [1499, 1499, 1499, 1499, 1499, 1499, 1499, 1499, 1499, 1499, 1499, 1499],
        "maint":  [3500, 3500, 2500, 4500, 2500, 3500, 2500, 3500, 4500, 2500, 3500, 5000],
        "elec_vendor": "BESCOM",
        "water_vendor": "BWSSB",
        "gas_vendor": "IGL Gas",
        "net_vendor": "ACT Fibernet",
        "maint_vendor": "Brigade Society",
    },
    {
        "title":         "Thane Skyline — 2BHK",
        "address":       "C-805, Skyline Tower, Majiwada Junction, Thane West",
        "city":          "Mumbai",
        "state":         "Maharashtra",
        "pincode":       "400601",
        "property_type": "apartment",
        "bedrooms":      2,
        "bathrooms":     2,
        "area_sqft":     870.0,
        "rent_amount":   32000.0,
        "latitude":      19.2183,
        "longitude":     72.9781,
        "amenities":     '["24x7 Security", "Covered Parking", "Garden", "CCTV"]',
        "description":   "Well-connected 2BHK in Thane West, 10 min from Thane Station.",
        "owner_idx":     1,
        "tenant_idx":    3,
        "elec":   [1410, 1360, 1710, 2310, 2710, 2410, 2010, 1810, 1560, 1390, 1410, 1560],
        "water":  [255,  255,  275,  305,  335,  315,  295,  280,  265,  255,  248,  255],
        "gas":    [710,  675,  645,  565,  525,  550,  605,  645,  675,  715,  755,  795],
        "net":    [799,  799,  799,  799,  799,  799,  799,  799,  799,  799,  799,  799],
        "maint":  [1500, 1500, 1000, 2000, 1000, 1500, 1000, 1500, 2000, 1000, 1500, 2000],
        "elec_vendor": "Tata Power",
        "water_vendor": "TMC Water",
        "gas_vendor": "Mahanagar Gas Ltd",
        "net_vendor": "Jio Fiber",
        "maint_vendor": "Skyline CHS",
    },
    {
        "title":         "Wakad Greens — 2BHK",
        "address":       "D-202, Wakad Greens Society, Wakad-Bhosari Road, Wakad",
        "city":          "Pune",
        "state":         "Maharashtra",
        "pincode":       "411057",
        "property_type": "apartment",
        "bedrooms":      2,
        "bathrooms":     2,
        "area_sqft":     820.0,
        "rent_amount":   22000.0,
        "latitude":      18.5975,
        "longitude":     73.7608,
        "amenities":     '["24x7 Security", "Covered Parking", "Kids Play Area", "CCTV"]',
        "description":   "Cozy 2BHK in upcoming Wakad locality, 2 km from Hinjawadi IT Park Gate 1.",
        "owner_idx":     2,
        "tenant_idx":    4,
        "elec":   [1110, 1060, 1310, 1910, 2210, 2010, 1660, 1510, 1260, 1090, 1110, 1210],
        "water":  [215,  215,  235,  265,  295,  275,  255,  245,  230,  215,  208,  215],
        "gas":    [610,  585,  555,  485,  455,  475,  525,  560,  585,  615,  655,  685],
        "net":    [799,  799,  799,  799,  799,  799,  799,  799,  799,  799,  799,  799],
        "maint":  [1000, 1000, 800,  1500, 800,  1000, 800,  1000, 1500, 800,  1000, 1500],
        "elec_vendor": "MSEDCL",
        "water_vendor": "PMC Water",
        "gas_vendor": "Adani Gas",
        "net_vendor": "Airtel Xstream",
        "maint_vendor": "Wakad Greens CHS",
    },
]

PAYMENT_NOTES = [
    "Monthly rent — NEFT transfer",
    "Monthly rent — UPI payment",
    "Monthly rent — IMPS transfer",
    "Monthly rent — Cheque deposit",
]


async def seed():
    if not settings.DEBUG and "--wipe-everything" not in sys.argv:
        raise SystemExit("seed.py DELETES every user, property and payment. DEBUG is off, so this looks like a live server: refusing. "
                         "Run it with --wipe-everything only if you really mean it.")
    engine = create_async_engine(settings.DATABASE_URL, echo=False)

    async with engine.begin() as conn:
        from app.models import user, property_model, document, financial  # noqa
        await conn.run_sync(Base.metadata.create_all)
        # Clear existing data
        for tbl in ["payments", "expenses", "documents", "properties", "users"]:
            await conn.execute(text(f'TRUNCATE TABLE "{tbl}" RESTART IDENTITY CASCADE'))

    AsyncSession_ = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with AsyncSession_() as db:
        hashed = hash_password(PASSWORD)

        # Manager
        mgr = User(full_name=MANAGER["full_name"], email=MANAGER["email"],
                   phone=MANAGER["phone"], role=UserRole.MANAGER,
                   hashed_password=hashed, is_active=True)
        db.add(mgr)

        # Owners
        owner_objs = []
        for o in OWNERS:
            u = User(full_name=o["full_name"], email=o["email"], phone=o["phone"],
                     role=UserRole.OWNER, hashed_password=hashed, is_active=True)
            db.add(u)
            owner_objs.append(u)

        # Tenants
        tenant_objs = []
        for t in TENANTS:
            u = User(full_name=t["full_name"], email=t["email"], phone=t["phone"],
                     role=UserRole.TENANT, hashed_password=hashed, is_active=True)
            db.add(u)
            tenant_objs.append(u)

        await db.flush()

        # Properties + 12 months expenses + payments
        for pd in PROPERTIES:
            owner = owner_objs[pd["owner_idx"]]
            tenant = tenant_objs[pd["tenant_idx"]]

            prop = Property(
                title=pd["title"],
                address=pd["address"],
                city=pd["city"],
                state=pd["state"],
                pincode=pd["pincode"],
                property_type=pd["property_type"],
                bedrooms=pd["bedrooms"],
                bathrooms=pd["bathrooms"],
                area_sqft=pd["area_sqft"],
                rent_amount=pd["rent_amount"],
                latitude=pd["latitude"],
                longitude=pd["longitude"],
                amenities=pd["amenities"],
                description=pd["description"],
                is_available=False,
                owner_id=owner.id,
                tenant_id=tenant.id,
            )
            db.add(prop)
            await db.flush()

            for i in range(12):          # Jan–Dec 2025
                month_num = i + 1
                month_str = f"2025-{month_num:02d}"
                bill_date = datetime(2025, month_num, 5, 10, 0, 0)

                db.add(Expense(
                    category=ExpenseCategory.ELECTRICITY,
                    amount=float(pd["elec"][i]),
                    expense_date=bill_date,
                    vendor=pd["elec_vendor"],
                    description=f"Electricity bill for {bill_date.strftime('%B %Y')}",
                    month=month_str,
                    property_id=prop.id,
                ))
                db.add(Expense(
                    category=ExpenseCategory.WATER,
                    amount=float(pd["water"][i]),
                    expense_date=bill_date,
                    vendor=pd["water_vendor"],
                    description=f"Water charges for {bill_date.strftime('%B %Y')}",
                    month=month_str,
                    property_id=prop.id,
                ))
                db.add(Expense(
                    category=ExpenseCategory.GAS,
                    amount=float(pd["gas"][i]),
                    expense_date=bill_date,
                    vendor=pd["gas_vendor"],
                    description=f"Gas bill for {bill_date.strftime('%B %Y')}",
                    month=month_str,
                    property_id=prop.id,
                ))
                db.add(Expense(
                    category=ExpenseCategory.INTERNET,
                    amount=float(pd["net"][i]),
                    expense_date=bill_date,
                    vendor=pd["net_vendor"],
                    description=f"Broadband subscription — {bill_date.strftime('%B %Y')}",
                    month=month_str,
                    property_id=prop.id,
                ))
                db.add(Expense(
                    category=ExpenseCategory.MAINTENANCE,
                    amount=float(pd["maint"][i]),
                    expense_date=bill_date,
                    vendor=pd["maint_vendor"],
                    description=f"Society maintenance charges — {bill_date.strftime('%B %Y')}",
                    month=month_str,
                    property_id=prop.id,
                ))

                # Rent payment on the 1st of each month
                rent_date = datetime(2025, month_num, 1, 9, 0, 0)
                db.add(Payment(
                    amount=prop.rent_amount,
                    payment_date=rent_date,
                    status=PaymentStatus.COMPLETED,
                    month=month_str,
                    notes=random.choice(PAYMENT_NOTES),
                    tenant_id=tenant.id,
                    property_id=prop.id,
                ))

        await db.commit()

        # ── Available-for-rent listings (for tenant "Find a Home" search) ──────
        LISTINGS = [
            # Mumbai
            {"title":"Bandra West 2BHK","address":"301 Turner Road, Bandra West","city":"Mumbai","state":"Maharashtra","pincode":"400050","property_type":"apartment","bedrooms":2,"bathrooms":2,"area_sqft":950.0,"rent_amount":65000.0,"security_deposit":130000.0,"latitude":19.0596,"longitude":72.8295,"amenities":"Parking,Gym,Security,WiFi","description":"Stylish 2BHK in prime Bandra West with sea breeze, modular kitchen, and 24-hr security."},
            {"title":"Powai Lake View 3BHK","address":"B-12 Hiranandani Gardens, Powai","city":"Mumbai","state":"Maharashtra","pincode":"400076","property_type":"apartment","bedrooms":3,"bathrooms":3,"area_sqft":1600.0,"rent_amount":85000.0,"security_deposit":170000.0,"latitude":19.1176,"longitude":72.9060,"amenities":"Gym,Pool,Parking,Security,WiFi","description":"Luxury 3BHK facing Powai Lake in Hiranandani Gardens. Gated complex with full amenities."},
            {"title":"Malad East 1BHK","address":"A-504 Inorbit Mall Road, Malad East","city":"Mumbai","state":"Maharashtra","pincode":"400097","property_type":"apartment","bedrooms":1,"bathrooms":1,"area_sqft":580.0,"rent_amount":26000.0,"security_deposit":52000.0,"latitude":19.1848,"longitude":72.8619,"amenities":"Security,Parking","description":"Compact 1BHK ideal for working professionals. Close to Inorbit Mall and metro station."},
            {"title":"Navi Mumbai 2BHK","address":"C-204, Seawoods Estate, Sector 54, Nerul","city":"Navi Mumbai","state":"Maharashtra","pincode":"400706","property_type":"apartment","bedrooms":2,"bathrooms":2,"area_sqft":1050.0,"rent_amount":28000.0,"security_deposit":56000.0,"latitude":19.0330,"longitude":73.0297,"amenities":"Parking,Garden,Security","description":"Spacious 2BHK in Seawoods with garden view. Well-connected to Seawoods railway station."},
            {"title":"Borivali 1BHK Studio","address":"D-103, Shanti Nagar CHS, Borivali West","city":"Mumbai","state":"Maharashtra","pincode":"400092","property_type":"apartment","bedrooms":1,"bathrooms":1,"area_sqft":490.0,"rent_amount":21000.0,"security_deposit":42000.0,"latitude":19.2307,"longitude":72.8567,"amenities":"Security,WiFi","description":"Cozy 1BHK studio near Borivali National Park. Perfect for single professionals."},
            # Pune
            {"title":"Kothrud 2BHK Premium","address":"Flat 5, Sahyadri Complex, Paud Road, Kothrud","city":"Pune","state":"Maharashtra","pincode":"411038","property_type":"apartment","bedrooms":2,"bathrooms":2,"area_sqft":1100.0,"rent_amount":28000.0,"security_deposit":56000.0,"latitude":18.5074,"longitude":73.8077,"amenities":"Parking,Garden,Security,WiFi","description":"Well-maintained 2BHK in peaceful Kothrud. Near Chandni Chowk and city centre."},
            {"title":"Viman Nagar 1BHK","address":"B-201, Clover Hills, Viman Nagar","city":"Pune","state":"Maharashtra","pincode":"411014","property_type":"apartment","bedrooms":1,"bathrooms":1,"area_sqft":650.0,"rent_amount":16000.0,"security_deposit":32000.0,"latitude":18.5679,"longitude":73.9143,"amenities":"Security,Parking","description":"Modern 1BHK near Pune airport and IT hubs. Great connectivity to Kalyani Nagar."},
            {"title":"Aundh 3BHK Villa","address":"17, Woodland Society, Baner Road, Aundh","city":"Pune","state":"Maharashtra","pincode":"411007","property_type":"villa","bedrooms":3,"bathrooms":3,"area_sqft":2200.0,"rent_amount":55000.0,"security_deposit":110000.0,"latitude":18.5590,"longitude":73.8080,"amenities":"Parking,Garden,Gym,Security,WiFi","description":"Independent 3BHK villa in leafy Aundh with private garden, ideal for families."},
            {"title":"Hadapsar 2BHK IT Belt","address":"C-301, Magarpatta Township, Hadapsar","city":"Pune","state":"Maharashtra","pincode":"411028","property_type":"apartment","bedrooms":2,"bathrooms":2,"area_sqft":990.0,"rent_amount":24000.0,"security_deposit":48000.0,"latitude":18.5018,"longitude":73.9260,"amenities":"Gym,Pool,Security,Parking,WiFi","description":"Semi-furnished 2BHK in Magarpatta Township. Walking distance to IT parks."},
            # Bangalore
            {"title":"Whitefield 2BHK Tech Hub","address":"402 Prestige Shantiniketan, ITPL Road, Whitefield","city":"Bangalore","state":"Karnataka","pincode":"560066","property_type":"apartment","bedrooms":2,"bathrooms":2,"area_sqft":1150.0,"rent_amount":32000.0,"security_deposit":64000.0,"latitude":12.9698,"longitude":77.7499,"amenities":"Gym,Pool,Security,Parking,WiFi","description":"Modern 2BHK in Prestige Shantiniketan township, 5 mins from ITPL tech park."},
            {"title":"HSR Layout 1BHK","address":"17/3, 27th Main, HSR Layout Sector 2","city":"Bangalore","state":"Karnataka","pincode":"560102","property_type":"apartment","bedrooms":1,"bathrooms":1,"area_sqft":620.0,"rent_amount":20000.0,"security_deposit":40000.0,"latitude":12.9116,"longitude":77.6389,"amenities":"Security,Parking,WiFi","description":"Bright 1BHK in HSR Layout close to startups and cafes. Ideal for IT professionals."},
            {"title":"Indiranagar 3BHK","address":"20, 12th Main, HAL 2nd Stage, Indiranagar","city":"Bangalore","state":"Karnataka","pincode":"560008","property_type":"apartment","bedrooms":3,"bathrooms":3,"area_sqft":1750.0,"rent_amount":72000.0,"security_deposit":144000.0,"latitude":12.9784,"longitude":77.6408,"amenities":"Gym,Security,Parking,WiFi,Pool","description":"Spacious 3BHK in Indiranagar — Bangalore's most vibrant neighbourhood. Semi-furnished."},
            {"title":"Marathahalli 2BHK","address":"B-404, SNN Raj Etternia, Outer Ring Road, Marathahalli","city":"Bangalore","state":"Karnataka","pincode":"560037","property_type":"apartment","bedrooms":2,"bathrooms":2,"area_sqft":1020.0,"rent_amount":26000.0,"security_deposit":52000.0,"latitude":12.9591,"longitude":77.6974,"amenities":"Gym,Security,Parking,WiFi","description":"Well-connected 2BHK on ORR near Marathahalli bridge. Ideal for Whitefield/Manyata commuters."},
            # Hyderabad
            {"title":"Gachibowli 2BHK HiTech","address":"C-1202, Aparna CyberZon, Nallagandla, Gachibowli","city":"Hyderabad","state":"Telangana","pincode":"500032","property_type":"apartment","bedrooms":2,"bathrooms":2,"area_sqft":1180.0,"rent_amount":27000.0,"security_deposit":54000.0,"latitude":17.4401,"longitude":78.3489,"amenities":"Gym,Pool,Security,Parking,WiFi","description":"Premium 2BHK in Aparna CyberZon, minutes from HITEC City and Financial District."},
            {"title":"Banjara Hills 3BHK","address":"12-2-786, Road No 12, Banjara Hills","city":"Hyderabad","state":"Telangana","pincode":"500034","property_type":"apartment","bedrooms":3,"bathrooms":3,"area_sqft":1900.0,"rent_amount":60000.0,"security_deposit":120000.0,"latitude":17.4126,"longitude":78.4483,"amenities":"Gym,Pool,Security,Parking,WiFi,Garden","description":"Elegant 3BHK in Banjara Hills — Hyderabad's upscale address with panoramic city views."},
            {"title":"Madhapur 1BHK Startup Zone","address":"Plot 56, Cyber Hills Colony, Madhapur","city":"Hyderabad","state":"Telangana","pincode":"500081","property_type":"apartment","bedrooms":1,"bathrooms":1,"area_sqft":720.0,"rent_amount":16500.0,"security_deposit":33000.0,"latitude":17.4485,"longitude":78.3908,"amenities":"Security,Parking,WiFi","description":"Compact 1BHK near Cyber Towers and DLF Cybercity. Great for IT freshers."},
            # Delhi NCR
            {"title":"Noida Sector 62 2BHK","address":"H-501, Amrapali Dream Valley, Sector 62, Noida","city":"Noida","state":"Uttar Pradesh","pincode":"201301","property_type":"apartment","bedrooms":2,"bathrooms":2,"area_sqft":1050.0,"rent_amount":20000.0,"security_deposit":40000.0,"latitude":28.6274,"longitude":77.3684,"amenities":"Gym,Pool,Security,Parking,WiFi","description":"2BHK in Amrapali society close to Sector 62 metro. Metro-connected IT corridor."},
            {"title":"Gurgaon Golf Course 3BHK","address":"1204, DLF Phase 5, Golf Course Road, Gurgaon","city":"Gurgaon","state":"Haryana","pincode":"122002","property_type":"apartment","bedrooms":3,"bathrooms":3,"area_sqft":2100.0,"rent_amount":75000.0,"security_deposit":150000.0,"latitude":28.4282,"longitude":77.0959,"amenities":"Gym,Pool,Concierge,Security,Parking,WiFi","description":"Luxury 3BHK in DLF Phase 5 with stunning golf course views. Full concierge services."},
            # Chennai
            {"title":"Anna Nagar 2BHK","address":"B4-C, 3rd Avenue, Anna Nagar","city":"Chennai","state":"Tamil Nadu","pincode":"600040","property_type":"apartment","bedrooms":2,"bathrooms":2,"area_sqft":1000.0,"rent_amount":25000.0,"security_deposit":50000.0,"latitude":13.0858,"longitude":80.2100,"amenities":"Security,Parking,WiFi","description":"Classic 2BHK in Anna Nagar, one of Chennai's most sought-after residential areas."},
            {"title":"OMR IT Corridor 1BHK","address":"B-202, Elita Promenade, OMR, Perungudi","city":"Chennai","state":"Tamil Nadu","pincode":"600096","property_type":"apartment","bedrooms":1,"bathrooms":1,"area_sqft":680.0,"rent_amount":15000.0,"security_deposit":30000.0,"latitude":12.9637,"longitude":80.2437,"amenities":"Security,Parking,Gym,WiFi","description":"Affordable 1BHK on OMR IT corridor. Perfect for software professionals joining Chennai offices."},
        ]

        for i, ld in enumerate(LISTINGS):
            owner = owner_objs[i % len(owner_objs)]
            db.add(Property(
                title=ld["title"],
                address=ld["address"],
                city=ld["city"],
                state=ld["state"],
                pincode=ld["pincode"],
                property_type=ld["property_type"],
                bedrooms=ld["bedrooms"],
                bathrooms=ld["bathrooms"],
                area_sqft=ld["area_sqft"],
                rent_amount=ld["rent_amount"],
                latitude=ld["latitude"],
                longitude=ld["longitude"],
                amenities=ld["amenities"],
                description=ld["description"],
                is_available=True,
                owner_id=owner.id,
            ))
        await db.commit()

    await engine.dispose()

    # Flush Redis cache so fresh data is served immediately
    try:
        import redis as _redis
        r = _redis.Redis(host=settings.REDIS_URL.split("//")[-1].split(":")[0] if "redis://" in settings.REDIS_URL else "redis", port=6379, decode_responses=True)
        r.flushall()
    except Exception:
        pass  # Redis flush is best-effort

    print()
    print("=" * 62)
    print("   PropAI — Seed Data Loaded Successfully!")
    print("=" * 62)
    print(f"   5 Occupied + 20 Available Listings | 3 Owners | 5 Tenants | 1 Manager")
    print(f"   12 months data (Jan–Dec 2025) | Password: {PASSWORD}")
    print()
    print("   MANAGER  : rajesh@propai.in")
    print("   OWNERS   : vikram@propai.in | priya@propai.in | suresh@propai.in")
    print("   TENANTS  : amit@example.in  | sneha@example.in | rahul@example.in")
    print("              anita@example.in | kiran@example.in")
    print("=" * 62)
    print()


if __name__ == "__main__":
    asyncio.run(seed())
