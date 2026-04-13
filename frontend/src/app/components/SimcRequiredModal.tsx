'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { downloadLatestSimc, getSimcStatus, isDesktop, type SimcStatus } from '../lib/api';

export default function SimcRequiredModal() {
  const [status, setStatus] = useState<SimcStatus | null>(null);
  const channel = 'weekly';
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoDownloadAttempted = useRef(false);

  const refreshStatus = useCallback(
    async (silent = false) => {
      if (!isDesktop) return;
      if (!silent) {
        setLoading(true);
        setError(null);
      }
      try {
        const next = await getSimcStatus(channel);
        setStatus(next);
      } catch (err: any) {
        if (!silent) {
          setError(err?.detail || err?.message || 'Failed to check SimC status.');
        }
      } finally {
        if (!silent) {
          setLoading(false);
        }
      }
    },
    [channel]
  );

  useEffect(() => {
    if (!isDesktop) return;
    void refreshStatus();
  }, [refreshStatus]);

  const handleDownload = useCallback(async () => {
    setDownloading(true);
    setError(null);
    void refreshStatus(true);
    try {
      const next = await downloadLatestSimc(channel);
      setStatus(next);
    } catch (err: any) {
      const msg = err?.detail || err?.message || 'Failed to download SimC.';
      const isInProgress =
        err?.status === 409 ||
        /already in progress/i.test(msg || '') ||
        /already updating/i.test(msg || '');
      if (isInProgress) {
        setError(null);
        void refreshStatus(true);
      } else {
        setError(msg);
      }
    } finally {
      setDownloading(false);
    }
  }, [channel, refreshStatus]);

  const isMissing = useMemo(() => {
    if (!isDesktop) return false;
    if (!status) return false;
    return !status.installed_exists;
  }, [status]);

  const progress = status?.download_progress;

  const formatBytes = (bytes?: number | null) => {
    if (bytes == null || Number.isNaN(bytes)) return 'Unknown';
    if (bytes < 1024) return `${bytes} B`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    const mb = kb / 1024;
    if (mb < 1024) return `${mb.toFixed(1)} MB`;
    const gb = mb / 1024;
    return `${gb.toFixed(2)} GB`;
  };

  const formatEta = (seconds?: number | null) => {
    if (seconds == null || !Number.isFinite(seconds)) return 'Unknown';
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  const formatElapsed = (seconds?: number | null) => {
    if (seconds == null || !Number.isFinite(seconds)) return '0s';
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  useEffect(() => {
    if (!isDesktop || !isMissing || downloading) return;
    if (!status?.latest_version || autoDownloadAttempted.current) return;
    autoDownloadAttempted.current = true;
    void handleDownload();
  }, [isMissing, downloading, status?.latest_version, handleDownload]);

  useEffect(() => {
    if (!downloading && !status?.is_updating) return;
    void refreshStatus(true);
    const id = window.setInterval(() => {
      void refreshStatus(true);
    }, 900);
    return () => window.clearInterval(id);
  }, [downloading, status?.is_updating, refreshStatus]);

  if (!isMissing) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/75 px-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-amber-700/40 bg-zinc-950 p-6 shadow-2xl">
        <h2 className="text-xl font-semibold text-zinc-100">SimulationCraft Required</h2>
        <p className="mt-2 text-sm leading-relaxed text-zinc-300">
          SimC is missing from your local install, so simulations cannot run yet. Download the
          weekly SimC build to continue.
        </p>
        {downloading && (
          <p className="mt-2 text-xs text-amber-200">
            Downloading {channel} SimC. This modal will close automatically once SimC is ready.
          </p>
        )}
        {(downloading || status?.is_updating) && (
          <div className="mt-3 rounded-xl border border-amber-800/40 bg-amber-950/20 p-3">
            <div className="mb-1.5 flex items-center justify-between text-xs text-amber-200">
              <span>
                {progress?.phase === 'extracting_archive'
                  ? 'Unpacking archive...'
                  : progress?.phase === 'installing_files'
                    ? 'Installing files...'
                    : 'Downloading...'}
              </span>
              <span>{progress?.percent != null ? `${progress.percent.toFixed(1)}%` : '...'}</span>
            </div>
            <div className="h-2 rounded bg-amber-900/35">
              <div
                className="h-full rounded bg-amber-400 transition-all duration-300"
                style={{ width: `${Math.max(2, Math.min(100, progress?.percent ?? 2))}%` }}
              />
            </div>
            <div className="mt-2 grid grid-cols-1 gap-1 text-[11px] text-zinc-300">
              {progress?.phase === 'extracting_archive' ? (
                <>
                  <span>Preparing extracted files...</span>
                  <span>Progress details are unavailable during unpacking.</span>
                </>
              ) : progress?.unit === 'files' ? (
                <>
                  <span>
                    {progress?.bytes_downloaded ?? 0}
                    {progress?.bytes_total ? ` / ${progress.bytes_total}` : ''} files
                  </span>
                  <span>
                    Speed:{' '}
                    {progress?.speed_bps != null
                      ? `${progress.speed_bps.toFixed(1)} files/s`
                      : 'Unknown'}
                  </span>
                </>
              ) : (
                <>
                  <span>
                    {formatBytes(progress?.bytes_downloaded ?? null)}
                    {progress?.bytes_total ? ` / ${formatBytes(progress.bytes_total)}` : ''}
                  </span>
                  <span>Speed: {formatBytes(progress?.speed_bps ?? null)}/s</span>
                </>
              )}
              <span>
                ETA:{' '}
                {progress?.bytes_total ? formatEta(progress?.eta_seconds ?? null) : 'Estimating...'}
              </span>
              <span>Elapsed: {formatElapsed(progress?.elapsed_seconds ?? null)}</span>
            </div>
          </div>
        )}

        <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900/80 p-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-zinc-500">Remote (weekly)</span>
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
            Retry Check
          </button>
          <button
            onClick={() => void handleDownload()}
            disabled={downloading || loading || !status?.latest_version}
            className="flex-1 rounded-lg border border-amber-700/50 bg-amber-950/40 px-3 py-2 text-sm font-semibold text-amber-200 transition-colors hover:bg-amber-900/40 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {downloading ? 'Downloading...' : 'Download Weekly SimC'}
          </button>
        </div>
      </div>
    </div>
  );
}
