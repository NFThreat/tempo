import { NextRequest, NextResponse } from 'next/server'
import { createPublicClient, getAddress, http, isAddress } from 'viem'
import { tempoModerato } from 'viem/tempo/chains'
import { ACCOUNT_KEYCHAIN, FACTORY_ADDRESS, TEMPO_RPC } from '@/lib/constants'
import { factoryAbi, keychainAbi, passAbi } from '@/lib/abis'
import { getKeyId } from '@/lib/relayer'
import { getPassInfo } from '@/lib/passInfo'

export const dynamic = 'force-dynamic'

const client = createPublicClient({ chain: tempoModerato, transport: http(TEMPO_RPC) })

// Short-lived per-user cache so repeated page loads don't hammer the RPC.
const TTL_MS = 20_000
const cache = new Map<string, { data: unknown; ts: number }>()

export async function GET(req: NextRequest) {
  const userParam = req.nextUrl.searchParams.get('user')
  if (!userParam || !isAddress(userParam)) {
    return NextResponse.json({ error: 'invalid user address' }, { status: 400 })
  }
  if (!FACTORY_ADDRESS) {
    return NextResponse.json({ error: 'factory not configured' }, { status: 400 })
  }
  const user = getAddress(userParam) as `0x${string}`

  const hit = cache.get(user)
  if (hit && Date.now() - hit.ts < TTL_MS) {
    return NextResponse.json(hit.data)
  }

  try {
    const count = await client.readContract({
      address: FACTORY_ADDRESS,
      abi: factoryAbi,
      functionName: 'passCount',
    })
    const passes = await Promise.all(
      Array.from({ length: Number(count) }, (_, i) =>
        client.readContract({
          address: FACTORY_ADDRESS,
          abi: factoryAbi,
          functionName: 'passes',
          args: [BigInt(i)],
        }),
      ),
    )

    const subs: {
      pass: string
      tokenId: string
      name: string
      symbol: string
      price: string
      periodDays: number
      expiresAt: string
      keyId: string | null
      revoked: boolean
    }[] = []
    for (const pass of passes) {
      try {
        const tokenId = await client.readContract({
          address: pass,
          abi: passAbi,
          functionName: 'tokenOfOwner',
          args: [user],
        })
        if (tokenId === 0n) continue
        const [info, expiresAt] = await Promise.all([
          getPassInfo(pass),
          client.readContract({
            address: pass,
            abi: passAbi,
            functionName: 'expiresAtOf',
            args: [tokenId],
          }),
        ])
        let keyId: string | null = null
        let revoked = false
        try {
          keyId = (await getKeyId(pass, user)).keyId
          const key = await client.readContract({
            address: ACCOUNT_KEYCHAIN,
            abi: keychainAbi,
            functionName: 'getKey',
            args: [user, keyId as `0x${string}`],
          })
          revoked = key.isRevoked
        } catch {
          // relayer has no key for this subscription — revoke unavailable
        }
        subs.push({
          pass,
          tokenId: tokenId.toString(),
          name: info.name,
          symbol: info.symbol,
          price: (Number(info.price) / 1e6).toFixed(2),
          periodDays: Math.round(info.billingPeriod / 86400),
          expiresAt: expiresAt.toString(),
          keyId,
          revoked,
        })
      } catch {
        // skip unreadable pass
      }
    }
    cache.set(user, { data: subs, ts: Date.now() })
    return NextResponse.json(subs)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}
