// pathUSD on Tempo testnet (same address on mainnet).
export const PATHUSD = '0x20C0000000000000000000000000000000000000' as const

// Account Keychain precompile (see Tempo docs).
export const ACCOUNT_KEYCHAIN = '0xaaaaaaaa00000000000000000000000000000000' as const

export function env(name: string, fallback = ''): string {
  const v = process.env[name]
  if (v !== undefined && v !== '') return v
  return fallback
}

export const config = {
  tempoRpc: env('TEMPO_RPC_URL', 'https://rpc.moderato.tempo.xyz'),
  ethRpc: env('ETH_RPC_URL', 'https://eth-sepolia.public.blastapi.io'),
  relayerPort: Number(env('RELAYER_PORT', '3001')),
  dbPath: env('DB_PATH', 'data/state.json'),
  renewIntervalMs: Number(env('RENEW_INTERVAL_MS', '60000')),
  mirrorIntervalMs: Number(env('MIRROR_INTERVAL_MS', '30000')),
  // Contracts (deploy with contracts/script/Deploy.s.sol, then set these).
  factoryAddress: env('FACTORY_ADDRESS'),
  passAddresses: env('PASS_ADDRESSES', '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  mirrorAddress: env('MIRROR_ADDRESS', ''),
  mirrorRelayerPk: env('MIRROR_RELAYER_PK', ''),
  stateSecret: env('STATE_SECRET', ''),
  // EOA used to sponsor gas for relayer transactions (optional).
  feePayerPk: env('FEE_PAYER_PK', ''),
}
