# Whel Pass — subscription NFT launchpad (testnet)

Launch NFT passes paired with auto-recurring payments on **Tempo** (testnet Moderato, chain 42431).
Users subscribe in stablecoins (pathUSD); payments are **pulled onchain** by the pass contract;
renewals are charged automatically via **Tempo access keys with recurring spend limits**; passes
that stop paying **expire and burn** after a grace period. Subscriptions can be **cancelled
anytime** by revoking the access key. A mirror copy of each pass is synced to Ethereum (Sepolia)
for compatibility.

## Architecture

| Piece | Where | Notes |
|---|---|---|
| `PassFactory` | Tempo `0x139a86d284db280745eb71bcaee543f02e35c987` | v2 — deploys `PassNFT` collections (deploy fee 0) |
| `PassNFT` v2 | Tempo (one per pass) | soulbound, self-service `subscribe(keyId)`, `unsubscribe()`, onchain payment pull, permissionless `burnExpired` |
| Relayer | `relayer/` (port 3001) | creates access keys, activates, renews, mirrors to Sepolia |
| Web app | `app/` (port 3000) | Next.js — launch, subscribe, cancel, "Your subs" |
| Mirror | Sepolia `0x3557fb8d1add9a041964710b375dc0211278a3a1` | ERC721 copy of the pass state (read-only compatibility) |

## How the payment flow works (v2, pull-based)

1. **Key creation** — `POST /key` makes a fresh P256 access key for the (pass, user) pair. The
   private key stays in the relayer; the public keyId goes to the subscriber.
2. **Authorize** — the subscriber's wallet calls `authorizeKey` on the Account Keychain
   precompile (`0xaaaaaaaa00000000000000000000000000000000`) with:
   - recurring limit `price + 10%` per `billingPeriod` on the payment token
   - call scope: `approve(paymentToken)` → **this pass contract only**, plus `activate`/`renew`
     on the pass
   - expiry bounded (~400 days) so an interrupted signup cannot leave a live approval forever
3. **Subscribe** — `subscribe(keyId)` mints the pass to the caller (msg.sender enforced).
4. **Activate** — the relayer signs `approve(pass, price) + activate(tokenId)` with the access
   key; the pass contract **pulls `price` from the holder onchain** via `transferFrom`. No
   payment, no activation — enforced by the contract itself.
5. **Renew** — same batch (`approve + renew`) when the period ends, within the grace window.
   Anti-stacking caps prepayment at ~one period ahead.
6. **Cancel** — `revokeKey(keyId)` (one click, from the pass page or "Your subs"): every future
   renewal reverts, the pass stays active until the paid period ends.
7. **Expire & burn** — after `expiry + gracePeriod`, anyone can call `burnExpired`; the NFT is
   destroyed on Tempo and mirrored off Ethereum.

## Verified end-to-end on Tempo testnet (Aug 2026, v4 contracts)

The full lifecycle was run live on Moderato (chain 42431) via `relayer/e2e-test.mjs`
(period 120s, grace 240s, price 0.5 pathUSD, adversarial pass name):

| Step | Result |
|---|---|
| Pass deployed through factory v4 | `0x29b7a39c…c6555` → `0x07aad9D9…Ba26` ✓ |
| Access key created (P256) + authorized (approve scope + activate/renew, bounded expiry) | `KeyAuthorized` ✓ |
| Subscribe → relayer `approve + activate`, price pulled onchain to treasury | `+0.5 pathUSD` ✓ |
| Onchain metadata (SVG + JSON base64, escaping) | `tokenURI` decodes, no injection ✓ |
| **Auto-renewal** (relayer loop, anti-stacking) | expiry extended, second pull `+0.5` ✓ |
| Cancel via `revokeKey` (gas 1M) | `KeyRevoked` event ✓ |
| Burn after expiry + grace | permissionless, token destroyed ✓ |

Known quirks encountered (all workarounded):
- Tempo CREATEs are gas-heavy: use `--gas-estimate-multiplier 800` for factory deploys
  (chain cap is 30M; PassNFT creation through the factory costs ~9.8M).
- The keychain precompile's `authorizeKey` with scoped calls needs ~4.8M gas — the app and
  e2e script pass an explicit `gas` (auto-estimate under-reports and reverts silently).
