# Deploying PropAI for free (Oracle Cloud "Always Free" server)

One small Linux server runs everything with Docker: the website, the API (with Tesseract for bills), Postgres, MongoDB, Redis and
Caddy (HTTPS). Only ports 80 and 443 are open to the internet. Cost: **$0** as long as you stay inside Oracle's Always Free limits.

Tested locally (same files, `DOMAIN=localhost`): HTTPS works, the API is reached at `/api`, page refreshes on deep links work, a Marathi
+ English sample bill is read end to end, the public build has no demo-login panel, and no database port is exposed.
NOT tested: the Oracle ARM server itself (all images used have ARM builds).

## 1. Oracle Cloud account
1. https://www.oracle.com/cloud/free/ -> **Start for free**. A card is needed for identity checks only; stay on "Always Free" resources.
2. Choose your **home region carefully - it cannot be changed**: Mumbai (`ap-mumbai-1`) or Hyderabad (`ap-hyderabad-1`).

## 2. Create the server
Menu -> **Compute -> Instances -> Create instance**
- **Image:** Canonical **Ubuntu 22.04** (Aarch64 if offered).
- **Shape:** Change shape -> **Ampere** -> **VM.Standard.A1.Flex**, **2 OCPU and 12 GB memory** (4 OCPU / 24 GB is also free).
- **Networking:** keep "Assign a public IPv4 address" on.
- **SSH keys:** "Generate a key pair" and **download the private key** (keep it safe; it is your only way in).
- **Boot volume:** 50-100 GB. Click **Create**.
- If you see **"Out of capacity"**: try another availability domain, or retry later (early morning works best).
Copy the instance's **Public IP address** when it is running.

## 3. Open ports 80 and 443
1. Instance page -> the **Subnet** link -> **Security List** -> **Add Ingress Rules**: source `0.0.0.0/0`, protocol TCP, destination port `80`.
   Add a second rule for `443`.
2. On the server (step 5) also run:
   ```
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
   sudo netfilter-persistent save
   ```

## 4. A free web address (DuckDNS)
1. https://www.duckdns.org -> sign in (Google/GitHub) -> create a name such as `propai-yourname`.
2. Set its **current ip** to the server's public IP and click update.
Your address is now `propai-yourname.duckdns.org` (use it as `DOMAIN` below, without `https://`).

## 5. Log in to the server
Windows PowerShell (use the path of the private key you downloaded):
```
ssh -i C:\path\to\ssh-key.key ubuntu@YOUR_SERVER_IP
```
Then install Docker:
```
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
exit
```
Log in again (same ssh command). Now run the two iptables commands from step 3.

## 6. Get the code and configure it
```
git clone https://github.com/SamruddhiKadam2023in/PropAI.git
cd PropAI/deploy
cp .env.example .env
nano .env
```
Fill in every value. Make the secrets on the server with:
```
openssl rand -hex 24     # use for POSTGRES_PASSWORD and again for MONGO_PASSWORD
openssl rand -hex 48     # use for SECRET_KEY
```
`.env` is never committed. Do not paste it anywhere. Save in nano with Ctrl+O, Enter, Ctrl+X.

## 7. Start it
```
docker compose up -d --build
docker compose ps
```
The first build takes 10-20 minutes on the ARM server. All services should show "Up" (backend "healthy").
Watch progress with `docker compose logs -f backend` (look for "AI Property Management ready.").
Caddy gets the HTTPS certificate by itself the first time someone opens the site.

## 8. Create your first Manager
```
docker compose exec backend python create_manager.py you@example.com "Your Name"
```
Type a strong password when asked (nothing shows while you type). Do NOT run seed.py on this server.

## 9. Check
- `https://YOUR_DOMAIN/api/health` shows `{"status":"ok",...}`
- `https://YOUR_DOMAIN` shows the login page (no demo-login panel). Sign in as the Manager, add users, upload a bill.
- Register a new Tenant to confirm the emailed code arrives.

## Keeping it running
- **Oracle can reclaim Always Free servers that sit almost idle for 7 days.** Add a free monitor at https://uptimerobot.com that opens
  `https://YOUR_DOMAIN/api/health` every 5 minutes; it also warns you if the site is down.
- **Update after new code:** `cd ~/PropAI && git pull && cd deploy && docker compose up -d --build`
- **Backup the database:** `docker compose exec postgres pg_dump -U propai property_management > backup.sql`
- **Logs:** `docker compose logs --tail 100 backend`

## If something fails
| Problem | Fix |
|---|---|
| Browser can't reach the site | Security List rules (step 3) AND the iptables commands; DuckDNS points at the right IP |
| Certificate error at first | Wait 1-2 minutes; check `docker compose logs caddy`; the domain must point at the server and ports 80/443 must be open |
| Backend keeps restarting | `docker compose logs backend`: usually a missing value in `.env` (SECRET_KEY must be 32+ characters) |
| No sign-up email | Check `SMTP_*` in `.env` (Gmail App password, no spaces); `docker compose logs backend` |
| Build fails on a Python package | Copy the error text and ask for help (it may need an ARM-specific fix) |
