import { NextRequest, NextResponse } from 'next/server'
import { isAddress } from 'viem'
import { getPassInfo } from '@/lib/passInfo'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ address: string }> }) {
  let { address } = await params
  // Tolerate the padded 32-byte form (0x + 64 hex chars) from raw event topics.
  if (/^0x[0-9a-fA-F]{64}$/.test(address)) address = `0x${address.slice(-40)}`
  try {
    const info = await getPassInfo(address)
    return NextResponse.json(info)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}
