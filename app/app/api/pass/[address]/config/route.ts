import { NextRequest, NextResponse } from 'next/server'
import { createPublicClient, getAddress, http, isAddress } from 'viem'
import { tempoModerato } from 'viem/tempo/chains'
import { TEMPO_RPC } from '@/lib/constants'
import { passAbi } from '@/lib/abis'

export const dynamic = 'force-dynamic'

const client = createPublicClient({ chain: tempoModerato, transport: http(TEMPO_RPC) })

export async function GET(_req: NextRequest, { params }: { params: Promise<{ address: string }> }) {
  let { address } = await params
  // Tolerate the padded 32-byte form (0x + 64 hex chars) from raw event topics.
  if (/^0x[0-9a-fA-F]{64}$/.test(address)) address = `0x${address.slice(-40)}`
  if (!isAddress(address)) {
    return NextResponse.json({ error: 'invalid pass address' }, { status: 400 })
  }
  const pass = getAddress(address) as `0x${string}`
  try {
    const [config, name, symbol] = await Promise.all([
      client.readContract({ address: pass, abi: passAbi, functionName: 'config' }),
      client.readContract({ address: pass, abi: passAbi, functionName: 'name' }),
      client.readContract({ address: pass, abi: passAbi, functionName: 'symbol' }),
    ])
    return NextResponse.json({
      paymentToken: config[0],
      price: config[1].toString(),
      billingPeriod: config[2],
      gracePeriod: config[3],
      treasury: config[4],
      name,
      symbol,
    })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}
