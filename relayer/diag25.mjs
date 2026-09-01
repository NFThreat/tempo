// Calls the ACTUAL relayer activateSubscription with the exact failed-E2E params
import { activateSubscription } from './src/subscriptions.js';
try {
  const r = await activateSubscription({
    pass: '0xd7B80111169ae6bB9e6D4F6b210579F69106eFFF',
    user: '0x553E4C46929900Bd794b83Fb43473D224E548dcb',
    tokenId: '1',
  });
  console.log('ACTIVATE => OK', r.txHash);
} catch (e) {
  console.log('ACTIVATE => FAIL:', (e.message || '').slice(0, 300));
  const det = e.cause?.details || e.details;
  console.log('DETAILS:', (det || '').slice(0, 200));
}
