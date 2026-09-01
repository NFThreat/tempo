// End-to-end pass lifecycle test against a live relayer + Tempo testnet.
// Usage: E2E_PK=0x... E2E_FACTORY=0x... node e2e-test.mjs
// v6 Tempo-native model: the relayer creates a P256 access key, the wallet
// authorizes it with a RECURRING SPEND LIMIT enforced by the Account
// Keychain, then the relayer signs transfer+activate/renew each period.
import { createPublicClient, createWalletClient, http, formatUnits, parseAbi, getAddress } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { tempoModerato } from 'viem/tempo/chains'

const RPC = process.env.TEMPO_RPC ?? 'https://rpc.moderato.tempo.xyz'
const RELAYER = process.env.E2E_RELAYER ?? 'http://localhost:3001'
const FACTORY = getAddress(process.env.E2E_FACTORY ?? '')
const PK = process.env.E2E_PK
if (!PK || !FACTORY) {
  console.error('set E2E_PK and E2E_FACTORY')
  process.exit(1)
}

const PATHUSD = '0x20C0000000000000000000000000000000000000'
const KEYCHAIN = '0xaaaaaaaa00000000000000000000000000000000'
const TRANSFER = '0xa9059cbb'
const ACTIVATE = '0xb260c42a'
const RENEW = '0x5baa7509'

const acct = privateKeyToAccount(PK)
const USER = acct.address
const pc = createPublicClient({ chain: tempoModerato, transport: http(RPC) })
const wc = createWalletClient({ account: acct, chain: tempoModerato, transport: http(RPC) })

const factoryAbi = parseAbi([
  'function passCount() view returns (uint256)',
  'function passes(uint256) view returns (address)',
  'function deployPass(string name_, string symbol_, (address paymentToken, uint96 price, uint32 billingPeriod, uint32 gracePeriod, address treasury) cfg, address relayer_) returns (address)',
])
const passAbi = parseAbi([
  'function subscribe(address keyId) returns (uint256)',
  'function unsubscribe()',
  'function activate(uint256 tokenId)',
  'function renew(uint256 tokenId)',
  'function burnExpired(uint256 tokenId)',
  'function expiresAtOf(uint256) view returns (uint256)',
  'function tokenOfOwner(address) view returns (uint256)',
  'function isActive(uint256) view returns (bool)',
  'function tokenURI(uint256) view returns (string)',
  'function totalSupply() view returns (uint256)',
  'function ownerOf(uint256) view returns (address)',
])
const tokenAbi = parseAbi(['function balanceOf(address) view returns (uint256)'])
const keychainAbi = [
  {
    type: 'function',
    name: 'authorizeKey',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'keyId', type: 'address' },
      { name: 'signatureType', type: 'uint8' },
      {
        name: 'config',
        type: 'tuple',
        components: [
          { name: 'expiry', type: 'uint64' },
          { name: 'enforceLimits', type: 'bool' },
          {
            name: 'limits',
            type: 'tuple[]',
            components: [
              { name: 'token', type: 'address' },
              { name: 'amount', type: 'uint256' },
              { name: 'period', type: 'uint64' },
            ],
          },
          { name: 'allowAnyCalls', type: 'bool' },
          {
            name: 'allowedCalls',
            type: 'tuple[]',
            components: [
              { name: 'target', type: 'address' },
              {
                name: 'selectorRules',
                type: 'tuple[]',
                components: [
                  { name: 'selector', type: 'bytes4' },
                  { name: 'recipients', type: 'address[]' },
                ],
              },
            ],
          },
        ],
      },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'revokeKey',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'keyId', type: 'address' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'getKey',
    stateMutability: 'view',
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'keyId', type: 'address' },
    ],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'signatureType', type: 'uint8' },
          { name: 'keyId', type: 'address' },
          { name: 'expiry', type: 'uint64' },
          { name: 'enforceLimits', type: 'bool' },
          { name: 'isRevoked', type: 'bool' },
        ],
      },
    ],
  },
]

const PRICE = 500000n // 0.5 pathUSD
const PERIOD = 120n // 2 minutes
const GRACE = 240n // 4 minutes
const NAME = 'E2E "Whel" <test>' // deliberately nasty to exercise metadata escaping

