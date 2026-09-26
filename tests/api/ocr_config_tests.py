"""Authorization + validation tests for GET/PUT /config/ocr. Resets the ocr_config collection to its
original state afterward (it's a single shared document, not throwaway data, so this restores it rather than deleting it)."""
import subprocess, sys, warnings
import requests
warnings.filterwarnings("ignore")
API = "http://localhost:8000"
results = []


def check(name, ok, detail=""):
    results.append(bool(ok))
    print(("PASS " if ok else "FAIL ") + name + (f"  [{str(detail)[:200]}]" if detail != "" else ""))


def mongo_eval(js):
    return subprocess.run(
        ["docker", "exec", "property_mongodb", "mongosh", "-u", "mongo", "-p", "mongo123",
         "--authenticationDatabase", "admin", "property_management", "--quiet", "--eval", js],
        capture_output=True, text=True, encoding="utf-8",
    ).stdout.strip()


def login(email):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": "PropAI@2024"})
    return {"Authorization": "Bearer " + r.json()["access_token"]}


owner, mgr, tenant = login("vikram@propai.in"), login("rajesh@propai.in"), login("amit@example.in")

original = mongo_eval("JSON.stringify(db.ocr_config.findOne({}, {_id: 0}))")   # 'null' if no document exists yet; _id excluded (immutable, and irrelevant to restore)
try:
    r = requests.get(f"{API}/config/ocr", headers=tenant)
    check("a tenant cannot view OCR config (403)", r.status_code == 403, f"{r.status_code} {r.text[:80]}")
    r = requests.put(f"{API}/config/ocr", headers=tenant, json={"ocr_engine": "tesseract"})
    check("a tenant cannot change OCR config (403)", r.status_code == 403, f"{r.status_code} {r.text[:80]}")

    r = requests.get(f"{API}/config/ocr", headers=owner)
    check("an owner can view OCR config (200)", r.status_code == 200, f"{r.status_code} {r.text[:80]}")

    r = requests.put(f"{API}/config/ocr", headers=owner, json={"ocr_engine": "tesseract", "confidence_threshold": 0.8})
    check("an owner can change OCR config (200)", r.status_code == 200, f"{r.status_code} {r.text[:80]}")
    body = r.json()
    check("the response reflects the new engine and threshold", body.get("ocr_engine") == "tesseract" and body.get("confidence_threshold") == 0.8, body)
    check("updated_by records who made the change", body.get("updated_by") == "vikram@propai.in", body)

    r = requests.get(f"{API}/config/ocr", headers=mgr)
    check("a manager can view OCR config (200) - this was Owner-only before", r.status_code == 200, f"{r.status_code} {r.text[:80]}")
    r = requests.put(f"{API}/config/ocr", headers=mgr, json={"ocr_engine": "auto"})
    check("a manager can change OCR config (200) - there was no write endpoint at all before", r.status_code == 200, f"{r.status_code} {r.text[:80]}")
    check("the manager's change actually persisted (engine back to auto)", r.json().get("ocr_engine") == "auto", r.json())

    r = requests.put(f"{API}/config/ocr", headers=owner, json={"ocr_engine": "made_up_engine"})
    check("an unknown engine name is rejected (400), not silently accepted", r.status_code == 400, f"{r.status_code} {r.text[:80]}")

    r = requests.put(f"{API}/config/ocr", headers=owner, json={"confidence_threshold": 1.5})
    check("a threshold above 1.0 is rejected (422)", r.status_code == 422, f"{r.status_code} {r.text[:80]}")
    r = requests.put(f"{API}/config/ocr", headers=owner, json={"confidence_threshold": -0.1})
    check("a negative threshold is rejected (422)", r.status_code == 422, f"{r.status_code} {r.text[:80]}")

    r = requests.put(f"{API}/config/ocr", headers=owner, json={})
    check("an empty update body is rejected (400), not a silent no-op success", r.status_code == 400, f"{r.status_code} {r.text[:80]}")

    r = requests.put(f"{API}/config/ocr", headers=owner, json={"confidence_threshold": 0.5})
    check("a partial update (threshold only) leaves the engine untouched", r.status_code == 200 and r.json().get("ocr_engine") == "auto", r.json())

    dead_fields = {"preprocessing_enabled", "tfidf_enabled", "min_text_length"}
    check("dead config fields the pipeline never read are no longer exposed", not (dead_fields & set(r.json().keys())), r.json())
finally:
    if original and original != "null":
        # restore the exact document that existed before this test ran (update_one + $set, not replaceOne:
        # replaceOne would try to also set _id, which Mongo refuses to change on an existing document)
        mongo_eval(f"db.ocr_config.updateOne({{}}, {{$set: {original}}}, {{upsert: true}})")
    else:
        mongo_eval("db.ocr_config.deleteMany({})")
    restored = mongo_eval("JSON.stringify(db.ocr_config.findOne({}, {_id: 0}))")
    check("cleanup: ocr_config restored to its original state", restored == original, (restored, original))

print(f"\n{sum(results)}/{len(results)} passed")
sys.exit(0 if all(results) else 1)
