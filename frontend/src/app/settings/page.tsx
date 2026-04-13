'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../components/AuthContext';
import { useRouter } from 'next/navigation';
import {
  API_URL,
  downloadLatestSimc,
  fetchJson,
  getSimcStatus,
  isDesktop,
  removeSimcChannel,
  type SimcStatus,
} from '../lib/api';
import { useSimContext } from '../components/SimContext';

const PRESETS = [
  { label: 'Balanced', pct: 0.3 },
  { label: 'Performance', pct: 0.6 },
  { label: 'Maximum', pct: 0.9 },
] as const;
type RefreshUnit = 'minutes' | 'hours' | 'days' | 'weeks';
const UNIT_TO_MINUTES: Record<RefreshUnit, number> = {
  minutes: 1,
  hours: 60,
  days: 60 * 24,
  weeks: 60 * 24 * 7,
};
const chooseBestUnit = (minutes: number): { value: number; unit: RefreshUnit } => {
  if (minutes <= 0) return { value: 0, unit: 'minutes' };
  if (minutes % UNIT_TO_MINUTES.weeks === 0) {
    return { value: Math.floor(minutes / UNIT_TO_MINUTES.weeks), unit: 'weeks' };
  }
  if (minutes % UNIT_TO_MINUTES.days === 0) {
    return { value: Math.floor(minutes / UNIT_TO_MINUTES.days), unit: 'days' };
  }
  if (minutes % UNIT_TO_MINUTES.hours === 0) {
    return { value: Math.floor(minutes / UNIT_TO_MINUTES.hours), unit: 'hours' };
  }
  return { value: minutes, unit: 'minutes' };
};

interface DataFileState {
  key: string;
  label: string;
  section: string;
  relative_path: string;
  required: boolean;
  downloadable: boolean;
  exists: boolean;
  size_bytes: number;
}

interface DataFileStatesResponse {
  base_path: string | null;
  available: boolean;
  files: DataFileState[];
}

interface DataFilePreviewResponse {
  key: string;
  label: string;
  relative_path: string;
  content: string;
  truncated: boolean;
}

const SIMC_CHANNELS = [
  { id: 'stable', label: 'Stable' },
  { id: 'nightly', label: 'Nightly' },
] as const;

type SimcChannelName = (typeof SIMC_CHANNELS)[number]['id'];

