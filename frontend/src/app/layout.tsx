import type { Metadata } from 'next';
import Script from 'next/script';
import SettingsPopover from './components/SettingsPopover';
import { SimProvider } from './components/SimContext';
import SimSharedConfig from './components/SimSharedConfig';
import SimTypeCards from './components/SimTypeCards';
import './globals.css';
import packageJson from '../../package.json';

export const metadata: Metadata = {
  title: 'SimHammer',
  description: 'Run SimulationCraft simulations from your browser',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <Script
          id="wowhead-config"
          strategy="afterInteractive"
        >{`const whTooltips = { colorLinks: false, iconizeLinks: false, renameLinks: false };`}</Script>
        <Script src="https://wow.zamimg.com/js/tooltips.js" strategy="afterInteractive" />
      </head>
      <body className="min-h-screen">
        <SimProvider>
          <header className="sticky top-0 z-50 border-b border-border/80 bg-bg/90 backdrop-blur-xl">
            <div className="flex h-11 items-center justify-between">
              <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-6">
                <a
                  href="https://simhammer.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-center gap-2.5"
                >
                  <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-b from-gold to-gold-dark shadow-sm">
                    <svg className="h-3.5 w-3.5 text-black" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M3 2l10 6-10 6V2z" />
                    </svg>
                  </div>
                  <span className="text-[17px] font-bold tracking-tight text-gray-100 transition-colors group-hover:text-white">
                    SimHammer
                  </span>
                </a>
                <div className="flex items-center gap-1.5">
                  <SettingsPopover />
                </div>
              </div>
            </div>
          </header>
          <main className="mx-auto max-w-7xl px-6 py-8">
            <SimTypeCards />
            <SimSharedConfig />
            {children}
          </main>
        </SimProvider>
        <footer className="mt-20 border-t border-border/40 py-8">
          <p className="mx-auto max-w-md text-center text-[13px] leading-relaxed text-zinc-600">
            SimHammer is a pet project held together by coffee, duct tape, and prayers to the RNG
            gods. Bugs are not features — but they might sim higher than your gear. Use at your own
            risk. Not affiliated with Blizzard, Raidbots, or anyone who knows what they&apos;re
            doing.
          </p>
          <p className="mt-3 text-center text-[12px] text-zinc-600">v{packageJson.version}</p>
        </footer>
      </body>
    </html>
  );
}
