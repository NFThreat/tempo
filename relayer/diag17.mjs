// ISOLATION: same relayer key (createAccessKey P256.randomPrivateKey) vs script key (generatePrivateKey)
// Authorize BOTH with identical scopes, run identical batches, compare.
import { createPublicClient, createWalletClient, http, parseAbi, getAddress } from 'viem';
import { tempoModerato } from 'viem/tempo/chains';
import { Account, createClient } from 'viem/tempo';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const USER = '0x553E4C46929900Bd794b83Fb43473D224E548dcb';
const PASS = '0x8A73BB7284dCDE7Fd7CB8c9D4DC418f61e46eE22'; // unactivated pass from the failed run, token 1 minted
const PATHUSD = '0x20C0000000000000000000000000000000000000';
const KEYCHAIN = '0xaaaaaaaa00000000000000000000000000000000';
const pc = createPublicClient({ chain: tempoModerato, transport: http('https://rpc.moderato.tempo.xyz') });
const wc = createWalletClient({ account: privateKeyToAccount('0x0466ac1bea572b6f4b38ef34d361f6feb9f21276cbeeab06957bd72c69da7a80'), chain: tempoModerato, transport: http('https://rpc.moderato.tempo.xyz') });
const kabi = [
  { type: 'function', name: 'authorizeKey', stateMutability: 'nonpayable', inputs: [
    { name: 'keyId', type: 'address' }, { name: 'signatureType', type: 'uint8' },
    { name: 'config', type: 'tuple', components: [
      { name: 'expiry', type: 'uint64' }, { name: 'enforceLimits', type: 'bool' },
      { name: 'limits', type: 'tuple[]', components: [{ name: 'token', type: 'address' }, { name: 'amount', type: 'uint256' }, { name: 'period', type: 'uint64' }] },
      { name: 'allowAnyCalls', type: 'bool' },
      { name: 'allowedCalls', type: 'tuple[]', components: [{ name: 'target', type: 'address' }, { name: 'selectorRules', type: 'tuple[]', components: [{ name: 'selector', type: 'bytes4' }, { name: 'recipients', type: 'address[]' }] }] },
    ] }],
  outputs: [] }];
const passAbi = parseAbi(['function activate(uint256 tokenId)']);
function encActivate(t) { return '0xb260c42a' + t.toString(16).padStart(64, '0'); }

const cases = [
  ['relayer P256 key', '0xE8cbE3B2659E9C2647Feaa96c19A6767Ea06257B'],
  ['script secp-scalar key', '0x9f0eE14FcFb7B63b4e6bBF0e0B6d4aE1D1b0fB62'],
];
// NOTE: case 2 keyId is made up; use a freshly generated one instead
const fresh = Account.fromP256(generatePrivateKey()).address;
cases[1] = ['fresh P256 key', fresh];

for (const [label, kid] of cases) {
  try {
    const h1 = await wc.writeContract({ address: KEYCHAIN, abi: kabi, functionName: 'authorizeKey', args: [kid, 1, {
      expiry: 18446744073709551615n, enforceLimits: true,
      limits: [{ token: PATHUSD, amount: 550000n, period: 120n }],
      allowAnyCalls: false,
      allowedCalls: [
        { target: PATHUSD, selectorRules: [{ selector: '0xa9059cbb', recipients: [TREASURY_STUB] }] },
        { target: PASS, selectorRules: [] },
      ],
    }], gas: 6000000n });
    const r1 = await pc.waitForTransactionReceipt({ hash: h1 });
    console.log(label, 'authorize =>', r1.status);
  } catch (e) { console.log(label, 'authorize ERR:', (e.message||'').slice(0, 100)); }
}
const TREASURY_STUB = USER;
