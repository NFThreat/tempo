import type { Metadata } from 'next'
import { Providers } from '@/components/Providers'

export const metadata: Metadata = {
  title: 'Tempo Pass — subscription NFT launchpad',
  description: 'Launch NFT passes with Tempo-native recurring payments. Pay or stop paying — the network enforces it.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: 0, background: '#0b0f14', color: '#e6edf3' }}>
        <Providers>
          <nav style={{ padding: '12px 24px', borderBottom: '1px solid #1f2937', display: 'flex', gap: 16 }}>
            <a href="/" style={{ color: '#58a6ff', textDecoration: 'none', fontWeight: 600 }}>
              Tempo Pass
            </a>
            <a href="/launch" style={{ color: '#8b949e', textDecoration: 'none' }}>
              Launch a pass
            </a>
          </nav>
          <main style={{ padding: 24, maxWidth: 960, margin: '0 auto' }}>{children}</main>
        </Providers>
      </body>
    </html>
  )
}
