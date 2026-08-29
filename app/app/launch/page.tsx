'use client'

import { useMemo, useState } from 'react'
import { parseUnits, zeroAddress } from 'viem'
import { useAccount, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { FACTORY_ADDRESS, PATHUSD } from '@/lib/constants'
import { factoryAbi } from '@/lib/abis'
import WalletButton from '@/components/WalletButton'
import Whale from '@/components/Whale'

export default function LaunchPage() {
  const { address: wallet } = useAccount()
  const [name, setName] = useState('')
  const [symbol, setSymbol] = useState('')
  const [baseURI, setBaseURI] = useState('https://pass.example/metadata/')
  const [price, setPrice] = useState('10')
  const [periodDays, setPeriodDays] = useState('30')
  const [graceDays, setGraceDays] = useState('3')
  const [treasury, setTreasury] = useState('')

  const cfg = useMemo(() => {
    return {
      paymentToken: PATHUSD as `0x${string}`,
      price: parseUnits(price || '0', 6),
      billingPeriod: Number(periodDays) * 86400,
      gracePeriod: Number(graceDays) * 86400,
      treasury: (treasury || wallet || zeroAddress) as `0x${string}`,
    }
  }, [price, periodDays, graceDays, treasury, wallet])

  const { data: hash, isPending, writeContractAsync } = useWriteContract()
  const { data: receipt, isLoading: waiting } = useWaitForTransactionReceipt({ hash })

  const deployed = useMemo(() => {
    if (!receipt) return null
    const log = receipt.logs.find(
      (l) => l.address.toLowerCase() === (FACTORY_ADDRESS || '').toLowerCase(),
    )
    // topics[1] is the raw 32-byte indexed arg (padded to 66 hex chars) —
    // strip the 0x + leading zeros to get the 40-char address.
    const topic = log?.topics[1]
    return topic ? (`0x${topic.slice(-40)}` as `0x${string}`) : null
  }, [receipt])

  async function deploy() {
    if (!wallet) return alert('Connect your wallet first')
    await writeContractAsync({
      address: FACTORY_ADDRESS,
      abi: factoryAbi,
      functionName: 'deployPass',
      args: [name, symbol, baseURI, cfg, wallet as `0x${string}`],
    })
  }

  if (!FACTORY_ADDRESS) {
    return (
      <div className="container" style={{ paddingTop: 48, maxWidth: 720 }}>
        <div className="empty-box">
          Set <code>NEXT_PUBLIC_FACTORY_ADDRESS</code> to the deployed PassFactory first.
        </div>
      </div>
    )
  }

  return (
    <div className="container" style={{ paddingTop: 44, paddingBottom: 64, maxWidth: 640 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 8 }}>
        <Whale size={44} />
        <div>
          <h1 style={{ margin: 0 }}>Launch a pass</h1>
        </div>
      </div>
      <p style={{ margin: '0 0 26px', color: 'var(--muted)', lineHeight: 1.6 }}>
        Set a price, choose a billing period, and your pass is live. Subscribers pay in pathUSD and can cancel
        anytime — renewals run automatically until they do.
      </p>

      {!wallet ? (
        <div className="card" style={{ padding: '26px 24px' }}>
          <p style={{ margin: '0 0 16px', color: 'var(--muted)' }}>Connect your wallet to launch a pass.</p>
          <WalletButton />
        </div>
      ) : (
        <div className="card" style={{ padding: '26px 28px' }}>
          <div style={{ display: 'grid', gap: 20 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                <span className="pill pill-neutral">1</span>
                <span style={{ fontWeight: 800, fontSize: 16 }}>Details</span>
              </div>
              <div style={{ display: 'grid', gap: 16 }}>
                <Field label="Name" hint="Shown on the pass card and in wallets.">
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="My Pass" className="input" />
                </Field>
                <Field label="Symbol" hint="Short ticker, e.g. PASS.">
                  <input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="PASS" className="input" />
                </Field>
                <Field label="Metadata base URI" hint="Token metadata lives at this URI + /tokenId.json.">
                  <input value={baseURI} onChange={(e) => setBaseURI(e.target.value)} className="input" />
                </Field>
              </div>
            </div>

            <div style={{ height: 1, background: 'var(--border)' }} />

            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                <span className="pill pill-neutral">2</span>
                <span style={{ fontWeight: 800, fontSize: 16 }}>Billing</span>
              </div>
              <div style={{ display: 'grid', gap: 16 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <Field label="Price (pathUSD)" hint="Charged each period.">
                    <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" className="input" />
                  </Field>
                  <Field label="Billing period (days)" hint="How often renewals charge.">
                    <input value={periodDays} onChange={(e) => setPeriodDays(e.target.value)} inputMode="numeric" className="input" />
                  </Field>
                </div>
                <Field label="Grace period (days)" hint="Time after expiry before the pass can be burned.">
                  <input value={graceDays} onChange={(e) => setGraceDays(e.target.value)} inputMode="numeric" className="input" />
                </Field>
                <Field label="Treasury" hint="Receives all payments. Defaults to your wallet.">
                  <input value={treasury} onChange={(e) => setTreasury(e.target.value)} placeholder={wallet} className="input" />
                </Field>
              </div>
            </div>

            <button
              onClick={deploy}
              disabled={isPending || waiting || !name.trim() || !symbol.trim()}
              className="btn btn-primary"
              style={{ width: '100%', padding: '14px 20px', fontSize: 16 }}
            >
              {isPending || waiting ? 'Deploying…' : 'Deploy pass'}
            </button>
            <p style={{ margin: 0, color: 'var(--muted)', fontSize: 12.5, textAlign: 'center' }}>
              One transaction — the factory charges the deploy fee in pathUSD.
            </p>
          </div>
        </div>
      )}

      {deployed && (
        <div className="card" style={{ marginTop: 20, background: 'var(--success-soft)', borderColor: '#b5e3c9' }}>
          <div style={{ color: 'var(--success-deep)', fontWeight: 800 }}>Pass deployed</div>
          <div style={{ wordBreak: 'break-all', marginTop: 4, fontSize: 14 }}>
            <a href={`/pass/${deployed}`} style={{ color: 'var(--primary-deep)' }}>
              {deployed}
            </a>
          </div>
          <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 6 }}>
            Share this address so people can subscribe.
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  )
}
