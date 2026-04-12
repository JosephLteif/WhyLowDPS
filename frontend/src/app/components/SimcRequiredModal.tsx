'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { downloadLatestSimc, getSimcStatus, isDesktop, type SimcStatus } from '../lib/api';

export default function SimcRequiredModal() {
  const [status, setStatus] = useState<SimcStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    if (!isDesktop) return;
    setLoading(true);
    setError(null);
    try {
      const next = await getSimcStatus();
      setStatus(next);
    } catch (err: any) {
      setError(err?.detail || err?.message || 'Failed to check SimC status.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isDesktop) return;
    void refreshStatus();
  }, [refreshStatus]);

  const handleDownload = useCallback(async () => {
    setDownloading(true);
    setError(null);
    try {
      const next = await downloadLatestSimc();
      setStatus(next);
    } catch (err: any) {
      setError(err?.detail || err?.message || 'Failed to download SimC.');
    } finally {
      setDownloading(false);
    }
  }, []);

  const isMissing = useMemo(() => {
    if (!isDesktop) return false;
    if (!status) return false;
    return !status.installed_exists;
  }, [status]);

  if (!isMissing) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/75 px-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-amber-700/40 bg-zinc-950 p-6 shadow-2xl">
        <h2 className="text-xl font-semibold text-zinc-100">SimulationCraft Required</h2>
        <p className="mt-2 text-sm leading-relaxed text-zinc-300">
          SimC is missing from your local install, so simulations cannot run yet. Download the
          latest SimC build to continue.
        </p>

        <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900/80 p-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-zinc-500">Latest</span>
            <span className="font-mono text-zinc-200">
              {status?.latest_version || (loading ? 'Checking...' : 'Unavailable')}
            </span>
          </div>
          {status?.detail && <p className="mt-2 text-xs text-red-300">{status.detail}</p>}
          {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
        </div>

        <div className="mt-5 flex gap-2">
          <button
            onClick={() => void refreshStatus()}
            disabled={loading || downloading}
            className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-300 transition-colors hover:border-zinc-500 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? 'Checking...' : 'Retry Check'}
          </button>
          <button
            onClick={() => void handleDownload()}
            disabled={downloading || loading || !status?.latest_version}
            className="flex-1 rounded-lg border border-amber-700/50 bg-amber-950/40 px-3 py-2 text-sm font-semibold text-amber-200 transition-colors hover:bg-amber-900/40 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {downloading ? 'Downloading...' : 'Download SimC'}
          </button>
        </div>
      </div>
    </div>
  );
}

