'use client'

import { useMemo, useState } from 'react'
import { parseUnits, zeroAddress } from 'viem'
import { useAccount, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { FACTORY_ADDRESS, DEFAULT_RELAYER_ADDRESS, PATHUSD } from '@/lib/constants'
import { factoryAbi } from '@/lib/abis'

export default function LaunchPage() {
  const { address: wallet } = useAccount()
  const [name, setName] = useState('')
  const [symbol, setSymbol] = useState('')
  const [baseURI, setBaseURI] = useState('https://pass.example/metadata/')
  const [price, setPrice] = useState('10')
  const [periodDays, setPeriodDays] = useState('30')
  const [graceDays, setGraceDays] = useState('3')
  const [treasury, setTreasury] = useState('')
  const [relayer, setRelayer] = useState<string>(DEFAULT_RELAYER_ADDRESS)

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
    return log ? (log.topics[1] as `0x${string}`) : null
  }, [receipt])

  async function deploy() {
    if (!wallet) return alert('Connect your wallet first')
    await writeContractAsync({
      address: FACTORY_ADDRESS,
      abi: factoryAbi,
      functionName: 'deployPass',
      args: [name, symbol, baseURI, cfg, (relayer || wallet) as `0x${string}`],
    })
  }

  return (
    <div>
      <h1>Launch a pass</h1>
      <p style={{ color: '#8b949e' }}>
        Deploy a subscription NFT collection. Buyers subscribe in pathUSD; the relayer renews them
        automatically; unpaid passes burn after expiry + grace.
      </p>

      {!FACTORY_ADDRESS ? (
        <p style={{ color: '#f0883e' }}>
          Set NEXT_PUBLIC_FACTORY_ADDRESS to the deployed PassFactory first.
        </p>
      ) : (
        <div style={{ display: 'grid', gap: 12, maxWidth: 480 }}>
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="My Pass" style={input} />
          </label>
          <label>
            Symbol
            <input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="PASS" style={input} />
          </label>
          <label>
            Metadata base URI
            <input value={baseURI} onChange={(e) => setBaseURI(e.target.value)} style={input} />
          </label>
          <label>
            Price per period (pathUSD)
            <input value={price} onChange={(e) => setPrice(e.target.value)} style={input} />
          </label>
          <label>
            Billing period (days)
            <input value={periodDays} onChange={(e) => setPeriodDays(e.target.value)} style={input} />
          </label>
          <label>
            Grace period (days)
            <input value={graceDays} onChange={(e) => setGraceDays(e.target.value)} style={input} />
          </label>
          <label>
            Treasury (receives payments)
            <input value={treasury} onChange={(e) => setTreasury(e.target.value)} placeholder={wallet} style={input} />
          </label>
          <label>
            Relayer (renewal executor — run the relayer with this EOA)
            <input value={relayer} onChange={(e) => setRelayer(e.target.value)} style={input} />
          </label>
          <button onClick={deploy} disabled={isPending || waiting || !wallet} style={button}>
            {isPending || waiting ? 'Deploying…' : 'Deploy pass'}
          </button>
        </div>
      )}

      {deployed && (
        <p style={{ color: '#3fb950' }}>
          Pass deployed: <a style={{ color: '#58a6ff' }} href={`/pass/${deployed}`}>{deployed}</a>
        </p>
      )}
    </div>
  )
}

const input: React.CSSProperties = {
  display: 'block',
  width: '100%',
  marginTop: 4,
  padding: '8px 10px',
  background: '#161b22',
  border: '1px solid #30363d',
  borderRadius: 6,
  color: '#e6edf3',
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