- `wallet_addEthereumChain` rejects `nativeCurrency.decimals != 18` on MetaMask even though
  the chain uses 6 — the UI overrides to 18 (display-only).

## Setup

```bash
# contracts (forge)
cd contracts
cp .env.example .env  # set PRIVATE_KEY (funded Tempo EOA)
forge test
# deploy the factory (CREATEs on Tempo need a large gas limit):
TEMPO_RPC_URL=https://rpc.moderato.tempo.xyz PRIVATE_KEY=0x... \
  forge script Deploy --rpc-url tempo --broadcast --gas-estimate-multiplier 800

# relayer
cd ../relayer
cp .env.example .env   # FACTORY_ADDRESS, MIRROR_* (optional), PASS_ADDRESSES
npm run start          # loads .env via --env-file-if-exists

# web app
cd ../app
echo "NEXT_PUBLIC_FACTORY_ADDRESS=0x..." > .env.local
npm run dev
```

Environment knobs: `relayer/.env` — `TEMPO_RPC_URL`, `FACTORY_ADDRESS`, `RELAYER_PORT`,
`DB_PATH` (access-key private keys — chmod 600, never commit), `ETH_RPC_URL`,
`MIRROR_ADDRESS`, `MIRROR_RELAYER_PK`, `PASS_ADDRESSES` (one pass per mirror contract —
tokenIds would collide otherwise). App: `NEXT_PUBLIC_FACTORY_ADDRESS`,
`NEXT_PUBLIC_RELAYER_URL` (server-side proxy — browsers never talk to the relayer directly).

## Hardening included

- PassNFT v2: self-service mint only, soulbound, onchain payment pull, anti-stacking,
  `unsubscribe` for interrupted signups, permissionless burn after expiry + grace.
- Relayer: per-IP rate limiting, 8KB body cap, revoked-key subscription cleanup, `state.json`
  written with mode 600.
- **State encrypted at rest**: set `STATE_SECRET` and the state file (which holds subscriber
  access-key private keys) is stored AES-256-GCM encrypted — a leaked disk or file alone is
  useless without the secret. Losing the secret loses the keys, so back the secret up
  separately.
- Private keys are generated relayer-side and never leave the process (the `/key` endpoint
  returns only the public keyId; browsers never touch or transmit key material).
- App: RPC read caching (30s), server-side relayer proxy, bounded key expiry, inline undo for
  interrupted signups.

## Deployment (free tier, no KYC)

**Web app → Vercel** (import the repo from GitHub):

1. Root Directory: `app`
2. Environment variables (set BEFORE the first build — `NEXT_PUBLIC_*` are baked at build time):
   - `NEXT_PUBLIC_FACTORY_ADDRESS=0x29b7a39c…c6555`
   - `NEXT_PUBLIC_RELAYER_URL=https://<your-static-domain>.ngrok-free.app`
3. Deploy. The relayer is reached server-side by the API routes — no CORS issues.

**Relayer → any VPS with Docker** (10 minutes, see `relayer/DEPLOY.md`):

```bash
cd relayer
cp .env.example .env && nano .env   # STATE_SECRET, NGROK_AUTHTOKEN, NGROK_DOMAIN
docker compose up -d                # relayer + HTTPS tunnel, survives reboots
```

Two containers (relayer + ngrok HTTPS tunnel), `state.json` encrypted at rest on a
persistent volume, automatic restarts. No systemd units, no reverse proxy, no domains to
buy.

## Known limitations

- Old demo passes live on the v1 factory (`0x274f7b4B…5d25`) — reachable by URL only; the v1
  contract does NOT include the v2 security fixes.
- NFT metadata is generated fully onchain (base64 SVG + JSON in `tokenURI`) — no hosting
  needed; the mirror contract still uses a placeholder `baseURI`.
- The relayer is custodial by design: it holds subscriber access-key private keys (that is
  how it renews). Mitigations: state encrypted at rest (`STATE_SECRET`), scoped + bounded
  authorizations, one-click revoke. Run it on a trusted machine.
- Deploy fee is 0 — anyone can create pass collections (set `setDeployFee` to deter spam).
