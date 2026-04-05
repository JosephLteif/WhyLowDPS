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
  const {
    threads,
    setThreads,
    maxCombinations,
    setMaxCombinations,
    disableCharacterMedia,
    setDisableCharacterMedia,
  } = useSimContext();

  useEffect(() => {
    // Fetch system info from backend for thread management
    fetch(`${API_URL}/health`)
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
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex h-7 items-center gap-1.5 rounded-md px-2 text-gray-400 transition-colors hover:bg-white/[0.06] hover:text-gray-200"
      >
        <svg
          className="h-3.5 w-3.5"
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
        <span className="text-[13px] font-medium">Settings</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-[60] mt-2 w-80 rounded-xl border border-border bg-surface p-4 shadow-xl shadow-black/40">
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
                        <span className="mt-0.5 block text-[10px] opacity-70">
                          {val} threads
                        </span>
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

            {/* Character Media Toggle */}
            <div className="flex items-center justify-between border-t border-border pt-4">
              <div className="space-y-0.5">
                <p className="text-[14px] font-medium text-zinc-200">Character Media</p>
                <p className="text-[11px] text-zinc-500">Enable 3D character renders.</p>
              </div>
              <button
                type="button"
                onClick={() => setDisableCharacterMedia(!disableCharacterMedia)}
                className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                  !disableCharacterMedia ? 'bg-gold' : 'border border-border bg-surface-2'
                }`}
              >
                <div
                  className={`absolute top-0.5 h-4 w-4 rounded-full transition-all ${
                    !disableCharacterMedia ? 'left-[18px] bg-black' : 'left-0.5 bg-gray-500'
                  }`}
                />
              </button>
            </div>

            {/* Shutdown Button */}
            <div className="border-t border-border pt-4">
              <button
                onClick={() => {
                  if (confirm('Are you sure you want to shut down the simulation server?')) {
                    fetch(`${API_URL}/api/system/shutdown`, { method: 'POST' });
                    setOpen(false);
                    // Show overlay or something
                    const overlay = document.createElement('div');
                    overlay.style.position = 'fixed';
                    overlay.style.top = '0';
                    overlay.style.left = '0';
                    overlay.style.width = '100vw';
                    overlay.style.height = '100vh';
                    overlay.style.backgroundColor = 'black';
                    overlay.style.color = 'white';
                    overlay.style.display = 'flex';
                    overlay.style.flexDirection = 'column';
                    overlay.style.alignItems = 'center';
                    overlay.style.justifyContent = 'center';
                    overlay.style.zIndex = '9999';
                    overlay.innerHTML = `
                      <h1 style="font-size: 24px; margin-bottom: 16px;">Shutting Down...</h1>
                      <p style="color: #666;">You can close this tab now.</p>
                    `;
                    document.body.appendChild(overlay);
                  }
                }}
                className="w-full flex items-center justify-center gap-2 rounded-lg border border-red-900/50 bg-red-950/20 py-2.5 text-[13px] font-medium text-red-400 transition-all hover:bg-red-950/40 hover:text-red-300 active:scale-[0.98]"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728L5.636 5.636" />
                </svg>
                Shutdown Simulation Server
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
