'use client';

import { useEffect, useState } from 'react';
import { PWA_UPDATE_EVENT } from './PwaRegistration';

export default function PwaUpdatePrompt() {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    const onUpdate = () => setAvailable(true);
    window.addEventListener(PWA_UPDATE_EVENT, onUpdate);
    return () => window.removeEventListener(PWA_UPDATE_EVENT, onUpdate);
  }, []);

  if (!available) return null;

  const applyUpdate = () => {
    navigator.serviceWorker?.controller?.postMessage({ type: 'SKIP_WAITING' });
    window.location.reload();
  };

  return (
    <div className="fixed inset-x-3 bottom-3 z-[180] mx-auto flex max-w-lg items-center gap-3 rounded-xl border border-gold/30 bg-surface/95 px-4 py-3 text-sm text-zinc-100 shadow-2xl backdrop-blur">
      <span className="min-w-0 flex-1">A new WhyLowDPS version is ready.</span>
      <button
        type="button"
        onClick={applyUpdate}
        className="shrink-0 rounded-lg bg-gold px-3 py-2 font-semibold text-black"
      >
        Refresh
      </button>
    </div>
  );
}
