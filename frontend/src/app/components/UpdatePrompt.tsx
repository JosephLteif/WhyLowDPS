'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { APP_VERSION } from '../lib/version';

type UpdateState = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error';
type CacheRefreshState = 'idle' | 'checking' | 'downloading' | 'downloaded' | 'error';
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
};

type DownloadProgress = {
  downloadedBytes: number;
  totalBytes?: number;
};

type TauriDownloadEvent =
  | { event: 'Started'; data: { contentLength?: number } }
  | { event: 'Progress'; data: { chunkLength: number } }
  | { event: 'Finished' };

const UPDATE_CHECK_EVENT = 'whylowdps-updater-check';
const UPDATE_STATUS_EVENT = 'whylowdps-updater-status';
const CACHE_REFRESH_CHECK_EVENT = 'whylowdps-cache-refresh-start';
const CACHE_REFRESH_STATUS_EVENT = 'whylowdps-cache-refresh-status';
const UPDATER_MANIFEST_URL =
  'https://github.com/JosephLteif/simcraft/releases/latest/download/latest.json';
const GITHUB_RELEASES_LATEST_API =
  'https://api.github.com/repos/JosephLteif/simcraft/releases/latest';

function isDesktopRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.electronAPI) return true;
  const hasTauriInternals = Boolean(
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
  );
  return process.env.NEXT_PUBLIC_DESKTOP_BUILD === 'true' || hasTauriInternals;
}

function emitUpdaterStatus(status: UpdaterStatusEvent, message?: string) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(UPDATE_STATUS_EVENT, { detail: { status, message } }));
}

function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/i, '');
}

function compareVersions(a: string, b: string): number | null {
  const parse = (value: string) => {
    const parts = normalizeVersion(value)
      .split('.')
      .map((part) => Number.parseInt(part, 10));
    if (parts.some((part) => Number.isNaN(part))) return null;
    return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
  };
  const left = parse(a);
  const right = parse(b);
  if (!left || !right) return null;

  for (let i = 0; i < 3; i += 1) {
    if (left[i] < right[i]) return -1;
    if (left[i] > right[i]) return 1;
  }
  return 0;
}

