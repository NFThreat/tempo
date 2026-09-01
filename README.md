# Whel Pass — subscription NFT passes on Tempo

Whel Pass is a subscription NFT launchpad built on **Tempo** (Moderato testnet, chain 42431).
Launchers deploy NFT pass collections in one transaction; subscribers pay in stablecoins
(pathUSD) through **Tempo's native Account Keychain** — the protocol's recurring-payment
primitive. No lock-in: revoking the access key stops every future charge instantly.

## Why this can only be built on Tempo

The app is a live showcase of three Tempo-native features that don't exist on generic EVM
chains:

1. **Account Keychain access keys** (`0xaaaaaa…aa` precompile) — a subscriber's wallet
   authorizes a scoped P256 key with a **recurring spend limit** (`price + 10%` per billing
   period) and a call scope (`transfer` to this pass's treasury + `activate`/`renew` on this
   pass). The protocol enforces the budget: the key physically cannot spend more, or send
   funds anywhere else. This is an onchain direct-debit mandate — no approvals to babysit,
   no ERC-20 allowance to drain.
2. **Access-key-signed batched transactions** (Tempo transaction type `0x76`) — one signature
   covers a batch (`transfer` to the treasury + `activate`/`renew`), with fees paid in
   pathUSD, so renewals are a single signature by the relayer on behalf of an offline holder.
3. **Stablecoin-native gas** — all fees are paid in pathUSD (6 decimals). No native gas
   token, no wrapping.

Everything else follows from these: renewals are charged automatically at period end,
revoking the key stops all future charges instantly (the pass stays active until the paid
period ends), unpaid passes expire and can be burned by anyone after a grace period, and
metadata is generated fully onchain (SVG + JSON as a base64 data URI — no IPFS).

## Architecture

| Piece | Where | Notes |
|---|---|---|
| `PassFactory` v6 | Tempo `0x8e3f7dc5…c189` | deploys `PassNFT` collections (deploy fee 0) |
| `PassNFT` v6 | Tempo (one per pass) | soulbound, self-service subscribe/unsubscribe, relayer automation, permissionless `burnExpired`, onchain metadata |
| Relayer | `relayer/` (port 3001) | creates scoped access keys, activates, renews, optional Sepolia mirror |
| Web app | `app/` (port 3000) | Next.js — launch, subscribe, cancel, "Your subs" |
| Mirror (optional) | Sepolia | ERC-721 copy of pass state for Ethereum-side visibility |

## Lifecycle

1. **Launch** — a creator calls `deployPass(name, symbol, config, relayer)` on the factory.
2. **Key creation** — `POST /key` generates a fresh P256 access key for the (pass, wallet)
   pair. The private key stays with the relayer (encrypted at rest); the public `keyId` goes
   back to the app.
3. **Authorize** — the subscriber's wallet calls `authorizeKey(keyId, P256, config)` on the
   Account Keychain with a recurring spend limit (`price + 10%` per billing period, covering
   gas) and a call scope (`transfer` → treasury, `activate`/`renew` on the pass). Expiry is
   bounded (~400 days) so an abandoned signup cannot leave a live mandate forever.
4. **Subscribe** — `subscribe(keyId)` mints the pass to the caller (one pass per wallet).
5. **Activate** — the relayer signs `transfer(treasury, price) + activate(tokenId)` with the
   access key in one atomic batch; the keychain caps the spend at the recurring limit.
6. **Renew** — the relayer's loop charges again only when the period has actually expired
   (never early — enforced onchain), within the grace window.
7. **Cancel** — `revokeKey(keyId)` from the pass page or "Your subs": every future charge
   reverts; the pass stays active until the paid period ends.
8. **Expire & burn** — after `expiry + gracePeriod`, anyone can call `burnExpired`; the NFT
   is destroyed on Tempo (and mirrored off Ethereum).

## Verified end-to-end on Tempo testnet

