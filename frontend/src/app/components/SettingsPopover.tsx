'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSimContext } from './SimContext';
import { API_URL, downloadLatestSimc, getSimcStatus, isDesktop, type SimcStatus } from '../lib/api';

const PRESETS = [
  { label: 'Balanced', pct: 0.3, desc: '30%' },
  { label: 'Performance', pct: 0.6, desc: '60%' },
  { label: 'Maximum', pct: 0.9, desc: '90%' },
] as const;

export default function SettingsPopover() {
  const [open, setOpen] = useState(false);
  const [maxThreads, setMaxThreads] = useState(0);
  const [simcStatus, setSimcStatus] = useState<SimcStatus | null>(null);
  const [simcLoading, setSimcLoading] = useState(false);
  const [simcUpdating, setSimcUpdating] = useState(false);
  const [simcError, setSimcError] = useState<string | null>(null);
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

  const refreshSimcStatus = useCallback(async () => {
    if (!isDesktop) return;
    setSimcLoading(true);
    setSimcError(null);
    try {
      const status = await getSimcStatus();
      setSimcStatus(status);
    } catch (error: any) {
      setSimcError(error?.detail || error?.message || 'Failed to fetch SimC update status.');
    } finally {
      setSimcLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open || !isDesktop) return;
    void refreshSimcStatus();
  }, [open, refreshSimcStatus]);

  useEffect(() => {
    if (!isDesktop) return;
    let cancelled = false;
    void getSimcStatus()
      .then((status) => {
        if (!cancelled) {
          setSimcStatus(status);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const handleDownloadLatest = async () => {
    setSimcUpdating(true);
    setSimcError(null);
    try {
      const status = await downloadLatestSimc();
      setSimcStatus(status);
    } catch (error: any) {
      setSimcError(error?.detail || error?.message || 'Failed to download latest SimC.');
    } finally {
      setSimcUpdating(false);
    }
  };

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
        {simcStatus?.update_available && (
          <span className="ml-auto rounded border border-amber-600/40 bg-amber-900/25 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-300">
            SimC update
          </span>
        )}
      </button>

      {open && (
        <div className="absolute bottom-full left-0 z-[60] mb-2 w-[22rem] rounded-xl border border-border bg-surface p-5 shadow-xl shadow-black/40">
          <div className="space-y-6">
            {/* CPU Threads */}
            {maxThreads > 0 && (
              <div className="space-y-3.5">
                <div className="flex items-center justify-between">
                  <span className="text-[15px] font-semibold text-zinc-100">CPU Threads</span>
                  <span className="rounded border border-border bg-surface-2 px-2.5 py-1 font-mono text-[12px] tabular-nums text-zinc-100">
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
                        className={`flex-1 rounded-lg border py-2.5 text-center transition-all ${
                          activePresetIdx === i
                            ? 'border-white bg-white text-black'
                            : 'border-border bg-surface-2 text-zinc-400 hover:border-gray-500 hover:text-white'
                        }`}
                      >
                        <span className="block text-[13px] font-semibold">{p.label}</span>
                        <span className="mt-0.5 block text-[11px] text-zinc-500">{val} threads</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Max Gear Combinations */}
            <div className="flex items-center justify-between border-t border-border pt-5">
              <div className="space-y-0.5">
                <p className="text-[15px] font-semibold text-zinc-100">Max Gear Combos</p>
                <p className="text-[12px] text-zinc-400">Limits simulation runtime.</p>
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
                className="w-24 rounded border border-border bg-surface-2 px-2 py-1.5 text-center font-mono text-[13px] tabular-nums text-zinc-100 [appearance:textfield] focus:border-gold/50 focus:outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
            </div>

            {isDesktop && (
              <div className="space-y-3.5 border-t border-border pt-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-0.5">
                    <p className="text-[15px] font-semibold text-zinc-100">SimulationCraft Engine</p>
                    <p className="text-[12px] leading-relaxed text-zinc-400">
                      Check installed version and update from official nightly builds.
                    </p>
                  </div>
                  <button
                    onClick={() => void refreshSimcStatus()}
                    disabled={simcLoading || simcUpdating}
                    className="rounded-md border border-border bg-surface-2 px-3 py-1.5 text-[12px] font-medium text-zinc-200 transition-colors hover:border-zinc-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {simcLoading ? 'Checking...' : 'Refresh'}
                  </button>
                </div>

                <div className="rounded-lg border border-border bg-surface-2 p-3.5 text-[13px]">
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-zinc-400">Installed</span>
                    <span className="font-mono text-zinc-100">
                      {simcStatus?.installed_version ??
                        (simcStatus?.installed_exists ? 'Detected' : 'Missing')}
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between gap-4">
                    <span className="text-zinc-400">Latest</span>
                    <span className="font-mono text-zinc-100">
                      {simcStatus?.latest_version ?? (simcLoading ? 'Checking...' : 'Unavailable')}
                    </span>
                  </div>
                  {simcStatus && (
                    <p
                      className={`mt-2 text-[12px] font-medium ${
                        simcStatus.update_available ? 'text-amber-300' : 'text-emerald-300'
                      }`}
                    >
                      {simcStatus.update_available
                        ? 'A newer SimC build is available.'
                        : 'Installed SimC is up to date.'}
                    </p>
                  )}
                  {(simcError || simcStatus?.detail) && (
                    <p className="mt-2 text-[12px] text-red-300">{simcError || simcStatus?.detail}</p>
                  )}
                </div>

                <button
                  onClick={() => void handleDownloadLatest()}
                  disabled={
                    simcLoading ||
                    simcUpdating ||
                    !simcStatus ||
                    !simcStatus.latest_version ||
                    !simcStatus.update_available
                  }
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-amber-700/50 bg-amber-950/30 py-3 text-[14px] font-semibold text-amber-300 transition-all hover:bg-amber-900/40 hover:text-amber-200 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {simcUpdating ? 'Downloading latest SimC...' : 'Download Latest SimC'}
                </button>
              </div>
            )}

            {/* Shutdown Button */}
            <div className="border-t border-border pt-5">
              <button
                onClick={() => {
                  if (confirm('Are you sure you want to shut down the simulation server?')) {
                    fetch(`${API_URL}/api/system/shutdown`, {
                      method: 'POST',
                      credentials: 'include',
                    });
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
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-red-900/50 bg-red-950/20 py-3 text-[14px] font-medium text-red-300 transition-all hover:bg-red-950/40 hover:text-red-200 active:scale-[0.98]"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728L5.636 5.636"
                  />
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
