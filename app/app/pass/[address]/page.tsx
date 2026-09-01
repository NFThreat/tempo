'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { formatUnits } from 'viem'
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { ACCOUNT_KEYCHAIN, TRANSFER_SELECTOR } from '@/lib/constants'
import { keychainAbi, passAbi } from '@/lib/abis'
import WalletButton from '@/components/WalletButton'
import Whale from '@/components/Whale'

type Step = 'idle' | 'key' | 'authorize' | 'subscribe' | 'activate' | 'done'

interface PassInfo {
  name: string
  symbol: string
  price: string
  billingPeriod: number
  gracePeriod: number
  treasury: string
}

export default function PassPage({ params }: { params: Promise<{ address: string }> }) {
  const [address, setAddress] = useState<string>('')
  useEffect(() => {
    params.then((p) => {
      // Tolerate the padded 32-byte form from raw event topic links.
      const a = /^0x[0-9a-fA-F]{64}$/.test(p.address) ? `0x${p.address.slice(-40)}` : p.address
      setAddress(a)
    })
  }, [params])

  const pass = address as `0x${string}` | undefined
  const { address: wallet } = useAccount()
  const [step, setStep] = useState<Step>('idle')
  const [keyId, setKeyId] = useState<string>('')
  const [error, setError] = useState('')
  const [now, setNow] = useState(Date.now())

  const [info, setInfo] = useState<PassInfo | null>(null)
  const [infoError, setInfoError] = useState('')
  const [infoLoading, setInfoLoading] = useState(false)

  const loadInfo = useCallback(async () => {
    if (!pass) return
    setInfoLoading(true)
    setInfoError('')
    try {
      const res = await fetch(`/api/pass/${pass}/config`, { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'failed to load pass config')
      setInfo({
        name: json.name,
        symbol: json.symbol,
        price: json.price,
        billingPeriod: json.billingPeriod,
        gracePeriod: json.gracePeriod,
        treasury: json.treasury,
      })
    } catch (e) {
      setInfoError((e as Error).message)
    } finally {
      setInfoLoading(false)
    }
  }, [pass])

  useEffect(() => {
    loadInfo()
  }, [loadInfo])

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const { data: myTokenId, refetch: refetchToken } = useReadContract({
    address: pass,
    abi: passAbi,
    functionName: 'tokenOfOwner',
    args: wallet ? [wallet] : undefined,
    query: { enabled: !!pass && !!wallet },
  })
  const { data: expiresAt } = useReadContract({
    address: pass,
    abi: passAbi,
    functionName: 'expiresAtOf',
    args: myTokenId && myTokenId > 0n ? [myTokenId] : undefined,
    query: { enabled: !!pass && !!myTokenId && myTokenId > 0n },
  })

  const subscribed = myTokenId !== undefined && myTokenId > 0n
  const active = expiresAt !== undefined && expiresAt > BigInt(Math.floor(now / 1000))

  const { writeContractAsync, reset: resetWrite } = useWriteContract()
  const [busy, setBusy] = useState(false)
  const [subTxHash, setSubTxHash] = useState<`0x${string}`>()
  const { isSuccess: subConfirmed } = useWaitForTransactionReceipt({ hash: subTxHash })

  const [accessKeyId, setAccessKeyId] = useState<string>()
  const [accessKeyRevoked, setAccessKeyRevoked] = useState(false)
  const [keyIdError, setKeyIdError] = useState('')
  const [cancelStep, setCancelStep] = useState<'idle' | 'confirm' | 'pending' | 'done'>('idle')
  const [cancelTxHash, setCancelTxHash] = useState<`0x${string}`>()
  const { isSuccess: cancelConfirmed } = useWaitForTransactionReceipt({ hash: cancelTxHash })

  useEffect(() => {
    if (cancelConfirmed) {
      setCancelStep('done')
      setCancelTxHash(undefined)
    }
  }, [cancelConfirmed])

  useEffect(() => {
    if (!pass || !wallet || !subscribed || accessKeyId) return
    fetch(`/api/pass/${pass}/key?user=${wallet}`, { cache: 'no-store' })
      .then(async (res) => {
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? 'failed to load access key')
        setAccessKeyId(json.keyId)
        setAccessKeyRevoked(json.revoked)
      })
      .catch((e) => setKeyIdError((e as Error).message))
  }, [pass, wallet, subscribed, accessKeyId])

  async function cancelSubscription() {
    if (!accessKeyId) return
    setCancelStep('pending')
    setError('')
    try {
      const hash = await writeContractAsync({
        address: ACCOUNT_KEYCHAIN,
        abi: keychainAbi,
        functionName: 'revokeKey',
        args: [accessKeyId as `0x${string}`],
        // The keychain precompile mis-estimates gas (returns a sentinel above the
        // RPC cap); the actual call is cheap, so set a fixed limit.
        gas: 1_000_000n,
      })
      setCancelTxHash(hash)
    } catch (e) {
      setError((e as Error).message)
      setCancelStep('idle')
      resetWrite()
    }
  }

  const priceStr = useMemo(
    () => (info ? formatUnits(BigInt(info.price), 6) : ''),
    [info],
  )
  const periodDays = useMemo(
    () => (info ? Math.round(info.billingPeriod / 86400) : 0),
    [info],
  )

  async function subscribe() {
    if (!wallet || !pass) return
    if (!info) {
      setError('Pass config not loaded yet — wait a moment and try again.')
      return
    }
    setBusy(true)
    setError('')
    setStep('key')
    try {
      const keyRes = await fetch(`/api/pass/${pass}/key`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ user: wallet }),
      })
      const keyJson = await keyRes.json()
      if (!keyRes.ok) throw new Error(keyJson.error ?? 'relayer key failed')
      setKeyId(keyJson.keyId)

      setStep('authorize')
      // The recurring limit covers the price plus a fee buffer, so renewal
      // transactions (approve + renew, price is pulled onchain) fit within
      // the authorized limit. The key expires after ~13 months so an
      // interrupted signup cannot leave a live approval forever.
      const limit = BigInt(keyJson.limit)
      const billingPeriod = Number(keyJson.billingPeriod)
      const paymentToken = keyJson.paymentToken as `0x${string}`
      const expiry = BigInt(Math.floor(Date.now() / 1000) + 400 * 86400)
      await writeContractAsync({
        address: ACCOUNT_KEYCHAIN,
        abi: keychainAbi,
        functionName: 'authorizeKey',
        args: [
          keyJson.keyId as `0x${string}`,
          1, // P256
          {
            expiry,
            enforceLimits: true,
            limits: [{ token: paymentToken, amount: limit, period: BigInt(billingPeriod) }],
            allowAnyCalls: false,
            allowedCalls: [
              {
                // the key pushes `price` to the pass treasury
                target: paymentToken,
                selectorRules: [{ selector: TRANSFER_SELECTOR, recipients: [info.treasury as `0x${string}`] }],
              },
              {
                // activate/renew on this pass — empty rules = any selector
                // (the dangerous pass functions are owner-gated)
                target: pass,
                selectorRules: [],
              },
            ],
          },
        ],
      })

      setStep('subscribe')
      const txHash = await writeContractAsync({
        address: pass,
        abi: passAbi,
        functionName: 'subscribe',
        args: [keyJson.keyId as `0x${string}`],
      })
      setSubTxHash(txHash)
    } catch (e) {
      setError((e as Error).message)
      setStep('idle')
      resetWrite()
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!subConfirmed || !pass || !wallet) return
    ;(async () => {
      setStep('activate')
      try {
        const tokenRes = await fetch(`/api/pass/${pass}/token?user=${wallet}`, { cache: 'no-store' })
        const tokenJson = await tokenRes.json()
        if (!tokenRes.ok) throw new Error(tokenJson.error ?? 'token read failed')
        const res = await fetch(`/api/pass/${pass}/activate`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ user: wallet, tokenId: tokenJson.tokenId }),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? 'activation failed')
        refetchToken()
        setStep('done')
      } catch (e) {
        setError((e as Error).message)
        setStep('done')
      }
    })()
  }, [subConfirmed, pass, wallet, refetchToken])

  async function burnExpired() {
    if (!pass || !myTokenId) return
    setBusy(true)
    setError('')
    try {
      await writeContractAsync({
        address: pass,
        abi: passAbi,
        functionName: 'burnExpired',
        args: [myTokenId],
      })
    } catch (e) {
      setError((e as Error).message)
      resetWrite()
    } finally {
      setBusy(false)
    }
  }

  async function unsubscribe() {
    if (!pass) return
    setBusy(true)
    setError('')
    try {
      await writeContractAsync({
        address: pass,
        abi: passAbi,
        functionName: 'unsubscribe',
      })
      refetchToken()
    } catch (e) {
      setError((e as Error).message)
      resetWrite()
    } finally {
      setBusy(false)
    }
  }

  if (!pass) return <p style={{ padding: 40, color: 'var(--muted)', textAlign: 'center' }}>Loading…</p>

  const steps: { id: Step; label: string }[] = [
    { id: 'key', label: 'Create key' },
    { id: 'authorize', label: 'Authorize' },
    { id: 'subscribe', label: 'Mint pass' },
    { id: 'activate', label: 'First payment' },
  ]

  return (
    <div className="container" style={{ paddingTop: 40, paddingBottom: 64, maxWidth: 760 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <Whale size={40} />
        <div>
          <h1 style={{ margin: 0 }}>
            {info?.name ?? 'Pass'}{' '}
            {info?.symbol && <span style={{ color: 'var(--muted)', fontWeight: 500, fontSize: 20 }}>{info.symbol}</span>}
          </h1>
          <div style={{ color: 'var(--muted)', fontSize: 12.5, wordBreak: 'break-all', marginTop: 2 }}>{pass}</div>
        </div>
      </div>

      {info && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, margin: '22px 0' }}>
          <Stat label="Price" value={`${priceStr} pathUSD`} />
          <Stat label="Billing period" value={`${periodDays} day${periodDays === 1 ? '' : 's'}`} />
          <Stat label="Treasury" value={info.treasury} />
        </div>
      )}

      {!wallet && (
        <div className="card" style={{ padding: '24px 22px', margin: '6px 0' }}>
          <p style={{ margin: '0 0 16px', color: 'var(--muted)' }}>Connect your wallet to subscribe.</p>
          <WalletButton />
        </div>
      )}

      {wallet && !subscribed && (
        <div style={{ margin: '6px 0' }}>
          {info ? (
            <div className="card card-aqua" style={{ padding: '24px 22px' }}>
              <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 6 }}>
                Subscribe to {info.name}
              </div>
              <p style={{ margin: '0 0 18px', color: 'var(--muted)', fontSize: 14, lineHeight: 1.55 }}>
                You authorize one access key (a recurring limit of {priceStr} pathUSD per {periodDays} day
                {periodDays === 1 ? '' : 's'}), then mint. Renewals charge automatically — cancel anytime.
              </p>
              <button onClick={subscribe} disabled={busy} className="btn btn-primary" style={{ fontSize: 16, padding: '14px 24px' }}>
                {busy ? 'Waiting for signatures…' : `Subscribe — ${priceStr} pathUSD`}
              </button>
            </div>
          ) : infoError ? (
            <div className="error-box">
              <p style={{ margin: '0 0 12px' }}>Could not load the pass config: {infoError}</p>
              <button onClick={() => loadInfo()} className="btn btn-muted" style={{ padding: '10px 16px' }}>
                Retry
              </button>
            </div>
          ) : (
            <p style={{ color: 'var(--muted)' }}>{infoLoading ? 'Loading pass config…' : 'Loading pass config…'}</p>
          )}

          {step !== 'idle' && step !== 'done' && (
            <div className="card" style={{ marginTop: 16 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                {steps.map((s, i) => {
                  const activeIdx = steps.findIndex((x) => x.id === step)
                  const done = i < activeIdx
                  const current = i === activeIdx
                  return (
                    <span
                      key={s.id}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, color: done ? 'var(--success-deep)' : current ? 'var(--ink)' : 'var(--muted)' }}
                    >
                      <span
                        style={{
                          width: 20,
                          height: 20,
                          borderRadius: '50%',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 11,
                          fontWeight: 800,
                          background: done ? 'var(--success)' : current ? 'var(--primary)' : 'var(--primary-soft)',
                          color: done || current ? '#fff' : 'var(--muted)',
                        }}
                      >
                        {done ? '✓' : i + 1}
                      </span>
                      {s.label}
                      {i < steps.length - 1 && <span style={{ color: 'var(--border)', margin: '0 2px' }}>—</span>}
                    </span>
                  )
                })}
              </div>
              {busy && (
                <p style={{ margin: '12px 0 0', color: 'var(--muted)', fontSize: 13 }}>
                  Waiting for your wallet — check the signature request.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {wallet && subscribed && (
        <div style={{ margin: '6px 0' }}>
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 800 }}>Your pass: #{myTokenId?.toString()}</span>
              <span className={`pill ${active ? 'pill-active' : 'pill-expired'}`}>
                {active ? '● active' : '● expired'}
              </span>
            </div>
            {expiresAt !== undefined && expiresAt > 0n && (
              <p style={{ color: 'var(--muted)', margin: '12px 0 0', fontSize: 14, lineHeight: 1.55 }}>
                Renewal due: <span style={{ color: 'var(--ink)', fontWeight: 600 }}>{new Date(Number(expiresAt) * 1000).toLocaleString()}</span>
                {' — renewals are charged automatically via your access key. Cancel anytime from here or from Your subs.'}
              </p>
            )}

            {subscribed && expiresAt !== undefined && expiresAt === 0n && (
              <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                <p style={{ margin: '0 0 12px', color: 'var(--muted)', fontSize: 14, lineHeight: 1.55 }}>
                  This pass was minted but never activated — the first payment did not go through. Undo it to
                  free your wallet and start over.
                </p>
                <button onClick={unsubscribe} disabled={busy} className="btn btn-danger-outline">
                  {busy ? 'Working…' : 'Undo subscription'}
                </button>
              </div>
            )}

            {!active && expiresAt !== undefined && expiresAt > 0n && myTokenId !== undefined && (
              <button onClick={burnExpired} disabled={busy} className="btn btn-danger" style={{ marginTop: 16 }}>
                {busy ? 'Burning…' : 'Burn expired pass'}
              </button>
            )}

            {active && (
              <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                {accessKeyRevoked || cancelStep === 'done' ? (
                  <p style={{ margin: 0, color: 'var(--amber-deep)', fontSize: 14, lineHeight: 1.55, background: 'var(--amber-soft)', borderRadius: 10, padding: '12px 14px' }}>
                    Subscription cancelled — renewals stopped. The pass stays active until the current period
                    ends{expiresAt !== undefined && expiresAt > 0n ? ` (${new Date(Number(expiresAt) * 1000).toLocaleString()})` : ''}, then expires
                    and can be burned by anyone.
                  </p>
                ) : cancelStep === 'pending' ? (
                  <p style={{ margin: 0, color: 'var(--muted)', fontSize: 14 }}>Cancelling… check your wallet.</p>
                ) : cancelStep === 'confirm' ? (
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ color: 'var(--ink)', fontSize: 14, fontWeight: 600 }}>Stop automatic renewals?</span>
                    <button onClick={cancelSubscription} className="btn btn-danger" style={{ padding: '10px 16px' }}>
                      Yes, cancel
                    </button>
                    <button onClick={() => setCancelStep('idle')} className="btn btn-muted" style={{ padding: '10px 16px' }}>
                      Keep
                    </button>
                  </div>
                ) : (
                  <button onClick={() => setCancelStep('confirm')} className="btn btn-danger-outline">
                    Cancel subscription
                  </button>
                )}
                {keyIdError && cancelStep === 'idle' && (
                  <p style={{ margin: '10px 0 0', color: 'var(--muted)', fontSize: 12.5 }}>
                    Could not load your access key: {keyIdError}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {error && <div className="error-box" style={{ marginTop: 16 }}>{error}</div>}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card" style={{ padding: '12px 16px' }}>
      <div style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 4, fontWeight: 600 }}>{label}</div>
      <div style={{ wordBreak: 'break-all', fontSize: 14.5 }}>{value}</div>
    </div>
  )
}
