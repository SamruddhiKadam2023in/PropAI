# Deploying PropAI with NO credit card and NO cost: Vercel + Render (or Koyeb) + Neon + MongoDB Atlas + Brevo

```
Browser --> https://your-project.vercel.app            (website, Vercel)
   |
   +------> https://propai-api.onrender.com            (the API: a free Docker web service on Render, or Koyeb)
                 |-- Postgres  -> Neon (free)           users, properties, payments
                 |-- MongoDB   -> Atlas (free)          settings, notes, AND a copy of every uploaded file
                 |-- Redis     -> runs inside the API container (sessions / one-time codes)
                 `-- Email     -> Brevo (free, over HTTPS)
```

## What "free" means here (read this first)
The free API hosts give **512 MB of memory and a small share of one CPU**. The full bill reader needs more, so this setup runs PropAI in
**LITE mode** (`OCR_LITE_MODE=true`, already set by `backend/Dockerfile.free`). We measured it with exactly those limits:

| | Full reader (needs a bigger host) | Lite mode (this guide) |
|---|---|---|
| Peak memory | 512 MB (crashes / wrong results) | about 290 MB |
| Time per bill | 2 to 2.5 minutes | 10 to 80 seconds |

What lite mode does: one Tesseract pass at a time on a smaller picture, no spaCy model, stops as soon as the essentials are read.
- **Clear English bills** are read completely (type, vendor, amount, dates).
- **Marathi + English bills**: type, vendor, dates and the address (PIN, suburb, city, state) are usually read, but the **amount is
  usually left empty** and the bill is marked "Needs review", because lite mode only accepts an amount it saw twice next to a label.
  The user types the amount with "Review & correct". A wrong amount is never shown on purpose.
- To read every Marathi bill fully, run the API on a bigger server (see `deploy/README.md`, Oracle) with normal mode.
- If reading is too slow even in lite mode, set `OCR_LANGUAGES=eng` (skips Marathi).

Other free-tier facts:
- The API **sleeps after about 15 minutes without visits** (Render) and wakes in about a minute. A free UptimeRobot monitor (step 8) keeps it awake.
- The disk is **wiped on every restart**. PropAI copies every uploaded bill and property photo into MongoDB and restores them at start-up.
- Login sessions live in the container's Redis, so people sign in again after a restart.
- Render and Hugging Face block the normal email ports, so code emails go through Brevo's web API.

Keep every secret ONLY in the host's environment-variable boxes. Never paste one in chat, git or a screenshot.

---------------------------------------------------------------------------------------------------------------------------------

## 1. Neon (Postgres) - no card
1. https://neon.tech -> sign up -> **Create project** (name `propai`, a US East region, only "Postgres database" on).
2. **Connect** -> turn **Connection pooling OFF** (the address must not contain `-pooler`) -> click **Show password** and copy the string
   (`postgresql://neondb_owner:...@ep-xxxx.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require`) into a private notes file.

## 2. MongoDB Atlas - no card
Reuse your cluster: string `mongodb+srv://USER:PASSWORD@propai.xxxxx.mongodb.net/?appName=propai` in your notes; Network Access has `0.0.0.0/0`.

## 3. Brevo (email over HTTPS) - no card
1. https://www.brevo.com -> sign up (free: 300 emails/day).
2. **Senders, Domains & Dedicated IPs -> Senders -> Add a sender** (your Gmail address, name `PropAI`) and click the link Brevo emails you.
3. **SMTP & API -> API Keys -> Generate a new API key**; copy it. (Emails may land in Spam at first.)

## 4. The API on Render (free web service) - no card
1. https://render.com -> sign up with GitHub (no card for the free plan).
2. **New + -> Web Service** -> pick the **PropAI** repository -> **Connect**.
3. Fill in:
   - **Name:** `propai-api`   **Region:** the one closest to Neon (e.g. Ohio)   **Branch:** `main`
   - **Language:** Docker
   - **Root Directory:** `backend`
   - **Dockerfile Path:** `./Dockerfile.free`
   - **Instance Type:** **Free**
   - **Advanced -> Health Check Path:** `/health`
