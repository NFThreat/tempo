import { createPublicClient, getAddress, http, isAddress } from 'viem'
import { tempoModerato } from 'viem/tempo/chains'
import { TEMPO_RPC } from '@/lib/constants'
import { passAbi } from '@/lib/abis'

const client = createPublicClient({ chain: tempoModerato, transport: http(TEMPO_RPC) })

export interface PassInfo {
  address: string
  paymentToken: string
  price: string
  billingPeriod: number
  gracePeriod: number
  treasury: string
  name: string
  symbol: string
}

const TTL_MS = 30_000
const cache = new Map<string, { data: PassInfo; ts: number }>()

/// Read a pass's onchain config + metadata, memoized for 30s to keep the
/// public RPC happy (it rate-limits bursts).
export async function getPassInfo(pass: string): Promise<PassInfo> {
  if (!isAddress(pass)) throw new Error('invalid pass address')
  const address = getAddress(pass)
  const hit = cache.get(address)
  if (hit && Date.now() - hit.ts < TTL_MS) return hit.data

  const [cfg, name, symbol] = await Promise.all([
    client.readContract({ address, abi: passAbi, functionName: 'config' }),
    client.readContract({ address, abi: passAbi, functionName: 'name' }),
    client.readContract({ address, abi: passAbi, functionName: 'symbol' }),
  ])
  const data: PassInfo = {
    address,
    paymentToken: cfg[0],
    price: cfg[1].toString(),
    billingPeriod: cfg[2],
    gracePeriod: cfg[3],
    treasury: cfg[4],
    name,
    symbol,
  }
  cache.set(address, { data, ts: Date.now() })
  return data
}
