'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { ACCOUNT_KEYCHAIN } from '@/lib/constants'
import { keychainAbi } from '@/lib/abis'

export interface Sub {
  pass: string
  tokenId: string
  name: string
  symbol: string
  price: string
  periodDays: number
  expiresAt: string
  keyId: string | null
  revoked: boolean
}

export default function SubCard({ sub, now }: { sub: Sub; now: number }) {
  const [step, setStep] = useState<'idle' | 'confirm' | 'pending' | 'done'>('idle')
  const [error, setError] = useState('')
  const [txHash, setTxHash] = useState<`0x${string}`>()
  const { writeContractAsync, reset: resetWrite } = useWriteContract()
  const { isSuccess: confirmed } = useWaitForTransactionReceipt({ hash: txHash })

  useEffect(() => {
    if (confirmed) {
      setStep('done')
      setTxHash(undefined)
    }
  }, [confirmed])

  const active = BigInt(sub.expiresAt) > BigInt(Math.floor(now / 1000))

  async function cancel() {
    if (!sub.keyId) return
    setStep('pending')
    setError('')
    try {
      const hash = await writeContractAsync({
        address: ACCOUNT_KEYCHAIN,
        abi: keychainAbi,
        functionName: 'revokeKey',
        args: [sub.keyId as `0x${string}`],
        // The keychain precompile mis-estimates gas (returns a sentinel above the
        // RPC cap); the actual call is cheap, so set a fixed limit.
        gas: 1_000_000n,
      })
      setTxHash(hash)
    } catch (e) {
      setError((e as Error).message)
      setStep('idle')
      resetWrite()
    }
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 16 }}>
            {sub.name} <span style={{ color: 'var(--muted)', fontWeight: 500, fontSize: 13 }}>{sub.symbol}</span>
          </div>
          <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 2 }}>
            Token #{sub.tokenId} ·{' '}
            <Link href={`/pass/${sub.pass}`} style={{ color: 'var(--primary-deep)', textDecoration: 'none', fontWeight: 600 }}>
              View pass →
            </Link>
          </div>
        </div>
        {sub.revoked ? (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 12px',
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 700,
              whiteSpace: 'nowrap',
              background: 'var(--amber-soft)',
              color: 'var(--amber-deep)',
              border: '1px solid var(--amber)',
            }}
          >
            ● cancelled
          </span>
        ) : (
          <span className={`pill ${active ? 'pill-active' : 'pill-expired'}`}>
            {active ? '● active' : '● expired'}
          </span>
        )}
      </div>

      <div
        style={{
          marginTop: 14,
          paddingTop: 12,
          borderTop: '1px solid var(--border)',
          display: 'flex',
          justifyContent: 'space-between',
          gap: 8,
          color: 'var(--muted)',
          fontSize: 13,
          flexWrap: 'wrap',
        }}
      >
        <span>
          <span style={{ color: 'var(--ink)', fontWeight: 700 }}>{sub.price}</span> pathUSD / {sub.periodDays} day{sub.periodDays === 1 ? '' : 's'}
        </span>
        <span>
          {BigInt(sub.expiresAt) > 0n
            ? `expires ${new Date(Number(sub.expiresAt) * 1000).toLocaleString()}`
            : 'no expiry set'}
        </span>
      </div>

      <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
        {step === 'done' || sub.revoked ? (
          <p
            style={{
              margin: 0,
              color: 'var(--amber-deep)',
              fontSize: 14,
              lineHeight: 1.55,
              background: 'var(--amber-soft)',
              borderRadius: 10,
              padding: '12px 14px',
            }}
          >
            Subscription cancelled — renewals stopped. The pass expires at the end of the current period, then
            can be burned by anyone.
          </p>
        ) : step === 'pending' ? (
          <p style={{ margin: 0, color: 'var(--muted)', fontSize: 14 }}>Cancelling… check your wallet.</p>
        ) : active && sub.keyId ? (
          step === 'confirm' ? (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ color: 'var(--ink)', fontSize: 14, fontWeight: 600 }}>Stop automatic renewals?</span>
              <button onClick={cancel} className="btn btn-danger" style={{ padding: '10px 16px' }}>
                Yes, cancel
              </button>
              <button onClick={() => setStep('idle')} className="btn btn-muted" style={{ padding: '10px 16px' }}>
                Keep
              </button>
            </div>
          ) : (
            <button onClick={() => setStep('confirm')} className="btn btn-danger-outline">
              Cancel subscription
            </button>
          )
        ) : active ? (
          <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13 }}>
            Access key unavailable — renewals can&apos;t be cancelled from here. It will stop once the wallet runs
            dry.
          </p>
        ) : (
          <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13 }}>
            Expired — anyone can burn it from the pass page.
          </p>
        )}
        {error && <p style={{ margin: '10px 0 0', color: 'var(--danger-deep)', fontSize: 12.5, wordBreak: 'break-word' }}>{error}</p>}
      </div>
    </div>
  )
}
