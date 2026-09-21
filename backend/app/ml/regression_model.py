"""
Regression & Analytics Models

1. Moving Average for expense trend smoothing:  MA = (x1 + x2 + ... + xn) / n
2. Linear Regression to forecast next-month expenses per category
3. Total living cost aggregation
"""
import numpy as np
from sklearn.linear_model import LinearRegression
from typing import List, Dict, Any
import logging

logger = logging.getLogger(__name__)

EXPENSE_CATEGORIES = ["rent", "electricity", "water", "gas", "internet", "maintenance", "other"]


def moving_average(values: List[float], window: int = 3) -> List[float]:
    """MA = (x1 + x2 + ... + xn) / n  (expanding window for first n-1 points)."""
    result = []
    for i, _ in enumerate(values):
        start = max(0, i - window + 1)
        chunk = values[start: i + 1]
        result.append(sum(chunk) / len(chunk))
    return result


def forecast_next_month(history: List[Dict]) -> Dict[str, float]:
    """
    Linear Regression per expense category.
    history: list of monthly dicts, e.g. [{"month":"2024-01","rent":12000,...}, ...]
    Returns predicted values for next month.
    """
    if not history:
        return {cat: 0.0 for cat in EXPENSE_CATEGORIES + ["total"]}

    n = len(history)
    X = np.arange(n).reshape(-1, 1)
    predictions: Dict[str, float] = {}

    for cat in EXPENSE_CATEGORIES:
        y = np.array([float(row.get(cat, 0)) for row in history])
        if y.sum() == 0:
            predictions[cat] = 0.0
            continue
        if n < 2:
            predictions[cat] = float(y[-1])
            continue
        try:
            m = LinearRegression().fit(X, y)
            pred = float(m.predict([[n]])[0])
            predictions[cat] = max(0.0, round(pred, 2))
        except Exception as e:
            logger.warning(f"Regression failed for {cat}: {e}")
            predictions[cat] = float(y[-1])

    predictions["total"] = round(sum(predictions.values()), 2)
    return predictions


def expense_trends(history: List[Dict]) -> Dict[str, Any]:
    """
    Compute moving-average trend for each category.
    Returns per-category: {values, moving_average, trend, avg}
    """
    trends: Dict[str, Any] = {}
    all_cats = EXPENSE_CATEGORIES + ["total"]

    for cat in all_cats:
        values = [float(row.get(cat, 0)) for row in history]
        ma = moving_average(values, window=3)
        direction = "stable"
        if len(ma) >= 2 and ma[-2]:
            pct_change = (ma[-1] - ma[-2]) / ma[-2] * 100
            if pct_change > 5:
                direction = "increasing"
            elif pct_change < -5:
                direction = "decreasing"
        trends[cat] = {
            "values": values,
            "moving_average": [round(v, 2) for v in ma],
            "trend": direction,
            "avg": round(sum(values) / len(values), 2) if values else 0,
        }
    return trends


def total_living_cost(month: str, **kwargs) -> Dict[str, float]:
    """
    Aggregate all expense components into a single living cost breakdown.
    kwargs: rent, electricity, water, gas, internet, maintenance, other (all optional floats)
    """
    breakdown = {cat: float(kwargs.get(cat, 0)) for cat in EXPENSE_CATEGORIES}
    breakdown["total"] = round(sum(breakdown.values()), 2)
    breakdown["month"] = month
    return breakdown
