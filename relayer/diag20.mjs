import { createPublicClient, http, parseAbi } from 'viem';
import { tempoModerato } from 'viem/tempo/chains';
import { Account, createClient } from 'viem/tempo';
import { createDecipheriv, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const raw = readFileSync('data/state.json', 'utf8').trim();
const [m, iv, tag, data] = raw.split('.');
const secret = readFileSync('.env', 'utf8').match(/STATE_SECRET=(.*)/)[1].trim();
const k = createHash('sha256').update(secret).digest();
const d = createDecipheriv('aes-256-gcm', k, Buffer.from(iv, 'base64'));
d.setAuthTag(Buffer.from(tag, 'base64'));
const state = JSON.parse(Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8'));
const USER = '0x553E4C46929900Bd794b83Fb43473D224E548dcb';
const PASS = '0x8A73BB7284dCDE7Fd7CB8c9D4DC418f61e46eE22';
const TREASURY = USER;
const PATHUSD = '0x20C0000000000000000000000000000000000000';
const entry = Object.entries(state.pendingKeys).find(([k2, v]) => k2.startsWith(PASS.slice(0, 10).toLowerCase()));
console.log('using pendingKey for pass:', entry[0]);
const accessKey = Account.fromP256(entry[1].accessKeyPrivate, { access: USER });
const client = createClient({ account: accessKey, chain: tempoModerato, feeToken: PATHUSD, transport: http('https://rpc.moderato.tempo.xyz') });
const tokenAbi = parseAbi(['function transfer(address to, uint256 amount) returns (bool)']);
const passAbi = parseAbi(['function activate(uint256 tokenId)']);
function encTransfer(to, a) { return '0xa9059cbb' + to.slice(2).toLowerCase().padStart(64, '0') + a.toString(16).padStart(64, '0'); }
function encActivate(t) { return '0xb260c42a' + t.toString(16).padStart(64, '0'); }
try {
  await client.sendTransactionSync({ calls: [
    { to: PATHUSD, data: encTransfer(TREASURY, 500000n) },
    { to: PASS, data: encActivate(1n) },
  ]});
  console.log('BATCH OK');
} catch (e) {
  const m = (e.message || '').match(/"method":"eth_estimateGas","params":\[(\{.*?\})\]/s);
  if (m) {
    const tx = JSON.parse(m[1].replace(/"value":"0x"/g, '"value":"0x0"'));
    const trace = await pc.request({ method: 'debug_traceCall', params: [tx, 'latest', { tracer: 'callTracer' }] });
    function walk(n, d) { console.log(' '.repeat(d) + (n.type||'call') + ' to ' + (n.to||'').slice(0,10) + ' sel:' + (n.input||'').slice(0,10) + ' err:' + (n.error||'-') + (n.revertReason ? ' reason:' + n.revertReason : '')); for (const c of n.calls||[]) walk(c, d+1); }
    walk(trace, 0);
  } else console.log('no body captured:', (e.message||'').slice(0, 200));
}
