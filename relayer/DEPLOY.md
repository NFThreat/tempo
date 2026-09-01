# Relayer on your VPS — 10 minutes (GitHub method)

Everything runs in Docker: two containers (relayer + HTTPS tunnel) that survive reboots.
No systemd units, no dedicated users, no reverse proxy. The relayer code comes from your
GitHub repo, so future updates are a single `git pull`.

## 1. Prerequisites (once)

```bash
# Docker (if not already installed)
curl -fsSL https://get.docker.com | sh
```

A free account on [dashboard.ngrok.com](https://dashboard.ngrok.com) (email only):
copy your **authtoken** and claim a **static domain** (Universal Gateway → Domains).

## 2. Get the code from GitHub

In the VPS web terminal:

```bash
git clone https://github.com/<your-user>/<your-repo>.git
cd <your-repo>/relayer
```

If the repo is private, git will ask for credentials — use a
[Personal Access Token](https://github.com/settings/tokens) as the password (classic token
with `repo` scope), not your GitHub password.

## 3. Configure and start

```bash
cp .env.example .env
nano .env      # STATE_SECRET: openssl rand -hex 32
               # NGROK_AUTHTOKEN + NGROK_DOMAIN: from the ngrok dashboard
docker compose --profile tunnel up -d
```

Done. Public HTTPS at `https://<your-domain>.ngrok-free.app`, automatic restarts,
`state.json` encrypted (STATE_SECRET) on a persistent volume `./data`.

## 4. Point the web app at it

In Vercel (Root Directory `app`), set before the first build:

- `NEXT_PUBLIC_FACTORY_ADDRESS=0x8e3f7dc5beaf73461310eddb5d05a41126bce189`
- `NEXT_PUBLIC_RELAYER_URL=https://<your-domain>.ngrok-free.app`

## 5. Verify

```bash
curl https://<your-domain>.ngrok-free.app/health          # {"ok":true,...}
curl https://<your-domain>.ngrok-free.app/data/state.json # 404 (never exposed)
```

Then run the full lifecycle from the app: launch → subscribe → auto-renew → cancel → burn.

## Updating

```bash
cd <your-repo>/relayer
git pull
docker compose --profile tunnel up -d --build
```

## Useful commands

```bash
docker compose logs -f relayer   # logs (renewals, mirror, errors)
docker compose restart           # restart
```

## Backup

One thing to save (password manager, away from the VPS):

- `relayer/.env` — contains `STATE_SECRET` (without it `state.json` is unreadable and
  subscriber keys are lost) and `NGROK_AUTHTOKEN`

Optionally `relayer/data/` (the encrypted state; without a backup subscribers must
re-subscribe).