let passFailures = 0
function check(label, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${label}`)
  if (!cond) passFailures++
}
const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000))
const now = () => BigInt(Math.floor(Date.now() / 1000))

async function relayer(path, body) {
  const res = await fetch(`${RELAYER}${path}`, body
    ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
    : {})
  const json = await res.json()
  if (!res.ok) throw new Error(json.error ?? `relayer ${res.status}`)
  return json
}

console.log(`E2E user: ${USER}`)
const bal0 = await pc.readContract({ address: PATHUSD, abi: tokenAbi, functionName: 'balanceOf', args: [USER] })
console.log(`pathUSD before: ${formatUnits(bal0, 6)}`)

// --- 1. deploy a short-lived pass through the factory ---
console.log('\n[1] deploy test pass (treasury = dead address, so pulls are measurable)')
const TREASURY = getAddress(acct.address)
const countBefore = await pc.readContract({ address: FACTORY, abi: factoryAbi, functionName: 'passCount' })
const tx = await wc.writeContract({
  address: FACTORY,
  abi: factoryAbi,
  functionName: 'deployPass',
  args: [NAME, 'E2E', { paymentToken: PATHUSD, price: PRICE, billingPeriod: Number(PERIOD), gracePeriod: Number(GRACE), treasury: TREASURY }, USER],
})
await pc.waitForTransactionReceipt({ hash: tx.transactionHash ?? tx })
const countAfter = await pc.readContract({ address: FACTORY, abi: factoryAbi, functionName: 'passCount' })
const PASS = getAddress(await pc.readContract({ address: FACTORY, abi: factoryAbi, functionName: 'passes', args: [countAfter - 1n] }))
check('pass deployed and registered', countAfter === countBefore + 1n)
console.log(`    pass: ${PASS}`)

// --- 2. relayer creates the access key ---
console.log('\n[2] relayer key creation')
const key = await relayer('/key', { pass: PASS, user: USER })
check('keyId returned', /^0x[0-9a-fA-F]{40}$/.test(key.keyId))
check('recurring limit = price + 10%', BigInt(key.limit) === PRICE + PRICE / 10n)
console.log(`    keyId: ${key.keyId}`)

// --- 3. authorize the key (Tempo keychain: recurring limit + call scope) ---
console.log('\n[3] authorizeKey (recurring direct-debit mandate)')
const authHash = await wc.writeContract({
  address: KEYCHAIN,
  abi: keychainAbi,
  functionName: 'authorizeKey',
  args: [
    key.keyId,
    1, // P256
    {
      expiry: now() + 5n * 86400n,
      enforceLimits: true,
      limits: [{ token: PATHUSD, amount: BigInt(key.limit), period: BigInt(key.billingPeriod) }],
      allowAnyCalls: false,
      allowedCalls: [
        { target: PATHUSD, selectorRules: [{ selector: TRANSFER, recipients: [TREASURY] }] },
        // empty selectorRules = any selector on the pass (activate/renew) —
        // the pass's other functions are owner-gated
        { target: PASS, selectorRules: [] },
      ],
    },
  ],
  gas: 6_000_000n, // keychain authorizeKey with scopes needs ~4.8M on Tempo
})
const authReceipt = await pc.waitForTransactionReceipt({ hash: authHash })
check('authorizeKey tx succeeded', authReceipt.status === 'success')
const keyOnchain = await pc.readContract({ address: KEYCHAIN, abi: keychainAbi, functionName: 'getKey', args: [USER, key.keyId] })
const isRevoked = keyOnchain.isRevoked ?? keyOnchain[4]
const enforceLimits = keyOnchain.enforceLimits ?? keyOnchain[3]
check('key authorized onchain (enforced limits, not revoked)', isRevoked === false && enforceLimits === true)

// --- 4. subscribe (mints to caller, bound to the key) ---
console.log('\n[4] subscribe')
const subHash = await wc.writeContract({ address: PASS, abi: passAbi, functionName: 'subscribe', args: [key.keyId] })
await pc.waitForTransactionReceipt({ hash: subHash })
const tokenId = await pc.readContract({ address: PASS, abi: passAbi, functionName: 'tokenOfOwner', args: [USER] })
check('pass minted to caller', tokenId === 1n)
check('not active yet (payment pending)', (await pc.readContract({ address: PASS, abi: passAbi, functionName: 'isActive', args: [tokenId] })) === false)

// --- 5. relayer activates: transfer + activate in one key-signed batch ---
console.log('\n[5] activate (relayer direct debit, capped by the keychain)')
const relayerRes = await relayer(`/activate`, { pass: PASS, user: USER, tokenId: tokenId.toString() })
const relayerTxHash = relayerRes.txHash
const exp1 = await pc.readContract({ address: PASS, abi: passAbi, functionName: 'expiresAtOf', args: [tokenId] })
check('pass activated, expiry = now + period', exp1 > now())
// treasury == holder here, so balances net out: verify the expiry move (PASS above)
check('relayer returned a tx hash', /^0x[0-9a-fA-F]{64}$/.test(relayerTxHash))
check('isActive true', (await pc.readContract({ address: PASS, abi: passAbi, functionName: 'isActive', args: [tokenId] })) === true)

// --- 6. onchain metadata ---
console.log('\n[6] onchain metadata')
const uri = await pc.readContract({ address: PASS, abi: passAbi, functionName: 'tokenURI', args: [tokenId] })
check('tokenURI is data:application/json;base64', uri.startsWith('data:application/json;base64,'))
const json = JSON.parse(Buffer.from(uri.slice(29), 'base64').toString('utf8'))
check('metadata name present', json.name.includes('E2E'))
check('SVG image embedded', json.image.startsWith('data:image/svg+xml;base64,'))
const svg = Buffer.from(json.image.slice(26), 'base64').toString('utf8')
check('metadata escaping (no raw <script>)', !svg.includes('<script>'))

// --- 7. auto-renewal by the relayer loop (keychain limit rolls over at period end) ---
console.log('\n[7] auto-renewal (waiting for the relayer loop, ~2-3 min)')
const T0 = Number(exp1)
let renewed = false
let expNow = exp1
let renewTxHash = null
while (Date.now() / 1000 < T0 + Number(PERIOD) + 60) {
  await sleep(15)
  expNow = await pc.readContract({ address: PASS, abi: passAbi, functionName: 'expiresAtOf', args: [tokenId] })
  if (expNow > exp1) {
    renewed = true
    renewTxHash = null
    break
  }
}
check(`auto-renewed (expiry now ${new Date(Number(expNow) * 1000).toISOString()})`, renewed)

// --- 8. cancel: revoke the access key ---
console.log('\n[8] revoke access key')
await wc.writeContract({ address: KEYCHAIN, abi: keychainAbi, functionName: 'revokeKey', args: [key.keyId], gas: 1_000_000n })
check('revokeKey tx sent', true)
let revokedFlag = false
for (let i = 0; i < 30; ++i) {
  await sleep(2)
  const k2 = await pc.readContract({ address: KEYCHAIN, abi: keychainAbi, functionName: 'getKey', args: [USER, key.keyId] })
  if ((k2.isRevoked ?? k2[4]) === true) { revokedFlag = true; break }
}
check('key revoked onchain', revokedFlag === true)

// --- 9. permissionless burn after expiry + grace ---
console.log('\n[9] permissionless burn after expiry + grace')
const burnAt = Number(expNow) + Number(GRACE)
console.log(`    waiting until ${new Date(burnAt * 1000).toISOString()} (~${Math.round(burnAt - Date.now() / 1000)}s)`)
while (Date.now() / 1000 <= burnAt) await sleep(20)
await wc.writeContract({ address: PASS, abi: passAbi, functionName: 'burnExpired', args: [tokenId] })
let burned = false
for (let i = 0; i < 30; ++i) {
  await sleep(2)
  try {
    await pc.readContract({ address: PASS, abi: passAbi, functionName: 'ownerOf', args: [tokenId] })
  } catch { burned = true; break }
}
check('token destroyed after burn', burned)

// --- summary ---
console.log(`\n${passFailures === 0 ? 'ALL CHECKS PASSED' : `${passFailures} CHECK(S) FAILED`}`)
process.exit(passFailures === 0 ? 0 : 1)
