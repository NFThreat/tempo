'use client'

import { useEffect, useState } from 'react'
import { useAccount } from 'wagmi'
import WalletButton from '@/components/WalletButton'
import SubCard, { type Sub } from '@/components/SubCard'
import Whale from '@/components/Whale'

export default function SubsPage() {
  const { address: wallet } = useAccount()
  const [subs, setSubs] = useState<Sub[] | null>(null)
  const [error, setError] = useState('')
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (!wallet) {
      setSubs(null)
      setError('')
      return
    }
    setSubs(null)
    setError('')
    fetch(`/api/subs?user=${wallet}`, { cache: 'no-store' })
      .then(async (res) => {
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? 'failed to load subscriptions')
        setSubs(json)
      })
      .catch((e) => setError((e as Error).message))
  }, [wallet])

  return (
    <div className="container" style={{ paddingTop: 40, paddingBottom: 64, maxWidth: 760 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 8 }}>
        <Whale size={40} />
        <h1 style={{ margin: 0 }}>Your subs</h1>
      </div>
      <p style={{ margin: '0 0 26px', color: 'var(--muted)', lineHeight: 1.6 }}>
        Every pass you hold, with its renewal status. Cancel a subscription to revoke the access key — renewals
        stop immediately, and the pass expires after the current period.
      </p>

      {!wallet ? (
        <div className="card" style={{ padding: '26px 24px' }}>
          <p style={{ margin: '0 0 16px', color: 'var(--muted)' }}>Connect your wallet to see your subscriptions.</p>
          <WalletButton />
        </div>
      ) : error ? (
        <div className="error-box">Could not load your subscriptions: {error}</div>
      ) : subs === null ? (
        <p style={{ color: 'var(--muted)' }}>Loading…</p>
      ) : subs.length === 0 ? (
        <div className="empty-box">
          No subscriptions yet — browse the{' '}
          <a href="/" style={{ color: 'var(--primary-deep)', fontWeight: 600 }}>
            pass launchpad
          </a>{' '}
          and subscribe to one.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 14 }}>
          {subs.map((s) => (
            <SubCard key={s.pass} sub={s} now={now} />
          ))}
        </div>
      )}
    </div>
  )
}
