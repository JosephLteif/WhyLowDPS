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
  type SimcStatus,
} from '../lib/api';
import { useSimContext } from '../components/SimContext';

const PRESETS = [
  { label: 'Balanced', pct: 0.3 },
  { label: 'Performance', pct: 0.6 },
  { label: 'Maximum', pct: 0.9 },
] as const;

export default function SettingsPage() {
  const { user } = useAuth();
  const router = useRouter();
  const { threads, setThreads, maxCombinations, setMaxCombinations, simcChannel, setSimcChannel } =
    useSimContext();
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
  const [updateCheckState, setUpdateCheckState] = useState<'idle' | 'checking'>('idle');
  const [updateMessage, setUpdateMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [simcStatus, setSimcStatus] = useState<SimcStatus | null>(null);
  const [simcLoading, setSimcLoading] = useState(false);
  const [simcUpdating, setSimcUpdating] = useState(false);
  const [simcDownloadChannel, setSimcDownloadChannel] = useState('latest');
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
        const savedDownloadChannel = (data.simc_download_channel || 'latest').toLowerCase();
        setSimcDownloadChannel(
          ['latest', 'weekly', 'nightly'].includes(savedDownloadChannel)
            ? savedDownloadChannel
            : 'latest'
        );
        const savedSimChannel = (data.simc_sim_channel || 'latest').toLowerCase();
        setSimcChannel(
          ['latest', 'weekly', 'nightly'].includes(savedSimChannel) ? savedSimChannel : 'latest'
        );
        setPerformanceSaved(true);
      })
      .catch((err) => {
        console.error('Failed to load settings:', err);
        setPerformanceSaved(true);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [user, router, setMaxCombinations, setSimcChannel, setThreads]);

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

  const refreshSimc = useCallback(
    async (channel = simcDownloadChannel) => {
      if (!isDesktop) return;
      setSimcLoading(true);
      setSimcMessage(null);
      try {
        const status = await getSimcStatus(channel);
        setSimcStatus(status);
      } catch (err: any) {
        setSimcMessage({
          type: 'error',
          text: err?.detail || err?.message || 'Failed to fetch SimC status.',
        });
      } finally {
        setSimcLoading(false);
      }
    },
    [simcDownloadChannel]
  );

  const downloadSimc = async () => {
    if (!isDesktop) return;
    setSimcUpdating(true);
    setSimcMessage(null);
    try {
      const status = await downloadLatestSimc(simcDownloadChannel);
      setSimcStatus(status);
      setSimcMessage({
        type: 'success',
        text: status.installed_exists
          ? 'SimulationCraft updated successfully.'
          : 'SimulationCraft download completed.',
      });
    } catch (err: any) {
      setSimcMessage({
        type: 'error',
        text: err?.detail || err?.message || 'Failed to download latest SimC.',
      });
    } finally {
      setSimcUpdating(false);
    }
  };

  useEffect(() => {
    if (!isDesktop || !user) return;
    void refreshSimc();
  }, [user, simcDownloadChannel, refreshSimc]);

  useEffect(() => {
    if (!performanceSaved || !user) return;
    fetchJson(`${API_URL}/api/user/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: 'simc_download_channel',
        value: simcDownloadChannel,
      }),
    }).catch(() => {});
  }, [simcDownloadChannel, performanceSaved, user]);

  useEffect(() => {
    if (!performanceSaved || !user) return;
    fetchJson(`${API_URL}/api/user/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: 'simc_sim_channel',
        value: simcChannel || 'latest',
      }),
    }).catch(() => {});
  }, [simcChannel, performanceSaved, user]);

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
                    Manage local SimC binary and keep it updated.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={simcDownloadChannel}
                    onChange={(e) => setSimcDownloadChannel(e.target.value)}
                    className="rounded-md border border-border bg-surface-2 px-2 py-1 text-xs text-zinc-200 focus:border-gold/50 focus:outline-none"
                  >
                    <option value="latest">Latest</option>
                    <option value="weekly">Weekly</option>
                    <option value="nightly">Nightly</option>
                  </select>
                  <button
                    onClick={() => void refreshSimc()}
                    disabled={simcLoading || simcUpdating}
                    className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-zinc-200 transition-colors hover:bg-white/10 disabled:opacity-50"
                  >
                    {simcLoading ? 'Checking...' : 'Refresh'}
                  </button>
                </div>
              </div>

              <div className="rounded-lg border border-border bg-surface-2 p-3 text-[12px]">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-zinc-500">Installed</span>
                  <span className="font-mono text-zinc-100">
                    {simcStatus?.installed_version ??
                      (simcStatus?.installed_exists ? 'Detected' : 'Missing')}
                  </span>
                </div>
                <div className="mt-1.5 flex items-center justify-between gap-4">
                  <span className="text-zinc-500">Remote ({simcDownloadChannel})</span>
                  <span className="font-mono text-zinc-100">
                    {simcStatus?.latest_version || (simcLoading ? 'Checking...' : 'Unavailable')}
                  </span>
                </div>
                {simcStatus && (
                  <p
                    className={`mt-2 font-medium ${
                      simcStatus.update_available ? 'text-amber-300' : 'text-emerald-300'
                    }`}
                  >
                    {simcStatus.update_available
                      ? 'A newer SimC build is available.'
                      : 'Installed SimC is up to date.'}
                  </p>
                )}
                {(simcStatus?.detail || simcMessage) && (
                  <p className="mt-2 text-red-300">
                    {simcMessage?.type === 'error'
                      ? simcMessage.text
                      : simcStatus?.detail || simcMessage?.text}
                  </p>
                )}
              </div>

              <button
                onClick={downloadSimc}
                disabled={
                  simcUpdating ||
                  simcLoading ||
                  !simcStatus ||
                  !simcStatus.latest_version ||
                  !simcStatus.update_available
                }
                className="rounded-lg border border-amber-700/50 bg-amber-950/30 px-4 py-2 text-sm font-semibold text-amber-200 transition-colors hover:bg-amber-900/40 disabled:opacity-50"
              >
                {simcUpdating
                  ? `Downloading ${simcDownloadChannel} SimC...`
                  : `Download ${simcDownloadChannel} SimC`}
              </button>
            </div>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-border/50 bg-surface/30 p-6 backdrop-blur-sm">
        <h2 className="mb-3 text-xl font-semibold text-white">Game Data Cache</h2>
        <p className="mb-5 text-sm text-zinc-400">
          Refetch game data and reload the backend cache used for gems, enchants, items, raids, and
          dungeon loot.
        </p>

        <div className="max-w-2xl space-y-4">
          <div className="flex items-center gap-4">
            <button
              onClick={refreshDataCache}
              disabled={cacheSyncing}
              className="rounded-lg bg-gold/10 px-6 py-2.5 text-sm font-semibold text-gold transition-colors hover:bg-gold/20 disabled:opacity-50"
            >
              {cacheSyncing ? 'Refreshing Cache...' : 'Refresh Game Data Cache'}
            </button>
            {cacheSyncing && (
              <span className="text-xs uppercase tracking-wide text-zinc-500">
                Sync in progress
              </span>
            )}
          </div>

          {!!cacheSyncProgress && (
            <div className="rounded-lg border border-border bg-surface-2 p-3">
              <p className="text-sm text-zinc-200">
                {parseProgress(cacheSyncProgress).details || cacheSyncProgress}
              </p>
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
    </div>
  );
}
