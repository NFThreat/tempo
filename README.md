# Tempo Pass — subscription NFT launchpad (testnet)

Launch NFT passes paired with auto-recurring payments on **Tempo** (testnet Moderato, chain 42431).
Users subscribe in stablecoins (pathUSD); renewals are charged automatically via **Tempo access
keys with recurring spend limits**; passes that stop paying **expire and burn** after a grace
period. A mirror copy of each pass is synced to Ethereum (Sepolia) for compatibility.

## How the recurring payment works (Tempo-only)

1. **Subscribe** — the user's wallet provisions a *limited access key* at the Account Keychain
   precompile (`0xAAAAAAAA00000000000000000000000000000000`): recurring limit `price + 10%`
   (fee buffer) per `billingPeriod` on the payment token, call-scoped to:
   - `transfer(paymentToken)` → pass treasury only
   - `activate(uint256)` and `renew(uint256)` on the pass contract
2. **Activate** — the relayer signs a batched Tempo transaction with that key: pay the first
   period to the treasury + activate the pass. The network enforces the limit and scope —
   the relayer can never overcharge or redirect funds.
3. **Renew** — when a period ends, the relayer signs the same payment again. The renewal fires
   *at/after* expiry (within the grace window) because the keychain's recurring limit only
   rolls over at `periodEnd`. If the user stops funding the wallet, renewal reverts.
4. **Expire & burn** — after `expiry + gracePeriod`, anyone can call `burnExpired`; the NFT is
   burned on Tempo and mirrored off Ethereum.

## Verified end-to-end on Tempo testnet (Aug 2026)

The full lifecycle was run live on Moderato (chain 42431):

| Step | Result |
|---|---|
| PassFactory + DemoPass deployed | `0x274f7b4B…5d25`, `0x0d048576…d1` |
| Access key created (P256) + authorized (recurring limit + scopes) | `KeyAuthorized` event ✓ |
| Subscribe → activate via access-key-signed batched payment | pass active, expiry +30d ✓ |
| Limit enforcement | tx reverted `SpendingLimitExceeded` until limit included fee buffer ✓ |
| Scope enforcement | tx reverted `CallNotAllowed` until pass selectors were scoped ✓ |
| **Auto-renewal** (60s-period pass) | two consecutive periods renewed automatically, back-to-back ✓ |
| Burn after expiry + grace | `burnExpired` permissionless, token destroyed ✓ |

Known quirks encountered (all workarounded):
- `forge script --broadcast` to testnet can fail validation with `PolicyForbids` (legacy tx
  fee path); deploy with `cast send --create` / `cast send` instead — identical results.
- The access key's call scope must include the pass contract's `activate`/`renew` selectors
  (`0xb260c42a`, `0x5baa7509`) or the batched tx reverts with `CallNotAllowed`.
- The recurring limit must exceed the price (fees count against the key's limit):
  relayer returns `limit = price * 1.1`.

## Repository layout

```
contracts/   Foundry: PassNFT, PassFactory, MirrorPassNFT + 27 tests + deploy scripts
relayer/     TypeScript: access-key creation, renewal worker, Tempo->ETH mirror sync
app/         Next.js + wagmi + viem/tempo: launch, list and subscribe flows
```

## Prerequisites

- [Foundry](https://getfoundry.sh/) (Tempo support is in upstream releases)
- Node 20+
- A wallet with testnet funds: `cast rpc tempo_fundAddress <ADDRESS> --rpc-url https://rpc.moderato.tempo.xyz`

## 1. Contracts

```bash
cd contracts
forge build
forge test                                  # 27 tests
```

Deploy the factory on Moderato:

```bash
export TEMPO_TESTNET_RPC_URL=https://rpc.moderato.tempo.xyz
export PRIVATE_KEY=<deployer>
forge script script/Deploy.s.sol:Deploy --rpc-url moderato --broadcast
```

> Note: if `forge script --broadcast` fails validation with `PolicyForbids` on testnet,
> deploy the same contracts via `cast` instead — it uses a fee path that passes:

```bash
INIT=$(forge inspect src/PassFactory.sol:PassFactory bytecode)
ARGS=$(cast abi-encode "constructor(address,uint256)" 0x20C0000000000000000000000000000000000000 0)
cast send --rpc-url $TEMPO_TESTNET_RPC_URL --private-key $PRIVATE_KEY \
  --create "$(cast concat-hex $INIT $ARGS)"
```

Deploy the ETH mirror on Sepolia:

```bash
export PRIVATE_KEY=<deployer>  # Sepolia key
export MIRROR_RELAYER=<relayer EOA address>   # same account the relayer uses on ETH
forge script script/Deploy.s.sol:Deploy --sig runMirror() --rpc-url sepolia --broadcast
```

## 2. Relayer (renewals + mirror)

```bash
cd relayer
cp .env.example .env   # fill addresses + relayer keys
npm install
npm start              # serve HTTP + renewal worker + mirror worker
```

Endpoints: `POST /key` (create access key), `POST /activate` (charge first period + activate),
`GET /health`. State persists in `data/state.json`.

> The relayer EOA must hold pathUSD to pay tx fees (faucet it on testnet).

## 3. App

```bash
cd app
export NEXT_PUBLIC_FACTORY_ADDRESS=<factory>          # after step 1
export NEXT_PUBLIC_RELAYER_URL=http://localhost:3001
export NEXT_PUBLIC_RELAYER_ADDRESS=<relayer EOA>      # prefill relayer field on /launch
npm install
npm run dev
```

- `/` — browse launched passes
- `/launch` — deploy a new pass collection (fee-charging factory)
- `/pass/[address]` — subscribe (authorize key → mint → first payment) and monitor status

## Subscription flow (end-to-end)

1. Pass owner deploys a pass via the factory (sets price, billing period, grace, treasury, relayer).
2. Buyer clicks *Subscribe*: the app asks the relayer for a fresh P256 access key.
3. Buyer's wallet authorizes the key (recurring limit + `transfer@treasury` scope) — one signature.
4. Buyer's wallet mints the pass — one signature.
5. The relayer pays the first period with the access key and activates the pass.
6. Every period, the relayer renews automatically. Unpaid → grace → anyone burns.

## Security model (read before prod)

- Access-key limits and call scopes are enforced by the protocol: the relayer can only move
  `price` per `billingPeriod` to the treasury. Revoke any time via `revokeKey`.
- The relayer holds access-key private keys in `data/state.json` — plaintext, for testnet only.
  Production: encrypt at rest (KMS), non-extractable WebCrypto keys, or delegated signing.
- The ETH mirror is a compatibility claim; canonical subscription state lives on Tempo.

## Roadmap

- Scheduled-transaction based payouts (Pillar A: platform fees → NFT holders, with Earn vaults)
- Collection-gated sales (only pass holders can buy)
- Fee sponsorship (gasless subscribe via Fee Payer API)
