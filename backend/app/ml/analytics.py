"""
Analytics orchestrator — combines KNN + Regression outputs into
a single dashboard payload.
"""
from typing import List, Dict, Any
from app.ml.knn_model import rent_model
from app.ml.regression_model import forecast_next_month, expense_trends, total_living_cost
import logging

logger = logging.getLogger(__name__)


def build_dashboard_analytics(
    property_data: Dict,
    expense_history: List[Dict],
    all_properties: List[Dict],
) -> Dict[str, Any]:
    """
    Generates the full analytics payload for a dashboard.

    Args:
        property_data   – dict with rent_amount, bedrooms, area_sqft, lat/lon, …
        expense_history – list of monthly expense dicts (oldest first)
        all_properties  – all properties in the DB (for KNN training)
    """
    analytics: Dict[str, Any] = {}

    # ── 1. Train KNN on available market data ───────────────────────────────
    if len(all_properties) >= 3:
        rent_model.train(all_properties)

    # ── 2. Rent deviation analysis ──────────────────────────────────────────
    if property_data and rent_model.is_trained:
        predicted_market_rent = rent_model.predict_market_rent(property_data)
        if predicted_market_rent:
            analytics["rent_analysis"] = rent_model.rent_deviation(
                tenant_rent=property_data.get("rent_amount", 0),
                market_rent=predicted_market_rent,
            )
            analytics["similar_properties"] = rent_model.get_similar_properties(
                property_data, all_properties, n=5
            )

    # ── 3. Expense trend analysis ────────────────────────────────────────────
    if expense_history:
        analytics["expense_trends"] = expense_trends(expense_history)
        analytics["forecast_next_month"] = forecast_next_month(expense_history)

    # ── 4. Current month living cost ─────────────────────────────────────────
    if expense_history:
        latest = expense_history[-1]
        analytics["current_living_cost"] = total_living_cost(
            month=latest.get("month", ""),
            rent=latest.get("rent", 0),
            electricity=latest.get("electricity", 0),
            water=latest.get("water", 0),
            gas=latest.get("gas", 0),
            internet=latest.get("internet", 0),
            maintenance=latest.get("maintenance", 0),
            other=latest.get("other", 0),
        )

    # ── 5. Summary stats ────────────────────────────────────────────────────
    if expense_history:
        totals = [row.get("total", 0) for row in expense_history]
        analytics["summary"] = {
            "avg_monthly_cost": round(sum(totals) / len(totals), 2) if totals else 0,
            "max_monthly_cost": max(totals) if totals else 0,
            "min_monthly_cost": min(totals) if totals else 0,
            "months_tracked": len(expense_history),
        }

    return analytics
