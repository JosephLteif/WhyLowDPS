'use client';

import { useEffect, useState } from 'react';
import { FileInput, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { isDesktop } from '../lib/api';
import { useSimContext } from './SimContext';

type FileImportPayload = {
  path: string;
  content: string;
};

type SimCompletedPayload = {
  id: string;
  status: string;
  sim_type: string;
  player_name: string;
};

function simTypeLabel(simType: string): string {
  return (
    {
      quick: 'Quick Sim',
      top_gear: 'Top Gear',
      droptimizer: 'Drop Finder',
      upgrade_compare: 'Upgrade Compare',
    } as Record<string, string>
  )[simType] || simType || 'Simulation';
}

export default function DesktopIntegrationListener() {
  const router = useRouter();
  const { setSimcInput } = useSimContext();
  const [completed, setCompleted] = useState<SimCompletedPayload | null>(null);

  useEffect(() => {
    if (!isDesktop) return;

    let cancelled = false;
    const unlisten: (() => void)[] = [];

    const applyImportedInput = (payload: FileImportPayload) => {
      if (!payload?.content?.trim()) return;
      setSimcInput(payload.content);
      try {
        sessionStorage.setItem('whylowdps_simc_input', payload.content);
      } catch {
        // The shared context still carries the imported input.
      }
      router.push('/quick-sim');
    };

    (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        if (cancelled) return;

        unlisten.push(
          await listen<FileImportPayload>('whylowdps-file-import', (event) => {
            applyImportedInput(event.payload);
          })
        );
        unlisten.push(
          await listen<{ paths?: string[] }>('tauri://drag-drop', async (event) => {
            const path = event.payload?.paths?.find((candidate) => /\.(simc|txt)$/i.test(candidate));
            if (!path) return;
            try {
              const { invoke } = await import('@tauri-apps/api/core');
              const payload = await invoke<FileImportPayload>('read_import_file', { path });
              applyImportedInput(payload);
            } catch {
              // Ignore unsupported or unreadable drops.
            }
          })
        );
        unlisten.push(
          await listen<SimCompletedPayload>('whylowdps-sim-completed', (event) => {
            if (event.payload?.id) setCompleted(event.payload);
          })
        );
      } catch {
        // The web build and older desktop builds do not expose Tauri events.
      }
    })();

    return () => {
      cancelled = true;
      unlisten.forEach((remove) => remove());
    };
  }, [router, setSimcInput]);

  if (!completed) return null;

  const openResult = async () => {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const window = getCurrentWindow();
      await window.show();
      await window.unminimize();
      await window.setFocus();
    } catch {
      // The result link remains usable in browser-like desktop environments.
    }
    router.push(`/sim/${encodeURIComponent(completed.id)}`);
    setCompleted(null);
  };

  return (
    <div className="fixed bottom-4 right-4 z-[140] w-[min(92vw,380px)] rounded-xl border border-gold/30 bg-surface/95 p-4 shadow-2xl backdrop-blur">
      <div className="flex items-start gap-3">
        <FileInput className="mt-0.5 h-5 w-5 shrink-0 text-gold" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-zinc-100">
            {completed.status === 'done' ? 'Simulation finished' : 'Simulation update'}
          </p>
          <p className="mt-1 truncate text-xs text-zinc-400">
            {completed.player_name} · {simTypeLabel(completed.sim_type)}
          </p>
          <button
            type="button"
            onClick={openResult}
            className="mt-3 rounded-md bg-gold/15 px-3 py-1.5 text-xs font-semibold text-gold hover:bg-gold/25"
          >
            Open result
          </button>
        </div>
        <button
          type="button"
          onClick={() => setCompleted(null)}
          className="rounded-md p-1 text-zinc-500 hover:bg-white/10 hover:text-zinc-200"
          aria-label="Dismiss simulation notification"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
