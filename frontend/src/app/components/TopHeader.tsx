'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from './AuthContext';
import LoginModal from './LoginModal';
import { downloadLatestSimc, getSimcStatus, isDesktop, type SimcStatus } from '../lib/api';

export default function TopHeader() {
  const router = useRouter();
  const { user, loading, login, logout, checkCredentialsStatus } = useAuth();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [simcChannel, setSimcChannel] = useState('weekly');
  const [simcStatus, setSimcStatus] = useState<SimcStatus | null>(null);
  const [simcLoading, setSimcLoading] = useState(false);
  const [simcUpdating, setSimcUpdating] = useState(false);
  const [simcError, setSimcError] = useState<string | null>(null);
  const [simcToastDismissed, setSimcToastDismissed] = useState(false);
  const [simcFastPolling, setSimcFastPolling] = useState(false);

  const refreshSimcStatus = useCallback(async () => {
    if (!isDesktop || !user) return;
    setSimcLoading(true);
    setSimcError(null);
    try {
      const status = await getSimcStatus(simcChannel);
      setSimcStatus(status);
      if (!status.is_updating && !status.update_available) {
        setSimcUpdating(false);
        setSimcFastPolling(false);
      }
    } catch (err: any) {
      setSimcError(err?.detail || err?.message || 'Failed to check SimC update status.');
    } finally {
      setSimcLoading(false);
    }
  }, [user, simcChannel]);

  const handleSimcUpdate = async () => {
    setSimcUpdating(true);
    setSimcFastPolling(true);
    setSimcError(null);
    try {
      const status = await downloadLatestSimc(simcChannel);
      setSimcStatus(status);
    } catch (err: any) {
      const msg = err?.detail || err?.message || 'Failed to update SimC.';
      const isInProgress =
        err?.status === 409 ||
        /already in progress/i.test(msg || '') ||
        /already updating/i.test(msg || '');
      if (isInProgress) {
        setSimcError(null);
        void refreshSimcStatus();
      } else {
        setSimcError(msg);
      }
    } finally {
      setSimcUpdating(false);
    }
  };

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

  const handleLoginClick = async () => {
    const status = await checkCredentialsStatus();
    if (status.globally_configured) {
      login();
    } else {
      setIsModalOpen(true);
    }
  };

  const handleModalConfirm = (clientId: string, clientSecret: string) => {
    setIsModalOpen(false);
    login(clientId, clientSecret);
  };

  const handleBack = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
      return;
    }
    router.push('/');
  };

  useEffect(() => {
    if (!isDesktop || !user) {
      setSimcStatus(null);
      setSimcError(null);
      return;
    }

    try {
      const stored = (localStorage.getItem('whylowdps_simc_download_channel') || 'weekly')
        .toLowerCase()
        .trim();
      if (stored === 'latest' || stored === 'weekly' || stored === 'nightly') {
        setSimcChannel(stored);
      } else {
        setSimcChannel('weekly');
      }
    } catch {
      setSimcChannel('weekly');
    }

    void refreshSimcStatus();

    const interval = window.setInterval(
      () => {
        void refreshSimcStatus();
      },
      simcStatus?.is_updating || simcUpdating || simcFastPolling ? 900 : 120000
    );

    return () => window.clearInterval(interval);
  }, [user, refreshSimcStatus, simcFastPolling, simcStatus?.is_updating, simcUpdating]);

  useEffect(() => {
    const onSimcDownloadStart = (event: Event) => {
      const detail = (event as CustomEvent<{ channel?: string }>).detail;
      const channel = (detail?.channel || 'weekly').toLowerCase().trim();
      if (channel === 'latest' || channel === 'weekly' || channel === 'nightly') {
        setSimcChannel(channel);
      }
      setSimcUpdating(true);
      setSimcFastPolling(true);
      setSimcToastDismissed(false);
      void refreshSimcStatus();
    };

    const onSimcDownloadFinish = () => {
      setSimcUpdating(false);
      void refreshSimcStatus();
    };

    window.addEventListener('whylowdps-simc-download-start', onSimcDownloadStart as EventListener);
    window.addEventListener(
      'whylowdps-simc-download-finish',
      onSimcDownloadFinish as EventListener
    );
    return () => {
      window.removeEventListener(
        'whylowdps-simc-download-start',
        onSimcDownloadStart as EventListener
      );
      window.removeEventListener(
        'whylowdps-simc-download-finish',
        onSimcDownloadFinish as EventListener
      );
    };
  }, [refreshSimcStatus]);

  useEffect(() => {
    if (simcStatus?.is_updating || simcStatus?.update_available || simcUpdating) {
      setSimcToastDismissed(false);
    }
  }, [simcStatus?.is_updating, simcStatus?.update_available, simcUpdating]);

  useEffect(() => {
    const refreshOnFocus = () => {
      void refreshSimcStatus();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void refreshSimcStatus();
      }
    };
    window.addEventListener('focus', refreshOnFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('focus', refreshOnFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [refreshSimcStatus]);

  const simcProgress = simcStatus?.download_progress;
  const simcIsUnpacking = simcProgress?.phase === 'extracting_archive';
  const simcIsIndeterminate =
    !simcProgress ||
    simcProgress.percent == null ||
    simcIsUnpacking ||
    (simcProgress.bytes_total ?? 0) <= 0;
  const showSimcToast =
    isDesktop &&
    !!user &&
    !simcToastDismissed &&
    (simcStatus?.is_updating || simcUpdating || simcStatus?.update_available || !!simcError);

  return (
    <>
      <header className="fixed top-0 z-50 w-full border-b border-border/80 bg-bg/90 backdrop-blur-xl">
        <div className="flex h-14 items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleBack}
              className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-[13px] font-medium text-zinc-300 transition-all hover:border-zinc-500 hover:bg-white/5 hover:text-white"
              title="Go back"
              aria-label="Go back"
            >
              <svg
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-3.5 w-3.5"
              >
                <path d="M7 3L2 8l5 5" />
                <path d="M3 8h10" />
              </svg>
              Back
            </button>
            <Link href="/" className="group flex items-center gap-2.5">
              <img
                src="/icon.png"
                alt="WhyLowDps"
                className="h-8 w-8 rounded-md shadow-sm ring-1 ring-white/10"
              />
              <span className="text-[18px] font-bold tracking-tight text-gray-100 transition-colors group-hover:text-white">
                WhyLowDps
              </span>
            </Link>
          </div>

          <div className="flex items-center gap-4">
            {!loading && (
              <>
                {user ? (
                  <div className="flex items-center gap-4">
                    <div className="flex flex-col items-end">
                      <span className="text-[13px] font-medium text-gold">{user.battletag}</span>
                      <Link
                        href="/characters"
                        className="text-[11px] text-zinc-400 transition-colors hover:text-white"
                      >
                        My Characters
                      </Link>
                    </div>
                    <div className="h-6 w-px bg-border" />
                    <button
                      onClick={() => logout(true)}
                      className="text-[13px] font-medium text-zinc-400 transition-colors hover:text-white"
                    >
                      Logout
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={handleLoginClick}
                    className="rounded-md bg-[#0074e0] px-4 py-1.5 text-[13px] font-semibold text-white shadow-sm transition-colors hover:bg-[#005fb8]"
                  >
                    Login with Battle.net
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </header>

      <LoginModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onConfirm={handleModalConfirm}
      />

      {showSimcToast && (
        <div className="fixed bottom-4 right-4 z-[95] w-[22rem] rounded-lg border border-amber-700/40 bg-zinc-950/95 px-4 py-3 shadow-xl">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-amber-300">
                {simcStatus?.is_updating || simcUpdating
                  ? `SimC ${simcProgress?.channel || simcChannel} Downloading`
                  : `SimC ${simcChannel} Update Available`}
              </p>
              <p className="mt-1 text-xs text-zinc-300">
                {simcStatus?.is_updating || simcUpdating
                  ? simcProgress?.phase === 'extracting_archive'
                    ? 'Unpacking archive...'
                    : simcProgress?.phase === 'installing_files'
                      ? 'Installing files...'
                      : 'Downloading...'
                  : `Remote: ${simcStatus?.latest_version || 'Unknown'}`}
              </p>
            </div>
            <button
              onClick={() => setSimcToastDismissed(true)}
              className="rounded-md p-1 text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-200"
              aria-label="Dismiss SimC notification"
            >
              <svg
                className="h-4 w-4"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              >
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </button>
          </div>

          {(simcStatus?.is_updating || simcUpdating) && (
            <div className="mt-2">
              <div className="h-1.5 overflow-hidden rounded-full bg-amber-900/40">
                {simcIsIndeterminate ? (
                  <div className="h-full w-1/3 animate-pulse rounded bg-amber-300/80" />
                ) : (
                  <div
                    className="h-full rounded bg-amber-300/80 transition-all duration-200"
                    style={{
                      width: `${Math.max(2, Math.min(100, simcProgress?.percent ?? 2))}%`,
                    }}
                  />
                )}
              </div>
              {!simcIsUnpacking && (
                <div className="mt-0.5 text-[11px] text-zinc-500">
                  {simcProgress?.unit === 'files'
                    ? `${simcProgress?.bytes_downloaded ?? 0}${simcProgress?.bytes_total ? ` / ${simcProgress.bytes_total}` : ''} files`
                    : `${formatBytes(simcProgress?.bytes_downloaded ?? null)}${simcProgress?.bytes_total ? ` / ${formatBytes(simcProgress.bytes_total)}` : ''}`}
                </div>
              )}
              {!simcIsUnpacking && (
                <div className="mt-0.5 text-[11px] text-zinc-500">
                  {simcProgress?.unit === 'files'
                    ? `Speed: ${simcProgress?.speed_bps != null ? `${simcProgress.speed_bps.toFixed(1)} files/s` : 'Unknown'}`
                    : `Speed: ${formatBytes(simcProgress?.speed_bps ?? null)}/s`}
                </div>
              )}
              {!simcIsIndeterminate && !simcIsUnpacking && (
                <div className="mt-0.5 text-[11px] text-zinc-500">
                  ETA: {formatEta(simcProgress?.eta_seconds ?? null)}
                </div>
              )}
            </div>
          )}

          {!!simcError && <p className="mt-2 text-[11px] text-red-300">{simcError}</p>}

          <div className="mt-3 flex gap-2">
            {!simcIsUnpacking && (
              <button
                onClick={() => void refreshSimcStatus()}
                disabled={simcLoading || simcUpdating || !!simcStatus?.is_updating}
                className="rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-[11px] font-semibold text-zinc-300 transition-colors hover:border-zinc-500 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Check
              </button>
            )}
            {simcStatus?.update_available && (
              <button
                onClick={() => void handleSimcUpdate()}
                disabled={simcUpdating || simcLoading || !!simcStatus?.is_updating}
                className="rounded-md border border-amber-500/50 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold text-amber-200 transition-colors hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {simcUpdating || simcStatus?.is_updating ? 'Downloading...' : 'Update SimC'}
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
