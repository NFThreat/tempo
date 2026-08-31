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
- App: RPC read caching (30s), server-side relayer proxy, bounded key expiry, inline undo for
  interrupted signups.

## Known limitations

- Old demo passes live on the v1 factory (`0x274f7b4B…5d25`) — reachable by URL only; the v1
  contract does NOT include the v2 security fixes.
- NFT metadata `baseURI` defaults to a placeholder — host real metadata for wallet rendering.
- The relayer holds subscriber access-key private keys by design (that is how it renews);
  run it on a trusted machine.
- Deploy fee is 0 — anyone can create pass collections (set `setDeployFee` to deter spam).
