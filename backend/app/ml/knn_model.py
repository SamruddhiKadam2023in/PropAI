"""
KNN Rent Comparison Model
Uses K-Nearest Neighbors to find similar properties and predict market rent.
Used to compute rent deviation score for tenants.
"""
import numpy as np
from sklearn.neighbors import KNeighborsRegressor
from sklearn.preprocessing import StandardScaler
from typing import List, Dict, Any, Optional
import logging

logger = logging.getLogger(__name__)


class RentComparisonModel:
    def __init__(self, n_neighbors: int = 5):
        self.k = n_neighbors
        self.model = KNeighborsRegressor(n_neighbors=n_neighbors, metric="euclidean")
        self.scaler = StandardScaler()
        self.is_trained = False

    # ── Feature engineering ──────────────────────────────────────────────────

    def _features(self, props: List[Dict]) -> np.ndarray:
        return np.array(
            [
                [
                    p.get("bedrooms") or 1,
                    p.get("bathrooms") or 1,
                    p.get("area_sqft") or 500,
                    p.get("latitude") or 19.076,   # Mumbai default lat
                    p.get("longitude") or 72.877,  # Mumbai default lon
                ]
                for p in props
            ],
            dtype=float,
        )

    # ── Train ────────────────────────────────────────────────────────────────

    def train(self, properties: List[Dict]) -> None:
        if len(properties) < 3:
            logger.warning("Not enough properties to train KNN model.")
            return
        # Use as many neighbors as are actually available - a hard-coded n_neighbors=5 used to make
        # this silently refuse to train (and give a blank deviation, though similar properties still
        # showed) whenever the pool had fewer than 5 properties, even though 3-4 is plenty for a KNN fit.
        k = min(self.k, len(properties))
        self.model = KNeighborsRegressor(n_neighbors=k, metric="euclidean")
        X = self._features(properties)
        y = np.array([p["rent_amount"] for p in properties], dtype=float)
        X_scaled = self.scaler.fit_transform(X)
        self.model.fit(X_scaled, y)
        self.is_trained = True
        logger.info(f"KNN trained on {len(properties)} properties.")

    # ── Predict ──────────────────────────────────────────────────────────────

    def predict_market_rent(self, prop: Dict) -> Optional[float]:
        if not self.is_trained:
            return None
        X = self.scaler.transform(self._features([prop]))
        return float(self.model.predict(X)[0])

    def get_similar_properties(self, prop: Dict, pool: List[Dict], n: int = 5) -> List[Dict]:
        if len(pool) < 2:
            return pool
        target = self._features([prop])
        candidates = self._features(pool)
        dists = np.linalg.norm(candidates - target, axis=1)
        indices = np.argsort(dists)[: min(n, len(pool))]
        result = []
        for i in indices:
            item = dict(pool[i])
            item["similarity_distance"] = round(float(dists[i]), 4)
            result.append(item)
        return result

    # ── Deviation ────────────────────────────────────────────────────────────

    def rent_deviation(self, tenant_rent: float, market_rent: float) -> Dict[str, Any]:
        dev = tenant_rent - market_rent
        pct = (dev / market_rent * 100) if market_rent else 0.0
        return {
            "tenant_rent": tenant_rent,
            "market_rent": round(market_rent, 2),
            "deviation": round(dev, 2),
            "deviation_percent": round(pct, 2),
            "is_above_market": dev > 0,
            "status": (
                "above_market" if pct > 5
                else "below_market" if pct < -5
                else "at_market"
            ),
        }


# Module-level singleton
rent_model = RentComparisonModel()
