'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type UpdateState = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error';
type UpdaterStatusEvent = 'checking' | 'available' | 'none' | 'error' | 'downloading' | 'downloaded';

type UpdateDetails = {
  version: string;
  notes?: string;
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

function isDesktopRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.electronAPI) return true;
  const hasTauriInternals = Boolean((window as unknown as Record<string, unknown>).__TAURI_INTERNALS__);
  return process.env.NEXT_PUBLIC_DESKTOP_BUILD === 'true' || hasTauriInternals;
}

function emitUpdaterStatus(status: UpdaterStatusEvent, message?: string) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(UPDATE_STATUS_EVENT, { detail: { status, message } }));
}

export default function UpdatePrompt() {
  const [state, setState] = useState<UpdateState>('idle');
  const [details, setDetails] = useState<UpdateDetails | null>(null);
  const [errorText, setErrorText] = useState<string>('');
  const [dismissed, setDismissed] = useState(false);
  const [backgroundMode, setBackgroundMode] = useState(false);
  const [progress, setProgress] = useState<DownloadProgress>({ downloadedBytes: 0 });
  const updateRef = useRef<any>(null);
  const isCheckingRef = useRef(false);

  const isModalVisible = useMemo(() => {
    if (backgroundMode && state === 'downloading') return false;
    if (dismissed && state !== 'downloading') return false;
    return state === 'available' || state === 'downloading' || state === 'downloaded' || state === 'error';
  }, [backgroundMode, dismissed, state]);

  const progressPercent = useMemo(() => {
    if (!progress.totalBytes || progress.totalBytes <= 0) return null;
    return Math.min(100, Math.round((progress.downloadedBytes / progress.totalBytes) * 100));
  }, [progress]);

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

      const update = await updaterModule.check();
      if (!update) {
        setState('idle');
        emitUpdaterStatus('none', 'You are on the latest version.');
        return;
      }

      updateRef.current = update;
      const version = String(update.version ?? update.versionName ?? 'latest');
      const notes = typeof update.body === 'string' ? update.body : undefined;
      setDetails({ version, notes });
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
                  {details
                    ? (
                      <>
                        Version <span className="font-semibold text-gold">{details.version}</span> is ready.
                      </>
                    )
                    : 'Could not check updates automatically.'}
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
                  <button onClick={() => setDismissed(true)} className="btn-outline px-4 py-2 text-sm">
                    Later
                  </button>
                  <button onClick={handleInstall} className="btn-primary px-4 py-2 text-sm">
                    Update Now
                  </button>
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
                <button onClick={() => setDismissed(true)} className="btn-outline px-4 py-2 text-sm">
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
              <div className="h-full bg-gold transition-all duration-200" style={{ width: `${progressPercent}%` }} />
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
    </>
  );
}

