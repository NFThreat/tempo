import { createPublicClient, createWalletClient, http, parseAbi } from 'viem';
import { tempoModerato } from 'viem/tempo/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { Account, P256, createClient } from 'viem/tempo';

const acct = privateKeyToAccount('0x0466ac1bea572b6f4b38ef34d361f6feb9f21276cbeeab06957bd72c69da7a80');
const USER = acct.address;
const PATHUSD = '0x20C0000000000000000000000000000000000000';
const KEYCHAIN = '0xaaaaaaaa00000000000000000000000000000000';
const PASS = '0x63B380327d4e7994b2B473993ef729cd5Efe2F70';
const pc = createPublicClient({ chain: tempoModerato, transport: http('https://rpc.moderato.tempo.xyz') });
const wc = createWalletClient({ account: acct, chain: tempoModerato, transport: http('https://rpc.moderato.tempo.xyz') });
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

const privateKey = P256.randomPrivateKey();
const keyId = Account.fromP256(privateKey).address;
const accessKey = Account.fromP256(privateKey, { access: USER });
console.log('relayer keyId:', keyId);

const expiry = BigInt(Math.floor(Date.now() / 1000) + 5 * 86400);
const h1 = await wc.writeContract({ address: KEYCHAIN, abi: kabi, functionName: 'authorizeKey', args: [keyId, 1, {
  expiry, enforceLimits: true,
  limits: [{ token: PATHUSD, amount: 550000n, period: 120n }],
  allowAnyCalls: false,
  allowedCalls: [
    { target: PATHUSD, selectorRules: [{ selector: '0xa9059cbb', recipients: [USER] }] },
    { target: PASS, selectorRules: [] },
  ],
}], gas: 6000000n });
const r1 = await pc.waitForTransactionReceipt({ hash: h1 });
console.log('authorize:', r1.status);

// THE RELAYER BATCH — verbatim activateSubscription body (push transfer, no approve)
const client = createClient({ chain: tempoModerato, transport: http('https://rpc.moderato.tempo.xyz'), account: accessKey });
const cfg = { paymentToken: PATHUSD, treasury: USER, price: 500000n };
try {
  const receipt = await client.sendTransactionSync({ account: accessKey, calls: [
    { to: cfg.paymentToken, data: encodeTransfer(cfg.treasury, cfg.price) },
    { to: PASS, data: encodeActivate(1n) },
  ], feeToken: PATHUSD });
  console.log('RELAYER BATCH =>', receipt.status, 'gas', receipt.gasUsed.toString());
} catch (e) {
  console.log('RELAYER BATCH => FAIL:', (e.message || '').slice(0, 250));
}
function encodeTransfer(to, amount) { return '0xa9059cbb' + to.slice(2).toLowerCase().padStart(64, '0') + amount.toString(16).padStart(64, '0'); }
function encodeActivate(t) { return '0xb260c42a' + t.toString(16).padStart(64, '0'); }
