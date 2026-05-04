import { useCallback, useMemo, useState } from 'react';
import { API_URL, fetchJson } from '../lib/api';
import type { SettingsStatusMessage } from './types';

export type DataCacheSyncProgress = {
  task: string;
  current: number;
  total: number;
  details: string;
};

function parseSyncStatus(status: any): string {
  if (typeof status === 'string') return status;
  if (status && typeof status === 'object' && status.error) {
    return `error:${String(status.error)}`;
  }
  return 'unknown';
}

function parseProgress(progress: string): DataCacheSyncProgress {
  const parts = progress.split(':');
  if (parts.length < 4) return { task: '', current: 0, total: 0, details: progress };
  return {
    task: parts[0],
    current: parseInt(parts[1], 10),
    total: parseInt(parts[2], 10),
    details: parts[3],
  };
}

export function useDataCacheRefresh() {
  const [cacheSyncing, setCacheSyncing] = useState(false);
  const [cacheSyncProgress, setCacheSyncProgress] = useState<string>('');
  const [cacheMessage, setCacheMessage] = useState<SettingsStatusMessage | null>(null);

  const pollSyncStatus = useCallback(async () => {
    try {
      const data = await fetchJson<any>(`${API_URL}/api/data/status`);
      const status = parseSyncStatus(data.status);
      const progress = data.progress || '';
      setCacheSyncProgress(progress);
      window.dispatchEvent(
        new CustomEvent('whylowdps-cache-refresh-status', {
          detail: { status, progress, message: data.message || '' },
        })
      );

      if (status === 'ready') {
        setCacheSyncing(false);
        setCacheMessage({ type: 'success', text: 'Game data cache refreshed successfully.' });
        return;
      }

      if (status === 'needs_credentials') {
        setCacheSyncing(false);
        setCacheMessage({
          type: 'error',
          text: 'Cannot refresh data cache: Blizzard credentials are required.',
        });
        return;
      }

      if (status.startsWith('error:')) {
        setCacheSyncing(false);
        setCacheMessage({
          type: 'error',
          text: status.replace(/^error:/, '') || 'Cache refresh failed.',
        });
        return;
      }

      window.setTimeout(() => {
        void pollSyncStatus();
      }, 1500);
    } catch (err: any) {
      setCacheSyncing(false);
      setCacheMessage({ type: 'error', text: err?.message || 'Failed to read sync status.' });
    }
  }, []);

  const refreshDataCache = useCallback(async () => {
    setCacheMessage(null);
    setCacheSyncing(true);
    setCacheSyncProgress('Initializing synchronization...');
    window.dispatchEvent(new CustomEvent('whylowdps-cache-refresh-start'));

    try {
      await fetchJson(`${API_URL}/api/data/sync?force=true`, { method: 'POST' });
      await pollSyncStatus();
    } catch (err: any) {
      if (err?.status === 409) {
        await pollSyncStatus();
        return;
      }

      setCacheSyncing(false);
      setCacheMessage({ type: 'error', text: err?.message || 'Failed to start cache refresh.' });
    }
  }, [pollSyncStatus]);

  const syncProgress = useMemo(() => parseProgress(cacheSyncProgress), [cacheSyncProgress]);
  const syncProgressPct = useMemo(
    () =>
      cacheSyncing && syncProgress.total > 0
        ? Math.max(0, Math.min(100, Math.round((syncProgress.current / syncProgress.total) * 100)))
        : 0,
    [cacheSyncing, syncProgress.current, syncProgress.total]
  );

  return {
    cacheSyncing,
    cacheSyncProgress,
    cacheMessage,
    syncProgress,
    syncProgressPct,
    refreshDataCache,
  };
}
