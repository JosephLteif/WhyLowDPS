'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isDesktopRuntime } from '../lib/api';
import { normalizeInvokeError } from '../lib/error-utils';
import {
  formatBytesDecimal,
  formatElapsedCompact,
  formatEta,
  formatTransferSpeed,
} from '../lib/format';
import {
  readStoredUpdateChannel,
  type UpdateChannel,
} from '../lib/update-channel';
import {
  fetchManifestVersion,
  isRemoteNewerForSelectedChannel,
  resolveCurrentVersion,
} from '../lib/updater-release';

type UpdateState = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'handoff' | 'error';
type CacheRefreshState = 'idle' | 'checking' | 'downloading' | 'downloaded' | 'error';
type SimcRuntimeState = 'idle' | 'checking' | 'downloading' | 'downloaded' | 'error';
type UpdaterStatusEvent =
  | 'checking'
  | 'available'
  | 'none'
  | 'error'
  | 'downloading'
  | 'downloaded';

type UpdateDetails = {
  version: string;
  notes?: string;
  currentVersion?: string;
  manualDownloadUrl?: string;
  fallbackOnly?: boolean;
  channel?: UpdateChannel;
};

type DownloadProgress = {
  downloadedBytes: number;
  totalBytes?: number;
  speedBytesPerSec?: number;
  etaSeconds?: number | null;
};

type CacheProgress = {
  current: number;
  total: number;
  details: string;
  downloadedBytes: number;
  totalBytes: number;
  elapsedSeconds: number;
  speedBytesPerSec: number;
};

type SimcRuntimeProgress = {
  channel: string;
  downloadedBytes: number;
  totalBytes?: number;
  elapsedSeconds: number;
  speedBytesPerSec: number;
  etaSeconds?: number | null;
};

type TauriDownloadEvent =
  | { event: 'Started'; data: { contentLength?: number } }
  | { event: 'Progress'; data: { chunkLength: number } }
  | { event: 'Finished' };

type DirectInstallProgressEvent = {
  status?: string;
  downloaded_bytes?: number;
  total_bytes?: number;
  message?: string;
};

type SimcRuntimeProgressEvent = {
  status?: string;
  channel?: string;
  downloaded_bytes?: number;
  total_bytes?: number;
  elapsed_ms?: number;
  speed_bytes_per_sec?: number;
  eta_seconds?: number | null;
  version?: string;
  updated?: boolean;
  message?: string;
};

const UPDATE_CHECK_EVENT = 'whylowdps-updater-check';
const UPDATE_INSTALL_EVENT = 'whylowdps-updater-install';
const DIRECT_INSTALL_PROGRESS_EVENT = 'whylowdps-direct-install-progress';
const SIMC_RUNTIME_PROGRESS_EVENT = 'whylowdps-simc-runtime-progress';
const UPDATE_STATUS_EVENT = 'whylowdps-updater-status';
const CACHE_REFRESH_CHECK_EVENT = 'whylowdps-cache-refresh-start';
const CACHE_REFRESH_STATUS_EVENT = 'whylowdps-cache-refresh-status';

function emitUpdaterStatus(status: UpdaterStatusEvent, message?: string) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(UPDATE_STATUS_EVENT, { detail: { status, message } }));
}


async function getCurrentAppVersion(): Promise<string | null> {
  try {
    const appModule = (await import('@tauri-apps/api/app')) as {
      getVersion: () => Promise<string>;
    };
    return await appModule.getVersion();
  } catch {
    return null;
  }
}

async function listenToDirectInstallProgress(
  callback: (detail: DirectInstallProgressEvent) => void,
): Promise<() => void> {
  const eventModule = (await import('@tauri-apps/api/event')) as {
    listen: (
      event: string,
      handler: (event: { payload: DirectInstallProgressEvent }) => void,
    ) => Promise<() => void>;
  };
  return eventModule.listen(DIRECT_INSTALL_PROGRESS_EVENT, (event) => callback(event.payload || {}));
}

async function listenToSimcRuntimeProgress(
  callback: (detail: SimcRuntimeProgressEvent) => void,
): Promise<() => void> {
  const eventModule = (await import('@tauri-apps/api/event')) as {
    listen: (
      event: string,
      handler: (event: { payload: SimcRuntimeProgressEvent }) => void,
    ) => Promise<() => void>;
  };
  return eventModule.listen(SIMC_RUNTIME_PROGRESS_EVENT, (event) => callback(event.payload || {}));
}

