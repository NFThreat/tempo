import { createPublicClient, http, parseAbi } from 'viem'
import { tempoModerato } from 'viem/tempo/chains'
import Link from 'next/link'
import { FACTORY_ADDRESS, TEMPO_RPC } from '@/lib/constants'
import { factoryAbi } from '@/lib/abis'
import { getPassInfo } from '@/lib/passInfo'
import Whale from '@/components/Whale'

export const dynamic = 'force-dynamic'

const listAbi = parseAbi(['function passCount() view returns (uint256)', 'function passes(uint256) view returns (address)'])

const steps = [
  {
    n: 1,
    title: 'Launch a pass',
    text: 'Give it a name, set the price and billing period. One transaction, done.',
  },
  {
    n: 2,
    title: 'Subscribers join',
    text: 'They connect a wallet, authorize a one-time access key and mint the pass. No repeated approvals.',
  },
  {
    n: 3,
    title: 'Renews automatically',
    text: 'Each period, the pass charges the price in pathUSD from the subscriber\u2019s wallet — within the limit they authorized.',
  },
  {
    n: 4,
    title: 'Cancel anytime',
    text: 'Revoke the access key in one click. Renewals stop immediately, and the pass expires at period end.',
  },
]

export default async function HomePage() {
  const client = createPublicClient({ chain: tempoModerato, transport: http(TEMPO_RPC) })

  let passes: { address: `0x${string}`; name: string; symbol: string }[] = []
  if (FACTORY_ADDRESS) {
    const count = await client.readContract({
      address: FACTORY_ADDRESS,
      abi: listAbi,
      functionName: 'passCount',
    })
    const addresses = await Promise.all(
      Array.from({ length: Number(count) }, (_, i) =>
        client.readContract({
          address: FACTORY_ADDRESS,
          abi: listAbi,
          functionName: 'passes',
          args: [BigInt(i)],
        }),
      ),
    )
    passes = addresses.map((address) => ({ address, name: '', symbol: '' }))
  }

  const rows: { address: `0x${string}`; name: string; symbol: string; price: string; period: number }[] = []
  for (const p of passes) {
    try {
      const info = await getPassInfo(p.address)
      rows.push({
        address: p.address,
        name: info.name,
        symbol: info.symbol,
        price: (Number(info.price) / 1e6).toFixed(2),
        period: Math.round(info.billingPeriod / 86400),
      })
    } catch {
      rows.push({ address: p.address, name: p.name, symbol: p.symbol, price: '?', period: 0 })
    }
  }

  return (
    <div>
      {/* Hero */}
      <section style={{ background: 'var(--bg)' }}>
        <div
          className="container"
          style={{
            display: 'grid',
            gridTemplateColumns: '1.15fr 0.85fr',
            gap: 40,
            alignItems: 'center',
            paddingTop: 56,
            paddingBottom: 48,
          }}
        >
          <div>
            <span className="pill pill-neutral" style={{ marginBottom: 18 }}>
              Live on Tempo testnet
            </span>
            <h1 style={{ fontSize: 40, margin: '0 0 14px' }}>
              Subscription passes that stop charging when you do.
            </h1>
            <p style={{ fontSize: 17, color: 'var(--muted)', margin: '0 0 28px', maxWidth: 520, lineHeight: 1.6 }}>
              Launch an NFT pass in one transaction, or subscribe with a single signature. Payments run
              automatically in pathUSD — cancel anytime and the network stops charging.
            </p>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <a href="/launch" className="btn btn-primary">
                Launch a pass
              </a>
              <a href="#passes" className="btn btn-ghost">
                Browse passes
              </a>
            </div>
            <div
              style={{
                display: 'flex',
                gap: 22,
                marginTop: 32,
                flexWrap: 'wrap',
                color: 'var(--muted)',
                fontSize: 13.5,
                fontWeight: 600,
              }}
            >
              <span>No lock-in — cancel anytime</span>
              <span>Auto-renewals in pathUSD</span>
              <span>Made for everyone</span>
            </div>
          </div>

          <div style={{ position: 'relative', justifySelf: 'center' }}>
            <div
              style={{
                width: 280,
                height: 280,
                borderRadius: '50%',
                background: 'var(--aqua)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Whale size={190} />
            </div>
            <div
              className="card"
              style={{
                position: 'absolute',
                left: -30,
                bottom: 10,
                maxWidth: 200,
                boxShadow: '0 8px 20px rgba(63,127,184,.16)',
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 14 }}>Renews by itself</div>
              <div style={{ color: 'var(--muted)', fontSize: 12.5, marginTop: 4 }}>
                Paid from your wallet, within the limit you authorized.
              </div>
            </div>
            <div
              className="card"
              style={{
                position: 'absolute',
                right: -24,
                top: 14,
                maxWidth: 170,
                boxShadow: '0 8px 20px rgba(63,127,184,.16)',
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 14 }}>Cancel in one click</div>
              <div style={{ color: 'var(--muted)', fontSize: 12.5, marginTop: 4 }}>
                Revoke the key — renewals stop onchain.
              </div>
            </div>
          </div>
        </div>

        {/* flat wave */}
        <svg viewBox="0 0 1440 70" preserveAspectRatio="none" style={{ display: 'block', width: '100%', height: 70 }}>
          <path d="M0 40 C 240 68, 480 8, 720 38 C 960 68, 1200 10, 1440 38 L 1440 70 L 0 70 Z" fill="#ffffff" />
        </svg>
      </section>

      {/* How it works */}
      <section style={{ background: '#fff', padding: '8px 0 56px' }}>
        <div className="container">
          <h2 style={{ fontSize: 26, margin: '0 0 6px' }}>How it works</h2>
          <p style={{ color: 'var(--muted)', margin: '0 0 28px' }}>
            Two minutes, two signatures — whether you launch or subscribe.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
            {steps.map((s) => (
              <div key={s.n} className="card">
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: '50%',
                    background: 'var(--aqua)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 800,
                    fontSize: 15,
                    marginBottom: 12,
                  }}
                >
                  {s.n}
                </div>
                <div style={{ fontWeight: 700, fontSize: 15.5, marginBottom: 6 }}>{s.title}</div>
                <div style={{ color: 'var(--muted)', fontSize: 13.5, lineHeight: 1.55 }}>{s.text}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Live passes */}
      <section id="passes" className="container" style={{ paddingTop: 44, paddingBottom: 64 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
          <div>
            <h2 style={{ fontSize: 26, margin: 0 }}>
              Live passes {rows.length > 0 && <span style={{ color: 'var(--muted)', fontWeight: 500 }}>({rows.length})</span>}
            </h2>
            <p style={{ color: 'var(--muted)', margin: '6px 0 0' }}>Pick one and subscribe — or launch your own.</p>
          </div>
          <a href="/launch" className="btn btn-primary" style={{ padding: '10px 16px' }}>
            Launch a pass
          </a>
        </div>

        {!FACTORY_ADDRESS ? (
          <div className="empty-box">
            Set <code>NEXT_PUBLIC_FACTORY_ADDRESS</code> (after running{' '}
            <code>forge script script/Deploy.s.sol</code>) to list passes here.
          </div>
        ) : rows.length === 0 ? (
          <div className="empty-box">No passes launched yet — be the first.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
            {rows.map((r) => (
              <Link key={r.address} href={`/pass/${r.address}`} className="pass-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 16 }}>{r.name}</div>
                    <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 2 }}>{r.symbol}</div>
                  </div>
                  <span className="pill pill-neutral">View</span>
                </div>
                <div
                  style={{
                    marginTop: 14,
                    paddingTop: 12,
                    borderTop: '1px solid var(--border)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    color: 'var(--muted)',
                    fontSize: 13,
                  }}
                >
                  <span>
                    <span style={{ color: 'var(--ink)', fontWeight: 700 }}>{r.price}</span> pathUSD
                  </span>
                  <span>{r.period > 0 ? `per ${r.period} day${r.period === 1 ? '' : 's'}` : ''}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