export default function SettingsPage() {
  const { user } = useAuth();
  const router = useRouter();
  const {
    threads,
    setThreads,
    maxCombinations,
    setMaxCombinations,
    autoClipboardPasteSimc,
    setAutoClipboardPasteSimc,
    dataCacheRefreshMinutes,
    setDataCacheRefreshMinutes,
  } = useSimContext();
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [secretTouched, setSecretTouched] = useState(false);
  const [hasSecret, setHasSecret] = useState(false);
  const [maxThreads, setMaxThreads] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [performanceSaved, setPerformanceSaved] = useState(false);
  const [cacheSyncing, setCacheSyncing] = useState(false);
  const [cacheSyncStatus, setCacheSyncStatus] = useState<string>('idle');
  const [cacheSyncProgress, setCacheSyncProgress] = useState<string>('');
  const [cacheMessage, setCacheMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [dataStateLoading, setDataStateLoading] = useState(false);
  const [dataStateError, setDataStateError] = useState('');
  const [dataStateMessage, setDataStateMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [dataStateOpen, setDataStateOpen] = useState(false);
  const [dataFileStates, setDataFileStates] = useState<DataFileStatesResponse | null>(null);
  const [dataActionBusyKey, setDataActionBusyKey] = useState<string | null>(null);
  const [dataFilePreview, setDataFilePreview] = useState<DataFilePreviewResponse | null>(null);
  const [dataFilePreviewOpen, setDataFilePreviewOpen] = useState(false);
  const [dataFilePreviewLoading, setDataFilePreviewLoading] = useState(false);
  const [dataFilePreviewError, setDataFilePreviewError] = useState('');
  const initialRefresh = chooseBestUnit(dataCacheRefreshMinutes);
  const [refreshEveryValue, setRefreshEveryValue] = useState(initialRefresh.value);
  const [refreshEveryUnit, setRefreshEveryUnit] = useState<RefreshUnit>(initialRefresh.unit);
  const [updateCheckState, setUpdateCheckState] = useState<'idle' | 'checking'>('idle');
  const [updateMessage, setUpdateMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [simcStatuses, setSimcStatuses] = useState<Record<SimcChannelName, SimcStatus | null>>({
    stable: null,
    nightly: null,
  });
  const [simcChecking, setSimcChecking] = useState(false);
  const [simcAction, setSimcAction] = useState<string | null>(null);
  const [simcMessage, setSimcMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  useEffect(() => {
    if (!user) {
      router.push('/');
      return;
    }

    fetchJson<any>(`${API_URL}/api/user/config`)
      .then((data) => {
        setClientId(data.blizzard_client_id || '');
        setHasSecret(data.has_blizzard_client_secret || false);
        const savedThreads = parseInt(data.sim_threads || '', 10);
        if (Number.isFinite(savedThreads) && savedThreads > 0) {
          setThreads(savedThreads);
        }
        const savedMaxCombos = parseInt(data.max_gear_combinations || '', 10);
        if (Number.isFinite(savedMaxCombos) && savedMaxCombos > 0) {
          setMaxCombinations(savedMaxCombos);
        }
        setPerformanceSaved(true);
      })
      .catch((err) => {
        console.error('Failed to load settings:', err);
        setPerformanceSaved(true);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [user, router, setMaxCombinations, setThreads]);

  useEffect(() => {
    fetch(`${API_URL}/health`, { credentials: 'include' })
      .then((res) => res.json())
      .then((data) => {
        if (data.threads) {
          setMaxThreads(data.threads);
          if (threads === 0) {
            setThreads(Math.max(1, Math.round(data.threads * 0.6)));
          }
        }
      })
      .catch(() => {});
  }, [threads, setThreads]);

  useEffect(() => {
    if (!performanceSaved || !user || threads <= 0) return;
    fetchJson(`${API_URL}/api/user/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'sim_threads', value: String(threads) }),
    }).catch(() => {});
  }, [threads, performanceSaved, user]);

  useEffect(() => {
    if (!performanceSaved || !user || (maxCombinations ?? 0) <= 0) return;
    fetchJson(`${API_URL}/api/user/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: 'max_gear_combinations',
        value: String(maxCombinations),
      }),
    }).catch(() => {});
  }, [maxCombinations, performanceSaved, user]);

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
          text: message || 'Update found. Use "Update Now" in the popup.',
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
    const derived = chooseBestUnit(dataCacheRefreshMinutes);
    setRefreshEveryValue(derived.value);
    setRefreshEveryUnit(derived.unit);
  }, [dataCacheRefreshMinutes]);

  const refreshSimc = useCallback(async (channel?: SimcChannelName) => {
    if (!isDesktop) return;
    setSimcChecking(true);
    setSimcMessage(null);
    try {
      if (channel) {
        const status = await getSimcStatus(channel);
        setSimcStatuses((prev) => ({ ...prev, [channel]: status }));
      } else {
        const channels = SIMC_CHANNELS.map((entry) => entry.id);
        const results = await Promise.all(channels.map((id) => getSimcStatus(id)));
        setSimcStatuses({
          stable: results[0],
          nightly: results[1],
        });
      }
    } catch (err: any) {
      setSimcMessage({
        type: 'error',
        text: err?.detail || err?.message || 'Failed to fetch SimC status.',
      });
    } finally {
      setSimcChecking(false);
    }
  }, []);

  const installSimcChannel = async (channel: SimcChannelName) => {
    if (!isDesktop) return;
    setSimcAction(`${channel}:install`);
    setSimcMessage(null);
    window.dispatchEvent(
      new CustomEvent('whylowdps-simc-download-start', {
        detail: { channel },
      })
    );
    try {
      const status = await downloadLatestSimc(channel);
      setSimcStatuses((prev) => ({ ...prev, [channel]: status }));
      window.dispatchEvent(
        new CustomEvent('whylowdps-simc-download-finish', {
          detail: { channel },
        })
      );
      setSimcMessage({
        type: 'success',
        text: `SimulationCraft ${channel} channel installed/updated successfully.`,
      });
    } catch (err: any) {
      const msg = err?.detail || err?.message || 'Failed to download SimC channel.';
      const isInProgress =
        err?.status === 409 ||
        /already in progress/i.test(msg || '') ||
        /already updating/i.test(msg || '');
      if (isInProgress) {
        setSimcMessage({
          type: 'success',
          text: 'A SimC update is already running. Refreshing status...',
        });
        window.dispatchEvent(
          new CustomEvent('whylowdps-simc-download-start', {
            detail: { channel },
          })
        );
        await refreshSimc();
      } else {
        setSimcMessage({ type: 'error', text: msg });
      }
    } finally {
      setSimcAction(null);
    }
  };

  const removeInstalledSimcChannel = async (channel: SimcChannelName) => {
    if (!isDesktop) return;
    const installedCount = Object.values(simcStatuses).filter(
      (value) => value?.installed_exists
    ).length;
    const targetInstalled = !!simcStatuses[channel]?.installed_exists;
    if (targetInstalled && installedCount <= 1) {
      setSimcMessage({
        type: 'error',
        text: 'Keep at least one SimC channel installed before removing another.',
      });
      return;
    }
    const targetPath =
      simcStatuses[channel]?.channel_path || simcStatuses[channel]?.installed_path || '(unknown)';
    const confirmed = window.confirm(
      `Delete SimC ${channel} files from disk at:\n${targetPath}\n\nThis removes that installed channel version.`
    );
    if (!confirmed) return;

    setSimcAction(`${channel}:remove`);
    setSimcMessage(null);
    try {
      const status = await removeSimcChannel(channel);
      setSimcStatuses((prev) => ({ ...prev, [channel]: status }));
      setSimcMessage({
        type: 'success',
        text: `Deleted SimC ${channel} files from disk.`,
      });
    } catch (err: any) {
      setSimcMessage({
        type: 'error',
        text: err?.detail || err?.message || 'Failed to remove SimC channel.',
      });
    } finally {
      setSimcAction(null);
    }
  };

  useEffect(() => {
    if (!isDesktop || !user) return;
    void refreshSimc();
  }, [user, refreshSimc]);

  useEffect(() => {
    if (!performanceSaved || !user) return;
    fetchJson(`${API_URL}/api/user/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: 'simc_download_channel',
        value: 'stable',
      }),
    }).catch(() => {});
  }, [performanceSaved, user]);

  useEffect(() => {
    try {
      localStorage.setItem('whylowdps_simc_download_channel', 'stable');
    } catch {}
  }, []);

  const testCredentials = async () => {
    setTesting(true);
    setMessage(null);
    try {
      const payload: Record<string, string> = { client_id: clientId.trim() };
      payload.client_secret = clientSecret.trim();
      await fetchJson(`${API_URL}/api/user/blizzard/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      setMessage({ type: 'success', text: 'Credentials verified successfully!' });
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to verify credentials.' });
    }
    setTesting(false);
  };

  const saveAllSettings = async () => {
    if (!clientId.trim()) return;
    setSaving(true);
    setMessage(null);
    try {
      await fetchJson(`${API_URL}/api/user/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'blizzard_client_id', value: clientId.trim() }),
      });

      if (clientSecret.trim()) {
        await fetchJson(`${API_URL}/api/user/config`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            key: 'blizzard_client_secret',
            value: clientSecret.trim(),
          }),
        });
        setHasSecret(true);
        setClientSecret('');
        setSecretTouched(false);
      }

      setMessage({ type: 'success', text: 'Settings saved successfully.' });
    } catch {
      setMessage({ type: 'error', text: 'Failed to save settings.' });
    } finally {
      setSaving(false);
    }
  };

  const parseSyncStatus = (status: any): string => {
    if (typeof status === 'string') return status;
    if (status && typeof status === 'object') {
      if (status.error) return `error:${String(status.error)}`;
    }
    return 'unknown';
  };

  const parseProgress = (str: string) => {
    const parts = str.split(':');
    if (parts.length < 4) return { task: '', current: 0, total: 0, details: str };
    return {
      task: parts[0],
      current: parseInt(parts[1], 10),
      total: parseInt(parts[2], 10),
      details: parts[3],
    };
  };

  const pollSyncStatus = async () => {
    try {
      const data = await fetchJson<any>(`${API_URL}/api/data/status`);
      const status = parseSyncStatus(data.status);
      setCacheSyncStatus(status);
      setCacheSyncProgress(data.progress || '');
      window.dispatchEvent(
        new CustomEvent('whylowdps-cache-refresh-status', {
          detail: { status, progress: data.progress || '', message: data.message || '' },
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
  };

  const refreshDataCache = async () => {
    setCacheMessage(null);
    setCacheSyncing(true);
    setCacheSyncStatus('syncing');
    setCacheSyncProgress('Initializing synchronization...');
    window.dispatchEvent(new CustomEvent('whylowdps-cache-refresh-start'));

    try {
      await fetchJson(`${API_URL}/api/data/sync?force=true`, { method: 'POST' });
      await pollSyncStatus();
    } catch (err: any) {
      // 409 means a sync is already in progress; follow it instead of failing.
      if (err?.status === 409) {
        await pollSyncStatus();
        return;
      }

      setCacheSyncing(false);
      setCacheMessage({ type: 'error', text: err?.message || 'Failed to start cache refresh.' });
    }
  };

  const checkForUpdatesNow = () => {
    setUpdateCheckState('checking');
    setUpdateMessage(null);
    window.dispatchEvent(new CustomEvent('whylowdps-updater-check'));
  };

  const formatBytes = (n: number) => {
    if (!Number.isFinite(n) || n <= 0) return '0 B';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  };

  const viewDataStates = async () => {
    setDataStateOpen(true);
    setDataStateLoading(true);
    setDataStateError('');
    setDataStateMessage(null);
    try {
      const data = await fetchJson<DataFileStatesResponse>(`${API_URL}/api/data/files`);
      setDataFileStates(data);
    } catch (err: any) {
      setDataStateError(err?.message || 'Failed to load data file states.');
    } finally {
      setDataStateLoading(false);
    }
  };

  const refreshDataStates = async () => {
    setDataStateLoading(true);
    setDataStateError('');
    try {
      const data = await fetchJson<DataFileStatesResponse>(`${API_URL}/api/data/files`);
      setDataFileStates(data);
    } catch (err: any) {
      setDataStateError(err?.message || 'Failed to refresh data file states.');
    } finally {
      setDataStateLoading(false);
    }
  };

  const downloadFile = async (key: string) => {
    setDataActionBusyKey(key);
    setDataStateMessage(null);
    try {
      await fetchJson(`${API_URL}/api/data/files/${encodeURIComponent(key)}/download`, {
        method: 'POST',
      });
      await refreshDataStates();
      setDataStateMessage({ type: 'success', text: 'File downloaded successfully.' });
    } catch (err: any) {
      setDataStateMessage({ type: 'error', text: err?.message || 'Failed to download file.' });
    } finally {
      setDataActionBusyKey(null);
    }
  };

  const downloadAllMissingFiles = async () => {
    setDataActionBusyKey('download-missing');
    setDataStateMessage(null);
    try {
      const data = await fetchJson<{ downloaded_keys?: string[]; failed?: unknown[] }>(
        `${API_URL}/api/data/files/missing/download`,
        { method: 'POST' }
      );
      await refreshDataStates();
      const count = data.downloaded_keys?.length ?? 0;
      const failures = data.failed?.length ?? 0;
      if (failures > 0) {
        setDataStateMessage({
          type: 'error',
          text: `Downloaded ${count} files, ${failures} failed. Check backend logs for details.`,
        });
      } else {
        setDataStateMessage({ type: 'success', text: `Downloaded ${count} missing files.` });
      }
    } catch (err: any) {
      setDataStateMessage({
        type: 'error',
        text: err?.message || 'Failed to download missing files.',
      });
    } finally {
      setDataActionBusyKey(null);
    }
  };

  const openDataRootDirectory = async () => {
    if (!dataFileStates?.base_path || !isDesktop) return;
    setDataStateMessage(null);
    try {
      await fetchJson(`${API_URL}/api/data/files/open-directory`, { method: 'POST' });
    } catch (err: any) {
      setDataStateMessage({
        type: 'error',
        text: err?.message || 'Failed to open directory.',
      });
    }
  };

  const showFileContent = async (key: string) => {
    setDataFilePreviewOpen(true);
    setDataFilePreviewLoading(true);
    setDataFilePreviewError('');
    setDataFilePreview(null);
    try {
      const data = await fetchJson<DataFilePreviewResponse>(
        `${API_URL}/api/data/files/${encodeURIComponent(key)}/content`
      );
      setDataFilePreview(data);
    } catch (err: any) {
      setDataFilePreviewError(err?.message || 'Failed to load file content.');
    } finally {
      setDataFilePreviewLoading(false);
    }
  };

  const groupedDataFiles = dataFileStates?.files.reduce<Record<string, DataFileState[]>>(
    (acc, file) => {
      (acc[file.section] ||= []).push(file);
      return acc;
    },
    {}
  );
  const sectionSummaries = Object.entries(groupedDataFiles || {}).reduce<
    Record<string, { totalBytes: number; downloaded: number; total: number }>
  >((acc, [section, files]) => {
    acc[section] = {
      totalBytes: files.reduce((sum, file) => sum + (file.exists ? file.size_bytes : 0), 0),
      downloaded: files.filter((file) => file.exists).length,
      total: files.length,
    };
    return acc;
  }, {});
  const totalDataFiles = dataFileStates?.files.length ?? 0;
  const downloadedDataFiles = dataFileStates?.files.filter((file) => file.exists).length ?? 0;
  const remainingDataFiles = Math.max(0, totalDataFiles - downloadedDataFiles);
  const syncProgress = parseProgress(cacheSyncProgress);
  const syncProgressPct =
    cacheSyncing && syncProgress.total > 0
      ? Math.max(0, Math.min(100, Math.round((syncProgress.current / syncProgress.total) * 100)))
      : 0;
  const installedSimcChannelsCount = Object.values(simcStatuses).filter(
    (value) => value?.installed_exists
  ).length;

  const activePresetIdx = PRESETS.findIndex(
    (p) => maxThreads > 0 && Math.max(1, Math.round(maxThreads * p.pct)) === threads
  );

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-gold"></div>
      </div>
    );
  }

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 space-y-8 duration-500">
      <header>
        <h1 className="text-3xl font-bold tracking-tight text-white">Settings</h1>
        <p className="mt-2 text-zinc-400">Manage your account and API credentials.</p>
      </header>

      <section className="rounded-xl border border-border/50 bg-surface/30 p-6 backdrop-blur-sm">
        <h2 className="mb-6 text-xl font-semibold text-white">Blizzard API (BYOK)</h2>
        <p className="mb-8 text-sm text-zinc-400">
          Provide your own Blizzard API credentials to fetch your characters and gear. If not
          provided, the system will use global default keys.
          <br />
          <a
            href="https://develop.battle.net/access/clients"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-block text-gold hover:underline"
          >
            Create a client on the Blizzard Developer Portal &rarr;
          </a>
        </p>

        <div className="max-w-2xl space-y-6">
          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-300">Client ID</label>
            <input
              type="text"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="Enter Client ID"
              className="w-full rounded-lg border border-border/50 bg-surface-2 px-4 py-2.5 text-white transition-colors focus:border-gold/50 focus:outline-none"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-300">Client Secret</label>
            <input
              type="password"
              value={secretTouched ? clientSecret : hasSecret ? '••••••••••••••••' : clientSecret}
              onFocus={() => {
                if (!secretTouched && hasSecret) {
                  setSecretTouched(true);
                  setClientSecret('');
                }
              }}
              onChange={(e) => {
                setSecretTouched(true);
                setClientSecret(e.target.value);
              }}
              placeholder="Enter Client Secret"
              className="w-full rounded-lg border border-border/50 bg-surface-2 px-4 py-2.5 text-white transition-colors focus:border-gold/50 focus:outline-none"
            />
            <p className="text-[12px] text-zinc-500">
              {hasSecret && !clientSecret
                ? 'A secret is already saved and hidden. Type to replace it.'
                : 'Your secret is hidden in this field.'}
            </p>
          </div>

          <div className="flex flex-col gap-4 pt-4">
            <div className="flex items-center gap-4">
              <button
                onClick={testCredentials}
                disabled={testing || !clientId.trim() || (!clientSecret.trim() && !hasSecret)}
                className="rounded-lg border border-white/10 bg-white/5 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/10 disabled:opacity-50"
              >
                {testing ? 'Testing...' : 'Test Connection'}
              </button>

              <button
                onClick={saveAllSettings}
                disabled={saving || !clientId.trim()}
                className="rounded-lg bg-gold/10 px-6 py-2.5 text-sm font-semibold text-gold transition-colors hover:bg-gold/20 disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save Settings'}
              </button>
            </div>

            {message && (
              <div
                className={`animate-in fade-in zoom-in rounded-lg p-4 text-sm duration-300 ${
                  message.type === 'success'
                    ? 'border border-emerald-500/20 bg-emerald-500/10 text-emerald-400'
                    : 'border border-red-500/20 bg-red-500/10 text-red-400'
                }`}
              >
                {message.text}
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-border/50 bg-surface/30 p-6 backdrop-blur-sm">
        <h2 className="mb-6 text-xl font-semibold text-white">Simulation Performance</h2>
        <div className="max-w-2xl space-y-6">
          {maxThreads > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-zinc-300">CPU Threads</span>
                <span className="rounded border border-border bg-surface-2 px-2 py-0.5 font-mono text-[11px] tabular-nums text-white">
                  {threads}/{maxThreads}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {PRESETS.map((p, i) => {
                  const val = Math.max(1, Math.round(maxThreads * p.pct));
                  return (
                    <button
                      key={p.label}
                      onClick={() => setThreads(val)}
                      className={`rounded-lg border px-3 py-2 text-center transition-all ${
                        activePresetIdx === i
                          ? 'border-white bg-white text-black'
                          : 'border-border bg-surface-2 text-zinc-400 hover:border-gray-500 hover:text-white'
                      }`}
                    >
                      <span className="block text-[12px] font-semibold">{p.label}</span>
                      <span className="mt-0.5 block text-[10px] opacity-70">{val} threads</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between border-t border-border pt-4">
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-zinc-300">Max Gear Combos</p>
              <p className="text-[12px] text-zinc-500">Limits Top Gear simulation runtime.</p>
            </div>
            <input
              type="number"
              min={10}
              max={100000}
              step={50}
              value={maxCombinations ?? 500}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                if (Number.isFinite(val) && val > 0) setMaxCombinations(val);
              }}
              className="w-24 rounded border border-border bg-surface-2 px-2 py-1 text-center font-mono text-xs tabular-nums text-white [appearance:textfield] focus:border-gold/50 focus:outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
          </div>

          {isDesktop && (
            <div className="space-y-4 border-t border-border pt-4">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-0.5">
                  <p className="text-sm font-medium text-zinc-300">SimulationCraft Engine</p>
                  <p className="text-[12px] text-zinc-500">
                    Manage installed SimC channels and update checks.
                  </p>
                </div>
                <button
                  onClick={() => void refreshSimc()}
                  disabled={simcChecking || !!simcAction}
                  className="rounded-lg border border-gold/40 bg-gold/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-gold transition-colors hover:bg-gold/20 disabled:opacity-50"
                >
                  {simcChecking ? 'Checking...' : 'Check for Updates'}
                </button>
              </div>

              <div className="rounded-xl border border-border bg-surface-2/90 p-3 text-[12px]">
                <div className="grid grid-cols-[1fr_150px] border-b border-border/80 px-2 pb-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                  <span>Branch / Version</span>
                  <span className="text-right">Actions</span>
                </div>

                <div className="mt-2 space-y-2">
                  {SIMC_CHANNELS.map((entry) => {
                    const status = simcStatuses[entry.id];
                    const isBusy =
                      simcChecking ||
                      !!simcAction ||
                      Object.values(simcStatuses).some((value) => value?.is_updating);
                    const actionKey = simcAction ?? '';
                    const isInstalling = actionKey === `${entry.id}:install`;
                    const isRemoving = actionKey === `${entry.id}:remove`;
                    const installed = !!status?.installed_exists;
                    const hasUpdate = !!status?.update_available && !!status?.latest_version;
                    const cannotRemoveLastInstalled = installed && installedSimcChannelsCount <= 1;

                    let actionLabel = 'Install';
                    let actionClass =
                      'border-emerald-700/40 bg-emerald-950/25 text-emerald-300 hover:bg-emerald-900/30';
                    let actionHandler = () => void installSimcChannel(entry.id);

                    if (installed && hasUpdate) {
                      actionLabel = 'Update';
                      actionClass =
                        'border-amber-700/40 bg-amber-950/25 text-amber-300 hover:bg-amber-900/30';
                    } else if (installed) {
                      actionLabel = 'Remove';
                      actionClass =
                        'border-red-800/40 bg-red-950/25 text-red-300 hover:bg-red-900/30';
                      actionHandler = () => void removeInstalledSimcChannel(entry.id);
                    }

                    return (
                      <div
                        key={entry.id}
                        className="grid grid-cols-[1fr_150px] items-center gap-3 rounded-lg border border-border/80 bg-surface px-3 py-2.5"
                      >
                        <div>
                          <p className="text-[19px] font-semibold text-zinc-100">{entry.label}</p>
                          <p className="text-[12px] leading-relaxed text-zinc-400">
                            {installed
                              ? `Installed: ${status?.installed_version ?? 'Detected'}${status?.installed_date ? ` - ${status.installed_date}` : ''}`
                              : `Available: ${status?.latest_version ?? (simcChecking ? 'Checking...' : 'Unknown')}`}
                          </p>
                          <p className="text-[11px] text-zinc-500">
                            Path: {status?.channel_path || status?.installed_path || 'Unknown'}
                          </p>
                          {installed && hasUpdate && (
                            <p className="text-[11px] font-medium text-amber-300">
                              Update available: {status?.latest_version}
                            </p>
                          )}
                          {cannotRemoveLastInstalled && (
                            <p className="text-[11px] text-zinc-500">
                              At least one SimC channel must remain installed.
                            </p>
                          )}
                        </div>

                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={actionHandler}
                            disabled={
                              isBusy ||
                              (!installed && !status?.latest_version) ||
                              (actionLabel === 'Remove' && cannotRemoveLastInstalled)
                            }
                            className={`rounded-md border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${actionClass}`}
                          >
                            {isInstalling
                              ? 'Installing...'
                              : isRemoving
                                ? 'Removing...'
                                : actionLabel}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {simcMessage && (
                <div
                  className={`rounded-lg border px-3 py-2 text-[12px] ${
                    simcMessage.type === 'success'
                      ? 'border-emerald-700/40 bg-emerald-950/25 text-emerald-300'
                      : 'border-red-700/40 bg-red-950/25 text-red-300'
                  }`}
                >
                  {simcMessage.text}
                </div>
              )}

              {Object.values(simcStatuses).some((value) => value?.detail) && (
                <div className="rounded-lg border border-red-700/30 bg-red-950/20 px-3 py-2 text-[12px] text-red-300">
                  {Object.values(simcStatuses)
                    .map((value) => value?.detail)
                    .filter(Boolean)
                    .join(' • ')}
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-border/50 bg-surface/30 p-6 backdrop-blur-sm">
        <h2 className="mb-3 text-xl font-semibold text-white">Clipboard Import</h2>
        <p className="mb-5 text-sm text-zinc-400">
          When the app regains focus, it can check the latest clipboard text and auto-fill the SimC
          export box if it looks like a valid SimC string.
        </p>

        <div className="flex max-w-2xl items-center justify-between gap-4 rounded-lg border border-border/60 bg-surface-2/60 px-4 py-3">
          <div className="space-y-1">
            <p className="text-sm font-medium text-zinc-200">Auto paste SimC clipboard content</p>
            <p className="text-[13px] text-zinc-500">
              If the newest clipboard copy looks like a SimC export, it will be pasted into the main
              text bar automatically when you return to the app.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setAutoClipboardPasteSimc(!autoClipboardPasteSimc)}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
              autoClipboardPasteSimc ? 'bg-gold' : 'border border-border bg-surface'
            }`}
            aria-pressed={autoClipboardPasteSimc}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full transition-all ${
                autoClipboardPasteSimc ? 'left-[22px] bg-black' : 'left-0.5 bg-gray-500'
              }`}
            />
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-border/50 bg-surface/30 p-6 backdrop-blur-sm">
        <h2 className="mb-3 text-xl font-semibold text-white">Game Data Cache</h2>
        <p className="mb-5 text-sm text-zinc-400">
          Refetch game data and reload the backend cache used for gems, enchants, items, raids, and
          dungeon loot.
        </p>

        <div className="max-w-2xl space-y-4">
          <div className="flex items-center justify-between gap-4 rounded-lg border border-border/60 bg-surface-2/60 px-4 py-3">
            <div className="space-y-1">
              <p className="text-sm font-medium text-zinc-200">Auto refresh interval</p>
              <p className="text-[13px] text-zinc-500">
                Refresh the game data cache automatically while the app is open. Set value to 0 to
                disable.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={999}
                step={1}
                value={refreshEveryValue}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  const nextValue = Number.isFinite(val) && val > 0 ? val : 0;
                  setRefreshEveryValue(nextValue);
                  setDataCacheRefreshMinutes(nextValue * UNIT_TO_MINUTES[refreshEveryUnit]);
                }}
                className="w-24 rounded border border-border bg-surface-2 px-2 py-1 text-center font-mono text-xs tabular-nums text-white [appearance:textfield] focus:border-gold/50 focus:outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
              <select
                value={refreshEveryUnit}
                onChange={(e) => {
                  const nextUnit = e.target.value as RefreshUnit;
                  setRefreshEveryUnit(nextUnit);
                  setDataCacheRefreshMinutes(refreshEveryValue * UNIT_TO_MINUTES[nextUnit]);
                }}
                className="rounded border border-border bg-surface-2 px-2 py-1 text-xs text-zinc-200 focus:border-gold/50 focus:outline-none"
              >
                <option value="minutes">Minutes</option>
                <option value="hours">Hours</option>
                <option value="days">Days</option>
                <option value="weeks">Weeks</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={refreshDataCache}
              disabled={cacheSyncing}
              className="rounded-lg bg-gold/10 px-6 py-2.5 text-sm font-semibold text-gold transition-colors hover:bg-gold/20 disabled:opacity-50"
            >
              {cacheSyncing ? 'Refreshing Cache...' : 'Refresh Game Data Cache'}
            </button>
            <button
              onClick={viewDataStates}
              className="rounded-lg border border-white/10 bg-white/5 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/10"
            >
              View Data State
            </button>
            {cacheSyncing && (
              <span className="text-xs uppercase tracking-wide text-zinc-500">
                Sync in progress
              </span>
            )}
          </div>

          {cacheSyncing && (
            <div className="rounded-lg border border-border bg-surface-2 p-4">
              <div className="mb-2 flex items-center justify-between text-xs text-zinc-400">
                <span>{syncProgress.details || 'Refreshing cache...'}</span>
                <span>
                  {syncProgress.total > 0
                    ? `${syncProgress.current}/${syncProgress.total}`
                    : 'Working...'}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-black/40">
                <div
                  className="h-full rounded-full bg-gold transition-all duration-300"
                  style={{ width: `${syncProgressPct}%` }}
                />
              </div>
            </div>
          )}

          {!!cacheSyncProgress && (
            <div className="rounded-lg border border-border bg-surface-2 p-3">
              <p className="text-sm text-zinc-200">{syncProgress.details || cacheSyncProgress}</p>
            </div>
          )}

          {cacheMessage && (
            <div
              className={`animate-in fade-in zoom-in rounded-lg p-4 text-sm duration-300 ${
                cacheMessage.type === 'success'
                  ? 'border border-emerald-500/20 bg-emerald-500/10 text-emerald-400'
                  : 'border border-red-500/20 bg-red-500/10 text-red-400'
              }`}
            >
              {cacheMessage.text}
            </div>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-border/50 bg-surface/30 p-6 backdrop-blur-sm">
        <h2 className="mb-3 text-xl font-semibold text-white">App Updates</h2>
        <p className="mb-5 text-sm text-zinc-400">Check if a newer desktop version is available.</p>
        <div className="max-w-2xl space-y-4">
          <button
            onClick={checkForUpdatesNow}
            disabled={updateCheckState === 'checking'}
            className="rounded-lg border border-white/10 bg-white/5 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/10 disabled:opacity-50"
          >
            {updateCheckState === 'checking' ? 'Checking...' : 'Check for Updates'}
          </button>

          {updateMessage && (
            <div
              className={`animate-in fade-in zoom-in rounded-lg p-4 text-sm duration-300 ${
                updateMessage.type === 'success'
                  ? 'border border-emerald-500/20 bg-emerald-500/10 text-emerald-400'
                  : 'border border-red-500/20 bg-red-500/10 text-red-400'
              }`}
            >
              {updateMessage.text}
            </div>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-border/50 bg-surface/10 p-6 opacity-60">
        <h2 className="mb-4 text-xl font-semibold text-white">Account Security</h2>
        <p className="text-sm text-zinc-400">
          Your credentials are used solely to fetch character data directly from Blizzard. They are
          stored in our secure database and are never shared with third parties.
        </p>
      </section>

      {dataStateOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 p-4">
          <div className="max-h-[80vh] w-full max-w-3xl overflow-hidden rounded-xl border border-border bg-[#121212] shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <h3 className="text-lg font-semibold text-white">Game Data File States</h3>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {dataFileStates?.base_path || 'Runtime data directory'}
                </p>
              </div>
              <button
                onClick={() => setDataStateOpen(false)}
                className="rounded-md px-2 py-1 text-zinc-400 hover:bg-white/5 hover:text-white"
              >
                Close
              </button>
            </div>

            <div className="max-h-[calc(80vh-72px)] overflow-y-auto p-5">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <button
                  onClick={refreshDataStates}
                  disabled={dataStateLoading || dataActionBusyKey !== null}
                  className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/10 disabled:opacity-50"
                >
                  Refresh List
                </button>
                <button
                  onClick={downloadAllMissingFiles}
                  disabled={dataStateLoading || dataActionBusyKey !== null}
                  className="rounded-md border border-gold/30 bg-gold/10 px-3 py-1.5 text-xs font-semibold text-gold hover:bg-gold/20 disabled:opacity-50"
                >
                  {dataActionBusyKey === 'download-missing'
                    ? 'Downloading Missing...'
                    : 'Download All Missing'}
                </button>
                <button
                  onClick={openDataRootDirectory}
                  disabled={!isDesktop || !dataFileStates?.base_path}
                  className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/10 disabled:opacity-50"
                >
                  Open Data Dir
                </button>
              </div>

              {dataStateLoading && <p className="text-sm text-zinc-400">Loading data state...</p>}

              {!dataStateLoading && dataStateMessage && (
                <div
                  className={`mb-3 rounded-lg border p-3 text-sm ${
                    dataStateMessage.type === 'success'
                      ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
                      : 'border-red-500/20 bg-red-500/10 text-red-300'
                  }`}
                >
                  {dataStateMessage.text}
                </div>
              )}

              {!dataStateLoading && dataStateError && (
                <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">
                  {dataStateError}
                </div>
              )}

              {!dataStateLoading && !dataStateError && dataFileStates && (
                <div className="space-y-4">
                  {Object.entries(groupedDataFiles || {}).map(([section, files]) => (
                    <div key={section} className="space-y-2">
                      <div className="flex items-center gap-3">
                        <h4 className="text-sm font-semibold uppercase tracking-[0.18em] text-zinc-400">
                          {section}
                        </h4>
                        <div className="h-px flex-1 bg-border/70" />
                        <span className="text-[11px] text-zinc-500">
                          {sectionSummaries[section]?.downloaded ?? 0}/{files.length} files ·{' '}
                          {formatBytes(sectionSummaries[section]?.totalBytes ?? 0)}
                        </span>
                      </div>
                      <div className="space-y-2">
                        {files.map((file) => (
                          <div
                            key={file.key}
                            className="grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded-lg border border-border/70 bg-surface/40 px-3 py-2.5"
                          >
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-zinc-200">
                                {file.label}
                              </p>
                              <p className="truncate font-mono text-[11px] text-zinc-500">
                                {file.relative_path}
                              </p>
                            </div>
                            <span
                              className={`rounded-md px-2 py-1 text-[11px] font-semibold ${
                                file.exists
                                  ? 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                                  : file.required
                                    ? 'border border-red-500/30 bg-red-500/10 text-red-300'
                                    : 'border border-zinc-600/40 bg-zinc-700/20 text-zinc-400'
                              }`}
                            >
                              {file.exists
                                ? 'Available'
                                : file.required
                                  ? 'Missing'
                                  : 'Not downloaded'}
                            </span>
                            <span className="font-mono text-xs text-zinc-400">
                              {file.exists ? formatBytes(file.size_bytes) : '--'}
                            </span>
                            <div className="flex items-center gap-1.5">
                              <button
                                onClick={() => downloadFile(file.key)}
                                disabled={
                                  !file.downloadable ||
                                  dataStateLoading ||
                                  dataActionBusyKey !== null
                                }
                                className="rounded-md border border-gold/30 bg-gold/10 px-2 py-1 text-[11px] font-semibold text-gold hover:bg-gold/20 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {dataActionBusyKey === file.key
                                  ? 'Working...'
                                  : file.exists
                                    ? 'Refresh'
                                    : 'Download'}
                              </button>
                              <button
                                onClick={() => showFileContent(file.key)}
                                disabled={!file.exists || dataFilePreviewLoading}
                                className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-zinc-200 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                Show Content
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {dataFilePreviewOpen && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/75 p-4">
          <div className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-border bg-[#101010] shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <h3 className="text-lg font-semibold text-white">
                  {dataFilePreview?.label || 'File Content'}
                </h3>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {dataFilePreview?.relative_path || 'Loading...'}
                </p>
              </div>
              <button
                onClick={() => setDataFilePreviewOpen(false)}
                className="rounded-md px-2 py-1 text-zinc-400 hover:bg-white/5 hover:text-white"
              >
                Close
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              {dataFilePreviewLoading && (
                <p className="text-sm text-zinc-400">Loading file content...</p>
              )}
              {!dataFilePreviewLoading && dataFilePreviewError && (
                <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">
                  {dataFilePreviewError}
                </div>
              )}
              {!dataFilePreviewLoading && dataFilePreview && (
                <div className="space-y-3">
                  {dataFilePreview.truncated && (
                    <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-200">
                      Preview truncated for large file.
                    </div>
                  )}
                  <textarea
                    readOnly
                    value={dataFilePreview.content}
                    className="h-[60vh] w-full rounded-lg border border-border bg-black/50 p-4 font-mono text-[12px] leading-5 text-zinc-200 outline-none"
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
