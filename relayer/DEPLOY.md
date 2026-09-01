# Relayer on your VPS — 10 minutes

Everything runs in Docker: two containers (relayer + HTTPS tunnel) that survive reboots.
No systemd units, no dedicated users, no reverse proxy.

## 1. Prerequisites (once)

```bash
# Docker (if not already installed)
curl -fsSL https://get.docker.com | sh
```

A free account on [dashboard.ngrok.com](https://dashboard.ngrok.com) (email only):
copy your **authtoken** and claim a **static domain** (Universal Gateway → Domains).

## 2. Copy files to the VPS

You only need the `relayer/` folder (Dockerfile, package.json, src, compose.yaml).

## 3. Configure and start

```bash
cd relayer
cp .env.example .env
nano .env      # STATE_SECRET: openssl rand -hex 32
               # NGROK_AUTHTOKEN + NGROK_DOMAIN: from the ngrok dashboard
docker compose --profile tunnel up -d   # relayer + HTTPS tunnel
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

## Useful commands

```bash
docker compose logs -f relayer   # logs (renewals, mirror, errors)
docker compose restart           # restart
docker compose up -d --build     # rebuild after code changes
```

## Backup

One thing to save (password manager, away from the VPS):

- `relayer/.env` — contains `STATE_SECRET` (without it `state.json` is unreadable and
  subscriber keys are lost) and `NGROK_AUTHTOKEN`

Optionally `relayer/data/` (the encrypted state; without a backup subscribers must
re-subscribe).
