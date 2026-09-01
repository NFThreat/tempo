// Reproduce EXACTLY: fresh key via P256.randomPrivateKey() (like createAccessKey)
import { createPublicClient, createWalletClient, http, parseAbi, getAddress } from 'viem';
import { tempoModerato } from 'viem/tempo/chains';
import { Account, createClient } from 'viem/tempo';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { P256 } from 'viem/tempo';

const acct = privateKeyToAccount('0x0466ac1bea572b6f4b38ef34d361f6feb9f21276cbeeab06957bd72c69da7a80');
const USER = acct.address;
const TREASURY = getAddress(acct.address);
const PATHUSD = '0x20C0000000000000000000000000000000000000';
const KEYCHAIN = '0xaaaaaaaa00000000000000000000000000000000';
const FACTORY = '0x8e3f7dc5beaf73461310eddb5d05a41126bce189';
const pc = createPublicClient({ chain: tempoModerato, transport: http('https://rpc.moderato.tempo.xyz') });
const wc = createWalletClient({ account: acct, chain: tempoModerato, transport: http('https://rpc.moderato.tempo.xyz') });
const factoryAbi = parseAbi(['function passCount() view returns (uint256)', 'function passes(uint256) view returns (address)', 'function deployPass(string, string, (address paymentToken, uint96 price, uint32 billingPeriod, uint32 gracePeriod, address treasury) cfg, address relayer_) returns (address)']);
const passAbi = parseAbi(['function subscribe(address keyId) returns (uint256)', 'function activate(uint256 tokenId)', 'function tokenOfOwner(address) view returns (uint256)', 'function expiresAtOf(uint256) view returns (uint256)']);
const tokenAbi = parseAbi(['function approve(address, uint256) returns (bool)', 'function transfer(address, uint256) returns (bool)', 'function balanceOf(address) view returns (uint256)']);
function encTransfer(to, a) { return '0xa9059cbb' + to.slice(2).toLowerCase().padStart(64, '0') + a.toString(16).padStart(64, '0'); }
function encActivate(t) { return '0xb260c42a' + t.toString(16).padStart(64, '0'); }

// CASE 1: P256.randomPrivateKey (relayer style)
const dHash = await wc.writeContract({ address: FACTORY, abi: factoryAbi, functionName: 'deployPass', args: ['DX', 'DX', { paymentToken: PATHUSD, price: 500000n, billingPeriod: 120, gracePeriod: 240, treasury: TREASURY }, USER] });
await pc.waitForTransactionReceipt({ hash: dHash });
const count = await pc.readContract({ address: FACTORY, abi: factoryAbi, functionName: 'passCount' });
const PASS = getAddress(await pc.readContract({ address: FACTORY, abi: factoryAbi, functionName: 'passes', args: [count - 1n] }));
console.log('pass:', PASS);
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

const pk = P256.randomPrivateKey();
const kid = Account.fromP256(pk).address;
const accessKey = Account.fromP256(pk, { access: USER });
const client = createClient({ account: accessKey, chain: tempoModerato, feeToken: PATHUSD, transport: http('https://rpc.moderato.tempo.xyz') });
const h1 = await wc.writeContract({ address: KEYCHAIN, abi: kabi, functionName: 'authorizeKey', args: [kid, 1, {
  expiry: now() + 5n * 86400n, enforceLimits: true,
  limits: [{ token: PATHUSD, amount: 550000n, period: 120n }],
  allowAnyCalls: false,
  allowedCalls: [
    { target: PATHUSD, selectorRules: [{ selector: '0xa9059cbb', recipients: [TREASURY] }] },
    { target: PASS, selectorRules: [] },
  ],
}], gas: 6000000n });
const r1 = await pc.waitForTransactionReceipt({ hash: h1 });
console.log('authorize:', r1.status);
const sHash = await wc.writeContract({ address: PASS, abi: passAbi, functionName: 'subscribe', args: [kid] });
await pc.waitForTransactionReceipt({ hash: sHash });
const tokenId = await pc.readContract({ address: PASS, abi: passAbi, functionName: 'tokenOfOwner', args: [USER] });
console.log('tokenId:', tokenId.toString());
const aHash = await wc.writeContract({ address: PATHUSD, abi: tokenAbi, functionName: 'approve', args: [PASS, 1500000n] });
await pc.waitForTransactionReceipt({ hash: aHash });
function now() { return BigInt(Math.floor(Date.now() / 1000)); }
try {
  const h2 = await client.sendTransactionSync({ calls: [
    { to: PATHUSD, data: encTransfer(TREASURY, 500000n) },
    { to: PASS, data: encActivate(tokenId) },
  ]});
  const r2 = await pc.waitForTransactionReceipt({ hash: h2.transactionHash ?? h2 });
  console.log('BATCH =>', r2.status, 'gas', r2.gasUsed.toString());
  const exp = await pc.readContract({ address: PASS, abi: passAbi, functionName: 'expiresAtOf', args: [tokenId] });
  console.log('expiresAt set:', exp.toString() !== '0');
} catch (e) {
  console.log('BATCH => FAIL');
  console.log('DETAILS:', (e.cause?.details || e.details || '').slice(0, 200));
}
