'use client';

import type { ReactNode } from 'react';

export default function MainScrollShell({ children }: { children: ReactNode }) {
  return (
    <main
      className="ml-[var(--sidebar-width)] px-3 transition-[margin-left] duration-200 md:px-4 xl:px-10 2xl:px-16"
      style={{
        paddingTop: 'calc(var(--app-header-height) + var(--main-scroll-top-offset, 1.5rem))',
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
