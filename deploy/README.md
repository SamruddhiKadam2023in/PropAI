> **No credit card?** Use **[FREE_HOST.md](FREE_HOST.md)** instead (Vercel + Render/Koyeb free tier + Neon + Atlas + Brevo, with a lighter bill-reading mode).
> This page is the Oracle Cloud route, which needs a card for identity checks but gives an always-on server.

# Deploying PropAI for free: Vercel (website) + Oracle Cloud "Always Free" (API)

```
Browser --> https://your-project.vercel.app      (the website: static files, Vercel)
   |
   +------> https://yourname.duckdns.org/api     (the API on ONE Oracle server: Caddy -> FastAPI + Tesseract,
                                                  Postgres, MongoDB, Redis in Docker; only ports 80/443 are open)
```
Cost: **$0** while you stay inside Oracle's Always Free limits and Vercel's Hobby plan.

Tested locally with the same files (website on one address, API on another, HTTPS via Caddy): sign-in across the two addresses,
CORS (only the website's address is allowed), a Marathi + English sample bill read end to end, deep-link refresh, no demo-login
panel in the public build, no database port exposed.
NOT tested: the real Oracle ARM server and Vercel itself (all images used have ARM builds).

Do part 1 (server) first, because the website needs the API's address. Then part 2 (Vercel), then part 3 (connect them).

---------------------------------------------------------------------------------------------------------------------------------

# Part 1. The API server (Oracle Cloud)

## 1.1 Oracle Cloud account
https://www.oracle.com/cloud/free/ -> **Start for free**. A card is needed for identity checks only; use "Always Free" resources.
Choose your **home region carefully - it cannot be changed**: Mumbai (`ap-mumbai-1`) or Hyderabad (`ap-hyderabad-1`).

## 1.2 Create the server
Menu -> **Compute -> Instances -> Create instance**
- **Image:** Canonical **Ubuntu 22.04** (Aarch64 if offered).
- **Shape:** Change shape -> **Ampere** -> **VM.Standard.A1.Flex**, **2 OCPU and 12 GB memory** (4 OCPU / 24 GB is also free).
- **Networking:** keep "Assign a public IPv4 address" on.
- **SSH keys:** "Generate a key pair" and **download the private key** (your only way in; keep it safe).
- **Boot volume:** 50-100 GB. Click **Create**.
- If you see **"Out of capacity"**: try another availability domain, or retry later (early morning works best).
Copy the instance's **Public IP address** once it is running.

## 1.3 Open ports 80 and 443 (two places)
1. Instance page -> the **Subnet** link -> **Security List** -> **Add Ingress Rules**: source `0.0.0.0/0`, protocol TCP, destination port
   `80`. Add a second rule for `443`.
2. On the server (after 1.5) also run:
   ```
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
   sudo netfilter-persistent save
   ```

## 1.4 A free web address for the API (DuckDNS)
1. https://www.duckdns.org -> sign in (Google/GitHub) -> create a name such as `propai-yourname`.
2. Set its **current ip** to the server's public IP and click update.
The API's address is then `https://propai-yourname.duckdns.org/api` (use `propai-yourname.duckdns.org` as `DOMAIN` below).

## 1.5 Log in to the server and install Docker
Windows PowerShell (use the path of the private key you downloaded):
```
ssh -i C:\path\to\ssh-key.key ubuntu@YOUR_SERVER_IP
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
exit
```
Log in again with the same `ssh` command, then run the two `iptables` commands from 1.3.

## 1.6 Get the code and configure it
```
git clone https://github.com/SamruddhiKadam2023in/PropAI.git
cd PropAI/deploy
cp .env.example .env
nano .env
```
Fill in every value. Make the secrets on the server with:
```
openssl rand -hex 24     # POSTGRES_PASSWORD (run again for MONGO_PASSWORD)
openssl rand -hex 48     # SECRET_KEY
```
- `DOMAIN` = your DuckDNS name (no `https://`).
- `WEBSITE_URL` = the Vercel address. You do not know it yet: put `https://propai-yourname.vercel.app` now and correct it in part 3.
- Leave `CADDYFILE=./Caddyfile.api-only`.
`.env` is never committed. Do not paste it anywhere. In nano: Ctrl+O, Enter, Ctrl+X.

## 1.7 Start it
```
docker compose up -d --build
docker compose ps
```
The first build takes 10-20 minutes on the ARM server. Every service should show "Up" (backend "healthy").
Watch with `docker compose logs -f backend` (look for "AI Property Management ready.").

## 1.8 Create your first Manager
```
docker compose exec backend python create_manager.py you@example.com "Your Name"
```
Type a strong password when asked (nothing shows as you type). Do NOT run seed.py on this server.

## 1.9 Check the API
Open `https://YOUR_DOMAIN/api/health` -> `{"status":"ok",...}`. (The HTTPS certificate is issued on the first visit; wait a minute
if the browser complains.)

---------------------------------------------------------------------------------------------------------------------------------

# Part 2. The website (Vercel)

1. https://vercel.com -> **Sign up with GitHub** (Hobby plan, free).
2. **Add New -> Project** -> import the **PropAI** repository.
3. Settings on the import screen:
   - **Root Directory:** `frontend`  (click Edit and choose the folder)
   - **Framework Preset:** Vite (detected automatically); build command `npm run build`, output `dist` (already in `frontend/vercel.json`)
   - **Environment Variables:** add `VITE_API_URL` = `https://YOUR_DOMAIN/api`   (no trailing slash)
   - Do NOT add `VITE_SHOW_DEMO_LOGIN`.
4. **Deploy.** Vercel shows your address, e.g. `https://propai-xxxx.vercel.app`. (You can change the name under Settings -> Domains.)

---------------------------------------------------------------------------------------------------------------------------------

# Part 3. Connect them

1. On the server: `cd ~/PropAI/deploy && nano .env` and set `WEBSITE_URL` to the **exact** Vercel address (`https://...vercel.app`,
   no trailing slash). Then `docker compose up -d` (this restarts the API with the new setting).
2. Open the Vercel address, sign in with the Manager you created, add users, upload a bill.
3. Register a new Tenant to confirm the emailed code arrives.
If you later add your own domain to Vercel, put that address in `WEBSITE_URL` too and run `docker compose up -d` again.

---------------------------------------------------------------------------------------------------------------------------------

## Keeping it running
- **Oracle can reclaim Always Free servers that sit almost idle for 7 days.** Add a free monitor at https://uptimerobot.com that opens
  `https://YOUR_DOMAIN/api/health` every 5 minutes; it also warns you if the API is down.
- **Update after new code:** on the server `cd ~/PropAI && git pull && cd deploy && docker compose up -d --build`; Vercel redeploys the
  website by itself when you push to GitHub.
- **Backup the database:** `docker compose exec postgres pg_dump -U propai property_management > backup.sql`
- **Logs:** `docker compose logs --tail 100 backend`

## If something fails
| Problem | Fix |
|---|---|
| API address does not open | Security List rules (1.3) AND the iptables commands; DuckDNS points at the right IP; `docker compose ps` |
| Certificate error at first | Wait 1-2 minutes; `docker compose logs caddy`; the domain must point at the server and ports 80/443 must be open |
| Website loads but sign-in says "Network Error" | `WEBSITE_URL` on the server must be exactly the Vercel address (https, no trailing slash), then `docker compose up -d`; check `VITE_API_URL` on Vercel ends with `/api` and redeploy the website after changing it |
| Website shows a blank page or 404 on refresh | `frontend/vercel.json` must be deployed (Root Directory = `frontend`) |
| Backend keeps restarting | `docker compose logs backend`: usually a missing value in `.env` (SECRET_KEY must be 32+ characters) |
| No sign-up email | Check `SMTP_*` in `.env` (Gmail App password, no spaces); `docker compose logs backend` |
| Build fails on a Python package | Copy the error text and ask for help (it may need an ARM-specific fix) |

## Alternative: everything on the one server (no Vercel)
In `deploy/.env` set `WEBSITE_URL=https://YOUR_DOMAIN`, `CADDYFILE=./Caddyfile` and `COMPOSE_PROFILES=website`, then
`docker compose up -d --build`. The website is then served at `https://YOUR_DOMAIN` and the API at `https://YOUR_DOMAIN/api`.
