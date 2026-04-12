'use client';

import { useEffect, useRef, useState } from 'react';
import { useSimContext } from './SimContext';
import { API_URL } from '../lib/api';

const PRESETS = [
  { label: 'Balanced', pct: 0.3, desc: '30%' },
  { label: 'Performance', pct: 0.6, desc: '60%' },
  { label: 'Maximum', pct: 0.9, desc: '90%' },
] as const;

export default function SettingsPopover() {
  const [open, setOpen] = useState(false);
  const [maxThreads, setMaxThreads] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const { threads, setThreads, maxCombinations, setMaxCombinations } = useSimContext();

  useEffect(() => {
    // Fetch system info from backend for thread management
    fetch(`${API_URL}/health`, { credentials: 'include' })
      .then((res) => res.json())
      .then((data) => {
        if (data.threads) {
          setMaxThreads(data.threads);
          if (threads === 0) {
            setThreads(Math.max(1, Math.round(data.threads * 0.6)));
          }
        }
      })
      .catch(() => {});
  }, [threads, setThreads]);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const activePresetIdx = PRESETS.findIndex(
    (p) => maxThreads > 0 && Math.max(1, Math.round(maxThreads * p.pct)) === threads
  );

  return (
    <div className="relative w-full" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className={`group flex w-full items-center gap-3 rounded-lg px-4 py-3 transition-colors ${
          open ? 'bg-surface-2 text-white' : 'text-zinc-400 hover:bg-surface-2 hover:text-white'
        }`}
      >
        <svg
          className={`h-5 w-5 shrink-0 ${open ? 'text-zinc-300' : 'text-zinc-500 group-hover:text-zinc-300'}`}
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="8" cy="8" r="2" />
          <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" />
        </svg>
        <span className="text-[15px] font-medium">Settings</span>
      </button>

      {open && (
        <div className="absolute bottom-full left-0 z-[60] mb-2 w-80 rounded-xl border border-border bg-surface p-4 shadow-xl shadow-black/40">
          <div className="space-y-5">
            {/* CPU Threads */}
            {maxThreads > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[14px] font-medium text-zinc-300">CPU Threads</span>
                  <span className="rounded border border-border bg-surface-2 px-2 py-0.5 font-mono text-[11px] tabular-nums text-white">
                    {threads}/{maxThreads}
                  </span>
                </div>
                <div className="flex gap-1.5">
                  {PRESETS.map((p, i) => {
                    const val = Math.max(1, Math.round(maxThreads * p.pct));
                    return (
                      <button
                        key={p.label}
                        onClick={() => setThreads(val)}
                        className={`flex-1 rounded-lg border py-2 text-center transition-all ${
                          activePresetIdx === i
                            ? 'border-white bg-white text-black'
                            : 'border-border bg-surface-2 text-zinc-400 hover:border-gray-500 hover:text-white'
                        }`}
                      >
                        <span className="block text-[12px] font-semibold">{p.label}</span>
                        <span className="mt-0.5 block text-[10px] opacity-70">{val} threads</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Max Gear Combinations */}
            <div className="flex items-center justify-between border-t border-border pt-4">
              <div className="space-y-0.5">
                <p className="text-[14px] font-medium text-zinc-300">Max Gear Combos</p>
                <p className="text-[11px] text-zinc-500">Limits simulation runtime.</p>
              </div>
              <input
                type="number"
                min={10}
                max={100000}
                step={50}
                value={maxCombinations ?? 500}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (Number.isFinite(val) && val > 0) setMaxCombinations(val);
                }}
                className="w-20 rounded border border-border bg-surface-2 px-2 py-1 text-center font-mono text-xs tabular-nums text-white [appearance:textfield] focus:border-gold/50 focus:outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
