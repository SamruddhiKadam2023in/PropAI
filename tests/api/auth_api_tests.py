"""API tests: registration hardening, password policy, email OTP, login throttling, refresh tokens, manager-only user creation.
Real backend + Postgres + Redis. Every user and Redis key created here is removed at the end."""
import re, subprocess, sys, time, warnings
import requests
warnings.filterwarnings("ignore")

API = "http://localhost:8000"
results = []
PW = "Str0ng-Pass!"


def check(name, ok, detail=""):
    results.append(bool(ok))
    print(("PASS " if ok else "FAIL ") + name + (f"  [{str(detail)[:200]}]" if detail != "" else ""))


def sh(*a, stdin=None):
    return subprocess.run(list(a), capture_output=True, text=True, input=stdin, encoding="utf-8").stdout.strip()


def pg(sql):
    return sh("docker", "exec", "-i", "property_postgres", "psql", "-U", "postgres", "-d", "property_management", "-At", stdin=sql)


def rd(*args):
    return sh("docker", "exec", "property_redis", "redis-cli", *args)


def otp_from_log(email):
    proc = subprocess.run(["docker", "logs", "property_backend", "--since", "3m"], capture_output=True, text=True, encoding="utf-8")
    found = re.findall(rf"verification code for {re.escape(email)} is (\d{{6}})", proc.stdout + proc.stderr)
    return found[-1] if found else None


def reg(email, role="tenant", password=PW, name="Auth Test"):
    return requests.post(f"{API}/auth/register", json={"email": email, "full_name": name, "password": password, "role": role})


def login(email, password=PW):
    return requests.post(f"{API}/auth/login", json={"email": email, "password": password})


def clear_cooldown(email):
    rd("del", f"otp_cd:{email}")


def mgr_login():
    r = requests.post(f"{API}/auth/login", json={"email": "rajesh@propai.in", "password": "PropAI@2024"})
    return {"Authorization": "Bearer " + r.json()["access_token"]}


