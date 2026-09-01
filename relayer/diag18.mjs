import { createPublicClient, http, parseAbi } from 'viem';
import { tempoModerato } from 'viem/tempo/chains';
import { Account, createClient } from 'viem/tempo';
import { createDecipheriv, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const raw = readFileSync('data/state.json', 'utf8').trim();
const [magic, iv, tag, data] = raw.split('.');
const secret = readFileSync('.env', 'utf8').match(/STATE_SECRET=(.*)/)[1].trim();
const k = createHash('sha256').update(secret).digest();
const d = createDecipheriv('aes-256-gcm', k, Buffer.from(iv, 'base64'));
d.setAuthTag(Buffer.from(tag, 'base64'));
const state = JSON.parse(Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8'));
const USER = '0x553E4C46929900Bd794b83Fb43473D224E548dcb';
const PASS = '0x8A73BB7284dCDE7Fd7CB8c9D4DC418f61e46eE22';
const PATHUSD = '0x20C0000000000000000000000000000000000000';
const pc = createPublicClient({ chain: tempoModerato, transport: http('https://rpc.moderato.tempo.xyz') });
const kcAbi = parseAbi([
  'function getKey(address account, address keyId) view returns (uint8 signatureType, address keyId, uint64 expiry, bool enforceLimits, bool isRevoked)',
  'function getRemainingLimitWithPeriod(address account, address keyId, address token) view returns (uint256 remaining, uint64 periodEnd)',
  'function getAllowedCalls(address account, address keyId) view returns (bool isScoped, (address target, (bytes4 selector, address[] recipients)[] rules)[] scopes)',
]);
// find the E2E subscription (pass 0x8A73)
const sub = Object.values(state.subscriptions).find(s2 => JSON.stringify(s2).toLowerCase().includes('8a73bb72'));
console.log('sub found:', !!sub);
const accessKey = Account.fromP256(sub.accessKeyPrivate, { access: USER });
const client = createClient({ account: accessKey, chain: tempoModerato, feeToken: PATHUSD, transport: http('https://rpc.moderato.tempo.xyz') });
const keyState = await pc.readContract({ address: KEYCHAIN, abi: kcAbi, functionName: 'getKey', args: [USER, accessKey.address] });
console.log('key onchain:', JSON.stringify(keyState, (_, v) => typeof v === 'bigint' ? v.toString() : v));
const rem = await pc.readContract({ address: KEYCHAIN, abi: kcAbi, functionName: 'getRemainingLimitWithPeriod', args: [USER, accessKey.address, PATHUSD] });
console.log('remaining:', rem[0].toString(), 'periodEnd:', rem[1].toString());
const sc = await pc.readContract({ address: KEYCHAIN, abi: kcAbi, functionName: 'getAllowedCalls', args: [USER, accessKey.address] });
console.log('scopes:', JSON.stringify(sc, (_, v) => typeof v === 'bigint' ? v.toString() : v).slice(0, 300));
// attempt the batch
try {
  const tokenAbi = parseAbi(['function transfer(address to, uint256 amount) returns (bool)']);
  const passAbi = parseAbi(['function activate(uint256 tokenId)']);
  const h = await client.sendTransactionSync({ calls: [
    { to: PATHUSD, data: '0xa9059cbb' + '0000000000000000000000000000000000000000000000000000000000000000'.slice(0, 64) },
  ]});
  console.log('noop-ish send:', h);
} catch (e) {
  console.log('ERR:', (e.message || '').slice(0, 150));
}
