"""API tests: change password, edit own profile, Manager activate / deactivate users.
Runs in normal or test mode (no email is involved). Everything created is removed at the end."""
import os, subprocess, sys, warnings
import requests
warnings.filterwarnings("ignore")

API = os.environ.get("API", "http://localhost:8000")
results = []
PW, NEW = "Account-Pass-1", "Account-Pass-2"


def check(name, ok, detail=""):
    results.append(bool(ok))
    print(("PASS " if ok else "FAIL ") + name + (f"  [{str(detail)[:200]}]" if detail != "" else ""))


def sh(*a, stdin=None):
    return subprocess.run(list(a), capture_output=True, text=True, input=stdin, encoding="utf-8").stdout.strip()


def pg(sql):
    return sh("docker", "exec", "-i", "property_postgres", "psql", "-U", "postgres", "-d", "property_management", "-At", stdin=sql)


def rd(*args):
    return sh("docker", "exec", "property_redis", "redis-cli", *args)


def login(email, pw):
    return requests.post(f"{API}/auth/login", json={"email": email, "password": pw})


def hdr(tok):
    return {"Authorization": "Bearer " + tok}


mgr_tok = login("rajesh@propai.in", "PropAI@2024").json()["access_token"]
mgr = hdr(mgr_tok)
BASE_USERS = pg("select count(*) from users")
E = {k: f"accttest_{k}@example.com" for k in ("ten", "own", "mgr2", "pw")}
ids = {}
try:
    for k, role in (("ten", "tenant"), ("own", "owner"), ("mgr2", "manager"), ("pw", "tenant")):
        r = requests.post(f"{API}/auth/users", headers=mgr, json={"email": E[k], "full_name": f"Acct {k}", "password": PW, "role": role})
        assert r.status_code == 201, r.text
        ids[k] = r.json()["id"]

    print("== 1. Change password ==")
    s = login(E["pw"], PW).json()
    tok, other = hdr(s["access_token"]), login(E["pw"], PW).json()      # a second device
    cp = lambda cur, new, h=tok: requests.post(f"{API}/auth/change-password", headers=h, json={"current_password": cur, "new_password": new})
    check("no token -> 401/403", requests.post(f"{API}/auth/change-password", json={"current_password": PW, "new_password": NEW}).status_code in (401, 403))
    check("empty current password -> 422", cp("", NEW).status_code == 422)
    check("new password under 8 characters -> 422", cp(PW, "short").status_code == 422)
    check("new password over 72 bytes -> 422", cp(PW, "z" * 80).status_code == 422)
    check("new password that is only spaces -> 422", cp(PW, "        ").status_code == 422)
    r = cp(PW, PW)
    check("new password equal to the current one -> 400", r.status_code == 400 and "different" in r.text, r.text[:80])
    r = cp("not-my-password", NEW)
    check("wrong current password -> 400, password unchanged", r.status_code == 400 and "current password is incorrect" in r.text and login(E["pw"], PW).status_code == 200, r.text[:80])
    rd("del", *([k for k in rd("keys", f"login_fail:{E['pw']}:*").split() if k] or ["x"]))
    for _ in range(5):
        cp("not-my-password", NEW)
    r = cp(PW, NEW)
    check("guessing the current password shares the sign-in lockout: after 5 misses even the right one is refused (429)", r.status_code == 429 and int(r.headers.get("Retry-After", 0)) > 0, r.status_code)
    rd("del", *[k for k in rd("keys", f"login_fail:{E['pw']}:*").split() if k])
    r = cp(PW, NEW)
    check("correct current + valid new -> 200 with a fresh session for this device", r.status_code == 200 and r.json()["refresh_token"] and r.json()["user"]["email"] == E["pw"], r.text[:80])
    fresh = r.json()
    check("the OLD password no longer signs in; the NEW one does", login(E["pw"], PW).status_code == 401 and login(E["pw"], NEW).status_code == 200)
    check("the OTHER device is signed out (its refresh token is revoked -> 401)", requests.post(f"{API}/auth/refresh", json={"refresh_token": other["refresh_token"]}).status_code == 401)
    check("this device's new refresh token works", requests.post(f"{API}/auth/refresh", json={"refresh_token": fresh["refresh_token"]}).status_code == 200)
    check("password stored hashed", pg(f"select hashed_password like '$2%' from users where email='{E['pw']}'") == "t")

    print("== 2. Edit own profile ==")
    t = hdr(login(E["ten"], PW).json()["access_token"])
    up = lambda body, h=t: requests.patch(f"{API}/auth/me", headers=h, json=body)
    r = up({"full_name": "  New Name  ", "phone": "+91 98765 43210"})
    check("valid name + phone -> 200, name trimmed", r.status_code == 200 and r.json()["full_name"] == "New Name" and r.json()["phone"] == "+91 98765 43210", r.text[:100])
    check("blank name -> 422", up({"full_name": "   "}).status_code == 422)
    check("name over 255 characters -> 422", up({"full_name": "x" * 256}).status_code == 422)
    check("garbage phone -> 422", up({"phone": "call me maybe"}).status_code == 422)
    check("phone with too few digits -> 422", up({"phone": "12345"}).status_code == 422)
    check("phone over 20 characters -> 422", up({"phone": "1" * 21}).status_code == 422)
    check("empty phone clears it", up({"phone": ""}).json()["phone"] is None)
    check("omitted fields are left alone", up({"full_name": "Only Name"}).json()["full_name"] == "Only Name")
    r = up({"full_name": "Sneaky", "email": "hacker@example.com", "role": "manager", "is_active": False, "email_verified": False, "id": 1})
    me = requests.get(f"{API}/auth/me", headers=t).json()
    check("email, role, active flag and id can NOT be changed through the profile endpoint", r.status_code == 200 and me["email"] == E["ten"] and me["role"] == "tenant" and me["is_active"] is True and me["id"] == ids["ten"] and me["email_verified"] is True, me)
    check("the change is persisted", pg(f"select full_name from users where email='{E['ten']}'") == "Sneaky")
    check("no token -> 401/403", requests.patch(f"{API}/auth/me", json={"full_name": "x"}).status_code in (401, 403))

    print("== 3. Manager: deactivate / reactivate ==")
    ten_login = login(E["ten"], PW).json()
    act = lambda uid, on, h=mgr: requests.patch(f"{API}/auth/users/{uid}/active", headers=h, json={"is_active": on})
    check("a tenant can't use it (403)", act(ids["own"], False, t).status_code == 403)
    o = hdr(login(E["own"], PW).json()["access_token"])
    check("an owner can't use it (403)", act(ids["ten"], False, o).status_code == 403)
    check("no token -> 401/403", requests.patch(f"{API}/auth/users/{ids['ten']}/active", json={"is_active": False}).status_code in (401, 403))
    check("a manager can't deactivate themselves (400)", act(1, False).status_code == 400 and login("rajesh@propai.in", "PropAI@2024").status_code == 200)
    check("unknown user -> 404", act(99999999, False).status_code == 404)
    check("missing/invalid body -> 422", requests.patch(f"{API}/auth/users/{ids['ten']}/active", headers=mgr, json={"is_active": "maybe"}).status_code == 422)
    r = act(ids["ten"], False)
    check("deactivate a tenant -> 200, is_active false", r.status_code == 200 and r.json()["is_active"] is False, r.text[:80])
    check("...their EXISTING access token stops working immediately (401)", requests.get(f"{API}/auth/me", headers=t).status_code == 401)
    check("...they can't refresh (401) or sign in (400)", requests.post(f"{API}/auth/refresh", json={"refresh_token": ten_login["refresh_token"]}).status_code == 401 and login(E["ten"], PW).status_code == 400)
    check("the list shows them as inactive", any(u["email"] == E["ten"] and u["is_active"] is False for u in requests.get(f"{API}/auth/users", headers=mgr).json()))
    check("deactivating again is harmless (200)", act(ids["ten"], False).status_code == 200)
    r = act(ids["ten"], True)
    check("reactivate -> 200 and they can sign in again", r.status_code == 200 and r.json()["is_active"] is True and login(E["ten"], PW).status_code == 200)
    m2 = hdr(login(E["mgr2"], PW).json()["access_token"])
    check("a second manager can deactivate the first manager's tenant but not themselves", act(ids["ten"], False, m2).status_code == 200 and act(ids["mgr2"], False, m2).status_code == 400)
    act(ids["ten"], True)
    check("a manager can deactivate another manager (and that manager is locked out at once)", act(ids["mgr2"], False).status_code == 200 and requests.get(f"{API}/auth/me", headers=m2).status_code == 401)
finally:
    pg("delete from users where email like 'accttest\\_%'")
    ks = [k for k in rd("--scan", "--pattern", "*accttest*").split() if k]
    if ks:
        rd("del", *ks)
    check("cleanup: user count back to baseline", pg("select count(*) from users") == BASE_USERS, (BASE_USERS, pg("select count(*) from users")))
    check("cleanup: no test keys left in Redis", not [k for k in rd("--scan", "--pattern", "*accttest*").split() if k])

print(f"\n{sum(results)}/{len(results)} passed")
sys.exit(0 if all(results) else 1)
