'use client';

import { useRef, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { API_URL, fetchJson } from '../lib/api';
import { useDismissOnOutside } from '../lib/useDismissOnOutside';
import { getPresetThreads, SIMULATION_PERFORMANCE_PRESETS } from '../lib/sim-performance';

type SimulationLaunchButtonProps = {
  children: ReactNode;
  onSubmit: (threadsOverride?: number) => void;
  disabled?: boolean;
  submitting?: boolean;
  dataTour?: string;
};

export default function SimulationLaunchButton({
  children,
  onSubmit,
  disabled = false,
  submitting = false,
  dataTour,
}: SimulationLaunchButtonProps) {
  const [open, setOpen] = useState(false);
  const [maxThreads, setMaxThreads] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useDismissOnOutside(rootRef, open, () => setOpen(false));

  const openPerformanceMenu = async () => {
    setOpen((current) => !current);
    if (maxThreads !== null || loading) return;

    setLoading(true);
    setLoadError(false);
    try {
      const data = await fetchJson<{ threads?: number }>(`${API_URL}/health`);
      if (data.threads && data.threads > 0) {
        setMaxThreads(data.threads);
      } else {
        setLoadError(true);
      }
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div ref={rootRef} className="relative flex w-full">
      <button
        type="button"
        onClick={() => onSubmit()}
        disabled={disabled || submitting}
        data-tour={dataTour}
        className="btn-primary flex min-w-0 flex-1 items-center justify-center gap-2 rounded-r-none py-3 text-sm"
      >
        {children}
      </button>
      <button
        type="button"
        aria-label="Choose simulation performance"
        aria-expanded={open}
        onClick={openPerformanceMenu}
        disabled={disabled || submitting}
        className="btn-primary flex w-12 shrink-0 items-center justify-center rounded-l-none border-l-black/20 px-2 py-3 text-sm"
      >
        <ChevronDown
          className={`h-4 w-4 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
          strokeWidth={2}
        />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Simulation performance overrides"
          className="border-border bg-surface-2 absolute right-0 bottom-full z-50 mb-2 w-[min(18rem,calc(100vw-2rem))] rounded-xl border p-2 shadow-xl"
        >
          <div className="px-2 pt-1 pb-2">
            <div className="text-xs font-semibold tracking-widest text-zinc-500 uppercase">
              Run with performance override
            </div>
            <p className="mt-1 text-[11px] text-zinc-500">
              The main button uses your saved default.
            </p>
          </div>
          {loading ? (
            <div className="px-2 py-3 text-sm text-zinc-400">Loading CPU options…</div>
          ) : loadError ? (
            <div className="px-2 py-3 text-sm text-red-300">
              CPU options are unavailable. Try again.
            </div>
          ) : (
            SIMULATION_PERFORMANCE_PRESETS.map((preset) => {
              const threads = maxThreads === null ? null : getPresetThreads(maxThreads, preset.pct);
              return (
                <button
                  key={preset.label}
                  type="button"
                  role="menuitem"
                  disabled={threads === null}
                  onClick={() => {
                    if (threads === null) return;
                    setOpen(false);
                    onSubmit(threads);
                  }}
                  className="hover:bg-surface-3 w-full rounded-lg px-2 py-2 text-left transition-colors disabled:cursor-wait disabled:opacity-50"
                >
                  <span className="block text-sm font-medium text-zinc-200">{preset.label}</span>
                  <span className="mt-0.5 block text-xs text-zinc-500">
                    {threads === null
                      ? preset.description
                      : `${threads} threads · ${preset.description}`}
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
