import { NextRequest, NextResponse } from 'next/server'
import { createKey } from '@/lib/relayer'

export const dynamic = 'force-dynamic'

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
