import type { Metadata } from 'next';
import Script from 'next/script';
import { SimProvider } from './components/SimContext';
import SimSharedConfig from './components/SimSharedConfig';
import Sidebar from './components/Sidebar';
import SimcRequiredModal from './components/SimcRequiredModal';
import TopHeader from './components/TopHeader';
import { AuthProvider } from './components/AuthContext';
import DataGuard from './components/DataGuard';
import UpdatePrompt from './components/UpdatePrompt';
import './globals.css';
import packageJson from '../../package.json';

export const metadata: Metadata = {
  title: 'WhyLowDps',
  description: 'Run SimulationCraft simulations from your browser',
  icons: {
    icon: '/icon.png',
    shortcut: '/icon.png',
    apple: '/icon.png',
  },
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
      <body className="min-h-screen" style={{ ['--sidebar-width' as string]: '18rem' }}>
        <AuthProvider>
          <DataGuard>
            <SimProvider>
              <TopHeader />
              <SimcRequiredModal />
              <SimcRequiredModal />

              <Sidebar />

              <main className="ml-[var(--sidebar-width)] mt-14 min-h-[calc(100vh-3.5rem)] px-8 py-8 transition-[margin-left] duration-200 lg:px-12">
                <div className="max-w-8xl mx-auto">
                  <SimSharedConfig />
                  {children}
                </div>
              </main>
            </SimProvider>
          </DataGuard>
        </AuthProvider>
      </body>
    </html>
  );
}
