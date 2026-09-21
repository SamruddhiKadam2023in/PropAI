> **Update (Sept 2026): Hugging Face now charges for Docker Spaces, so this route is no longer free.** Use **[FREE_HOST.md](FREE_HOST.md)** (Render/Koyeb free tier, lite reading mode). This page is kept for reference if you ever pay for a Space.

# Deploying PropAI with NO credit card: Vercel + Hugging Face Space + Neon + MongoDB Atlas + Brevo

```
Browser --> https://your-project.vercel.app          (website, Vercel)
   |
   +------> https://USER-propai-api.hf.space         (the API: a free Hugging Face "Space" running Docker)
                 |-- Postgres  -> Neon (free)        all your users, properties, payments
                 |-- MongoDB   -> Atlas (free)       settings, notes, AND a copy of every uploaded file
                 |-- Redis     -> runs inside the Space (sessions / one-time codes)
                 `-- Email     -> Brevo (free, over HTTPS)
```
Cost: **$0**, no card anywhere.

What to expect from a free Space:
- It **sleeps after ~2 days without visits**; the next visit wakes it (about a minute). A free monitor (UptimeRobot, step 8) keeps it awake.
- Its disk is **wiped on every restart/rebuild**. PropAI copies every uploaded bill and property photo into MongoDB and puts them back
  at start-up, so nothing is lost (tested: a brand-new empty container restored all files and re-read a bill).
- Everything in Redis (login sessions, pending one-time codes) is lost on restart: people simply sign in again.
- **Hugging Face blocks the normal email ports**, so code emails go through Brevo's web API instead (step 4).

Tested locally with the same Dockerfile: non-root user, bundled Redis, Neon-style database address, first Manager created from settings,
CORS for the Vercel address, Marathi + English bill read, wiped-disk rebuild restoring files. NOT tested: Hugging Face itself, Neon, Brevo
(the email code is tested against a fake Brevo server).

Keep every secret ONLY in the Hugging Face "Secrets" boxes below. Never paste one in chat, git or a screenshot.

---------------------------------------------------------------------------------------------------------------------------------

## 1. Neon (Postgres)
1. https://neon.tech -> **Sign up** (GitHub or Google, no card) -> **Create project** (name `propai`, region closest to you, e.g. Singapore).
2. On the dashboard click **Connect**. Turn **OFF "Connection pooling"** so the address has no `-pooler` in it.
3. Copy the connection string. It looks like `postgresql://USER:PASSWORD@ep-xxxx.region.aws.neon.tech/neondb?sslmode=require&channel_binding=require`.
   Keep it in a private notes file. (PropAI converts it for its driver by itself.)

## 2. MongoDB Atlas
You already have the cluster. Reuse the connection string in your notes (`mongodb+srv://USER:PASSWORD@propai.xxxxx.mongodb.net/?appName=propai`).
Network Access must contain `0.0.0.0/0`.

## 3. Hugging Face account and Space
1. https://huggingface.co/join (no card). Verify your email.
2. **New -> Space**: name `propai-api`, **SDK: Docker -> Blank**, **Hardware: CPU basic (free)**, **Visibility: Public**
   (a private Space cannot be reached from your website).
3. Open the Space -> **Files -> Add file -> Upload files**. Upload the two files from this repository's `deploy/huggingface/` folder:
   `Dockerfile` and `README.md` (keep those names) -> **Commit**. The Space now builds (about 10-15 minutes the first time).
   The API address is `https://YOURUSERNAME-propai-api.hf.space` (shown under the three dots -> "Embed this Space" -> Direct URL).

## 4. Brevo (email over HTTPS)
1. https://www.brevo.com -> sign up (free plan: 300 emails/day, no card).
2. **Senders, Domains & Dedicated IPs -> Senders -> Add a sender**: your Gmail address and name `PropAI`. Click the link Brevo emails you.
3. **SMTP & API -> API Keys -> Generate a new API key** (name `propai`). Copy it (shown once).
Emails come from your Gmail address through Brevo, so they may land in Spam at first: tell testers to check it.

