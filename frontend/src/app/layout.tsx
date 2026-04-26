import type { Metadata } from 'next';
import Script from 'next/script';
import { SimProvider } from './components/SimContext';
import SimSharedConfig from './components/SimSharedConfig';
import Sidebar from './components/Sidebar';
import TopHeader from './components/TopHeader';
import UpdatePrompt from './components/UpdatePrompt';
import CloseBehaviorPrompt from './components/CloseBehaviorPrompt';
import ScrollToTopOnRouteChange from './components/ScrollToTopOnRouteChange';
import InitialSidebarRoute from './components/InitialSidebarRoute';
import { AuthProvider } from './components/AuthContext';
import DataGuard from './components/DataGuard';
import './globals.css';
import React from 'react';

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
      <body className="min-h-screen overflow-x-hidden" style={{ ['--sidebar-width' as string]: '0rem' }}>
        <AuthProvider>
          <DataGuard>
            <SimProvider>
              <TopHeader />
              <UpdatePrompt />
              <CloseBehaviorPrompt />
              <ScrollToTopOnRouteChange />
              <InitialSidebarRoute />

              <Sidebar />

              <main className="ml-[var(--sidebar-width)] mt-14 min-h-[calc(100vh-3.5rem)] px-3 py-6 transition-[margin-left] duration-200 md:px-4 lg:py-8 xl:px-10 2xl:px-16">
                <div
                  className="mx-auto w-full min-w-0"
                  style={{
                    maxWidth: 'min(2200px, calc(100vw - var(--sidebar-width) - 1.5rem))',
                  }}
                >
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
