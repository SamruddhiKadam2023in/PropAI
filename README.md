# 🏠 PropAI : AI-Driven Financial Analytics for Property Management

> A full-stack intelligent property management platform combining OCR, NLP, KNN-based rent comparison, and expense forecasting.

**Repository:** [github.com/SamruddhiKadam2023in/PropAI](https://github.com/SamruddhiKadam2023in/PropAI)

---

## 📌 About the Project

PropAI automates financial document processing, predicts rental market trends, and streamlines the complete tenant–owner–manager workflow. It supports three user roles — **Tenant**, **Owner**, and **Manager** — each with a dedicated dashboard and its own set of features.

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Backend | FastAPI, SQLAlchemy, PostgreSQL, MongoDB, Redis |
| Frontend | React 18, Vite, Tailwind CSS, Recharts |
| AI / ML | Tesseract OCR, OpenCV, spaCy, scikit-learn, pypdfium2 |
| Reports | ReportLab (PDF), openpyxl (Excel) |
| Auth | JWT access tokens + rotating refresh tokens, bcrypt, email one-time codes (OTP) |
| Deploy | Docker Compose, Nginx |

---

## ✨ Features by Role

### 🧑‍💼 Tenant
- Dashboard with property info and payment history
- Payments page: what's due this month, record a payment, transaction history with receipts
- Rental agreement view, including any amount still owed after leaving early
- Upload documents — OCR reads English and Marathi bills, classifies the document, and pulls out type, vendor, amount, bill date, due date, billing period, and address (PIN, suburb, city, state)
- Cost analysis with expense trends and next-month forecast
- **Find a Home** — search available properties and apply to rent
- Track rental application status (Pending / Approved / Rejected)
- In-app notifications and messaging with owner

### 🏢 Owner
- Portfolio dashboard with occupancy rate and income summary
- Add, edit, and manage properties
- Review incoming rental applications and approve or reject them
- Analytics powered by KNN market rent comparison
- Download PDF and Excel financial reports
- Messaging with tenants
- Maintenance requests, service records and fees, and a directory of repair contacts
- Agreements: record the rent and term for a tenant, and record a tenant leaving early

### 🛡️ Manager
- Platform-wide dashboard with all users, properties, and rent stats
- Manage users and assign roles
- View and action all rental applications across all properties
- Rent collection tracker (by month or date range)
- Download PDF and Excel reports for all properties, or for a single property
- Add users (Tenant, Owner, or Manager), deactivate or reactivate accounts, and review all agreements

---

## 🔄 How the Rental Flow Works

1. Tenant browses available properties and clicks **Apply to Rent**
2. Owner receives a bell notification — *New Rental Application*
3. Manager also receives the same notification
4. Owner or Manager opens the Applications page
5. They click **Approve** or **Reject**
6. Tenant immediately receives a notification with the outcome
7. On approval, the property is automatically marked as **Occupied**

---

## 📂 Project Structure

```
PropAI/
├── backend/
│   ├── app/
│   │   ├── main.py          # Entry point, CORS, routers
│   │   ├── config.py        # Settings and environment variables
│   │   ├── database.py      # PostgreSQL, MongoDB, Redis connections
│   │   ├── models/          # SQLAlchemy database models
│   │   ├── schemas/         # Pydantic request and response schemas
│   │   ├── routers/         # All API endpoints
│   │   ├── ml/               # OCR pipeline, KNN, regression, NLP
│   │   ├── services/          # OCR service, report generation, listings
│   │   └── utils/             # Auth helpers, cache, dependencies
│   ├── seed.py               # Sample data loader
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── pages/            # Tenant, Owner, Manager dashboards
│   │   ├── components/        # Layout, Charts, DocumentUpload
│   │   ├── contexts/           # Auth and Theme state
│   │   └── services/            # Axios API client
│   ├── Dockerfile
│   └── nginx.conf
├── tests/                    # End-to-end API and browser tests (see tests/README.md)
├── docker-compose.yml
└── README.md
```

---

## ⚙️ Requirements

Before you begin, make sure you have the following installed on your machine:

- [Docker Desktop](https://www.docker.com/products/docker-desktop)
- [Git](https://git-scm.com/download/win)

---

## 🚀 How to Clone and Run Locally

Follow these steps in order.

**Step 1 — Clone the repository**
```bash
git clone https://github.com/SamruddhiKadam2023in/PropAI.git
```

**Step 2 — Go into the project folder**
```bash
cd PropAI
```

**Step 3 — Start all services using Docker**
*(First time will take 5 to 8 minutes to download and build everything)*
```bash
docker compose up --build -d
```

This starts 5 services automatically:
| Service | Address |
|---|---|
| Backend API | http://localhost:8000 |
| Frontend app | http://localhost:3000 |
| PostgreSQL database | port 5432 |
| MongoDB | port 27017 |
| Redis | port 6379 |

**Step 4 — Load sample data into the database**
```bash
docker exec property_backend python seed.py
```

**Step 5 — Open the app in your browser**
```
http://localhost:3000
```

---

## 🔑 Login Credentials (after running seed)

| Role | Email | Password |
|---|---|---|
| Tenant | amit@example.in | PropAI@2024 |
| Owner | vikram@propai.in | PropAI@2024 |
| Manager | rajesh@propai.in | PropAI@2024 |

You can also register a new **Tenant** or **Owner** account. Sign-up requires a one-time code emailed to you (see **Sign-in, sign-up and email codes** below). Manager accounts cannot be created via sign-up — an existing Manager adds them under **Users & Roles → Add user**.

> ⚠️ These are demo/seed credentials for local development only replace or remove them entirely before any public/production deployment.

---

## 📅 Daily Usage

| Action | Command |
|---|---|
| Start the project | `docker compose up -d` |
| Stop the project (data is saved) | `docker compose stop` |
| View backend logs | `docker compose logs -f backend` |

---

## 🌐 Environment Variables

A sample environment file is provided at `backend/.env.example`. Copy it to `backend/.env` before running locally:

```bash
copy backend\.env.example backend\.env
```

The default values work with Docker out of the box — no changes needed for local development. To receive emailed one-time codes, you must add your mail settings (`SMTP_*`); see **Email setup** below.

For production, update these values:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `MONGODB_URL` | MongoDB connection string |
| `REDIS_URL` | Redis connection string |
| `SECRET_KEY` | A long random secret string |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USERNAME` / `SMTP_PASSWORD` / `SMTP_FROM` | Outgoing email for one-time codes |
| `DEBUG` | Set to `false` (`true` prints every SQL statement, including password hashes, in the logs) |
| `FRONTEND_URL` | The website's address (the only origin allowed to call the API) |
| `CONFIDENCE_THRESHOLD` | Minimum OCR confidence (default `0.65`) |

The **Quick Demo Login** panel on the Login page is shown only when `frontend/.env` contains `VITE_SHOW_DEMO_LOGIN=true` (copy `frontend/.env.example` to `frontend/.env` for a local demo). **Public builds must not set it** — without it, the build contains no panel and no demo password.

---

## 🔐 Sign-in, Sign-up, and Email Codes

- Sign-up (Tenant or Owner only) creates an unverified account and emails a 6-digit code. You're signed in only after entering it.
- Codes last 10 minutes, work once, and lock after 5 wrong guesses. "Resend code" waits 60 seconds (max 5 per hour).
- **Forgot password?** on the Login page emails a reset code the same way. A reset signs you out everywhere.
- Passwords must be at least 8 characters (at most 72 bytes) — enforced on both the server and the forms.
- 5 wrong passwords for the same email from the same address within a minute are blocked for the rest of that minute (HTTP 429).
- Access tokens last 15 minutes and renew silently; the refresh token lasts 7 days, is replaced on every use, and is revoked by Sign Out, a password reset, or if an already-used one is presented again.
- Managers create other accounts (including other Managers) at **Manager → Users & Roles → Add user**.
- Everyone can open **Account settings** (click your name at the bottom of the sidebar) to edit their name and phone and to change their password. Changing the password signs out all other devices. Email and role can't be changed there.
- Managers can deactivate and reactivate other accounts under **Users & Roles**. A deactivated person is signed out on their next action and cannot sign in until reactivated; their data is kept. A Manager cannot deactivate themselves.

### Email Setup (Gmail example)

1. On the Gmail account, turn on 2-Step Verification, then create an App password at [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) (it's 16 letters shown once — remove the spaces when you copy it).
2. In `backend/.env` set:
   ```
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USERNAME=your.address@gmail.com
   SMTP_PASSWORD=<the 16 letters, no spaces>
   SMTP_FROM="PropAI <your.address@gmail.com>"
   ```
3. Apply it:
   ```bash
   docker compose up -d --force-recreate backend
   ```

If `SMTP_HOST` is empty, the server sends nothing and the sign-up screen says the code could not be sent. For development only, you can set `EMAIL_DEV_LOG_CODES=true` to print codes in the backend log (`docker compose logs backend`). **Never enable that in production.**

---

## 🧾 Reading Bills (English + Marathi)

Uploaded bills are read in the background by `backend/app/ml/bill_pipeline.py`: Tesseract (English + Marathi) runs on several cleaned-up copies of the image, then rules identify the type, vendor, amount to pay, bill date, due date, billing period, and address (6-digit PIN checked against its state, suburb/city, with the name kept apart from the address).

It stops as soon as it's confident, within 60 seconds. Anything it's unsure about is left **empty** (never guessed), and the document is marked **"flagged"** so the user can correct it. If the new reader finds nothing, the older pipeline is used as a fallback.

The Marathi language pack is installed in the backend image (`backend/Dockerfile`), so after pulling this change, run:
```bash
docker compose build backend
docker compose up -d --force-recreate backend
```

**Known limits:** very low-resolution photos are flagged instead of read; the place list in `backend/app/ml/india_places.py` covers major cities and suburbs and can be extended.

---

## 🚢 Deploying for Free

The local Docker setup is a **demo** (sample passwords, database ports open, debug on). For a real, always-on site the recommended free setup is:

- **Website** on **Vercel** (free), built from the `frontend` folder.
- **API** on an **Oracle Cloud "Always Free"** server, running Docker Compose behind **Caddy** (automatic HTTPS), with a free **DuckDNS** address.

Step-by-step instructions are in **[`deploy/README.md`](deploy/README.md)** (Oracle server) and, if you have **no credit card**, **[`deploy/FREE_HOST.md`](deploy/FREE_HOST.md)** (Vercel + Render/Koyeb free tier + Neon + MongoDB Atlas + Brevo email, using a lighter bill-reading mode). Key points:

- The app **refuses to start** with `DEBUG=false` if `SECRET_KEY` is the placeholder or shorter than 32 characters.
- Create your first Manager with `python create_manager.py` and **never run `seed.py` on a live server** (it deletes all data and refuses to run when `DEBUG=false`).
- Keep every secret (SMTP app password, `SECRET_KEY`, database passwords) only in the host's environment or `deploy/.env` — never in chat, git or screenshots. If one leaks, revoke it and create a new one.
- Dependencies were upgraded for known security advisories; re-check with `pip-audit` (backend) and `npm audit --omit=dev` (frontend).

---

## 🧪 Running the Tests

Real end-to-end tests (API + real browser) live in the `tests/` folder. See `tests/README.md`.

```bash
pip install -r tests/requirements.txt
cd tests && npm install && cd ..
python tests/run_all.py
```

---

## 📖 API Documentation

Once the backend is running, open either of these in your browser:

| Docs | URL |
|---|---|
| Swagger UI | http://localhost:8000/docs |
| ReDoc | http://localhost:8000/redoc |

---

## 📄 License

This project is open-source. Feel free to use, modify, and distribute it as per your needs (add your preferred license, e.g. MIT, here).

---

## 🙌 Built With

FastAPI · React · PostgreSQL · MongoDB · Redis · Tesseract OCR · spaCy · scikit-learn
