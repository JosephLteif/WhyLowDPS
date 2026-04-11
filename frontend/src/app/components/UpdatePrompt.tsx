'use client';

import { useEffect, useMemo, useState } from 'react';

type UpdateState = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error';

type UpdateDetails = {
  version: string;
  notes?: string;
};

function isDesktopRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.electronAPI) return true;

  const hasTauriInternals = Boolean((window as unknown as Record<string, unknown>).__TAURI_INTERNALS__);
  return process.env.NEXT_PUBLIC_DESKTOP_BUILD === 'true' || hasTauriInternals;
}

export default function UpdatePrompt() {
  const [state, setState] = useState<UpdateState>('idle');
  const [details, setDetails] = useState<UpdateDetails | null>(null);
  const [errorText, setErrorText] = useState<string>('');
  const [dismissed, setDismissed] = useState(false);

  const shouldRender = useMemo(() => {
    const isVisibleState =
      state === 'available' || state === 'downloading' || state === 'downloaded' || state === 'error';
    if (!isVisibleState) return false;
    if (dismissed && state !== 'downloading') return false;
    return true;
  }, [dismissed, state]);

  useEffect(() => {
    let cancelled = false;

    async function checkForUpdates() {
      if (!isDesktopRuntime()) return;
      setState('checking');

      try {
        if (window.electronAPI) {
          const result = await window.electronAPI.checkForUpdate();
          if (cancelled || !result) {
            setState('idle');
            return;
          }
          setDetails({ version: result.version });
          setState('available');
          return;
        }

        const updaterModule = (await import('@tauri-apps/plugin-updater')) as {
          check: () => Promise<any>;
        };

        const update = await updaterModule.check();
        if (cancelled || !update) {
          setState('idle');
          return;
        }

        const version = String(update.version ?? update.versionName ?? 'latest');
        const notes = typeof update.body === 'string' ? update.body : undefined;
        setDetails({ version, notes });
        setState('available');
      } catch (error) {
        if (cancelled) return;
        setState('error');
        setErrorText(error instanceof Error ? error.message : 'Failed to check for updates.');
      }
    }

    void checkForUpdates();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleInstall() {
    if (!details) return;
    setState('downloading');
    setErrorText('');

    try {
      if (window.electronAPI) {
        await window.electronAPI.downloadAndInstall();
      } else {
        const updaterModule = (await import('@tauri-apps/plugin-updater')) as {
          check: () => Promise<any>;
        };
        const update = await updaterModule.check();
        if (!update) {
          setState('idle');
          return;
        }
        await update.downloadAndInstall();
      }
      setState('downloaded');
    } catch (error) {
      setState('error');
      setErrorText(error instanceof Error ? error.message : 'Failed to install update.');
    }
  }

  if (!shouldRender) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-lg font-semibold text-white">Update Available</p>
            <p className="mt-1 text-sm text-zinc-300">
              {details
                ? <>Version <span className="font-semibold text-gold">{details.version}</span> is ready.</>
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

        {details?.notes && (
          <p className="mt-3 max-h-24 overflow-auto rounded-md border border-border bg-surface-2 p-2 text-xs text-zinc-300">
            {details.notes}
          </p>
        )}

        {state === 'downloading' && (
          <p className="mt-3 text-sm text-zinc-200">Downloading and preparing update...</p>
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

          {(state === 'downloaded' || state === 'error') && (
            <button onClick={() => setDismissed(true)} className="btn-outline px-4 py-2 text-sm">
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
