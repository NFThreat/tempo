# Relayer su VPS — 10 minuti

Tutto gira in Docker: due container (relayer + tunnel HTTPS) che sopravvivono ai reboot.
Niente systemd, niente utenti dedicati, niente Caddy.

## 1. Prerequisiti (una volta)

```bash
# Docker (se non c'è già)
curl -fsSL https://get.docker.com | sh
```

Account gratuito su [dashboard.ngrok.com](https://dashboard.ngrok.com) (solo email):
copia l'**authtoken** e crea un **static domain** (Universal Gateway → Domains).

## 2. Copia i file sul VPS

Serve solo la cartella `relayer/` (Dockerfile, package.json, src, compose.yaml).

## 3. Configura e avvia

```bash
cd relayer
cp .env.example .env
nano .env      # STATE_SECRET: openssl rand -hex 32
               # NGROK_AUTHTOKEN + NGROK_DOMAIN: dal dashboard ngrok
docker compose up -d
```

Fatto. HTTPS pubblico su `https://<tuo-dominio>.ngrok-free.app`, riavvii automatici,
`state.json` cifrato (STATE_SECRET) su volume persistente `./data`.

## 4. Collega l'app

Su Vercel (Root Directory `app`), env vars prima del build:

- `NEXT_PUBLIC_FACTORY_ADDRESS=0x29b7a39ca48b82f6f6c9d5ee495750aeca2c6555`
- `NEXT_PUBLIC_RELAYER_URL=https://<tuo-dominio>.ngrok-free.app`

## 5. Verifica

```bash
curl https://<tuo-dominio>.ngrok-free.app/health          # {"ok":true,...}
curl https://<tuo-dominio>.ngrok-free.app/data/state.json # 404 (mai esposto)
```

Poi il ciclo completo dall'app: launch → subscribe → auto-renew → cancel → burn.

## Comandi utili

```bash
docker compose logs -f relayer   # log (rinnovi, mirror, errori)
docker compose restart           # riavvio
docker compose pull && docker compose up -d --build   # aggiorna
```

## Backup

Una sola cosa da salvare (password manager, fuori dal VPS):

- `relayer/.env` — contiene `STATE_SECRET` (senza di esso `state.json` è illeggibile e le
  chiavi degli abbonati si perdono) e `NGROK_AUTHTOKEN`

E la cartella `relayer/data/` (opzionale: contiene lo stato cifrato; senza backup gli
abbonati devono ri-abbonarsi).

## Nota ngrok free

Il dominio statico gratuito è stabile e non scade. Nelle risposte ai browser ngrok
mostra una pagina di avviso: le chiamate server-side di Vercel non sono browser e non la
vedono mai — nessun impatto sull'app.
