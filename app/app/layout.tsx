import type { Metadata } from 'next'
import './globals.css'
import { Providers } from '@/components/Providers'
import WalletButton from '@/components/WalletButton'
import Whale from '@/components/Whale'

export const metadata: Metadata = {
  title: 'Whel Pass — subscription passes on Tempo',
  description:
    'Launch a subscription pass or join one. Payments run automatically in pathUSD — cancel anytime, renewals stop onchain.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <div className="navbar">
            <nav className="nav-inner">
              <a href="/" className="brand">
                <Whale size={34} />
                <span>
                  Whel <span>Pass</span>
                </span>
              </a>
              <a href="/launch" className="nav-link">
                Launch a pass
              </a>
              <a href="/subs" className="nav-link">
                Your subs
              </a>
              <div className="nav-spacer">
                <WalletButton />
              </div>
            </nav>
          </div>
          <main>{children}</main>
          <footer className="footer">
            <div className="footer-brand">
              <Whale size={22} /> Whel Pass
            </div>
            <div>Subscription passes on the Tempo testnet — renewals and cancellations are enforced onchain via access keys.</div>
          </footer>
        </Providers>
      </body>
    </html>
  )
}
