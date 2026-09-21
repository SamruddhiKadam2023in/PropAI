"""
One-off, idempotent: gives every currently rented property an agreement record, and links its rent payments to it.

    docker exec property_backend python backfill_agreements.py

The application never stored agreement terms before, so for tenancies that already exist the only honest evidence is the
payment history: the agreement is taken to start on the first day of the tenant's earliest rent month (or today, if they have
never paid), for the standard 12-month term at the property's current rent. Owners/Managers can record the true terms through
POST /agreements. Properties that already have an agreement are left alone.
"""
import asyncio

from sqlalchemy import func, select

from app.database import AsyncSessionLocal
from app.models.agreement import Agreement
from app.models.financial import Payment
from app.models.property_model import Property
from app.services.agreements import create_agreement
from app.utils.dates import local_today
from datetime import date


async def main():
    async with AsyncSessionLocal() as db:
        props = (await db.execute(select(Property).where(Property.tenant_id.is_not(None)).order_by(Property.id))).scalars().all()
        made = 0
        for prop in props:
            have = (await db.execute(select(func.count(Agreement.id)).where(Agreement.property_id == prop.id, Agreement.tenant_id == prop.tenant_id))).scalar()
            if have:
                continue
            first = (await db.execute(
                select(func.min(Payment.month)).where(Payment.tenant_id == prop.tenant_id, Payment.property_id == prop.id, Payment.payment_type == "rent")
            )).scalar()
            start = date(int(first[:4]), int(first[5:7]), 1) if first else local_today()
            a = await create_agreement(db, prop, prop.tenant_id, start)
            made += 1
            print(f"property {prop.id} tenant {prop.tenant_id}: agreement {a.id} {a.start_date} -> {a.end_date}")
        await db.commit()
        print(f"created {made} agreement(s)")


asyncio.run(main())
