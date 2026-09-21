# PropAI tests

End-to-end tests that drive the **real running app**: real API calls against the real databases, and a real browser for the UI.
Nothing is mocked. Every suite creates its own users, properties and payments and removes them again afterwards.

## What is covered

| Area | Suites |
|---|---|
| Sign-up, email OTP, password policy, login throttling, refresh tokens, manager-only user creation | `api/auth_api_tests.py`, `ui/ui_auth.mjs` |
| Forgotten password (code by email, reset, sessions revoked) | `api/auth_reset_tests.py`, `ui/ui_reset.mjs` |
| Account page: edit profile, change password, Manager deactivate / reactivate users | `api/account_api_tests.py`, `ui/ui_account.mjs` |
| Email sender (SMTP message, escaping, failures) | `api/smtp_sender_test.py` |
| Tenant agreement abandonment rule | `api/abandon_api_tests.py`, `ui/ui_abandon.mjs` |
| Tenant pages, documents, maintenance, messages, SMS / WhatsApp links, isolation | `api/tenant_api_tests.py`, `ui/ui_tenant.mjs` |
| Owner maintenance, service providers and fees | `api/maint_regression_tests.py`, `api/providers_dir_api_tests.py`, `ui/ui_dirs.mjs` |
| Application approve / reject, expenses (authorization) | `api/approve_auth_tests.py`, `api/expense_auth_tests.py` |
| Bill reading: sample English + Marathi bills end to end, and the extraction rules | `api/ocr_bills_tests.py`, `api/ocr_extractor_unit.py` (fixtures in `assets/bills/`) |
| Manager exports, OCR configuration removed | `ui/ui_export.mjs`, `ui/ui_mgr_ocr.mjs` |
| Login page, demo login panel | `ui/ui_demo_restore.mjs` |
| Every page for every role, light and dark, phone and desktop; role/authorization matrix | `ui/reg_sweep.mjs` (`api`, `guards`, `tenant`, `owner`, `manager`) |
| Responsive audit (overflow, clipped text, tap targets) | `ui/resp_audit.mjs` (run by hand, prints a report) |

## Running them

One-time setup, from the project root:

```
pip install -r tests/requirements.txt
cd tests && npm install && cd ..
```

The browser suites use Microsoft Edge. If it is somewhere else, set `BROWSER_PATH` to any Chromium-based browser executable.
Docker Desktop must be running with the stack up (`docker compose up -d`).

```
python tests/run_all.py                # everything in the default set
python tests/run_all.py --api-only     # just the API suites
python tests/run_all.py --only reset   # suites whose name contains "reset"
```

The runner does three things you should know about:

1. **Switches the backend to test mode** using `tests/docker-compose.test.yml`. In test mode no real email is sent and the one-time
   codes are printed in the backend log, which is how the tests read them. Without this, sign-up tests would try to email
   `example.com` addresses through your real mail account.
2. Runs the suites and prints one line per suite.
3. **Restores normal mode** when it finishes (also on Ctrl+C or failure), so your `backend/.env` email settings apply again.

To run a single suite by hand you must be in test mode first:

```
docker compose -f docker-compose.yml -f tests/docker-compose.test.yml up -d --force-recreate backend
python tests/api/auth_reset_tests.py
cd tests/ui && node ui_reset.mjs
docker compose up -d --force-recreate backend      # back to normal
```

## "Seed baseline" suites

`api/seed/*` and `ui_docs`, `ui_clean`, `ui_payments`, `ui_rent` assert the exact contents of the **untouched sample data**
(for example "Amit has exactly 12 payments and no documents"). They fail as soon as anyone records a payment, uploads a
document or raises a maintenance request by hand, and that is expected. Run them only on a fresh database:

```
docker compose down -v && docker compose up -d --build
docker exec property_backend python seed.py
python tests/run_all.py --seed
```

## Notes

- Test accounts use addresses like `authtest_*@example.com`, `resettest_*`, `abn_*`. If a run is killed half-way you can remove
  leftovers with `delete from users where email like 'authtest\_%'` (same pattern for the others).
- Generated files (screenshots, exported PDFs/Excel) go to `tests/ui/shots/` and `tests/.artifacts/` and are safe to delete.
- `assets/make_assets.py` regenerates the sample bills used by the upload tests (it uses Windows fonts).
- Test data is created through the Manager-only endpoint `POST /auth/users`, because public sign-up requires an emailed code.

## Sample bills (`assets/bills/`)

The bill-reading tests use three **sample bills that are entirely invented** (names, numbers, addresses and dates are made up, and each
is stamped "SAMPLE - TEST DATA"). They copy the *layout* of typical Indian bills: a Marathi + English electricity bill, a Marathi +
English "duplicate" water bill, and an English electricity bill shrunk so far that it cannot be read (it must come back empty and
"needs review", never guessed). Never add a real person's bill to this repository.

- `assets/make_bills.mjs` draws them (`cd tests && node assets/make_bills.mjs`; needs Edge/Chrome and, for Marathi, the Nirmala UI font).
- `assets/bills/expected.json` is what the reader must find in each one.
- `assets/bills/*.ocr.json` are saved OCR readings used by the fast unit tests. After regenerating the pictures, rebuild them by running
  `run_hybrid_ocr(path, budget_seconds=90)` on each picture inside the backend container and saving `{"lines": [l.to_dict() ...], "languages": ...}`.
