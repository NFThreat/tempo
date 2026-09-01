// The EXACT failing batch from the E2E: treasury = 0x553E (self-transfer OK per diag20!)
// but with keyId = 0xA9e2 (the E2E's key) — trace it.
import { createPublicClient, http, parseAbi } from 'viem';
import { tempoModerato } from 'viem/tempo/chains';
const pc = createPublicClient({ chain: tempoModerato, transport: http('https://rpc.moderato.tempo.xyz') });
const USER = '0x553E4C46929900Bd794b83Fb43473D224E548dcb';
const txb = { from: USER, type: '0x76', chainId: '0xa5bf', nonce: '0x5', calls: [
  { to: PATHUSD(), value: '0x0', data: '0xa9059cbb' + USER.slice(2).toLowerCase().padStart(64, '0') + '000000000000000000000000000000000000000000000000000000000007a120' },
  { to: PASS2X(), value: '0x0', data: '0xb260c42a' + '01'.padStart(64, '0') },
], feeToken: PATHUSD(), keyId: '0xcc2c18028ec5f90a9c0d7bc0d466f86ca93ea4be', keyType: 'p256' };
function PATHUSD() { return '0x20C0000000000000000000000000000000000000'; }
function PASS2X() { return '0x3fE11170c13258eF37661fDa839f7f306616930A'; }
(async () => {
  try {
    const trace = await pc.request({ method: 'debug_traceCall', params: [txb, 'latest', { tracer: 'callTracer' }] });
    console.log('gasUsed:', trace.gasUsed);
    function walk(n, d) { console.log(' '.repeat(d) + (n.type||'call') + ' to ' + (n.to||'').slice(0,12) + ' err:' + (n.error||'-') + (n.revertReason ? ' reason:' + n.revertReason : '')); for (const c of n.calls||[]) walk(c, d+1); }
    walk(trace, 0);
  } catch (e) { console.log('ERR:', e.message.slice(0, 200)); }
})();