export default function UpdatePrompt() {
  const [state, setState] = useState<UpdateState>('idle');
  const [cacheState, setCacheState] = useState<CacheRefreshState>('idle');
  const [simcState, setSimcState] = useState<SimcRuntimeState>('idle');
  const [details, setDetails] = useState<UpdateDetails | null>(null);
  const [cacheDetails, setCacheDetails] = useState<string>('');
  const [simcDetails, setSimcDetails] = useState<string>('');
  const [errorText, setErrorText] = useState<string>('');
  const [cacheErrorText, setCacheErrorText] = useState<string>('');
  const [simcErrorText, setSimcErrorText] = useState<string>('');
  const [dismissed, setDismissed] = useState(false);
  const [backgroundMode, setBackgroundMode] = useState(false);
  const [cacheBackgroundMode, setCacheBackgroundMode] = useState(false);
  const [simcDismissed, setSimcDismissed] = useState(false);
  const [progress, setProgress] = useState<DownloadProgress>({ downloadedBytes: 0 });
  const [cacheProgress, setCacheProgress] = useState<CacheProgress>({
    current: 0,
    total: 0,
    details: '',
    downloadedBytes: 0,
    totalBytes: 0,
    elapsedSeconds: 0,
    speedBytesPerSec: 0,
  });
  const [simcProgress, setSimcProgress] = useState<SimcRuntimeProgress>({
    channel: 'weekly',
    downloadedBytes: 0,
    totalBytes: undefined,
    elapsedSeconds: 0,
    speedBytesPerSec: 0,
    etaSeconds: null,
  });
  const updateRef = useRef<any>(null);
  const isCheckingRef = useRef(false);
  const installInFlightRef = useRef(false);
  const speedTrackerRef = useRef<{ startedAt: number; lastAt: number; lastBytes: number }>({
    startedAt: 0,
    lastAt: 0,
    lastBytes: 0,
  });
  const totalBytesRef = useRef<number | undefined>(undefined);

  const isUpdateToastVisible = useMemo(() => {
    if (backgroundMode && (state === 'downloading' || state === 'downloaded' || state === 'handoff')) return false;
    if (dismissed && state !== 'downloading') return false;
    return (
      state === 'available' ||
      state === 'downloading' ||
      state === 'downloaded' ||
      state === 'handoff' ||
      state === 'error'
    );
  }, [backgroundMode, dismissed, state]);

  const progressPercent = useMemo(() => {
    if (!progress.totalBytes || progress.totalBytes <= 0) return null;
    return Math.min(100, Math.round((progress.downloadedBytes / progress.totalBytes) * 100));
  }, [progress]);

  const cacheProgressPercent = useMemo(() => {
    if (!cacheProgress.total || cacheProgress.total <= 0) return null;
    return Math.min(100, Math.round((cacheProgress.current / cacheProgress.total) * 100));
  }, [cacheProgress]);
  const cacheFileProgressPercent = useMemo(() => {
    if (!cacheProgress.totalBytes || cacheProgress.totalBytes <= 0) return null;
    return Math.min(
      100,
      Math.round((cacheProgress.downloadedBytes / cacheProgress.totalBytes) * 100),
    );
  }, [cacheProgress]);
  const simcProgressPercent = useMemo(() => {
    if (!simcProgress.totalBytes || simcProgress.totalBytes <= 0) return null;
    return Math.min(
      100,
      Math.round((simcProgress.downloadedBytes / simcProgress.totalBytes) * 100),
    );
  }, [simcProgress]);

  const resetSpeedTracking = useCallback(() => {
    const now = Date.now();
    totalBytesRef.current = undefined;
    speedTrackerRef.current = {
      startedAt: now,
      lastAt: now,
      lastBytes: 0,
    };
  }, []);

  const applyProgressSample = useCallback((downloadedBytes: number, totalBytes?: number) => {
    if (typeof totalBytes === 'number') {
      totalBytesRef.current = totalBytes;
    }
    const effectiveTotalBytes = totalBytesRef.current;
    const now = Date.now();
    setProgress((prev) => {
      const tracker = speedTrackerRef.current;
      const elapsedMs = Math.max(1, now - tracker.lastAt);
      const deltaBytes = Math.max(0, downloadedBytes - tracker.lastBytes);
      const instantSpeed = (deltaBytes * 1000) / elapsedMs;
      const lifetimeMs = Math.max(1, now - (tracker.startedAt || now));
      const averageSpeed = (downloadedBytes * 1000) / lifetimeMs;
      const blended = instantSpeed > 0 ? instantSpeed * 0.6 + averageSpeed * 0.4 : averageSpeed;
      const prevSpeed = prev.speedBytesPerSec ?? blended;
      const smoothedSpeed = prevSpeed * 0.7 + blended * 0.3;
      const etaSeconds =
        effectiveTotalBytes && smoothedSpeed > 0 && downloadedBytes < effectiveTotalBytes
          ? Math.max(0, (effectiveTotalBytes - downloadedBytes) / smoothedSpeed)
          : null;

      speedTrackerRef.current = {
        startedAt: tracker.startedAt || now,
        lastAt: now,
        lastBytes: downloadedBytes,
      };
      return {
        downloadedBytes,
        totalBytes: effectiveTotalBytes,
        speedBytesPerSec: smoothedSpeed,
        etaSeconds,
      };
    });
  }, []);

  const handleInstall = useCallback(async (options?: { background?: boolean }) => {
    if (installInFlightRef.current) return;
    installInFlightRef.current = true;
    const runInBackground = Boolean(options?.background);
    setState('downloading');
    setErrorText('');
    setBackgroundMode(runInBackground);
    setDismissed(runInBackground);
    resetSpeedTracking();
    setProgress({ downloadedBytes: 0, totalBytes: undefined, speedBytesPerSec: 0, etaSeconds: null });
    emitUpdaterStatus(
      'downloading',
      runInBackground ? 'Downloading update in background...' : 'Downloading update...',
    );

    try {
      if (window.electronAPI) {
        const unsubscribe =
          window.electronAPI.onDownloadProgress?.((percent) => {
            if (typeof percent === 'number' && Number.isFinite(percent)) {
              applyProgressSample(Math.max(0, Math.round(percent)), 100);
            }
          }) ?? (() => {});
        await window.electronAPI.downloadAndInstall();
        unsubscribe();
      } else {
        const update = updateRef.current;
        if (!update) {
          setState('idle');
          return;
        }
        let downloaded = 0;
        await update.downloadAndInstall((event: TauriDownloadEvent) => {
          if (event.event === 'Started') {
            resetSpeedTracking();
            applyProgressSample(0, event.data.contentLength);
          } else if (event.event === 'Progress') {
            downloaded += event.data.chunkLength;
            applyProgressSample(downloaded);
          }
        });
      }

      setState('downloaded');
      setBackgroundMode(runInBackground);
      setDismissed(runInBackground);
      emitUpdaterStatus('downloaded', 'Update installed. Restart app to apply.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to install update.';
      setState('error');
      setErrorText(message);
      setBackgroundMode(false);
      setDismissed(false);
      emitUpdaterStatus('error', message);
    } finally {
      installInFlightRef.current = false;
    }
  }, [applyProgressSample, resetSpeedTracking]);

  const startInstallFromDetails = useCallback(
    async (snapshot: UpdateDetails | null) => {
      if (!snapshot) return;
      if (snapshot.fallbackOnly) {
        if (installInFlightRef.current) return;
        if (!snapshot.manualDownloadUrl) {
          const message = 'No installer asset found for this release.';
          setState('error');
          setErrorText(message);
          emitUpdaterStatus('error', message);
          return;
        }
        installInFlightRef.current = true;
        setDetails(snapshot);
        setState('downloading');
        setErrorText('');
        setDismissed(false);
        setBackgroundMode(false);
        resetSpeedTracking();
        setProgress({ downloadedBytes: 0, totalBytes: undefined, speedBytesPerSec: 0, etaSeconds: null });
        emitUpdaterStatus('downloading', 'Downloading and installing update...');
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          await invoke('download_and_install_release', { url: snapshot.manualDownloadUrl });
        } catch (error) {
          const message = normalizeInvokeError(error, 'Failed to download and install update.');
          setState('error');
          setErrorText(message);
          emitUpdaterStatus('error', message);
          installInFlightRef.current = false;
        }
        return;
      }
      await handleInstall();
    },
    [handleInstall, resetSpeedTracking],
  );

  const handleRestart = useCallback(async () => {
    try {
      if (window.electronAPI) {
        window.location.reload();
        return;
      }
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('restart_app');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to restart app.';
      setState('error');
      setErrorText(message);
      emitUpdaterStatus('error', message);
    }
  }, []);

  const checkForUpdates = useCallback(async (channelOverride?: UpdateChannel, installIfAvailable = false) => {
    if (!isDesktopRuntime() || isCheckingRef.current) return;
    const selectedChannel = channelOverride ?? readStoredUpdateChannel();
    isCheckingRef.current = true;
    setState('checking');
    setErrorText('');
    emitUpdaterStatus('checking');

    try {
      if (window.electronAPI) {
        const result = await window.electronAPI.checkForUpdate();
        if (!result) {
          setState('idle');
          emitUpdaterStatus('none', 'You are on the latest version.');
          return;
        }
        updateRef.current = null;
        setDetails({ version: result.version, channel: selectedChannel });
        setDismissed(false);
        setBackgroundMode(false);
        setState('available');
        emitUpdaterStatus('available', `Update ${result.version} is available.`);
        if (installIfAvailable) {
          await startInstallFromDetails({ version: result.version, channel: selectedChannel });
        }
        return;
      }

      const updaterModule = (await import('@tauri-apps/plugin-updater')) as {
        check: () => Promise<any>;
      };

      const tauriVersion = await getCurrentAppVersion();
      const currentVersion = resolveCurrentVersion(tauriVersion);
      const canUseNativeUpdater = selectedChannel === 'stable';
      const update = canUseNativeUpdater ? await updaterModule.check() : null;
      if (!update) {
        const manifest = await fetchManifestVersion(selectedChannel);
        if (installIfAvailable && manifest) {
          const updateSnapshot = {
            version: String(manifest.version),
            notes: manifest.notes,
            currentVersion: currentVersion ?? undefined,
            manualDownloadUrl: manifest.downloadUrl,
            fallbackOnly: true,
            channel: selectedChannel,
          } satisfies UpdateDetails;
          setDetails(updateSnapshot);
          setDismissed(false);
          setBackgroundMode(false);
          setState('available');
          emitUpdaterStatus(
            'available',
            `${selectedChannel[0].toUpperCase()}${selectedChannel.slice(1)} build ${manifest.version} selected.`,
          );
          await startInstallFromDetails(updateSnapshot);
          return;
        }
        const hasNewerManifest =
          manifest &&
          isRemoteNewerForSelectedChannel(currentVersion, String(manifest.version), selectedChannel);

        if (hasNewerManifest) {
          setDismissed(false);
          setBackgroundMode(false);
          setState('available');
          const updateSnapshot = {
            version: String(manifest.version),
            notes: manifest.notes,
            currentVersion: currentVersion ?? undefined,
            manualDownloadUrl: manifest.downloadUrl,
            fallbackOnly: true,
            channel: selectedChannel,
          } satisfies UpdateDetails;
          setDetails(updateSnapshot);
          emitUpdaterStatus(
            'available',
            `${selectedChannel[0].toUpperCase()}${selectedChannel.slice(1)} update ${manifest.version} is available (current ${currentVersion}).`,
          );
          if (installIfAvailable) {
            await startInstallFromDetails(updateSnapshot);
          }
          return;
        }

        setState('idle');
        emitUpdaterStatus(
          'none',
          currentVersion
            ? `You are on the latest version (${currentVersion}).`
            : 'You are on the latest version.',
        );
        return;
      }

      updateRef.current = update;
      const version = String(update.version ?? update.versionName ?? 'latest');
      const notes = typeof update.body === 'string' ? update.body : undefined;
      const updateSnapshot = {
        version,
        notes,
        currentVersion: currentVersion ?? undefined,
        fallbackOnly: false,
        channel: selectedChannel,
      } satisfies UpdateDetails;
      setDetails(updateSnapshot);
      setDismissed(false);
      setBackgroundMode(false);
      setState('available');
      emitUpdaterStatus('available', `Update ${version} is available.`);
      if (installIfAvailable) {
        await startInstallFromDetails(updateSnapshot);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to check for updates.';
      setState('error');
      setErrorText(message);
      emitUpdaterStatus('error', message);
    } finally {
      isCheckingRef.current = false;
    }
  }, [startInstallFromDetails]);

  useEffect(() => {
    void checkForUpdates();
  }, [checkForUpdates]);

  useEffect(() => {
    const wrapped = (event: Event) => {
      const detail = (event as CustomEvent<{ channel?: UpdateChannel }>).detail;
      void checkForUpdates(detail?.channel);
    };
    window.addEventListener(UPDATE_CHECK_EVENT, wrapped as EventListener);
    return () => window.removeEventListener(UPDATE_CHECK_EVENT, wrapped as EventListener);
  }, [checkForUpdates]);

  useEffect(() => {
    const wrapped = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          channel?: UpdateChannel;
          version?: string;
          notes?: string;
          manualDownloadUrl?: string;
          fallbackOnly?: boolean;
        }>
      ).detail;
      const requestedChannel = detail?.channel ?? readStoredUpdateChannel();
      if (detail?.manualDownloadUrl && detail?.version) {
        void startInstallFromDetails({
          version: detail.version,
          notes: detail.notes,
          manualDownloadUrl: detail.manualDownloadUrl,
          fallbackOnly: detail.fallbackOnly ?? true,
          channel: requestedChannel,
        });
        return;
      }
      if (state === 'available' && details && details.channel === requestedChannel) {
        void startInstallFromDetails(details);
        return;
      }
      void checkForUpdates(requestedChannel, true);
    };
    window.addEventListener(UPDATE_INSTALL_EVENT, wrapped as EventListener);
    return () => window.removeEventListener(UPDATE_INSTALL_EVENT, wrapped as EventListener);
  }, [checkForUpdates, details, startInstallFromDetails, state]);

  useEffect(() => {
    if (!isDesktopRuntime()) return;
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    const onDirectInstallProgress = (detail: DirectInstallProgressEvent) => {
      const status = String(detail.status || '');
      const downloaded = Number(detail.downloaded_bytes || 0);
      const total =
        typeof detail.total_bytes === 'number' && Number.isFinite(detail.total_bytes)
          ? detail.total_bytes
          : undefined;
      if (status === 'started') {
        resetSpeedTracking();
        setState('downloading');
        setDismissed(false);
        setBackgroundMode(false);
        applyProgressSample(0, total);
        return;
      }
      if (status === 'progress') {
        applyProgressSample(Math.max(0, downloaded), total);
        return;
      }
      if (status === 'finished') {
        applyProgressSample(Math.max(0, downloaded), total);
        setState('handoff');
        installInFlightRef.current = false;
        emitUpdaterStatus('downloaded', detail.message || 'Installer launched. Finish setup to complete update.');
        return;
      }
      if (status === 'error') {
        setState('error');
        setErrorText(detail.message || 'Update installer failed.');
        installInFlightRef.current = false;
        emitUpdaterStatus('error', detail.message || 'Update installer failed.');
      }
    };
    void listenToDirectInstallProgress(onDirectInstallProgress).then((off) => {
      if (cancelled) {
        off();
        return;
      }
      unlisten = off;
    });
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, [applyProgressSample, resetSpeedTracking]);

  useEffect(() => {
    if (!isDesktopRuntime()) return;
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    const onSimcRuntimeProgress = (detail: SimcRuntimeProgressEvent) => {
      const status = String(detail.status || '');
      const channel = detail.channel || 'weekly';
      const downloadedBytes = Number(detail.downloaded_bytes || 0);
      const totalBytes =
        typeof detail.total_bytes === 'number' && Number.isFinite(detail.total_bytes)
          ? detail.total_bytes
          : undefined;
      const elapsedMs = Number(detail.elapsed_ms || 0);
      const speedBytesPerSec = Number(detail.speed_bytes_per_sec || 0);
      const etaSeconds =
        typeof detail.eta_seconds === 'number' && Number.isFinite(detail.eta_seconds)
          ? detail.eta_seconds
          : null;

      if (status === 'started') {
        setSimcState('checking');
        setSimcDismissed(false);
        setSimcDetails(detail.message || `Checking ${channel} SimC runtime...`);
        setSimcErrorText('');
        setSimcProgress({
          channel,
          downloadedBytes: 0,
          totalBytes: undefined,
          elapsedSeconds: 0,
          speedBytesPerSec: 0,
          etaSeconds: null,
        });
        return;
      }

      if (status === 'progress') {
        setSimcState('downloading');
        setSimcDismissed(false);
        setSimcDetails(`Downloading ${channel} SimC runtime...`);
        setSimcErrorText('');
        setSimcProgress({
          channel,
          downloadedBytes,
          totalBytes,
          elapsedSeconds: Number.isFinite(elapsedMs) ? elapsedMs / 1000 : 0,
          speedBytesPerSec: Number.isFinite(speedBytesPerSec) ? speedBytesPerSec : 0,
          etaSeconds,
        });
        return;
      }

      if (status === 'finished') {
        setSimcState('downloaded');
        setSimcDismissed(false);
        setSimcDetails(
          detail.message ||
            (detail.updated
              ? `SimC ${channel} runtime downloaded.`
              : `SimC ${channel} runtime is already up to date.`),
        );
        setSimcErrorText('');
        return;
      }

      if (status === 'error') {
        setSimcState('error');
        setSimcDismissed(false);
        setSimcErrorText(detail.message || 'Failed to update SimC runtime.');
      }
    };

    void listenToSimcRuntimeProgress(onSimcRuntimeProgress).then((off) => {
      if (cancelled) {
        off();
        return;
      }
      unlisten = off;
    });
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, []);

  useEffect(() => {
    const onCacheRefreshStart = () => {
      setCacheState('checking');
      setCacheDetails('Preparing cache refresh...');
      setCacheErrorText('');
      setCacheBackgroundMode(true);
      setDismissed(true);
      setCacheProgress({
        current: 0,
        total: 0,
        details: '',
        downloadedBytes: 0,
        totalBytes: 0,
        elapsedSeconds: 0,
        speedBytesPerSec: 0,
      });
    };

    const onCacheRefreshStatus = (event: Event) => {
      const detail = (
        event as CustomEvent<{ status?: string; progress?: string; message?: string }>
      ).detail;
      const status = detail?.status || '';
      const message = detail?.message || '';
      const progressText = detail?.progress || '';

      if (status === 'downloading' || status === 'checking' || status === 'syncing') {
        setCacheState('downloading');
        setCacheDetails(message || progressText || 'Refreshing game data cache...');
        setCacheErrorText('');

        const parts = progressText.split(':');
        if (parts.length >= 4) {
          const current = parseInt(parts[1], 10);
          const total = parseInt(parts[2], 10);
          const downloadedBytes = Number(parts[4] || 0);
          const totalBytes = Number(parts[5] || 0);
          const elapsedMs = Number(parts[6] || 0);
          const speedBytesPerSec = Number(parts[7] || 0);
          if (Number.isFinite(current) && Number.isFinite(total)) {
            setCacheProgress({
              current,
              total,
              details: parts[3] || '',
              downloadedBytes: Number.isFinite(downloadedBytes) ? downloadedBytes : 0,
              totalBytes: Number.isFinite(totalBytes) ? totalBytes : 0,
              elapsedSeconds: Number.isFinite(elapsedMs) ? elapsedMs / 1000 : 0,
              speedBytesPerSec: Number.isFinite(speedBytesPerSec) ? speedBytesPerSec : 0,
            });
          }
        }
        return;
      }

      if (status === 'available' || status === 'ready' || status === 'done') {
        setCacheState('downloaded');
        setCacheDetails(message || 'Game data cache refreshed.');
        setCacheErrorText('');
        return;
      }

      if (status === 'error' || status.startsWith('error:') || status === 'needs_credentials') {
        setCacheState('error');
        const normalizedError = status.startsWith('error:') ? status.replace(/^error:/, '') : '';
        setCacheErrorText(
          message ||
            normalizedError ||
            (status === 'needs_credentials'
              ? 'Blizzard credentials are required to refresh cache.'
              : 'Failed to refresh game data cache.')
        );
      }
    };

    window.addEventListener(CACHE_REFRESH_CHECK_EVENT, onCacheRefreshStart as EventListener);
    window.addEventListener(CACHE_REFRESH_STATUS_EVENT, onCacheRefreshStatus as EventListener);
    return () => {
      window.removeEventListener(CACHE_REFRESH_CHECK_EVENT, onCacheRefreshStart as EventListener);
      window.removeEventListener(CACHE_REFRESH_STATUS_EVENT, onCacheRefreshStatus as EventListener);
    };
  }, []);


  return (
    <>
      {isUpdateToastVisible && (
        <div className="fixed bottom-4 right-4 z-[86] w-80 rounded-lg border border-border bg-surface px-4 py-3 shadow-xl">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-white">
                {state === 'error' ? 'Update Failed' : state === 'downloaded' ? 'Update Ready' : 'App Update'}
              </p>
              {details && (
                <p className="mt-1 text-xs text-zinc-300">
                  {details.channel ? `${details.channel[0].toUpperCase()}${details.channel.slice(1)} ` : ''}
                  version <span className="font-semibold text-gold">{details.version}</span> is available.
                </p>
              )}
            </div>
            {state !== 'downloading' && (
              <button
                onClick={() => setDismissed(true)}
                className="rounded-md px-2 py-1 text-zinc-400 transition-colors hover:bg-surface-2 hover:text-zinc-200"
                aria-label="Dismiss update prompt"
              >
                x
              </button>
            )}
          </div>

          {details?.notes && state === 'available' && (
            <p className="mt-2 max-h-20 overflow-auto rounded-md border border-border bg-surface-2 p-2 text-xs text-zinc-300">
              {details.notes}
            </p>
          )}

          {state === 'downloading' && (
            <div className="mt-3 space-y-2">
              <p className="text-xs text-zinc-300">
                Downloading update{progressPercent != null ? `... ${progressPercent}%` : '...'}
              </p>
              <p className="text-[11px] text-zinc-500">
                Speed: {formatTransferSpeed(progress.speedBytesPerSec)} | ETA: {formatEta(progress.etaSeconds)}
              </p>
              <p className="text-[11px] text-zinc-500">
                {formatBytesDecimal(progress.downloadedBytes)} / {formatBytesDecimal(progress.totalBytes)}
              </p>
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                {progressPercent != null ? (
                  <div
                    className="h-full bg-gold transition-all duration-200"
                    style={{ width: `${progressPercent}%` }}
                  />
                ) : (
                  <div className="h-full w-1/3 animate-pulse bg-gold" />
                )}
              </div>
            </div>
          )}

          {state === 'downloaded' && (
            <p className="mt-2 text-xs text-emerald-300">
              Update installed. Restart the app to apply it.
            </p>
          )}

          {state === 'handoff' && (
            <p className="mt-2 text-xs text-emerald-300">
              Installer launched. Complete setup, then open WhyLowDps again.
            </p>
          )}

          {state === 'error' && (
            <p className="mt-2 text-xs text-red-300">
              {errorText || 'Could not complete the update. Please try again later.'}
            </p>
          )}

          <div className="mt-3 flex justify-end gap-2">
            {state === 'available' && (
              <>
                <button onClick={() => setDismissed(true)} className="btn-outline px-3 py-1.5 text-xs">
                  Later
                </button>
                <button
                  onClick={() => void startInstallFromDetails(details)}
                  className="btn-primary px-3 py-1.5 text-xs"
                >
                  Download & Install
                </button>
              </>
            )}

            {state === 'downloading' && (
              <button
                onClick={() => {
                  setBackgroundMode(true);
                  setDismissed(true);
                }}
                className="btn-outline px-3 py-1.5 text-xs"
              >
                Run in Background
              </button>
            )}

            {state === 'downloaded' && (
              <>
                <button onClick={() => setDismissed(true)} className="btn-outline px-3 py-1.5 text-xs">
                  Later
                </button>
                <button onClick={() => void handleRestart()} className="btn-primary px-3 py-1.5 text-xs">
                  Restart App
                </button>
              </>
            )}

            {state === 'handoff' && (
              <button onClick={() => setDismissed(true)} className="btn-outline px-3 py-1.5 text-xs">
                Close
              </button>
            )}

            {state === 'error' && (
              <button onClick={() => setDismissed(true)} className="btn-outline px-3 py-1.5 text-xs">
                Close
              </button>
            )}
          </div>
        </div>
      )}

      {backgroundMode && state === 'downloading' && (
        <div className="fixed bottom-4 right-4 z-[85] w-72 rounded-lg border border-border bg-surface px-4 py-3 shadow-xl">
          <p className="text-sm font-semibold text-white">Downloading update</p>
          <p className="mt-1 text-xs text-zinc-400">
            {progressPercent != null ? `${progressPercent}% complete` : 'Running in background...'}
          </p>
          <p className="mt-1 text-[11px] text-zinc-500">
            {formatTransferSpeed(progress.speedBytesPerSec)} | ETA {formatEta(progress.etaSeconds)}
          </p>
          <p className="mt-1 text-[11px] text-zinc-500">
            {formatBytesDecimal(progress.downloadedBytes)} / {formatBytesDecimal(progress.totalBytes)}
          </p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
            {progressPercent != null ? (
              <div
                className="h-full bg-gold transition-all duration-200"
                style={{ width: `${progressPercent}%` }}
              />
            ) : (
              <div className="h-full w-1/3 animate-pulse bg-gold" />
            )}
          </div>
          <button
            onClick={() => {
              setBackgroundMode(false);
              setDismissed(false);
            }}
            className="mt-3 rounded-md border border-white/10 px-3 py-1.5 text-xs text-zinc-200 hover:bg-white/[0.06]"
          >
            Open Updater
          </button>
        </div>
      )}

      {backgroundMode && state === 'downloaded' && (
        <div className="fixed bottom-4 right-4 z-[85] w-80 rounded-lg border border-emerald-500/20 bg-surface px-4 py-3 shadow-xl">
          <p className="text-sm font-semibold text-white">Update Ready</p>
          <p className="mt-1 text-xs text-zinc-300">
            The update installed in the background. Restart the app to apply it.
          </p>
          <div className="mt-3 flex justify-end gap-2">
            <button
              onClick={() => {
                setBackgroundMode(false);
                setDismissed(true);
              }}
              className="rounded-md border border-white/10 px-3 py-1.5 text-xs text-zinc-200 hover:bg-white/[0.06]"
            >
              Later
            </button>
            <button onClick={() => void handleRestart()} className="btn-primary px-3 py-1.5 text-xs">
              Restart App
            </button>
          </div>
        </div>
      )}

      {backgroundMode && state === 'handoff' && (
        <div className="fixed bottom-4 right-4 z-[85] w-80 rounded-lg border border-emerald-500/20 bg-surface px-4 py-3 shadow-xl">
          <p className="text-sm font-semibold text-white">Installer Launched</p>
          <p className="mt-1 text-xs text-zinc-300">
            Finish setup, then reopen WhyLowDps.
          </p>
          <div className="mt-3 flex justify-end gap-2">
            <button
              onClick={() => {
                setBackgroundMode(false);
                setDismissed(true);
              }}
              className="rounded-md border border-white/10 px-3 py-1.5 text-xs text-zinc-200 hover:bg-white/[0.06]"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {!simcDismissed && simcState !== 'idle' && (
        <div className="fixed bottom-4 right-4 z-[84] w-80 rounded-lg border border-border bg-surface px-4 py-3 shadow-xl">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-white">
                {simcState === 'error'
                  ? 'SimC Download Failed'
                  : simcState === 'downloaded'
                    ? 'SimC Runtime Ready'
                    : 'SimC Runtime'}
              </p>
              <p className="mt-1 text-xs text-zinc-300">
                {simcDetails || `Preparing ${simcProgress.channel} SimC runtime...`}
              </p>
            </div>
            {simcState !== 'downloading' && simcState !== 'checking' && (
              <button
                onClick={() => setSimcDismissed(true)}
                className="rounded-md px-2 py-1 text-zinc-400 transition-colors hover:bg-surface-2 hover:text-zinc-200"
                aria-label="Dismiss SimC runtime prompt"
              >
                x
              </button>
            )}
          </div>

          {(simcState === 'checking' || simcState === 'downloading') && (
            <div className="mt-3 space-y-2">
              <p className="text-xs text-zinc-300">
                {simcState === 'checking'
                  ? 'Checking runtime...'
                  : `Downloading runtime${simcProgressPercent != null ? `... ${simcProgressPercent}%` : '...'}`}
              </p>
              <p className="text-[11px] text-zinc-500">
                Speed: {formatTransferSpeed(simcProgress.speedBytesPerSec)} | ETA:{' '}
                {formatEta(simcProgress.etaSeconds)}
              </p>
              <p className="text-[11px] text-zinc-500">
                Duration: {formatElapsedCompact(simcProgress.elapsedSeconds)}
              </p>
              {simcProgress.downloadedBytes > 0 || simcProgress.totalBytes ? (
                <p className="text-[11px] text-zinc-500">
                  {formatBytesDecimal(simcProgress.downloadedBytes)} /{' '}
                  {formatBytesDecimal(simcProgress.totalBytes)}
                </p>
              ) : null}
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                {simcProgressPercent != null ? (
                  <div
                    className="h-full bg-gold transition-all duration-200"
                    style={{ width: `${simcProgressPercent}%` }}
                  />
                ) : (
                  <div className="h-full w-1/3 animate-pulse bg-gold" />
                )}
              </div>
            </div>
          )}

          {simcState === 'downloaded' && (
            <p className="mt-2 text-xs text-emerald-300">
              {simcDetails || 'SimC runtime is ready.'}
            </p>
          )}

          {simcState === 'error' && (
            <p className="mt-2 text-xs text-red-300">
              {simcErrorText || 'Could not update the SimC runtime.'}
            </p>
          )}

          <div className="mt-3 flex justify-end">
            {simcState === 'downloading' || simcState === 'checking' ? (
              <button
                onClick={() => setSimcDismissed(true)}
                className="btn-outline px-3 py-1.5 text-xs"
              >
                Run in Background
              </button>
            ) : (
              <button
                onClick={() => setSimcDismissed(true)}
                className="btn-outline px-3 py-1.5 text-xs"
              >
                Close
              </button>
            )}
          </div>
        </div>
      )}

      {cacheBackgroundMode && cacheState === 'downloading' && (
        <div className="fixed bottom-4 right-4 z-[85] w-72 rounded-lg border border-border bg-surface px-4 py-3 shadow-xl">
          <p className="text-sm font-semibold text-white">Refreshing game data cache</p>
          <p className="mt-1 text-xs text-zinc-400">
            {cacheProgressPercent != null
              ? `${cacheProgressPercent}% complete`
              : cacheDetails || 'Running in background...'}
          </p>
          {cacheProgress.details && (
            <p className="mt-1 truncate text-[11px] text-zinc-500">{cacheProgress.details}</p>
          )}
          {cacheProgress.totalBytes > 0 && (
            <>
              <p className="mt-1 text-[11px] text-zinc-500">
                {formatBytesDecimal(cacheProgress.downloadedBytes)} /{' '}
                {formatBytesDecimal(cacheProgress.totalBytes)}
                {cacheFileProgressPercent != null ? ` (${cacheFileProgressPercent}%)` : ''}
              </p>
              <p className="mt-1 text-[11px] text-zinc-500">
                {formatTransferSpeed(cacheProgress.speedBytesPerSec)} |{' '}
                {formatElapsedCompact(cacheProgress.elapsedSeconds)}
              </p>
            </>
          )}
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
            {cacheProgressPercent != null ? (
              <div
                className="h-full bg-gold transition-all duration-200"
                style={{ width: `${cacheProgressPercent}%` }}
              />
            ) : (
              <div className="h-full w-1/3 animate-pulse bg-gold" />
            )}
          </div>
          <button
            onClick={() => {
              setCacheBackgroundMode(false);
              setCacheState('idle');
            }}
            className="mt-3 rounded-md border border-white/10 px-3 py-1.5 text-xs text-zinc-200 hover:bg-white/[0.06]"
          >
            Dismiss
          </button>
        </div>
      )}

      {cacheBackgroundMode && cacheState === 'downloaded' && (
        <div className="fixed bottom-4 right-4 z-[85] w-72 rounded-lg border border-emerald-500/20 bg-surface px-4 py-3 shadow-xl">
          <p className="text-sm font-semibold text-white">Game data cache refreshed</p>
          <p className="mt-1 text-xs text-zinc-400">
            {cacheDetails || 'Refresh completed successfully.'}
          </p>
          <button
            onClick={() => {
              setCacheBackgroundMode(false);
              setCacheState('idle');
            }}
            className="mt-3 rounded-md border border-white/10 px-3 py-1.5 text-xs text-zinc-200 hover:bg-white/[0.06]"
          >
            Close
          </button>
        </div>
      )}

      {cacheBackgroundMode && cacheState === 'error' && (
        <div className="fixed bottom-4 right-4 z-[85] w-72 rounded-lg border border-red-500/20 bg-surface px-4 py-3 shadow-xl">
          <p className="text-sm font-semibold text-white">Cache refresh failed</p>
          <p className="mt-1 text-xs text-zinc-400">
            {cacheErrorText || 'Could not complete the cache refresh.'}
          </p>
          <button
            onClick={() => {
              setCacheBackgroundMode(false);
              setCacheState('idle');
            }}
            className="mt-3 rounded-md border border-white/10 px-3 py-1.5 text-xs text-zinc-200 hover:bg-white/[0.06]"
          >
            Close
          </button>
        </div>
      )}

    </>
  );
}
