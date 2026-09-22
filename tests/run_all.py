#!/usr/bin/env python
"""
Runs the PropAI test suites against the running Docker stack.

    python tests/run_all.py                 # the default suites (they create their own data and clean up after themselves)
    python tests/run_all.py --only auth     # suites whose name contains "auth"
    python tests/run_all.py --api-only      # skip the browser suites
    python tests/run_all.py --seed          # ALSO run the suites that assume the untouched seed data (see tests/README.md)

While it runs, the backend is switched to TEST MODE (no real email is sent; one-time codes are printed in the backend log so the
tests can read them). Normal mode is restored at the end, even if a suite fails or you press Ctrl+C.
"""
import argparse
import os
import re
import subprocess
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
COMPOSE = ["docker", "compose", "-f", "docker-compose.yml"]
TEST_OVERRIDE = os.path.join("tests", "docker-compose.test.yml")

API_MAIN = ["auth_api_tests", "auth_reset_tests", "account_api_tests", "abandon_api_tests", "approve_auth_tests", "expense_auth_tests",
            "maint_regression_tests", "tenant_api_tests", "providers_dir_api_tests", "ocr_bills_tests", "file_mirror_tests", "expense_sync_tests"]
API_SEED = ["api_tests", "payments_api_tests", "rent_dates_api_tests", "export_api_tests"]
UI_MAIN = ["ui_auth", "ui_reset", "ui_account", "ui_tenant", "ui_abandon", "ui_dirs", "ui_export", "ui_mgr_ocr", "ui_ocr_card", "ui_forecast_zero", "ui_demo_restore", "prod_bundle_check"]
UI_SWEEPS = [("reg_sweep api", ["reg_sweep.mjs", "api"]), ("reg_sweep guards", ["reg_sweep.mjs", "guards"]),
             ("reg_sweep tenant", ["reg_sweep.mjs", "tenant"]), ("reg_sweep owner", ["reg_sweep.mjs", "owner"]),
             ("reg_sweep manager", ["reg_sweep.mjs", "manager"])]
UI_SEED = ["ui_docs", "ui_clean", "ui_payments", "ui_rent"]


def compose(*args, override=False):
    cmd = COMPOSE + (["-f", TEST_OVERRIDE] if override else []) + list(args)
    return subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)


def wait_healthy(timeout=120):
    end = time.time() + timeout
    while time.time() < end:
        try:
            if urllib.request.urlopen("http://localhost:8000/health", timeout=3).status == 200:
                return True
        except Exception:
            time.sleep(2)
    return False


def summarise(output):
    passed = len(re.findall(r"^PASS ", output, re.M))
    failed = len(re.findall(r"^FAIL ", output, re.M))
    return passed, failed


