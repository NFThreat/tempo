import { createPublicClient, http } from 'viem'
import { tempoModerato } from 'viem/tempo/chains'
import Link from 'next/link'
import { FACTORY_ADDRESS, TEMPO_RPC } from '@/lib/constants'
import { factoryAbi, passAbi } from '@/lib/abis'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const client = createPublicClient({ chain: tempoModerato, transport: http(TEMPO_RPC) })

  let passes: { address: `0x${string}`; name: string; symbol: string }[] = []
  if (FACTORY_ADDRESS) {
    const logs = await client.getLogs({
      address: FACTORY_ADDRESS,
      event: factoryAbi[6],
      fromBlock: 'earliest',
    })
    passes = logs.map((l) => ({
      address: l.args.pass as `0x${string}`,
      name: l.args.name ?? '',
      symbol: l.args.symbol ?? '',
    }))
  }

  const rows: { address: `0x${string}`; name: string; symbol: string; price: string }[] = []
  for (const p of passes) {
    try {
      const [name, symbol, cfg] = await Promise.all([
        client.readContract({ address: p.address, abi: passAbi, functionName: 'name' }),
        client.readContract({ address: p.address, abi: passAbi, functionName: 'symbol' }),
        client.readContract({ address: p.address, abi: passAbi, functionName: 'config' }),
      ])
      rows.push({ address: p.address, name, symbol, price: (Number(cfg[1]) / 1e6).toFixed(2) })
    } catch {
      rows.push({ address: p.address, name: p.name, symbol: p.symbol, price: '?' })
    }
  }

  return (
    <div>
      <h1>Pass launchpad</h1>
      <p style={{ color: '#8b949e' }}>
        Launch an NFT pass on Tempo testnet. Holders pay in pathUSD — renewals run automatically via access
        keys, and unpaid passes expire and burn.
      </p>

      {!FACTORY_ADDRESS ? (
        <p style={{ color: '#f0883e' }}>
          Set NEXT_PUBLIC_FACTORY_ADDRESS (after running <code>forge script script/Deploy.s.sol</code>) to list
          passes here.
        </p>
      ) : rows.length === 0 ? (
        <p style={{ color: '#8b949e' }}>No passes launched yet — be the first.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', color: '#8b949e' }}>
              <th style={{ padding: 8, borderBottom: '1px solid #1f2937' }}>Pass</th>
              <th style={{ padding: 8, borderBottom: '1px solid #1f2937' }}>Price / period</th>
              <th style={{ padding: 8, borderBottom: '1px solid #1f2937' }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.address}>
                <td style={{ padding: 8, borderBottom: '1px solid #1f2937' }}>
                  {r.name} <span style={{ color: '#8b949e' }}>({r.symbol})</span>
                </td>
                <td style={{ padding: 8, borderBottom: '1px solid #1f2937' }}>{r.price} pathUSD</td>
                <td style={{ padding: 8, borderBottom: '1px solid #1f2937' }}>
                  <Link href={`/pass/${r.address}`} style={{ color: '#58a6ff' }}>
                    View →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