`relayer/e2e-test.mjs` runs the full lifecycle live (period 120s, grace 240s, price 0.5
pathUSD, adversarial pass name). Latest run: **17/17 checks passed**, including onchain
payment pulls, auto-renewal, revocation, permissionless burn, and metadata injection tests.

Known quirks (all workarounded in code):
- Tempo CREATEs are gas-heavy: deploy with `--gas-estimate-multiplier 800` (chain cap 30M;
  PassNFT creation through the factory costs ~9.8M).
- `authorizeKey` with scoped calls needs ~4.8M gas — pass an explicit `gas` (auto-estimate
  under-reports and reverts silently).
- MetaMask's `wallet_addEthereumChain` rejects `nativeCurrency.decimals != 18` even though
  Tempo uses 6 — the UI overrides it (display-only).
- Revoked keys read back as a zeroed "tombstone" (`isRevoked: true`); re-authorizing a
  revoked key reverts with `KeyAlreadyRevoked` — the relayer generates a fresh key instead.

## Local development

```bash
# 1. contracts (foundry)
cd contracts
cp .env.example .env            # PRIVATE_KEY = funded Tempo EOA (faucet.tempo.xyz)
forge test

# 2. relayer
cd ../relayer
cp .env.example .env            # STATE_SECRET (openssl rand -hex 32), FACTORY_ADDRESS
npm install && npm run start    # port 3001

# 3. web app
cd ../app
echo "NEXT_PUBLIC_FACTORY_ADDRESS=0x..." > .env.local
npm install && npm run dev      # port 3000
```

Full lifecycle regression test (deploys its own short-lived pass, exercises every phase):

```bash
cd relayer
E2E_PK=0x... E2E_FACTORY=0x8e3f... node e2e-test.mjs
```

## Going online (Vercel + your own VPS)

**Web app → Vercel** (free, no KYC):

1. Push the repo to GitHub and import it in Vercel. Root Directory: `app`.
2. Environment variables (before the first build — `NEXT_PUBLIC_*` are baked at build time):
   - `NEXT_PUBLIC_FACTORY_ADDRESS=0x8e3f7dc5…c189`
   - `NEXT_PUBLIC_RELAYER_URL=https://<your-relayer-host>`
3. Deploy. The app reaches the relayer server-side — browsers never talk to it directly.

**Relayer → your VPS with Docker** (~10 minutes, details in `relayer/DEPLOY.md`):

```bash
cd relayer
cp .env.example .env && nano .env    # FACTORY_ADDRESS, STATE_SECRET, NGROK_AUTHTOKEN, NGROK_DOMAIN
docker compose up -d                 # relayer + HTTPS tunnel, survives reboots
```

Two containers (relayer + ngrok HTTPS tunnel — free static domain, email only, no credit
card), `state.json` encrypted at rest on a persistent volume, automatic restarts. No
systemd units, no reverse proxy, no certificate setup.

## Security model

- **Custodial by design, cap by protocol**: the relayer holds subscriber access keys (that
  is how offline renewals work — the same model as Tempo's official MPP subscriptions), but
  the keychain mandate is a hard ceiling: at most `price + 10%` per period, only to the pass
  treasury, only `activate`/`renew` on the pass.
- **State encrypted at rest** (`STATE_SECRET`, AES-256-GCM): a leaked disk or file alone
  does not expose subscriber keys. Losing the secret loses the keys — back it up separately
  from the VPS.
- **One-click revoke** kills the mandate onchain even if the relayer is compromised.
- Rate limiting (20 req/min per IP) and 8KB body caps on state-changing endpoints.

## Known limitations

- The relayer is a single trusted service — for mainnet-grade deployments, distribute
  renewals across competing relayers or move signing closer to the holder.
- The Sepolia mirror uses a placeholder `baseURI` for metadata.
- Deploy fee is 0 — anyone can create pass collections (set `setDeployFee` to deter spam).
