'use client';

import type { ReactNode } from 'react';

export default function MainScrollShell({ children }: { children: ReactNode }) {
  return (
    <main
      className="ml-[var(--sidebar-width)] px-3 pb-6 pt-6 transition-[margin-left] duration-200 md:px-4 lg:pb-8 lg:pt-8 xl:px-10 2xl:px-16"
      style={{
        marginTop: 'var(--app-header-height)',
        minHeight: 'calc(100vh - var(--app-header-height))',
      }}
    >
      <div
        className="mx-auto w-full min-w-0"
        style={{
          maxWidth: 'min(2200px, calc(100vw - var(--sidebar-width) - 1.5rem))',
        }}
      >
        {children}
      </div>
    </main>
  );
}
