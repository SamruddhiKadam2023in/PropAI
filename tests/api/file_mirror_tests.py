"""End to end: with MIRROR_UPLOADS_TO_MONGO on (test mode turns it on), an uploaded bill survives the disk being wiped and the API restarted.
Simulates a free host whose disk is emptied on every restart. Uses a throwaway tenant; everything created is removed."""
import os, subprocess, sys, time, warnings
import requests
warnings.filterwarnings("ignore")

API = os.environ.get("API", "http://localhost:8000")
ASSETS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets")
EMAIL, PW = "mirrortest_tenant@example.com", "MirrorTest-Pass-1"
results = []


def check(name, ok, detail=""):
    results.append(bool(ok))
    print(("PASS " if ok else "FAIL ") + name + (f"  [{str(detail)[:170]}]" if detail != "" else ""))


def sh(*args, stdin=None):
    return subprocess.run(list(args), capture_output=True, text=True, input=stdin, encoding="utf-8", env={**os.environ, "MSYS_NO_PATHCONV": "1"}).stdout.strip()


def pg(sql):
    return sh("docker", "exec", "-i", "property_postgres", "psql", "-U", "postgres", "-d", "property_management", "-At", stdin=sql)


def mongo(js):
    return sh("docker", "exec", "property_mongodb", "mongosh", "-u", "mongo", "-p", "mongo123", "--authenticationDatabase", "admin",
              "property_management", "--quiet", "--eval", js)


def wait_healthy(seconds=90):
    end = time.time() + seconds
    while time.time() < end:
        try:
            if requests.get(f"{API}/health", timeout=3).status_code == 200:
                return True
        except Exception:
            pass
        time.sleep(2)
    return False


mgr = {"Authorization": "Bearer " + requests.post(f"{API}/auth/login", json={"email": "rajesh@propai.in", "password": "PropAI@2024"}).json()["access_token"]}
doc_id = None
try:
    assert requests.post(f"{API}/auth/users", headers=mgr, json={"email": EMAIL, "full_name": "Mirror Test", "password": PW, "role": "tenant"}).status_code == 201
    tenant = {"Authorization": "Bearer " + requests.post(f"{API}/auth/login", json={"email": EMAIL, "password": PW}).json()["access_token"]}
    original = open(os.path.join(ASSETS, "electricity_bill.png"), "rb").read()

    r = requests.post(f"{API}/documents/upload", headers=tenant, files={"file": ("electricity_bill.png", original, "image/png")})
    check("upload accepted", r.status_code == 201, r.status_code)
    doc_id = r.json()["id"]
    d = r.json()
    for _ in range(60):                              # let the first reading finish, or the restart below would interrupt it
        if d["status"] not in ("pending", "processing"):
            break
        time.sleep(2)
        d = requests.get(f"{API}/documents/{doc_id}", headers=tenant).json()
    check("first reading finished before the simulated crash", d["status"] == "completed", d["status"])
    path = pg(f"select file_url from documents where id={doc_id}")
    key = path.split("uploads/", 1)[1]
    check("a copy of the file is in MongoDB right away", mongo(f'db.file_mirror.countDocuments({{_id: "{key}"}})') == "1", key)

    sh("docker", "exec", "property_backend", "rm", "-f", path)
    check("the file is gone from the server's disk (simulated wipe)", sh("docker", "exec", "property_backend", "sh", "-c", f"test -f {path} && echo yes || echo no") == "no")
    sh("docker", "restart", "property_backend")
    check("API restarts", wait_healthy())

    back = sh("docker", "exec", "property_backend", "sh", "-c", f"test -f {path} && echo yes || echo no")
    check("after the restart the file is back on disk", back == "yes", back)
    d = requests.get(f"{API}/documents/{doc_id}", headers=tenant).json()
    check("the document says its original file is available", d.get("file_available") is True and d.get("mime_type") == "image/png", (d.get("file_available"), d.get("mime_type")))
    f = requests.get(f"{API}/documents/{doc_id}/file", headers=tenant)
    check("'View original' returns exactly the bytes that were uploaded", f.status_code == 200 and f.content == original, f.status_code)

    rp = requests.post(f"{API}/documents/{doc_id}/reprocess", headers=tenant)
    for _ in range(60):
        d = requests.get(f"{API}/documents/{doc_id}", headers=tenant).json()
        if d["status"] not in ("pending", "processing"):
            break
        time.sleep(2)
    check("re-reading the bill from the restored file works", rp.status_code == 200 and d["status"] == "completed" and (d["extracted_data"] or {}).get("amount") == 2450.0, (d["status"], (d["extracted_data"] or {}).get("amount")))

    check("deleting the document...", requests.delete(f"{API}/documents/{doc_id}", headers=tenant).status_code == 204)
    doc_id = None
    check("...also deletes the MongoDB copy", mongo(f'db.file_mirror.countDocuments({{_id: "{key}"}})') == "0")
finally:
    if doc_id:
        requests.delete(f"{API}/documents/{doc_id}", headers=tenant)
    pg(f"delete from documents where user_id in (select id from users where email='{EMAIL}'); delete from users where email='{EMAIL}';")
    check("cleanup: throwaway tenant removed", pg(f"select count(*) from users where email='{EMAIL}'") == "0")

print(f"\n{sum(results)}/{len(results)} passed")
sys.exit(0 if all(results) else 1)
