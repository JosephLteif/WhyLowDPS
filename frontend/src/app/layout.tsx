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
import MainScrollShell from './components/MainScrollShell';
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
      <body
        className="min-h-screen overflow-x-hidden"
        style={{
          ['--sidebar-width' as string]: '0rem',
          ['--app-header-height' as string]: '3rem',
        }}
      >
        <AuthProvider>
          <DataGuard>
            <SimProvider>
              <TopHeader />
              <UpdatePrompt />
              <CloseBehaviorPrompt />
              <ScrollToTopOnRouteChange />
              <InitialSidebarRoute />

              <Sidebar />

              <MainScrollShell>
                <SimSharedConfig />
                {children}
              </MainScrollShell>
            </SimProvider>
          </DataGuard>
        </AuthProvider>
      </body>
    </html>
  );
}
