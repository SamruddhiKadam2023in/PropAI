"""
Demo repair contacts for testing the Owner -> Maintenance -> Service Providers section.

    docker exec property_backend python seed_service_providers.py            # (re)load the demo providers
    docker exec property_backend python seed_service_providers.py --remove   # remove only the demo providers

Every row inserted here is flagged is_demo=True (shown as "Demo" in the app, read-only, shared by all owners/managers).
The businesses are fictional and every phone number is an obviously fake placeholder (+91 00000 xxxxx) that cannot reach a
real person. Providers added by users (is_demo=False) are never touched.
"""
import argparse
import asyncio
from decimal import Decimal

from sqlalchemy import delete, func, select

from app.database import AsyncSessionLocal
from app.models.service_provider import ServiceProvider

MUMBAI = "Mumbai / Navi Mumbai / Thane"
PUNE = "Pune / Pimpri-Chinchwad"
BLR = "Bangalore"
HYD = "Hyderabad / Secunderabad"
DELHI = "Delhi NCR / Noida / Gurgaon"
CHENNAI = "Chennai"

# (name, category, area, availability, visit charge, status, description, problem types)
DEMO = [
    ("Rajesh Plumbing Services", "plumber", MUMBAI, "9:00 AM – 7:00 PM", 500, "available",
     "Tap leakage, pipe blockage, water leakage and plumbing repairs.", ["Tap leakage", "Pipe blockage", "Water leakage"]),
    ("XYZ Plumbing", "plumber", MUMBAI, "8:00 AM – 8:00 PM", 450, "available",
     "Bathroom fittings, geyser and drainage repairs.", ["Drain clearing", "Geyser repair", "Bathroom fittings"]),
    ("Pune Pipe & Drain Works", "plumber", PUNE, "9:00 AM – 6:00 PM", 400, "available",
     "Leaks, blocked drains and overhead tank plumbing.", ["Water leakage", "Blocked drain", "Tank plumbing"]),
    ("Namma Bengaluru Plumbers", "plumber", BLR, "9:00 AM – 7:00 PM", 450, "unavailable",
     "Currently fully booked. Tap, flush and pipe repairs.", ["Tap leakage", "Flush tank", "Pipe repair"]),
    ("ABC Electrical Services", "electrician", MUMBAI, "10:00 AM – 8:00 PM", 400, "available",
     "Fan, light, switch, socket and wiring repairs.", ["Fan not working", "Light not working", "Switch / socket", "Wiring"]),
    ("Spark Electricals", "electrician", PUNE, "9:00 AM – 7:00 PM", 350, "available",
     "MCB, inverter and short-circuit repairs.", ["MCB tripping", "Short circuit", "Inverter wiring"]),
    ("BrightWire Electric Co.", "electrician", BLR, "9:00 AM – 8:00 PM", 400, "available",
     "House wiring, fans, lights and doorbells.", ["Wiring issue", "Fan repair", "Doorbell"]),
    ("CoolAir AC Care", "ac_technician", MUMBAI, "10:00 AM – 7:00 PM", 600, "available",
     "Split and window AC servicing, gas refill and repairs.", ["AC not cooling", "AC servicing", "Gas refill"]),
    ("FrostLine AC Service", "ac_technician", HYD, "9:00 AM – 7:00 PM", 550, "available",
     "AC installation, servicing and compressor repair.", ["AC servicing", "AC installation", "Compressor repair"]),
    ("Woodcraft Carpenters", "carpenter", MUMBAI, "9:00 AM – 6:00 PM", 450, "available",
     "Door, window and furniture repairs, wardrobe fitting.", ["Door repair", "Furniture repair", "Wardrobe fitting"]),
    ("Sahyadri Furniture Works", "carpenter", PUNE, "10:00 AM – 6:00 PM", 400, "available",
     "Hinges, drawers, cupboards and modular repairs.", ["Hinge repair", "Drawer repair", "Cupboard repair"]),
    ("Sparkle Home Cleaners", "cleaning", MUMBAI, "8:00 AM – 6:00 PM", 800, "available",
     "Deep cleaning, move-in / move-out cleaning, bathroom and kitchen cleaning.", ["Deep cleaning", "Move-out cleaning", "Kitchen cleaning"]),
    ("FreshNest Cleaning Co.", "cleaning", DELHI, "8:00 AM – 7:00 PM", 700, "available",
     "Home and office cleaning, sofa and carpet cleaning.", ["House cleaning", "Sofa cleaning", "Carpet cleaning"]),
    ("SafeKey Locksmiths", "locksmith", MUMBAI, "24 hours", 300, "available",
     "Lock repair, replacement and emergency lockout service.", ["Lock problem", "Lost keys", "Lockout"]),
    ("KeyMaster Services", "locksmith", CHENNAI, "9:00 AM – 9:00 PM", 300, "available",
     "Door lock, padlock and key duplication.", ["Lock replacement", "Key duplication"]),
    ("Fix-It Handyman Co", "handyman", MUMBAI, "9:00 AM – 6:00 PM", 350, "available",
     "Minor repairs, fittings, curtain rods, shelves and small jobs.", ["Minor repairs", "Shelf fitting", "Curtain rods"]),
    ("HomeCare Handymen", "handyman", PUNE, "9:00 AM – 6:00 PM", 300, "available",
     "General repairs and odd jobs around the house.", ["General repairs", "Odd jobs"]),
]


async def main(remove_only: bool) -> None:
    async with AsyncSessionLocal() as db:
        real_before = (await db.execute(select(func.count()).select_from(ServiceProvider).where(ServiceProvider.is_demo.is_(False)))).scalar_one()
        removed = (await db.execute(delete(ServiceProvider).where(ServiceProvider.is_demo.is_(True)))).rowcount
        print(f"Removed {removed} previously seeded demo provider(s). Providers added by users untouched: {real_before}.")
        if not remove_only:
            for i, (name, category, area, hours, charge, status, description, problems) in enumerate(DEMO, start=1):
                db.add(ServiceProvider(
                    created_by=None, is_demo=True, name=name, category=category, service_area=area, availability=hours,
                    visit_charge=Decimal(charge), status=status, description=description, problem_types=problems,
                    phone=f"+91000000{i:04d}", whatsapp=f"+91000000{i:04d}",          # +91 00000 000NN - fake on purpose
                ))
            print(f"Inserted {len(DEMO)} demo provider(s).")
        await db.commit()
        real_after = (await db.execute(select(func.count()).select_from(ServiceProvider).where(ServiceProvider.is_demo.is_(False)))).scalar_one()
        assert real_before == real_after, "user-added providers changed - this must never happen"


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Load or remove demo repair contacts.")
    parser.add_argument("--remove", action="store_true", help="only remove the demo providers")
    asyncio.run(main(parser.parse_args().remove))