4. **Environment Variables** (add each; type the values yourself):

| Name | Value |
|---|---|
| `DATABASE_URL` | the Neon string from step 1 |
| `MONGODB_URL` | the Atlas string |
| `SECRET_KEY` | 96 random characters: `python -c "import secrets; print(secrets.token_hex(48))"` on your computer |
| `BREVO_API_KEY` | the Brevo key |
| `SMTP_FROM` | `PropAI <your.verified.gmail@gmail.com>` |
| `FRONTEND_URL` | your Vercel address (set after step 6; the service restarts by itself) |
| `BOOTSTRAP_MANAGER_EMAIL` | your email (becomes the Manager login) |
| `BOOTSTRAP_MANAGER_NAME` | your name |
| `BOOTSTRAP_MANAGER_PASSWORD` | a strong password (8+ characters) |

5. **Create Web Service.** The first build takes about 10 minutes. In **Logs** look for `First Manager ... created` and
   `AI Property Management ready.` Then open `https://YOUR-SERVICE.onrender.com/health` -> `{"status":"ok",...}`.

(Koyeb instead of Render: https://www.koyeb.com -> Create Web Service -> GitHub -> repo PropAI -> **Dockerfile** builder with
**Work directory** `backend` and **Dockerfile location** `Dockerfile.free` -> Instance **Free** -> same environment variables -> port `8000`.)

## 5. Sign in once, then remove the bootstrap variables
After your first successful sign-in (step 6) delete the three `BOOTSTRAP_MANAGER_*` variables. They only act when no Manager exists.

## 6. The website on Vercel - no card
1. https://vercel.com -> sign up with GitHub (Hobby) -> **Add New -> Project** -> import **PropAI**.
2. **Root Directory:** `frontend`. **Environment Variables:** `VITE_API_URL` = `https://YOUR-SERVICE.onrender.com` (no trailing slash, **no `/api`**).
   Do NOT add `VITE_SHOW_DEMO_LOGIN`.
3. **Deploy**, copy the address Vercel gives you, and put it into `FRONTEND_URL` on Render (step 4). Sign in with your Manager.
4. Add users (Users & Roles -> Add user) or register a Tenant to check that code emails arrive (look in Spam).

## 7. Try a bill
Sign in as a Tenant, upload a clear English bill: it should complete in under a minute with the amount filled in. Upload a Marathi
bill: expect the address and dates, and "Needs review" for the amount.

## 8. Keep it awake (free)
https://uptimerobot.com -> Add monitor -> HTTP(s) -> `https://YOUR-SERVICE.onrender.com/health`, every 5 minutes.
(Render gives 750 free hours a month, enough for one service running all month.)

## Updating later
Push to GitHub. Render redeploys the API by itself (Settings -> Auto-Deploy); Vercel redeploys the website by itself.

## If something fails
| Problem | Fix |
|---|---|
| Build fails on Render | Check Root Directory = `backend` and Dockerfile Path = `./Dockerfile.free`; open the build log and send me the error text |
| Service restarts / "Out of memory" | Keep `OCR_LITE_MODE` unset-or-true (default in this image); do not raise thread settings; upload smaller pictures |
| "Network Error" on the website | `FRONTEND_URL` on the API must be exactly the Vercel address (https, no trailing slash); `VITE_API_URL` on Vercel must be the API address; redeploy Vercel after changing it |
| First request after a while is slow | The free service was asleep (about a minute to wake); use the UptimeRobot monitor |
| No code email | Brevo sender not verified, wrong key, or Spam. The API log shows `Could not send ... email` with Brevo's reason. A Manager can also add users directly |
| Uploaded bill missing after a restart | Log should say `Restored N uploaded file(s)`; check `MONGODB_URL` |
