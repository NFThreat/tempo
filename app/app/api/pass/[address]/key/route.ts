import { NextRequest, NextResponse } from 'next/server'
import { createPublicClient, getAddress, http } from 'viem'
import { tempoModerato } from 'viem/tempo/chains'
import { createKey, getKeyId } from '@/lib/relayer'
import { ACCOUNT_KEYCHAIN, TEMPO_RPC } from '@/lib/constants'
import { keychainAbi } from '@/lib/abis'

export const dynamic = 'force-dynamic'

const client = createPublicClient({ chain: tempoModerato, transport: http(TEMPO_RPC) })

export async function POST(req: NextRequest, { params }: { params: Promise<{ address: string }> }) {
  const { address } = await params
  const body = await req.json()
  try {
    const result = await createKey(address, body.user as string)
    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ address: string }> }) {
  const { address } = await params
  const userParam = req.nextUrl.searchParams.get('user')
  if (!userParam) return NextResponse.json({ error: 'missing user' }, { status: 400 })
  try {
    const { keyId } = await getKeyId(address, userParam)
    const user = getAddress(userParam) as `0x${string}`
    const key = await client.readContract({
      address: ACCOUNT_KEYCHAIN,
      abi: keychainAbi,
      functionName: 'getKey',
      args: [user, keyId as `0x${string}`],
    })
    return NextResponse.json({ keyId, revoked: key.isRevoked })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}