function resolveCurrentVersion(tauriVersion: string | null): string | null {
  const frontendVersion = APP_VERSION || null;
  if (!tauriVersion) return frontendVersion;
  if (!frontendVersion) return tauriVersion;

  const comparison = compareVersions(frontendVersion, tauriVersion);
  if (comparison === null) return tauriVersion;
  if (comparison === 0) return tauriVersion;

  // If the two sources drift, prefer the lower one to avoid false "latest" reports.
  return comparison === -1 ? frontendVersion : tauriVersion;
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

type RemoteReleaseInfo = {
  version: string;
  notes?: string;
  downloadUrl?: string;
};

async function fetchManifestVersionFromLatestJson(): Promise<RemoteReleaseInfo | null> {
  try {
    const response = await fetch(UPDATER_MANIFEST_URL, { cache: 'no-store' });
    if (!response.ok) return null;
    const raw = await response.text();
    let payload: {
      version?: unknown;
      notes?: unknown;
      platforms?: Record<string, { url?: unknown }>;
    };
    try {
      payload = JSON.parse(raw);
    } catch {
      return null;
    }

    const version = typeof payload.version === 'string' ? payload.version : '';
    if (!version) return null;

    const platforms = payload.platforms || {};
    const preferredKeys = ['windows-x86_64', 'windows-x86_64-nsis'];
    const preferredUrl =
      preferredKeys
        .map((key) => platforms[key]?.url)
        .find((url) => typeof url === 'string' && url.length > 0) ||
      Object.values(platforms)
        .map((platform) => platform?.url)
        .find((url) => typeof url === 'string' && url.length > 0);

    return {
      version,
      notes: typeof payload.notes === 'string' ? payload.notes : undefined,
      downloadUrl: typeof preferredUrl === 'string' ? preferredUrl : undefined,
    };
  } catch {
    return null;
  }
}

async function fetchManifestVersionFromGitHubApi(): Promise<RemoteReleaseInfo | null> {
  try {
    const response = await fetch(GITHUB_RELEASES_LATEST_API, {
      cache: 'no-store',
      headers: {
        Accept: 'application/vnd.github+json',
      },
    });
    if (!response.ok) return null;

    const payload = (await response.json()) as {
      tag_name?: unknown;
      name?: unknown;
      body?: unknown;
      assets?: Array<{ browser_download_url?: unknown; name?: unknown }>;
    };

    const versionRaw =
      typeof payload.tag_name === 'string'
        ? payload.tag_name
        : typeof payload.name === 'string'
          ? payload.name
          : '';
    const version = normalizeVersion(versionRaw);
    if (!version) return null;

    const assetUrls = (payload.assets || [])
      .map((asset) => (typeof asset.browser_download_url === 'string' ? asset.browser_download_url : ''))
      .filter((url) => url.length > 0);
    const preferredUrl =
      assetUrls.find((url) => /windows|x64|setup|nsis/i.test(url)) || assetUrls[0];

    return {
      version,
      notes: typeof payload.body === 'string' ? payload.body : undefined,
      downloadUrl: preferredUrl,
    };
  } catch {
    return null;
  }
}

async function fetchManifestVersion(): Promise<RemoteReleaseInfo | null> {
  const fromLatestJson = await fetchManifestVersionFromLatestJson();
  if (fromLatestJson) return fromLatestJson;
  return fetchManifestVersionFromGitHubApi();
}

export default function UpdatePrompt() {
  const [state, setState] = useState<UpdateState>('idle');
  const [cacheState, setCacheState] = useState<CacheRefreshState>('idle');
  const [details, setDetails] = useState<UpdateDetails | null>(null);
  const [cacheDetails, setCacheDetails] = useState<string>('');
  const [errorText, setErrorText] = useState<string>('');
  const [cacheErrorText, setCacheErrorText] = useState<string>('');
  const [dismissed, setDismissed] = useState(false);
  const [backgroundMode, setBackgroundMode] = useState(false);
  const [cacheBackgroundMode, setCacheBackgroundMode] = useState(false);
  const [progress, setProgress] = useState<DownloadProgress>({ downloadedBytes: 0 });
  const [cacheProgress, setCacheProgress] = useState<{ current: number; total: number }>({
    current: 0,
    total: 0,
  });
  const updateRef = useRef<any>(null);
  const isCheckingRef = useRef(false);

  const isModalVisible = useMemo(() => {
    if (backgroundMode && state === 'downloading') return false;
    if (dismissed && state !== 'downloading') return false;
    return (
      state === 'available' ||
      state === 'downloading' ||
      state === 'downloaded' ||
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

  const checkForUpdates = useCallback(async () => {
    if (!isDesktopRuntime() || isCheckingRef.current) return;
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
        setDetails({ version: result.version });
        setDismissed(false);
        setBackgroundMode(false);
        setState('available');
        emitUpdaterStatus('available', `Update ${result.version} is available.`);
        return;
      }

      const updaterModule = (await import('@tauri-apps/plugin-updater')) as {
        check: () => Promise<any>;
      };

      const tauriVersion = await getCurrentAppVersion();
      const currentVersion = resolveCurrentVersion(tauriVersion);
      const update = await updaterModule.check();
      if (!update) {
        const manifest = await fetchManifestVersion();
        const hasNewerManifest =
          manifest &&
          currentVersion &&
          compareVersions(currentVersion, String(manifest.version)) === -1;

        if (hasNewerManifest) {
          setDetails({
            version: String(manifest.version),
            notes: manifest.notes,
            currentVersion,
            manualDownloadUrl: manifest.downloadUrl,
            fallbackOnly: true,
          });
          setDismissed(false);
          setBackgroundMode(false);
          setState('available');
          emitUpdaterStatus(
            'available',
            `Update ${manifest.version} is available (current ${currentVersion}).`,
          );
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
      setDetails({ version, notes, currentVersion: currentVersion ?? undefined, fallbackOnly: false });
      setDismissed(false);
      setBackgroundMode(false);
      setState('available');
      emitUpdaterStatus('available', `Update ${version} is available.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to check for updates.';
      setState('error');
      setErrorText(message);
      emitUpdaterStatus('error', message);
    } finally {
      isCheckingRef.current = false;
    }
  }, []);

  useEffect(() => {
    void checkForUpdates();
  }, [checkForUpdates]);

  useEffect(() => {
    const onManualCheck = () => {
      void checkForUpdates();
    };
    window.addEventListener(UPDATE_CHECK_EVENT, onManualCheck as EventListener);
    return () => window.removeEventListener(UPDATE_CHECK_EVENT, onManualCheck as EventListener);
  }, [checkForUpdates]);

  useEffect(() => {
    const onCacheRefreshStart = () => {
      setCacheState('checking');
      setCacheDetails('Preparing cache refresh...');
      setCacheErrorText('');
      setCacheBackgroundMode(true);
      setDismissed(true);
      setCacheProgress({ current: 0, total: 0 });
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
          if (Number.isFinite(current) && Number.isFinite(total)) {
            setCacheProgress({ current, total });
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

  async function handleInstall() {
    setState('downloading');
    setErrorText('');
    setBackgroundMode(false);
    setDismissed(false);
    setProgress({ downloadedBytes: 0 });
    emitUpdaterStatus('downloading', 'Downloading update...');

    try {
      if (window.electronAPI) {
        const unsubscribe =
          window.electronAPI.onDownloadProgress?.((percent) => {
            if (typeof percent === 'number' && Number.isFinite(percent)) {
              setProgress({ downloadedBytes: Math.max(0, Math.round(percent)), totalBytes: 100 });
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
            setProgress({ downloadedBytes: 0, totalBytes: event.data.contentLength });
          } else if (event.event === 'Progress') {
            downloaded += event.data.chunkLength;
            setProgress((prev) => ({
              downloadedBytes: downloaded,
              totalBytes: prev.totalBytes,
            }));
          }
        });
      }

      setState('downloaded');
      setBackgroundMode(false);
      emitUpdaterStatus('downloaded', 'Update installed. Restart app to apply.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to install update.';
      setState('error');
      setErrorText(message);
      setBackgroundMode(false);
      emitUpdaterStatus('error', message);
    }
  }

  return (
    <>
      {isModalVisible && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-lg font-semibold text-white">
                  {state === 'error' ? 'Update Check Failed' : 'Update Available'}
                </p>
                <p className="mt-1 text-sm text-zinc-300">
                  {details ? (
                    <>
                      Version <span className="font-semibold text-gold">{details.version}</span> is
                      ready.
                    </>
                  ) : (
                    'Could not check updates automatically.'
                  )}
                </p>
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
              <p className="mt-3 max-h-24 overflow-auto rounded-md border border-border bg-surface-2 p-2 text-xs text-zinc-300">
                {details.notes}
              </p>
            )}

            {state === 'downloading' && (
              <div className="mt-3 space-y-2">
                <p className="text-sm text-zinc-200">
                  Downloading update{progressPercent != null ? `... ${progressPercent}%` : '...'}
                </p>
                <div className="h-2 overflow-hidden rounded-full bg-surface-2">
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
              <p className="mt-3 text-sm text-emerald-300">
                Update installed. Restart the app to apply the new version.
              </p>
            )}

            {state === 'error' && (
              <p className="mt-3 text-sm text-red-300">
                {errorText || 'Could not complete the update. Please try again later.'}
              </p>
            )}

            <div className="mt-4 flex justify-end gap-2">
              {state === 'available' && (
                <>
                  <button
                    onClick={() => setDismissed(true)}
                    className="btn-outline px-4 py-2 text-sm"
                  >
                    Later
                  </button>
                  {details?.fallbackOnly && details.manualDownloadUrl ? (
                    <button
                      onClick={() => window.open(details.manualDownloadUrl, '_blank', 'noopener,noreferrer')}
                      className="btn-primary px-4 py-2 text-sm"
                    >
                      Open Download
                    </button>
                  ) : (
                  <button onClick={handleInstall} className="btn-primary px-4 py-2 text-sm">
                    Update Now
                  </button>
                  )}
                </>
              )}

              {state === 'downloading' && (
                <button
                  onClick={() => {
                    setBackgroundMode(true);
                    setDismissed(true);
                  }}
                  className="btn-outline px-4 py-2 text-sm"
                >
                  Continue in Background
                </button>
              )}

              {(state === 'downloaded' || state === 'error') && (
                <button
                  onClick={() => setDismissed(true)}
                  className="btn-outline px-4 py-2 text-sm"
                >
                  Close
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {backgroundMode && state === 'downloading' && (
        <div className="fixed bottom-4 right-4 z-[85] w-72 rounded-lg border border-border bg-surface px-4 py-3 shadow-xl">
          <p className="text-sm font-semibold text-white">Downloading update</p>
          <p className="mt-1 text-xs text-zinc-400">
            {progressPercent != null ? `${progressPercent}% complete` : 'Running in background...'}
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

      {cacheBackgroundMode && cacheState === 'downloading' && (
        <div className="fixed bottom-4 right-4 z-[85] w-72 rounded-lg border border-border bg-surface px-4 py-3 shadow-xl">
          <p className="text-sm font-semibold text-white">Refreshing game data cache</p>
          <p className="mt-1 text-xs text-zinc-400">
            {cacheProgressPercent != null
              ? `${cacheProgressPercent}% complete`
              : cacheDetails || 'Running in background...'}
          </p>
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
