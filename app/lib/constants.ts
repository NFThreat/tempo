import { http } from 'viem'
import { tempoModerato } from 'viem/tempo/chains'

export const chain = tempoModerato

export const PATHUSD = '0x20C0000000000000000000000000000000000000' as const
export const ACCOUNT_KEYCHAIN = '0xaaaaaaaa00000000000000000000000000000000' as const

export const FACTORY_ADDRESS = (process.env.NEXT_PUBLIC_FACTORY_ADDRESS ?? '') as `0x${string}`
export const RELAYER_URL = process.env.NEXT_PUBLIC_RELAYER_URL ?? 'http://localhost:3001'
export const TEMPO_RPC = process.env.NEXT_PUBLIC_TEMPO_RPC ?? 'https://rpc.moderato.tempo.xyz'
export const DEFAULT_RELAYER_ADDRESS = (process.env.NEXT_PUBLIC_RELAYER_ADDRESS ?? '') as `0x${string}`

export const transport = http(TEMPO_RPC)

/// approve(address,uint256) selector — the pass pulls payment via allowance.
/// transfer(address,uint256) selector — the access key pushes the payment.
export const TRANSFER_SELECTOR = '0xa9059cbb' as const
/// PassNFT.activate(uint256) selector, authorized in the access-key scope.
export const ACTIVATE_SELECTOR = '0xb260c42a' as const
/// PassNFT.renew(uint256) selector, authorized in the access-key scope.
export const RENEW_SELECTOR = '0x5baa7509' as const
