import { NextRequest, NextResponse } from 'next/server'
import { createPublicClient, getAddress, http } from 'viem'
import { tempoModerato } from 'viem/tempo/chains'
import { TEMPO_RPC } from '@/lib/constants'
import { passAbi } from '@/lib/abis'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ address: string }> }) {
  const { address } = await params
  const user = req.nextUrl.searchParams.get('user')
  if (!user) return NextResponse.json({ error: 'missing user' }, { status: 400 })
  try {
    const client = createPublicClient({ chain: tempoModerato, transport: http(TEMPO_RPC) })
    const tokenId = await client.readContract({
      address: getAddress(address) as `0x${string}`,
      abi: passAbi,
      functionName: 'tokenOfOwner',
      args: [getAddress(user) as `0x${string}`],
    })
    return NextResponse.json({ tokenId: tokenId.toString() })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}
