import type { Metadata } from 'next';
import Script from 'next/script';
import { SimProvider } from './components/SimContext';
import SimSharedConfig from './components/SimSharedConfig';
import Sidebar from './components/Sidebar';
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
          <header className="fixed top-0 z-50 w-full border-b border-border/80 bg-bg/90 backdrop-blur-xl">
            <div className="flex h-14 items-center justify-between px-6">
              <a
                href="https://simhammer.com"
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center gap-2.5"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-gradient-to-b from-gold to-gold-dark shadow-sm">
                  <svg className="h-4 w-4 text-black" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M3 2l10 6-10 6V2z" />
                  </svg>
                </div>
                <span className="text-[18px] font-bold tracking-tight text-gray-100 transition-colors group-hover:text-white">
                  SimHammer
                </span>
              </a>
            </div>
          </header>
          
          <Sidebar />
          
          <main className="ml-72 mt-14 min-h-[calc(100vh-3.5rem)] px-8 py-8 lg:px-12">
            <div className="mx-auto max-w-5xl">
              <SimSharedConfig />
              {children}
            </div>
          </main>
        </SimProvider>
      </body>
    </html>
  );
}