## 5. Settings in the Space
Space -> **Settings -> Variables and secrets**.

**Secrets** (hidden) - **New secret** for each:
| Name | Value |
|---|---|
| `DATABASE_URL` | the Neon string from step 1 |
| `MONGODB_URL` | the Atlas string |
| `SECRET_KEY` | 96 random letters/digits: run `python -c "import secrets; print(secrets.token_hex(48))"` on your computer |
| `BREVO_API_KEY` | the Brevo key |
| `SMTP_FROM` | `PropAI <your.verified.gmail@gmail.com>` (the sender you verified) |
| `BOOTSTRAP_MANAGER_EMAIL` | your email (this becomes the Manager login) |
| `BOOTSTRAP_MANAGER_NAME` | your name |
| `BOOTSTRAP_MANAGER_PASSWORD` | a strong password (8+ characters) |

**Variables** (visible) - **New variable**:
| Name | Value |
|---|---|
| `FRONTEND_URL` | your Vercel address, e.g. `https://propai.vercel.app` (set it after step 7, then the Space restarts by itself) |

Saving a secret restarts the Space. Check **Logs**: you should see `First Manager ... created` and `AI Property Management ready.`
Open `https://YOURUSERNAME-propai-api.hf.space/health` -> `{"status":"ok",...}`.

## 6. Sign in once, then remove the bootstrap secrets
After your first successful sign-in (step 7), delete `BOOTSTRAP_MANAGER_EMAIL`, `BOOTSTRAP_MANAGER_NAME` and
`BOOTSTRAP_MANAGER_PASSWORD` from the Space's secrets. They only ever act when the database has no Manager.

## 7. The website on Vercel
1. https://vercel.com -> sign up with GitHub (Hobby, free) -> **Add New -> Project** -> import the **PropAI** repository.
2. **Root Directory:** `frontend`. Framework: Vite (automatic).
3. **Environment Variables:** `VITE_API_URL` = `https://YOURUSERNAME-propai-api.hf.space` (no trailing slash, **no `/api`** in this setup).
   Do NOT add `VITE_SHOW_DEMO_LOGIN`.
4. **Deploy**, copy the address Vercel gives you, and put it into the Space variable `FRONTEND_URL` (step 5). Then sign in with the Manager.
5. Register a Tenant to check the code email arrives (look in Spam).

## 8. Keep it awake (free)
https://uptimerobot.com -> Add monitor -> HTTP(s) -> `https://YOURUSERNAME-propai-api.hf.space/health`, every 5 minutes.

## Updating later
Push to GitHub. For the API: Space -> **Settings -> Factory rebuild** (it re-downloads the backend from GitHub). Vercel redeploys the
website by itself.

## If something fails
| Problem | Fix |
|---|---|
| Space shows "Build error" | Open the Space **Logs**; usually a typo in the two uploaded files. Re-upload them unchanged from `deploy/huggingface/` |
| Space starts then stops | Logs: a missing/wrong secret (`SECRET_KEY` must be 32+ characters; `DATABASE_URL` from Neon with pooling OFF) |
| "Network Error" on the website | `FRONTEND_URL` must be exactly the Vercel address (https, no trailing slash); `VITE_API_URL` on Vercel must be the Space address; redeploy Vercel after changing it |
| Neon: first request is slow | Neon pauses when idle and wakes in about a second: normal |
| No code email | Brevo sender not verified, wrong key, or the mail is in Spam. Space Logs show `Could not send ... email` with Brevo's reason. Managers can also create accounts directly (Users & Roles -> Add user) which needs no email |
| Uploaded bill missing after a restart | Check the Space Logs for "Restored N uploaded file(s)"; `MONGODB_URL` must be set correctly |
