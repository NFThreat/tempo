'use client'

import { useEffect, useRef, useState } from 'react'
import { injected, useAccount, useConnect, useConnections, useDisconnect } from 'wagmi'
import type { EIP1193Provider } from 'viem'
import { chain } from '@/lib/constants'

type WalletMeta = {
  id: string
  name: string
  icon?: string
  provider: EIP1193Provider
}

const PROVIDER_FLAGS: [string, string][] = [
  ['isMetaMask', 'MetaMask'],
  ['isRabby', 'Rabby'],
  ['isCoinbaseWallet', 'Coinbase Wallet'],
  ['isPhantom', 'Phantom'],
  ['isOKXWallet', 'OKX Wallet'],
  ['isOKExWallet', 'OKX Wallet'],
  ['isBraveWallet', 'Brave Wallet'],
  ['isTrustWallet', 'Trust Wallet'],
  ['isTrust', 'Trust Wallet'],
  ['isTokenPocket', 'TokenPocket'],
  ['isImToken', 'imToken'],
  ['isExodus', 'Exodus'],
  ['isBitKeep', 'BitKeep'],
  ['isOpera', 'Opera'],
  ['isTokenary', 'Tokenary'],
]

function detectEip6963(): Promise<WalletMeta[]> {
  return new Promise((resolve) => {
    const found: WalletMeta[] = []
    const seen = new Set<string>()
    const onAnnounce = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          info?: { uuid?: string; name?: string; icon?: string; rdns?: string }
          provider?: EIP1193Provider
        }>
      ).detail
      if (!detail?.provider || !detail.info?.uuid || seen.has(detail.info.uuid)) return
      seen.add(detail.info.uuid)
      found.push({
        id: detail.info.rdns ?? detail.info.uuid,
        name: detail.info.name || 'Injected wallet',
        icon: detail.info.icon,
        provider: detail.provider,
      })
    }
    window.addEventListener('eip6963:announceProvider', onAnnounce)
    window.dispatchEvent(new Event('eip6963:requestProvider'))
    window.setTimeout(() => {
      window.removeEventListener('eip6963:announceProvider', onAnnounce)
      resolve(found)
    }, 300)
  })
}

function detectLegacy(): WalletMeta | undefined {
  const ethereum = (window as unknown as { ethereum?: EIP1193Provider }).ethereum
  if (!ethereum) return undefined
  const flags = ethereum as EIP1193Provider & Record<string, unknown>
  const name = PROVIDER_FLAGS.find(([flag]) => flags[flag])?.[1] ?? 'Browser wallet'
  return { id: 'window.ethereum', name, provider: ethereum }
}

