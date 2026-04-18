'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { downloadLatestSimc, getSimcStatus, isDesktop, type SimcStatus } from '../lib/api';

type StatusMap = { nightly: SimcStatus | null };

export default function SimcRequiredModal() {
  const [statuses, setStatuses] = useState<StatusMap>({
    nightly: null,
  });
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  const refreshStatuses = useCallback(async (silent = false) => {
    if (!isDesktop) return;
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const [nightly] = await Promise.all([getSimcStatus()]);
      setStatuses({ nightly });
      setInitialized(true);
    } catch (err: any) {
      if (!silent) {
        setError(err?.detail || err?.message || 'Failed to check SimC status.');
      }
      setInitialized(true);
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!isDesktop) return;
    void refreshStatuses();
  }, [refreshStatuses]);

  const handleDownload = useCallback(async () => {
    setDownloading(true);
    setError(null);
    window.dispatchEvent(
      new CustomEvent('whylowdps-simc-download-start', {
        detail: { channel: 'nightly' },
      })
    );
    void refreshStatuses(true);
    try {
      const next = await downloadLatestSimc();
      setStatuses((prev) => ({ ...prev, nightly: next }));
      window.dispatchEvent(
        new CustomEvent('whylowdps-simc-download-finish', {
          detail: { channel: 'nightly' },
        })
      );
      try {
        localStorage.setItem('whylowdps_simc_download_channel', 'nightly');
        localStorage.setItem('whylowdps_simc_channel', 'nightly');
      } catch {}
    } catch (err: any) {
      const msg = err?.detail || err?.message || 'Failed to download SimC.';
      const isInProgress =
        err?.status === 409 ||
        /already in progress/i.test(msg || '') ||
        /already updating/i.test(msg || '');
      if (isInProgress) {
        setError(null);
        window.dispatchEvent(
          new CustomEvent('whylowdps-simc-download-start', {
            detail: { channel: 'nightly' },
          })
        );
        void refreshStatuses(true);
      } else {
        setError(msg);
      }
    } finally {
      setDownloading(false);
    }
  }, [refreshStatuses]);

  const anyInstalled = useMemo(() => {
    return Object.values(statuses).some((status) => status?.installed_exists);
  }, [statuses]);

  const activeChannel = 'nightly';
  const activeStatus = statuses[activeChannel];
  const selectedStatus = statuses.nightly;
  const progress = activeStatus?.download_progress;
  const isUpdating = Object.values(statuses).some((status) => !!status?.is_updating);
  const showProgress = downloading || isUpdating;
  const isIndeterminate = !progress || progress.percent == null || (progress.bytes_total ?? 0) <= 0;

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

  const formatElapsed = (seconds?: number | null) => {
    if (seconds == null || !Number.isFinite(seconds)) return '0s';
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  useEffect(() => {
    if (!showProgress) return;
    void refreshStatuses(true);
    const id = window.setInterval(() => {
      void refreshStatuses(true);
    }, 900);
    return () => window.clearInterval(id);
  }, [refreshStatuses, showProgress]);

  useEffect(() => {
    const refreshOnFocus = () => {
      void refreshStatuses(true);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void refreshStatuses(true);
      }
    };
    window.addEventListener('focus', refreshOnFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('focus', refreshOnFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [refreshStatuses]);

  if (!isDesktop || !initialized || anyInstalled) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/75 px-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-amber-700/40 bg-zinc-950 p-6 shadow-2xl">
        <h2 className="text-xl font-semibold text-zinc-100">SimulationCraft Required</h2>
        <p className="mt-2 text-sm leading-relaxed text-zinc-300">
          SimC is missing from your local install, so simulations cannot run yet. Choose a channel
          and install it to continue.
        </p>
        {showProgress && (
          <p className="mt-2 text-xs text-amber-200">
            Installing {activeChannel} SimC. This modal will close automatically once SimC is ready.
          </p>
        )}
        {showProgress && (
          <div className="mt-3 rounded-xl border border-amber-800/40 bg-amber-950/20 p-3">
            <div className="mb-1.5 flex items-center justify-between text-xs text-amber-200">
              <span>
                {progress?.phase === 'extracting_archive'
                  ? 'Unpacking archive...'
                  : progress?.phase === 'installing_files' || progress?.phase === 'extracting_data'
                    ? 'Extracting data files...'
                    : 'Downloading...'}
              </span>
              <span>{isIndeterminate ? '...' : `${progress?.percent?.toFixed(1)}%`}</span>
            </div>
            <div className="h-2 overflow-hidden rounded bg-amber-900/35">
              {isIndeterminate ? (
                <div className="h-full w-1/3 animate-pulse rounded bg-amber-400/90" />
              ) : (
                <div
                  className="h-full rounded bg-amber-400 transition-all duration-300"
                  style={{ width: `${Math.max(2, Math.min(100, progress?.percent ?? 2))}%` }}
                />
              )}
            </div>
            <div className="mt-2 grid grid-cols-1 gap-1 text-[11px] text-zinc-300">
              {progress?.unit === 'files' ? (
                <>
                  <span>
                    {(progress?.bytes_downloaded ?? 0).toLocaleString()}
                    {progress?.bytes_total
                      ? ` / ${progress.bytes_total.toLocaleString()}`
                      : ''}{' '}
                    files
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
              {!isIndeterminate && <span>ETA: {progress?.eta_seconds ?? 'Unknown'}s</span>}
              <span>Elapsed: {formatElapsed(progress?.elapsed_seconds ?? null)}</span>
            </div>
          </div>
        )}

        <div className="mt-3 rounded-xl border border-zinc-800 bg-zinc-900/80 p-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-zinc-500">Remote (nightly)</span>
            <span className="font-mono text-zinc-200">
              {selectedStatus?.latest_version || (loading ? 'Checking...' : 'Unavailable')}
            </span>
          </div>
          {selectedStatus?.detail && (
            <p className="mt-2 text-xs text-red-300">{selectedStatus.detail}</p>
          )}
          {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
        </div>

        <div className="mt-5 flex gap-2">
          <button
            onClick={() => void handleDownload()}
            disabled={downloading || loading || isUpdating || !selectedStatus?.latest_version}
            className="flex-1 rounded-lg border border-amber-700/50 bg-amber-950/40 px-3 py-2 text-sm font-semibold text-amber-200 transition-colors hover:bg-amber-900/40 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {downloading || isUpdating ? 'Installing...' : 'Install nightly'}
          </button>
        </div>
      </div>
    </div>
  );
}
