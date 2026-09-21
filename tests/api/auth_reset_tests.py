"""API tests: forgotten-password flow (POST /auth/forgot-password, POST /auth/reset-password).
Needs the backend in TEST MODE (codes printed in the log) - run through tests/run_all.py. Everything created is removed at the end."""
import os, re, subprocess, sys, time, warnings
import requests
warnings.filterwarnings("ignore")

API = os.environ.get("API", "http://localhost:8000")
results = []
OLD, NEW = "OldPass-12345", "NewPass-67890"


def check(name, ok, detail=""):
    results.append(bool(ok))
    print(("PASS " if ok else "FAIL ") + name + (f"  [{str(detail)[:200]}]" if detail != "" else ""))


def sh(*a, stdin=None):
    return subprocess.run(list(a), capture_output=True, text=True, input=stdin, encoding="utf-8").stdout.strip()


def pg(sql):
    return sh("docker", "exec", "-i", "property_postgres", "psql", "-U", "postgres", "-d", "property_management", "-At", stdin=sql)


def rd(*args):
    return sh("docker", "exec", "property_redis", "redis-cli", *args)


def code_from_log(email, kind="password reset"):
    p = subprocess.run(["docker", "logs", "property_backend", "--since", "3m"], capture_output=True, text=True, encoding="utf-8")
    found = re.findall(rf"{kind} code for {re.escape(email)} is (\d{{6}})", p.stdout + p.stderr)
    return found[-1] if found else None


def logs_mention(email):
    p = subprocess.run(["docker", "logs", "property_backend", "--since", "3m"], capture_output=True, text=True, encoding="utf-8")
    return len(re.findall(rf"code for {re.escape(email)} is", p.stdout + p.stderr))


def forgot(email):
    return requests.post(f"{API}/auth/forgot-password", json={"email": email})


def reset(email, otp, pw=NEW):
    return requests.post(f"{API}/auth/reset-password", json={"email": email, "otp": otp, "new_password": pw})


def login(email, pw):
    return requests.post(f"{API}/auth/login", json={"email": email, "password": pw})


def fresh(email):
    """Clear cooldown + hourly cap so the next request may send."""
    rd("del", f"pwreset_cd:{email}", f"pwreset_sent:{email}")


