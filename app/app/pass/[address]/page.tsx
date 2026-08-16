'use client'

import { useEffect, useMemo, useState } from 'react'
import { formatUnits, maxUint64 } from 'viem'
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { ACCOUNT_KEYCHAIN, ACTIVATE_SELECTOR, RENEW_SELECTOR, TRANSFER_SELECTOR } from '@/lib/constants'
import { keychainAbi, passAbi } from '@/lib/abis'

type Step = 'idle' | 'key' | 'authorize' | 'subscribe' | 'activate' | 'done'

export default function PassPage({ params }: { params: Promise<{ address: string }> }) {
  const [address, setAddress] = useState<string>('')
  useEffect(() => {
    params.then((p) => setAddress(p.address))
  }, [params])

  const pass = address as `0x${string}` | undefined
  const { address: wallet } = useAccount()
  const [step, setStep] = useState<Step>('idle')
  const [keyId, setKeyId] = useState<string>('')
  const [error, setError] = useState('')
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const { data: config } = useReadContract({
    address: pass,
    abi: passAbi,
    functionName: 'config',
    query: { enabled: !!pass },
  })
  const { data: name } = useReadContract({
    address: pass,
    abi: passAbi,
    functionName: 'name',
    query: { enabled: !!pass },
  })

  const { data: myTokenId } = useReadContract({
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

  const { writeContractAsync, isPending: writing } = useWriteContract()
  const [subTxHash, setSubTxHash] = useState<`0x${string}`>()
  const { isSuccess: subConfirmed } = useWaitForTransactionReceipt({ hash: subTxHash })

  const priceStr = useMemo(
    () => (config ? formatUnits(config[1], 6) : ''),
    [config],
  )
  const periodDays = useMemo(() => (config ? Math.round(Number(config[2]) / 86400) : 0), [config])

  async function subscribe() {
    if (!wallet || !pass || !config) return
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
      // transactions (price + fees) fit within the authorized limit.
      const limit = BigInt(keyJson.limit)
      const billingPeriod = Number(keyJson.billingPeriod)
      const paymentToken = keyJson.paymentToken as `0x${string}`
      const treasury = keyJson.treasury as `0x${string}`
      await writeContractAsync({
        address: ACCOUNT_KEYCHAIN,
        abi: keychainAbi,
        functionName: 'authorizeKey',
        args: [
          keyJson.keyId as `0x${string}`,
          1, // P256
          {
            expiry: maxUint64,
            enforceLimits: true,
            limits: [{ token: paymentToken, amount: limit, period: BigInt(billingPeriod) }],
            allowAnyCalls: false,
            allowedCalls: [
              {
                target: paymentToken,
                selectorRules: [{ selector: TRANSFER_SELECTOR, recipients: [treasury] }],
              },
              {
                target: pass,
                selectorRules: [
                  { selector: ACTIVATE_SELECTOR, recipients: [] },
                  { selector: RENEW_SELECTOR, recipients: [] },
                ],
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
        args: [wallet, keyJson.keyId as `0x${string}`],
      })
      setSubTxHash(txHash)
    } catch (e) {
      setError((e as Error).message)
      setStep('idle')
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
        setStep('done')
      } catch (e) {
        setError((e as Error).message)
        setStep('done')
      }
    })()
  }, [subConfirmed, pass, wallet])

  async function burnExpired() {
    if (!pass || !myTokenId) return
    try {
      await writeContractAsync({
        address: pass,
        abi: passAbi,
        functionName: 'burnExpired',
        args: [myTokenId],
      })
    } catch (e) {
      setError((e as Error).message)
    }
  }

  if (!pass) return <p>Loading…</p>

  return (
    <div>
      <h1>{name ?? 'Pass'}</h1>
      <p style={{ color: '#8b949e', wordBreak: 'break-all' }}>{pass}</p>

      {config && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, margin: '16px 0' }}>
          <Stat label="Price" value={`${priceStr} pathUSD`} />
          <Stat label="Billing period" value={`${periodDays} days`} />
          <Stat label="Treasury" value={config[4]} />
        </div>
      )}

      {!wallet && <p style={{ color: '#f0883e' }}>Connect your wallet to subscribe.</p>}

      {wallet && !subscribed && (
        <div>
          <button onClick={subscribe} disabled={writing} style={button}>
            {writing ? 'Waiting for signatures…' : 'Subscribe'}
          </button>
          {step !== 'idle' && <p style={{ color: '#8b949e' }}>Step: {step}</p>}
        </div>
      )}

      {wallet && subscribed && (
        <div>
          <p>
            Your pass: <strong>#{myTokenId?.toString()}</strong>{' '}
            {active ? <span style={{ color: '#3fb950' }}>● active</span> : <span style={{ color: '#f85149' }}>● expired</span>}
          </p>
          {expiresAt !== undefined && expiresAt > 0n && (
            <p style={{ color: '#8b949e' }}>
              Renewal due:{' '}
              {new Date(Number(expiresAt) * 1000).toLocaleString()} — renewals are charged automatically via your
              access key. Stop funding the wallet and the pass burns after the grace period.
            </p>
          )}
          {!active && myTokenId !== undefined && (
            <button onClick={burnExpired} style={{ ...button, background: '#b62324' }}>
              Burn expired pass
            </button>
          )}
        </div>
      )}

      {error && <p style={{ color: '#f85149' }}>{error}</p>}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: 12 }}>
      <div style={{ color: '#8b949e', fontSize: 12 }}>{label}</div>
      <div style={{ wordBreak: 'break-all' }}>{value}</div>
    </div>
  )
}

const button: React.CSSProperties = {
  padding: '10px 16px',
  background: '#238636',
  border: 'none',
  borderRadius: 6,
  color: '#fff',
  fontWeight: 600,
  cursor: 'pointer',
}