def run(name, cmd, cwd, stdin_path=None):
    start = time.time()
    env = dict(os.environ, PYTHONIOENCODING="utf-8", PYTHONUTF8="1", PYTHON=sys.executable)   # browser suites call Python helpers too
    stdin = open(stdin_path, "rb") if stdin_path else None
    try:
        proc = subprocess.run(cmd, cwd=cwd, capture_output=True, env=env, stdin=stdin, timeout=1500)
        out = (proc.stdout + proc.stderr).decode("utf-8", errors="replace")
        code = proc.returncode
    except subprocess.TimeoutExpired:
        out, code = "TIMED OUT after 25 minutes", 124
    finally:
        if stdin:
            stdin.close()
    passed, failed = summarise(out)
    ok = code == 0 and failed == 0
    print(f"  {'OK  ' if ok else 'FAIL'} {name:<28} {passed:>4} passed {failed:>3} failed   ({time.time() - start:5.0f}s)", flush=True)
    if not ok:
        for line in [l for l in out.splitlines() if l.startswith("FAIL")][:6]:
            print("        " + line[:170])
        if failed == 0:
            print("        " + "\n        ".join(out.strip().splitlines()[-4:])[:600])
    return name, ok, passed, failed


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", help="run only suites whose name contains this text")
    ap.add_argument("--api-only", action="store_true")
    ap.add_argument("--ui-only", action="store_true")
    ap.add_argument("--seed", action="store_true", help="also run the suites that need the untouched seed data")
    ap.add_argument("--keep-test-mode", action="store_true", help="leave the backend in test mode afterwards")
    args = ap.parse_args()

    api = API_MAIN + (API_SEED if args.seed else [])
    ui = [(n, [f"{n}.mjs"]) for n in UI_MAIN] + UI_SWEEPS + ([(n, [f"{n}.mjs"]) for n in UI_SEED] if args.seed else [])
    match = (lambda n: args.only in n) if args.only else (lambda n: True)

    print("Switching the backend to test mode (no real email; codes go to the log) ...")
    r = compose("up", "-d", "--force-recreate", "backend", override=True)
    if r.returncode or not wait_healthy():
        print("Could not start the backend in test mode:\n" + r.stderr[-800:])
        return 2
    results = []
    try:
        if not args.ui_only:
            print("\nAPI suites")
            for n in api:
                if match(n):
                    sub = "seed" if n in API_SEED else ""
                    results.append(run(n, [sys.executable, os.path.join(HERE, "api", sub, f"{n}.py")], HERE))
            if match("smtp_sender_test"):
                results.append(run("smtp_sender_test", ["docker", "exec", "-i", "property_backend", "python", "-"], HERE,
                                   stdin_path=os.path.join(HERE, "api", "smtp_sender_test.py")))
            if match("hosting_unit") or match("ocr_extractor_unit"):
                subprocess.run(["docker", "cp", os.path.join(HERE, "assets", "bills"), "property_backend:/tmp/bills"],
                               capture_output=True, env={**os.environ, "MSYS_NO_PATHCONV": "1"})
            if match("hosting_unit"):
                results.append(run("hosting_unit", ["docker", "exec", "-i", "property_backend", "python", "-"], HERE,
                                   stdin_path=os.path.join(HERE, "api", "hosting_unit.py")))
            if match("ocr_extractor_unit"):
                results.append(run("ocr_extractor_unit", ["docker", "exec", "-i", "property_backend", "python", "-"], HERE,
                                   stdin_path=os.path.join(HERE, "api", "ocr_extractor_unit.py")))
            if match("knn_model_unit"):
                results.append(run("knn_model_unit", ["docker", "exec", "-i", "property_backend", "python", "-"], HERE,
                                   stdin_path=os.path.join(HERE, "api", "knn_model_unit.py")))
        if not args.api_only:
            print("\nBrowser suites")
            for n, argv in ui:
                if match(n):
                    results.append(run(n, ["node"] + argv, os.path.join(HERE, "ui")))
    finally:
        # Test mode mirrors uploads into MongoDB; suites that clean up with SQL leave those copies behind, so empty the collection.
        subprocess.run(["docker", "exec", "property_mongodb", "mongosh", "-u", "mongo", "-p", "mongo123", "--authenticationDatabase", "admin",
                        "property_management", "--quiet", "--eval", "db.file_mirror.deleteMany({})"], capture_output=True, env={**os.environ, "MSYS_NO_PATHCONV": "1"})
        if not args.keep_test_mode:
            print("\nRestoring normal mode (real email settings from backend/.env) ...")
            compose("up", "-d", "--force-recreate", "backend")
            print("  backend healthy again" if wait_healthy() else "  WARNING: backend did not come back - run: docker compose up -d --force-recreate backend")

    failed = [r for r in results if not r[1]]
    total_pass = sum(r[2] for r in results)
    print(f"\n{len(results) - len(failed)}/{len(results)} suites passed, {total_pass} checks passed")
    if failed:
        print("Failed suites: " + ", ".join(r[0] for r in failed))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
