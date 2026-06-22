import { useCallback, useEffect, useState } from 'react';
import { API_URL, fetchJson, isDesktop } from '../lib/api';
import type { SettingsStatusMessage } from './types';

type UpdateCheckState = 'idle' | 'checking' | 'installing';

type UseSettingsUpdaterArgs = {
  performanceSaved: boolean;
  hasUser: boolean;
};

export function useSettingsUpdater({ performanceSaved, hasUser }: UseSettingsUpdaterArgs) {
  const [updateCheckState, setUpdateCheckState] = useState<UpdateCheckState>('idle');
  const [updateMessage, setUpdateMessage] = useState<SettingsStatusMessage | null>(null);

  useEffect(() => {
    const onUpdaterStatus = (event: Event) => {
      const detail = (event as CustomEvent<{ status?: string; message?: string }>).detail;
      const status = detail?.status || '';
      const message = detail?.message || '';

      if (status === 'checking') {
        setUpdateCheckState('checking');
        setUpdateMessage(null);
        return;
      }

      setUpdateCheckState('idle');
      if (status === 'available') {
        setUpdateMessage({
          type: 'success',
          text: message || 'Update available. Use the bottom-right updater popup to install.',
        });
      } else if (status === 'downloading') {
        setUpdateMessage({
          type: 'success',
          text: message || 'Downloading and installing update...',
        });
      } else if (status === 'downloaded') {
        setUpdateMessage({
          type: 'success',
          text: message || 'Update installed. Restart the app to apply.',
        });
      } else if (status === 'none') {
        setUpdateMessage({ type: 'success', text: message || 'You are on the latest version.' });
      } else if (status === 'error') {
        setUpdateMessage({ type: 'error', text: message || 'Failed to check for updates.' });
      }
    };

    window.addEventListener('whylowdps-updater-status', onUpdaterStatus as EventListener);
    return () => {
      window.removeEventListener('whylowdps-updater-status', onUpdaterStatus as EventListener);
    };
  }, []);

  useEffect(() => {
    if (!isDesktop) return;
    try {
      localStorage.removeItem('whylowdps_update_channel');
    } catch {}
    if (!performanceSaved || !hasUser) return;
    fetchJson(`${API_URL}/api/user/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: 'app_update_channel',
        value: 'stable',
      }),
    }).catch(() => {});
  }, [hasUser, performanceSaved]);

  const checkForUpdatesNow = useCallback(() => {
    setUpdateCheckState('checking');
    setUpdateMessage(null);
    window.dispatchEvent(
      new CustomEvent('whylowdps-updater-check', {
        detail: { channel: 'stable' },
      })
    );
  }, []);

  const downloadAndInstallLatest = useCallback(() => {
    setUpdateCheckState('installing');
    setUpdateMessage(null);
    window.dispatchEvent(
      new CustomEvent('whylowdps-updater-install', {
        detail: { channel: 'stable' },
      })
    );
  }, []);

  return {
    updateCheckState,
    updateMessage,
    checkForUpdatesNow,
    downloadAndInstallLatest,
  };
}