export default function WalletButton() {
  const { address, chainId, isConnected } = useAccount()
  const { connect, isPending } = useConnect()
  const { disconnect } = useDisconnect()
  const connections = useConnections()
  const [open, setOpen] = useState(false)
  const [wallets, setWallets] = useState<WalletMeta[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [importing, setImporting] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [imported, setImported] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setError('')
    let cancelled = false
    ;(async () => {
      const detected = await detectEip6963()
      if (cancelled) return
      const legacy = detectLegacy()
      const list =
        legacy && !detected.some((w) => w.provider === legacy.provider) ? [...detected, legacy] : detected
      setWallets(list)
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [open])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  async function onConnect(w: WalletMeta) {
    setError('')
    try {
      await connect({
        connector: injected({ target: { id: w.id, name: w.name, icon: w.icon, provider: w.provider } }),
      })
      setOpen(false)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  useEffect(() => {
    if (!error) return
    const t = setTimeout(() => setError(''), 8000)
    return () => clearTimeout(t)
  }, [error])

  async function resolveProvider(): Promise<EIP1193Provider | undefined> {
    const active = connections[0]
    if (active) {
      try {
        const p = await active.connector.getProvider()
        if (p) return p as EIP1193Provider
      } catch {
        // fall through to window.ethereum / detected wallets
      }
    }
    const ethereum = (window as unknown as { ethereum?: EIP1193Provider }).ethereum
    if (ethereum) return ethereum
    return wallets[0]?.provider
  }

  async function addChain(provider: EIP1193Provider) {
    const request = provider.request as (req: { method: string; params?: unknown[] }) => Promise<unknown>
    // MetaMask only accepts 18 decimals in wallet_addEthereumChain, regardless of
    // the chain's real native currency, so override the chain's 6-decimal USD.
    await request({
      method: 'wallet_addEthereumChain',
      params: [
        {
          chainId: `0x${chain.id.toString(16)}`,
          chainName: chain.name,
          nativeCurrency: { ...chain.nativeCurrency, decimals: 18 },
          rpcUrls: [chain.rpcUrls.default.http[0]],
          blockExplorerUrls: chain.blockExplorers?.default.url ? [chain.blockExplorers.default.url] : [],
        },
      ],
    })
  }

  async function addTempoChain() {
    const provider = await resolveProvider()
    if (!provider) {
      setError('No wallet detected. Install a wallet extension first.')
      return
    }
    setImporting(true)
    setError('')
    try {
      const request = provider.request as (req: { method: string; params?: unknown[] }) => Promise<unknown>
      // Wallets (MetaMask) only allow wallet_addEthereumChain after the site is
      // authorized, so request accounts first — this also unlocks the wallet if needed.
      await request({ method: 'eth_requestAccounts' })
      await addChain(provider)
      setImported(true)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setImporting(false)
    }
  }

  async function switchToTempo() {
    const provider = await resolveProvider()
    if (!provider) {
      setError('No wallet detected. Install a wallet extension first.')
      return
    }
    setSwitching(true)
    setError('')
    try {
      const request = provider.request as (req: { method: string; params?: unknown[] }) => Promise<unknown>
      const params = [{ chainId: `0x${chain.id.toString(16)}` }]
      try {
        await request({ method: 'wallet_switchEthereumChain', params })
      } catch (e) {
        const err = e as { code?: number; data?: { originalError?: { code?: number } } }
        if (err?.code !== 4902 && err?.data?.originalError?.code !== 4902) throw e
        await addChain(provider)
        await request({ method: 'wallet_switchEthereumChain', params })
      }
      setImported(true)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSwitching(false)
    }
  }

  const onWrongChain = isConnected && chainId !== undefined && chainId !== chain.id

  return (
    <div style={{ position: 'relative', display: 'flex', gap: 8, alignItems: 'center' }} ref={rootRef}>
      {isConnected && address ? (
        <>
          {onWrongChain && (
            <button
              onClick={switchToTempo}
              disabled={switching}
              title="Add and switch to Tempo Testnet"
              style={{ ...button, background: 'var(--amber)', color: '#fff', boxShadow: '0 2px 0 var(--amber-deep)' }}
            >
              {switching ? 'Switching…' : 'Switch to Tempo'}
            </button>
          )}
          <button
            onClick={() => disconnect()}
            title="Disconnect"
            style={{ ...button, background: 'var(--aqua)', color: 'var(--ink)', boxShadow: '0 2px 0 #bfe0e4' }}
          >
            <span
              style={{
                display: 'inline-block',
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: onWrongChain ? 'var(--amber-deep)' : 'var(--success-deep)',
                marginRight: 8,
              }}
            />
            {shorten(address)}
          </button>
        </>
      ) : (
        <>
          <div style={{ position: 'relative' }}>
            <button onClick={() => setOpen((v) => !v)} style={button} disabled={isPending}>
              {isPending ? 'Connecting…' : 'Connect wallet'}
            </button>
            {open && (
              <div style={menu}>
                {loading ? (
                  <p style={{ margin: 0, padding: 12, color: 'var(--muted)' }}>Detecting wallets…</p>
                ) : wallets.length === 0 ? (
                  <p style={{ margin: 0, padding: 12, color: 'var(--muted)' }}>
                    No wallet detected. Install MetaMask or another wallet extension, then refresh.
                  </p>
                ) : (
                  wallets.map((w) => (
                    <button key={w.id} onClick={() => onConnect(w)} style={item} className="wallet-item">
                      {w.icon ? (
                        <img src={w.icon} alt="" width={20} height={20} style={{ borderRadius: 4 }} />
                      ) : (
                        <span style={dot}>{w.name[0]}</span>
                      )}
                      <span>{w.name}</span>
                    </button>
                  ))
                )}
                {error && (
                  <p style={{ margin: 0, padding: '8px 12px', color: 'var(--danger-deep)', fontSize: 12, wordBreak: 'break-word' }}>
                    {error}
                  </p>
                )}
              </div>
            )}
          </div>
          <button
            onClick={addTempoChain}
            disabled={importing}
            title="Add Tempo Testnet to your wallet"
            style={{ ...button, background: 'var(--surface)', border: '2px solid var(--primary)', color: 'var(--primary-deep)', boxShadow: '0 2px 0 var(--primary)' }}
          >
            {importing ? 'Importing…' : imported ? 'Tempo added' : 'Add Tempo Testnet'}
          </button>
        </>
      )}

      {error && !open && (
        <div style={errorBox}>
          {error}
        </div>
      )}
    </div>
  )
}

function shorten(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}

const button: React.CSSProperties = {
  padding: '10px 16px',
  background: 'var(--primary)',
  border: 'none',
  borderRadius: 12,
  color: '#fff',
  fontWeight: 700,
  fontSize: 14,
  cursor: 'pointer',
  fontFamily: 'inherit',
  boxShadow: '0 2px 0 var(--primary-deep)',
  transition: 'background .15s',
}

const menu: React.CSSProperties = {
  position: 'absolute',
  right: 0,
  top: 'calc(100% + 6px)',
  minWidth: 240,
  background: '#fff',
  border: '1px solid var(--border)',
  borderRadius: 12,
  boxShadow: '0 10px 28px rgba(30,58,95,.16)',
  zIndex: 50,
  overflow: 'hidden',
}

const item: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  width: '100%',
  padding: '11px 12px',
  background: 'none',
  border: 'none',
  borderBottom: '1px solid var(--border)',
  color: 'var(--ink)',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
  textAlign: 'left',
  fontFamily: 'inherit',
  transition: 'background .15s',
}

const dot: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 20,
  height: 20,
  borderRadius: 6,
  background: 'var(--aqua)',
  color: 'var(--primary-deep)',
  fontSize: 11,
  fontWeight: 800,
}

const errorBox: React.CSSProperties = {
  position: 'absolute',
  right: 0,
  top: 'calc(100% + 6px)',
  maxWidth: 320,
  background: '#fff',
  border: '1px solid var(--danger)',
  borderRadius: 10,
  padding: '8px 12px',
  fontSize: 12,
  color: 'var(--danger-deep)',
  zIndex: 50,
  boxShadow: '0 10px 28px rgba(30,58,95,.16)',
}
