import type { Metadata } from 'next';
import Script from 'next/script';
import { SimProvider } from './components/SimContext';
import SimSharedConfig from './components/SimSharedConfig';
import Sidebar from './components/Sidebar';
import TopHeader from './components/TopHeader';
import { AuthProvider } from './components/AuthContext';
import './globals.css';
import packageJson from '../../package.json';

export const metadata: Metadata = {
  title: 'WhyLowDps',
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
        <AuthProvider>
          <SimProvider>
            <TopHeader />
            
            <Sidebar />
            
            <main className="ml-72 mt-14 min-h-[calc(100vh-3.5rem)] px-8 py-8 lg:px-12">
              <div className="mx-auto max-w-5xl">
                <SimSharedConfig />
                {children}
              </div>
            </main>
          </SimProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