mgr = {"Authorization": "Bearer " + requests.post(f"{API}/auth/login", json={"email": "rajesh@propai.in", "password": "PropAI@2024"}).json()["access_token"]}
BASE_USERS = pg("select count(*) from users")
U = [f"resettest_{i}@example.com" for i in range(1, 6)]
try:
    for e in U[:4]:
        r = requests.post(f"{API}/auth/users", headers=mgr, json={"email": e, "full_name": "Reset Test", "password": OLD, "role": "tenant"})
        assert r.status_code == 201, r.text
    e = U[0]

    print("== 1. Requesting a code ==")
    r = forgot(e)
    ok_body = r.json()
    check("existing account -> 200 with a generic message", r.status_code == 200 and "If an account exists" in ok_body["message"] and ok_body["resend_in"] == 60, r.text[:100])
    time.sleep(0.5)
    code = code_from_log(e)
    check("a 6-digit reset code was issued", code is not None and len(code) == 6, code)
    stored = rd("hget", f"pwreset:{e}", "h")
    check("stored only as a keyed hash, in its own Redis namespace (not the sign-up one)", len(stored) == 64 and code not in stored and rd("exists", f"otp:{e}") == "0", stored[:12])
    check("the code expires (TTL <= 600 s)", 0 < int(rd("ttl", f"pwreset:{e}") or -1) <= 600)

    print("== 2. No account enumeration ==")
    ghost = "resettest_nobody@example.com"
    r2 = forgot(ghost)
    check("unknown address -> identical status and body shape", r2.status_code == 200 and set(r2.json()) == set(ok_body) and r2.json()["message"] == ok_body["message"], r2.text[:100])
    time.sleep(0.4)
    check("...and nothing was issued or logged for it", rd("exists", f"pwreset:{ghost}") == "0" and logs_mention(ghost) == 0)
    unv = U[4]
    requests.post(f"{API}/auth/register", json={"email": unv, "full_name": "Unverified", "password": OLD, "role": "tenant"})
    r3 = forgot(unv)
    check("an UNVERIFIED account gets the same reply but no reset code", r3.status_code == 200 and r3.json()["message"] == ok_body["message"] and rd("exists", f"pwreset:{unv}") == "0")
    pg(f"update users set is_active=false where email='{U[3]}'")
    r4 = forgot(U[3])
    check("a DEACTIVATED account gets the same reply but no reset code", r4.status_code == 200 and rd("exists", f"pwreset:{U[3]}") == "0")
    pg(f"update users set is_active=true where email='{U[3]}'")
    check("reset-password for unknown / unverified addresses is the generic 400", reset(ghost, "123456").status_code == 400 and reset(unv, "123456").status_code == 400)

    print("== 3. Cooldown and hourly cap ==")
    r = forgot(e)
    check("a second request inside 60 s -> 429 with Retry-After", r.status_code == 429 and 0 < int(r.headers.get("Retry-After", 0)) <= 60, r.headers.get("Retry-After"))
    for _ in range(6):
        rd("del", f"pwreset_cd:{e}")
        last = forgot(e)
    check("more than 5 codes in an hour -> 429", last.status_code == 429, last.text[:80])
    fresh(e)
    forgot(e); time.sleep(0.5)
    code = code_from_log(e)                                   # the newest code is the valid one
    check("sign-up and reset cooldowns are independent (a reset request doesn't start the sign-up cooldown)", rd("exists", f"otp_cd:{e}") == "0")

    print("== 4. Guessing the code ==")
    wrong = "000000" if code != "000000" else "111111"
    r = reset(e, wrong)
    check("wrong code -> 400 with attempts left", r.status_code == 400 and "4 attempts left" in r.text, r.text[:90])
    r = reset(e, code, pw="short")
    check("a too-short new password -> 422", r.status_code == 422)
    r = reset(e, code, pw="x" * 80)
    check("a 80-byte new password -> 422 (bcrypt would truncate)", r.status_code == 422)
    check("...and those refused requests did NOT burn the code or change the password", rd("hget", f"pwreset:{e}", "n") == "1" and login(e, OLD).status_code == 200)
    for _ in range(3):
        last = reset(e, wrong)
    r = reset(e, wrong)
    check("5 wrong guesses burn the code", r.status_code == 400 and "Too many" in r.text, r.text[:90])
    r = reset(e, code)
    check("even the correct code fails afterwards (400 expired)", r.status_code == 400 and "expired" in r.text.lower(), r.text[:90])
    check("password still the old one", login(e, OLD).status_code == 200 and login(e, NEW).status_code == 401)

    print("== 5. A successful reset ==")
    old_tokens = login(e, OLD).json()
    for _ in range(5):
        login(e, "definitely-wrong-1")                        # lock this (email, IP) out
    locked = login(e, OLD).status_code
    fresh(e); forgot(e); time.sleep(0.5)
    code = code_from_log(e)
    other = code_from_log(U[1])
    check("a code issued for one address can't reset another (400)", reset(U[1], code).status_code == 400)
    r = reset(e, code)
    check("correct code + valid password -> 200", r.status_code == 200 and "Password updated" in r.text, r.text[:90])
    check("the OLD password no longer works; the NEW one does (and the earlier lockout was lifted)", locked == 429 and login(e, OLD).status_code == 401 and login(e, NEW).status_code == 200, f"locked-before={locked}")
    check("existing sessions were signed out: the old refresh token is dead (401)", requests.post(f"{API}/auth/refresh", json={"refresh_token": old_tokens["refresh_token"]}).status_code == 401)
    check("the code is single-use (400 on reuse)", reset(e, code, pw="Another-Pass-1").status_code == 400)
    check("reset does not sign anybody in (no token in the response)", "access_token" not in r.text)

    print("== 6. Sign-up codes and reset codes are not interchangeable ==")
    time.sleep(0.5)
    vcode = code_from_log(unv, kind="verification")
    r = reset(unv, vcode or "123456")
    check("a sign-up verification code can't reset a password (400)", r.status_code == 400)
    fresh(U[1]); forgot(U[1]); time.sleep(0.5)
    rcode = code_from_log(U[1])
    r = requests.post(f"{API}/auth/verify-email", json={"email": U[1], "otp": rcode})
    check("a reset code can't be used to verify an email (400)", r.status_code == 400)
    check("malformed body -> 422, not 500", requests.post(f"{API}/auth/reset-password", json={"email": "nope"}).status_code == 422 and requests.post(f"{API}/auth/forgot-password", json={}).status_code == 422)
finally:
    pg("delete from users where email like 'resettest\\_%'")
    for pat in ("pwreset*resettest*", "otp*resettest*", "login_fail:resettest*"):
        ks = [k for k in rd("--scan", "--pattern", pat).split() if k]
        if ks:
            rd("del", *ks)
    check("cleanup: user count back to baseline", pg("select count(*) from users") == BASE_USERS, (BASE_USERS, pg("select count(*) from users")))
    check("cleanup: no test keys left in Redis", not [k for k in rd("--scan", "--pattern", "*resettest*").split() if k])

print(f"\n{sum(results)}/{len(results)} passed")
sys.exit(0 if all(results) else 1)
