"""Unit tests for the KNN rent-comparison model (no DB, no HTTP): train() must actually train
whenever the router's own "enough data" threshold (>= 3 properties) says it should.

Runs INSIDE the backend container (it imports app.ml.knn_model):
    docker exec -i property_backend python - < tests/api/knn_model_unit.py
tests/run_all.py does this for you.
"""
from app.ml.knn_model import RentComparisonModel

results = []


def check(name, ok, detail=""):
    results.append(bool(ok))
    print(("PASS " if ok else "FAIL ") + name + (f"  [{str(detail)[:170]}]" if detail != "" else ""))


def prop(rent, bedrooms=2, bathrooms=2, area=800, lat=19.076, lon=72.877):
    return {"rent_amount": rent, "bedrooms": bedrooms, "bathrooms": bathrooms, "area_sqft": area, "latitude": lat, "longitude": lon}


target = prop(20000, bedrooms=1, bathrooms=1, area=600)

print("== A pool of only 3 properties (the router's own minimum) must still train and predict ==")
m = RentComparisonModel()
pool3 = [prop(18000, 1, 1, 590), prop(22000, 1, 1, 610), prop(50000, 3, 3, 1400)]
m.train(pool3)
check("is_trained becomes True with exactly 3 properties (used to need >= 5)", m.is_trained)
pred = m.predict_market_rent(target)
check("predict_market_rent returns a real number, not None", isinstance(pred, float), pred)
if pred is not None:
    dev = m.rent_deviation(target["rent_amount"], pred)
    check("rent_deviation is fully populated (this is what the UI's Your Rent / Market Rate / Deviation read)",
          dev.get("tenant_rent") == 20000 and dev.get("market_rent") is not None and dev.get("deviation_percent") is not None, dev)

print("\n== A pool of 4 properties must also train (this was the exact size that reproduced the live bug) ==")
m4 = RentComparisonModel()
pool4 = pool3 + [prop(19000, 1, 1, 605)]
m4.train(pool4)
check("is_trained becomes True with exactly 4 properties", m4.is_trained)
check("predict_market_rent returns a real number with a pool of 4", isinstance(m4.predict_market_rent(target), float))

print("\n== Fewer than 3 properties must still correctly refuse to train (not enough data, no crash) ==")
m2 = RentComparisonModel()
m2.train([prop(18000), prop(22000)])
check("is_trained stays False with only 2 properties", not m2.is_trained)
check("predict_market_rent returns None when untrained (never crashes)", m2.predict_market_rent(target) is None)

print("\n== A large pool (>= the usual n_neighbors=5) still works exactly as before - no regression ==")
m10 = RentComparisonModel()
pool10 = [prop(15000 + i * 1000, 1, 1, 580 + i * 5) for i in range(10)]
m10.train(pool10)
check("is_trained becomes True with a 10-property pool", m10.is_trained)
pred10 = m10.predict_market_rent(target)
check("predict_market_rent returns a real number with a 10-property pool", isinstance(pred10, float), pred10)

print(f"\n{results.count(True)}/{len(results)} checks passed")
raise SystemExit(0 if all(results) else 1)
