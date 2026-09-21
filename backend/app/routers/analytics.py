from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List, Dict, Any

from app.database import get_db
from app.models.property_model import Property
from app.models.financial import Expense, Payment
from app.models.user import User, UserRole
from app.ml.analytics import build_dashboard_analytics
from app.utils.dependencies import get_current_user
from app.utils.cache import get_cache, set_cache

router = APIRouter(prefix="/analytics", tags=["Analytics"])


async def _build_expense_history(property_id: int, db: AsyncSession) -> List[Dict]:
    """Aggregate monthly expenses for a property into list of dicts."""
    result = await db.execute(
        select(Expense)
        .where(Expense.property_id == property_id)
        .order_by(Expense.month)
    )
    expenses = result.scalars().all()

    monthly: Dict[str, Dict] = {}
    for e in expenses:
        m = e.month or "unknown"
        if m not in monthly:
            monthly[m] = {
                "month": m, "rent": 0, "electricity": 0, "water": 0,
                "gas": 0, "internet": 0, "maintenance": 0, "other": 0, "total": 0,
            }
        cat = e.category.value if hasattr(e.category, "value") else str(e.category)
        if cat in monthly[m]:
            monthly[m][cat] += e.amount
        monthly[m]["total"] += e.amount

    return list(monthly.values())


@router.get("/dashboard/{property_id}")
async def get_dashboard(
    property_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    cache_key = f"dashboard:{current_user.id}:{property_id}"
    cached = await get_cache(cache_key)
    if cached:
        return cached

    # Fetch property
    res = await db.execute(select(Property).where(Property.id == property_id))
    prop = res.scalar_one_or_none()
    prop_data = {}
    if prop:
        prop_data = {
            "id": prop.id,
            "title": prop.title,
            "address": prop.address,
            "city": prop.city,
            "rent_amount": prop.rent_amount,
            "bedrooms": prop.bedrooms,
            "bathrooms": prop.bathrooms,
            "area_sqft": prop.area_sqft,
            "latitude": prop.latitude,
            "longitude": prop.longitude,
        }

    # All properties (for KNN)
    all_res = await db.execute(select(Property))
    all_props = [
        {
            "id": p.id,
            "title": p.title,
            "address": p.address,
            "city": p.city,
            "rent_amount": p.rent_amount,
            "bedrooms": p.bedrooms,
            "bathrooms": p.bathrooms,
            "area_sqft": p.area_sqft,
            "latitude": p.latitude,
            "longitude": p.longitude,
        }
        for p in all_res.scalars().all()
    ]

    expense_history = await _build_expense_history(property_id, db)
    analytics = build_dashboard_analytics(prop_data, expense_history, all_props)
    analytics["property"] = prop_data

    # Payment history
    pay_res = await db.execute(
        select(Payment).where(Payment.property_id == property_id).order_by(Payment.payment_date.desc())
    )
    analytics["payment_history"] = [
        {"id": p.id, "amount": p.amount, "month": p.month, "status": p.status.value,
         "payment_date": str(p.payment_date)[:10]}
        for p in pay_res.scalars().all()
    ]

    await set_cache(cache_key, analytics, ttl=300)
    return analytics


@router.get("/market-comparison/{property_id}")
async def market_comparison(
    property_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """Compare a property's rent against market using KNN."""
    from app.ml.knn_model import rent_model

    res = await db.execute(select(Property).where(Property.id == property_id))
    prop = res.scalar_one_or_none()
    if not prop:
        return {"error": "Property not found"}

    all_res = await db.execute(select(Property))
    all_props = [
        {
            "id": p.id, "title": p.title, "city": p.city,
            "rent_amount": p.rent_amount, "bedrooms": p.bedrooms,
            "bathrooms": p.bathrooms, "area_sqft": p.area_sqft,
            "latitude": p.latitude, "longitude": p.longitude,
        }
        for p in all_res.scalars().all()
    ]

    prop_dict = {
        "rent_amount": prop.rent_amount, "bedrooms": prop.bedrooms,
        "bathrooms": prop.bathrooms, "area_sqft": prop.area_sqft,
        "latitude": prop.latitude, "longitude": prop.longitude,
    }

    if len(all_props) >= 3:
        rent_model.train(all_props)
        market_rent = rent_model.predict_market_rent(prop_dict)
        deviation = rent_model.rent_deviation(prop.rent_amount, market_rent) if market_rent else {}
        similar = rent_model.get_similar_properties(prop_dict, all_props)
        return {"deviation": deviation, "similar_properties": similar}

    return {"message": "Not enough data for market comparison"}