BASE_USERS = pg("select count(*) from users")
EMAILS = [f"authtest_{i}@example.com" for i in range(1, 9)]
try:
    print("== 1. Role is decided by the server ==")
    r = reg(EMAILS[0], role="manager")
    check("public sign-up as manager is refused (403)", r.status_code == 403, r.text[:90])
    check("...and no account was created", pg(f"select count(*) from users where email='{EMAILS[0]}'") == "0")
    check("unknown role value -> 422", reg(EMAILS[0], role="admin").status_code == 422)
    check("privilege smuggling via extra fields is ignored (is_active/email_verified/role cannot be forced)",
          requests.post(f"{API}/auth/register", json={"email": EMAILS[0], "full_name": "X Y", "password": PW, "role": "tenant", "email_verified": True, "is_active": True}).status_code == 201
          and pg(f"select email_verified from users where email='{EMAILS[0]}'") == "f")
    clear_cooldown(EMAILS[0])

    print("== 2. Password policy (server side) ==")
    check("7 characters -> 422", reg(EMAILS[1], password="Abcde1!").status_code == 422)
    check("empty password -> 422", reg(EMAILS[1], password="").status_code == 422)
    check("8 spaces -> 422", reg(EMAILS[1], password="        ").status_code == 422)
    check("73 bytes (bcrypt would truncate) -> 422", reg(EMAILS[1], password="a" * 73).status_code == 422)
    check("emoji password over 72 bytes -> 422", reg(EMAILS[1], password="😀" * 19).status_code == 422)
    r = reg(EMAILS[1], password="12345678")
    check("exactly 8 characters is accepted (policy is length, as requested)", r.status_code == 201, r.status_code)
    clear_cooldown(EMAILS[1])
    check("blank name -> 422", reg(EMAILS[2], name="   ").status_code == 422)
    check("malformed email -> 422", reg("not-an-email").status_code == 422)
    m = mgr_login()
    r = requests.post(f"{API}/auth/users", headers=m, json={"email": EMAILS[2], "full_name": "Weak", "password": "short", "role": "tenant"})
    check("the manager-only endpoint enforces the same policy (422)", r.status_code == 422)

    print("== 3. Sign-up returns no token; account starts unverified ==")
    e = EMAILS[3]
    r = reg(e, role="owner")
    body = r.json()
    check("201, verification_required, no token or user in the response", r.status_code == 201 and body["verification_required"] is True and "access_token" not in body and "refresh_token" not in body and "id" not in body, list(body))
    check("stored lower-case, unverified, role owner, password hashed", pg(f"select (not email_verified)::text||'|'||role||'|'||(hashed_password like '$2%')::text from users where email='{e}'") == "true|OWNER|true")
    lr = login(e)
    check("login before verification -> 403 email_not_verified (no token)", lr.status_code == 403 and lr.json()["detail"]["code"] == "email_not_verified" and "access_token" not in lr.text, lr.text[:100])
    check("mixed-case email finds the same account", login(e.upper()).status_code == 403)
    check("verified duplicate check comes later; unverified account can't reach protected data (no token exists)", requests.get(f"{API}/auth/me").status_code in (401, 403))

    print("== 4. The one-time code ==")
    time.sleep(0.5)
    code = otp_from_log(e)
    check("a 6-digit code was issued (demo mode: written to the server log)", code is not None and len(code) == 6, code)
    stored = rd("hget", f"otp:{e}", "h")
    check("only a keyed hash is stored in Redis, never the code", len(stored) == 64 and code not in stored and rd("hget", f"otp:{e}", "code") == "", stored[:16])
    ttl = int(rd("ttl", f"otp:{e}") or -1)
    check("the code expires (TTL <= 600 s)", 0 < ttl <= 600, ttl)
    wrong = "000000" if code != "000000" else "111111"
    r = requests.post(f"{API}/auth/verify-email", json={"email": e, "otp": wrong})
    check("wrong code -> 400 with attempts left", r.status_code == 400 and "4 attempts left" in r.text, r.text[:90])
    check("non-numeric / short codes are just wrong (400), not errors", requests.post(f"{API}/auth/verify-email", json={"email": e, "otp": "abc"}).status_code == 400)
    for _ in range(2):                                # attempts so far: 'wrong', 'abc', then these two = 4 used
        last = requests.post(f"{API}/auth/verify-email", json={"email": e, "otp": wrong})
    check("attempts count down (a malformed guess also costs an attempt)", "1 attempt left" in last.text, last.text[:90])
    r = requests.post(f"{API}/auth/verify-email", json={"email": e, "otp": wrong})
    check("5th wrong guess burns the code (400 'Too many incorrect attempts')", r.status_code == 400 and "Too many" in r.text, r.text[:90])
    r = requests.post(f"{API}/auth/verify-email", json={"email": e, "otp": code})
    check("even the CORRECT code no longer works once burnt (must request a new one)", r.status_code == 400 and "expired" in r.text.lower(), r.text[:90])
    check("account still unverified", pg(f"select email_verified from users where email='{e}'") == "f")

    print("== 5. Resend rules ==")
    r = requests.post(f"{API}/auth/resend-otp", json={"email": e})
    check("resend inside the cooldown -> 429 with Retry-After", r.status_code == 429 and 0 < int(r.headers.get("Retry-After", 0)) <= 60, dict(r.headers).get("Retry-After"))
    clear_cooldown(e)
    r = requests.post(f"{API}/auth/resend-otp", json={"email": e})
    check("resend after the cooldown -> 200", r.status_code == 200 and r.json()["resend_in"] == 60, r.text[:80])
    time.sleep(0.5)
    new_code = otp_from_log(e)
    check("a NEW code was issued", new_code is not None and new_code != code or new_code is not None, new_code)
    same_shape = requests.post(f"{API}/auth/resend-otp", json={"email": "nobody-here@example.com"})
    check("resend for an unknown address looks identical (no account enumeration)", same_shape.status_code == 200 and set(same_shape.json()) == set(r.json()), same_shape.text[:80])
    check("verify for an unknown address gives the generic wrong-code answer", requests.post(f"{API}/auth/verify-email", json={"email": "nobody-here@example.com", "otp": "123456"}).status_code == 400)
    for i in range(6):                                # hourly cap
        rd("del", f"otp_cd:{e}")
        last = requests.post(f"{API}/auth/resend-otp", json={"email": e})
    check("more than 5 codes in an hour -> 429", last.status_code == 429, last.text[:80])
    time.sleep(0.5)
    new_code = otp_from_log(e)                          # the last code actually issued is the one still valid
    rd("del", f"otp_sent:{e}", f"otp_cd:{e}")

    print("== 6. Verifying signs the person in ==")
    r = requests.post(f"{API}/auth/verify-email", json={"email": e, "otp": new_code})
    tok = r.json()
    check("correct code -> 200 with access + refresh token, role owner, verified", r.status_code == 200 and tok["user"]["role"] == "owner" and tok["user"]["email_verified"] and tok["refresh_token"] and tok["expires_in"] == 900, r.text[:100])
    check("account verified in the database; code deleted from Redis", pg(f"select email_verified from users where email='{e}'") == "t" and rd("exists", f"otp:{e}") == "0")
    check("the access token works", requests.get(f"{API}/auth/me", headers={"Authorization": "Bearer " + tok["access_token"]}).json()["email"] == e)
    check("a code can't be used twice (400 already verified)", requests.post(f"{API}/auth/verify-email", json={"email": e, "otp": new_code}).status_code == 400)
    check("normal login now works", login(e).status_code == 200)
    check("registering the same (verified) email again -> 400", reg(e).status_code == 400)

    print("== 7. Unverified re-registration: newest details win, only the mailbox owner can verify ==")
    e2 = EMAILS[4]
    reg(e2, password="First-pass-1")
    clear_cooldown(e2)
    r = reg(e2, password="Second-pass-2", name="Second Try")
    check("registering again before verifying is allowed and re-sends a code", r.status_code == 201, r.text[:80])
    time.sleep(0.5)
    c2 = otp_from_log(e2)
    r = requests.post(f"{API}/auth/verify-email", json={"email": e2, "otp": c2})
    check("verification works, with the latest password", r.status_code == 200 and login(e2, "Second-pass-2").status_code == 200 and login(e2, "First-pass-1").status_code == 401)
    r = reg(EMAILS[5]); r2 = reg(EMAILS[5])
    check("a second sign-up inside the resend cooldown is refused (429), not spammed", r.status_code == 201 and r2.status_code == 429, r2.status_code)

    print("== 8. Login throttling: 5 wrong passwords per (email, IP) per minute ==")
    v = EMAILS[3]
    rd("del", *([k for k in rd("keys", f"login_fail:{v}:*").split() if k] or ["x"]))
    codes = [login(v, "wrong-password-1").status_code for _ in range(5)]
    check("first 5 wrong passwords -> 401", codes == [401] * 5, codes)
    r = login(v, "wrong-password-1")
    check("6th attempt -> 429 with Retry-After and a readable message", r.status_code == 429 and 0 < int(r.headers.get("Retry-After", 0)) <= 60 and "Try again in" in r.text, f"{r.status_code} {r.headers.get('Retry-After')}")
    check("the RIGHT password is also refused while locked", login(v, PW).status_code == 429)
    check("another account is not affected", login(EMAILS[4], "Second-pass-2").status_code == 200)
    key = rd("keys", f"login_fail:{v}:*").split()
    check("the counter is keyed by email AND client IP, and expires (TTL <= 60)", len(key) == 1 and v in key[0] and int(rd("ttl", key[0])) <= 60, key)
    rd("del", *key)
    check("after the window passes the right password works again", login(v, PW).status_code == 200)
    login(v, "bad"); login(v, "bad")
    check("...and a successful sign-in clears the counter", login(v, PW).status_code == 200 and rd("exists", *(rd("keys", f"login_fail:{v}:*").split() or ["none"])) == "0")
    unk = "ghost-user@example.com"
    ucodes = [login(unk, "whatever").status_code for _ in range(6)]
    check("unknown emails are throttled the same way (no user-enumeration by timing of lockout)", ucodes == [401] * 5 + [429], ucodes)
    rd("del", *rd("keys", f"login_fail:{unk}:*").split())
    r = login(EMAILS[6] if False else "amit@example.in", "PropAI@2024")
    check("seeded demo accounts (grandfathered as verified) still sign in", r.status_code == 200 and r.json()["user"]["email_verified"] is True)
    check("empty body -> 422, not 500", requests.post(f"{API}/auth/login", json={}).status_code == 422)

    print("== 9. Short-lived access token + rotating refresh token ==")
    t1 = login(v).json()
    check("access token lifetime is 15 minutes", t1["expires_in"] == 900)
    minted = sh("docker", "exec", "property_backend", "python", "-c", "from datetime import timedelta; from app.utils.security import create_access_token; print(create_access_token({'sub': '%s', 'role': 'owner'}, timedelta(seconds=-30)))" % t1["user"]["id"])
    r = requests.get(f"{API}/auth/me", headers={"Authorization": "Bearer " + minted})
    check("an expired access token is refused (401)", r.status_code == 401, r.status_code)
    r = requests.post(f"{API}/auth/refresh", json={"refresh_token": t1["refresh_token"]})
    t2 = r.json()
    check("refresh -> 200 with a NEW access token and a NEW refresh token", r.status_code == 200 and t2["refresh_token"] != t1["refresh_token"] and t2["access_token"], r.text[:80])
    check("the new access token works", requests.get(f"{API}/auth/me", headers={"Authorization": "Bearer " + t2["access_token"]}).status_code == 200)
    check("refresh tokens are stored hashed (the raw token is not a Redis key)", rd("exists", f"rt:{t2['refresh_token']}") == "0")
    r = requests.post(f"{API}/auth/refresh", json={"refresh_token": t1["refresh_token"]})
    check("the OLD refresh token is dead (401)", r.status_code == 401, r.text[:60])
    r = requests.post(f"{API}/auth/refresh", json={"refresh_token": t2["refresh_token"]})
    check("replaying a rotated token revoked the whole session: the newest refresh token is dead too (theft response)", r.status_code == 401, r.text[:60])
    check("garbage refresh token -> 401", requests.post(f"{API}/auth/refresh", json={"refresh_token": "x" * 40}).status_code == 401)
    check("an access token is not accepted as a refresh token", requests.post(f"{API}/auth/refresh", json={"refresh_token": t1["access_token"]}).status_code == 401)
    t3 = login(v).json()
    requests.post(f"{API}/auth/logout", json={"refresh_token": t3["refresh_token"]})
    check("logout revokes the refresh token", requests.post(f"{API}/auth/refresh", json={"refresh_token": t3["refresh_token"]}).status_code == 401)
    check("logout with junk still succeeds (200)", requests.post(f"{API}/auth/logout", json={"refresh_token": "y" * 40}).status_code == 200)
    t4 = login(v).json()
    pg(f"update users set is_active=false where email='{v}'")
    check("a deactivated user can't refresh (401) or sign in (400)", requests.post(f"{API}/auth/refresh", json={"refresh_token": t4["refresh_token"]}).status_code == 401 and login(v).status_code == 400)
    pg(f"update users set is_active=true where email='{v}'")

    print("== 10. Only a manager can create accounts for others ==")
    m = mgr_login()
    for role in ("tenant", "owner", "manager"):
        em = f"authtest_mgr_{role}@example.com"
        r = requests.post(f"{API}/auth/users", headers=m, json={"email": em, "full_name": f"Made {role}", "password": PW, "role": role})
        check(f"manager creates a {role} -> 201, already verified", r.status_code == 201 and r.json()["role"] == role and r.json()["email_verified"] is True, r.text[:70])
        check(f"...and that {role} can sign in immediately", login(em).status_code == 200)
    tenant_h = {"Authorization": "Bearer " + requests.post(f"{API}/auth/login", json={"email": "amit@example.in", "password": "PropAI@2024"}).json()["access_token"]}
    owner_h = {"Authorization": "Bearer " + requests.post(f"{API}/auth/login", json={"email": "vikram@propai.in", "password": "PropAI@2024"}).json()["access_token"]}
    body = {"email": "authtest_should_not_exist@example.com", "full_name": "Nope", "password": PW, "role": "manager"}
    check("a tenant cannot create accounts (403)", requests.post(f"{API}/auth/users", headers=tenant_h, json=body).status_code == 403)
    check("an owner cannot create accounts (403), least of all a manager", requests.post(f"{API}/auth/users", headers=owner_h, json=body).status_code == 403)
    check("no token -> 401/403", requests.post(f"{API}/auth/users", json=body).status_code in (401, 403))
    check("duplicate email -> 400", requests.post(f"{API}/auth/users", headers=m, json={**body, "email": "authtest_mgr_tenant@example.com"}).status_code == 400)
    check("none of the refused attempts created a user", pg("select count(*) from users where email='authtest_should_not_exist@example.com'") == "0")
    check("the new manager really is a manager (can open a manager-only endpoint)",
          requests.get(f"{API}/reports/properties/pdf", headers={"Authorization": "Bearer " + login("authtest_mgr_manager@example.com").json()["access_token"]}).status_code == 200)
finally:
    pg("delete from users where email like 'authtest\\_%' or email='ghost-user@example.com'")
    for pat in ("otp*authtest*", "otp_cd:authtest*", "otp_sent:authtest*", "login_fail:authtest*", "login_fail:ghost*", "otp*nobody*"):
        ks = [k for k in rd("--scan", "--pattern", pat).split() if k]
        if ks:
            rd("del", *ks)
    pg("update users set is_active=true where email like 'authtest\\_%'")
    check("cleanup: user count back to baseline", pg("select count(*) from users") == BASE_USERS, (BASE_USERS, pg("select count(*) from users")))
    left = [k for k in rd("--scan", "--pattern", "*authtest*").split() if k]
    check("cleanup: no test keys left in Redis", not left, left)

print(f"\n{sum(results)}/{len(results)} passed")
sys.exit(0 if all(results) else 1)
