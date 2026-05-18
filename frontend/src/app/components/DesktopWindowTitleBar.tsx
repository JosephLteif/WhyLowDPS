'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Maximize2, Minimize2, Minus, X } from 'lucide-react';
import { isDesktop } from '../lib/api';

type DesktopWindowTitleBarProps = {
  className?: string;
  overlay?: boolean;
};

export default function DesktopWindowTitleBar({
  className = '',
  overlay = false,
}: DesktopWindowTitleBarProps) {
  const [isMaximized, setIsMaximized] = useState(false);

  const handleWindowAction = async (action: 'minimize' | 'maximize' | 'close') => {
    if (!isDesktop) return;
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const win = getCurrentWindow();
    if (action === 'minimize') await win.minimize();
    if (action === 'maximize') {
      await win.toggleMaximize();
      setIsMaximized(await win.isMaximized());
    }
    if (action === 'close') await win.close();
  };

  useEffect(() => {
    if (!isDesktop) return;
    let unlisten: (() => void) | undefined;
    (async () => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const win = getCurrentWindow();
      setIsMaximized(await win.isMaximized());
      unlisten = await win.onResized(async () => {
        setIsMaximized(await win.isMaximized());
      });
    })();
    return () => unlisten?.();
  }, []);

  if (!isDesktop) return null;

  const windowControlButtonClass =
    'grid h-8 w-11 place-items-center text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-100';

  return (
    <div
      data-tauri-drag-region
      className={`${overlay ? 'absolute left-0 top-0 z-10 w-full' : 'relative'} h-8 border-b border-white/5 bg-[#0a0a0b] ${className}`}
    >
      <Link
        data-tauri-drag-region="false"
        href="/"
        className="absolute left-2 top-0 flex h-8 items-center gap-2 pr-2"
      >
        <img src="/icon.png" alt="WhyLowDps" className="h-5 w-5 object-contain" />
        <span className="text-[14px] font-semibold tracking-tight text-zinc-100">WhyLowDps</span>
      </Link>
      <div data-tauri-drag-region="false" className="absolute right-0 top-0 flex h-8 items-center">
        <button
          onClick={() => void handleWindowAction('minimize')}
          className={windowControlButtonClass}
          title="Minimize"
          aria-label="Minimize"
        >
          <Minus className="h-4 w-4" strokeWidth={2} />
        </button>
        <button
          onClick={() => void handleWindowAction('maximize')}
          className={windowControlButtonClass}
          title={isMaximized ? 'Restore' : 'Maximize'}
          aria-label={isMaximized ? 'Restore' : 'Maximize'}
        >
          {isMaximized ? (
            <Minimize2 className="h-4 w-4" strokeWidth={2} />
          ) : (
            <Maximize2 className="h-4 w-4" strokeWidth={2} />
          )}
        </button>
        <button
          onClick={() => void handleWindowAction('close')}
          className={`${windowControlButtonClass} hover:bg-red-500/85 hover:text-white`}
          title="Close"
          aria-label="Close"
        >
          <X className="h-4 w-4" strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
