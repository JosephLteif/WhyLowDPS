'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '../components/AuthContext';
import { useRouter } from 'next/navigation';
import {
  API_URL,
  type BlizzardCredentialProfile,
  deleteBlizzardCredentialProfile,
  fetchJson,
  isDesktop,
  listBlizzardCredentialProfiles,
  renameBlizzardCredentialProfile,
  saveBlizzardCredentialProfile,
} from '../lib/api';
import { useSimContext } from '../components/SimContext';
import DefaultOptionsSettingsCard from '../components/DefaultOptionsSettingsCard';
import DataCacheSettingsSection from './components/DataCacheSettingsSection';
import DataFilePreviewModal from './components/DataFilePreviewModal';
import DataFileStateModal from './components/DataFileStateModal';
import IntegrationsSettingsSection from './components/IntegrationsSettingsSection';
import UpdatesSettingsSection from './components/UpdatesSettingsSection';
import {
  fetchSimcRuntimeInfo,
  fetchSimcRuntimeVersions,
  type SimcRuntimeInfo,
  type SimcRuntimeVersionOption,
} from '../lib/simc-runtime-release';
import { useDataCacheRefresh } from './useDataCacheRefresh';
import { useDataFileStateManager } from './useDataFileStateManager';
import { useSettingsUpdater } from './useSettingsUpdater';

const PRESETS = [
  { label: 'Balanced', pct: 0.3 },
  { label: 'Performance', pct: 0.6 },
  { label: 'Maximum', pct: 0.9 },
] as const;

type CloseBehaviorPreferenceResponse = {
  minimize_to_tray_on_close?: boolean | null;
};
type CloseBehaviorMode = 'ask' | 'close' | 'tray';
type SimcUpdateChannel = 'weekly' | 'nightly';
type SimcUpdateChannelResponse = {
  channel?: string | null;
};
type SimcRuntimeVersionPreferenceResponse = {
  version?: string | null;
};
type SimcRuntimeStatusResponse = {
  channel?: string | null;
  version?: string | null;
  updated?: boolean | null;
};

type SettingsTab = 'simulation' | 'integrations' | 'data' | 'updates' | 'about';

export default function SettingsPage() {
  const { user, loading: authLoading } = useAuth();
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
  const [credentialName, setCredentialName] = useState('');
  const [credentialProfiles, setCredentialProfiles] = useState<BlizzardCredentialProfile[]>([]);
  const [secretTouched, setSecretTouched] = useState(false);
  const [hasSecret, setHasSecret] = useState(false);
  const [maxThreads, setMaxThreads] = useState(0);
  const [pageLoading, setPageLoading] = useState(true);
  const [blizzardSaving, setBlizzardSaving] = useState(false);
  const [blizzardTesting, setBlizzardTesting] = useState(false);
  const [blizzardMessage, setBlizzardMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [performanceSaved, setPerformanceSaved] = useState(false);
  const { cacheSyncing, cacheMessage, syncProgress, syncProgressPct, refreshDataCache } =
    useDataCacheRefresh();
  const {
    dataStateLoading,
    dataStateError,
    dataStateMessage,
    dataStateOpen,
    setDataStateOpen,
    dataFileStates,
    dataActionBusyKey,
    dataFilePreview,
    dataFilePreviewOpen,
    setDataFilePreviewOpen,
    dataFilePreviewLoading,
    dataFilePreviewError,
    viewDataStates,
    refreshDataStates,
    downloadFile,
    downloadAllMissingFiles,
    openDataRootDirectory,
    showFileContent,
    groupedDataFiles,
  } = useDataFileStateManager();
  const [refreshPreset, setRefreshPreset] = useState<'disabled' | 'daily' | 'weekly'>('disabled');
  const [activeTab, setActiveTab] = useState<SettingsTab>('simulation');
  const [closeBehaviorMode, setCloseBehaviorMode] = useState<CloseBehaviorMode>('ask');
  const [closeBehaviorLoading, setCloseBehaviorLoading] = useState(false);
  const [closeBehaviorMessage, setCloseBehaviorMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [selectedSimcChannel, setSelectedSimcChannelState] = useState<SimcUpdateChannel>('weekly');
  const [selectedSimcRuntimeVersion, setSelectedSimcRuntimeVersionState] = useState<string | null>(
    null
  );
  const [simcChannelMessage, setSimcChannelMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [simcRuntimeInfo, setSimcRuntimeInfo] = useState<SimcRuntimeInfo | null>(null);
  const [simcRuntimeVersions, setSimcRuntimeVersions] = useState<SimcRuntimeVersionOption[]>([]);
  const [simcRuntimeVersionsLoading, setSimcRuntimeVersionsLoading] = useState(false);
  const [simcRuntimeInfoLoading, setSimcRuntimeInfoLoading] = useState(false);
  const [simcRuntimeDownloading, setSimcRuntimeDownloading] = useState(false);
  const {
    updateCheckState,
    updateMessage,
    appReleases,
    appReleaseMetadataStatus,
    selectedAppVersion,
    setSelectedAppVersion,
    loadAppReleases,
    downloadAndInstallLatest,
  } = useSettingsUpdater({ performanceSaved, hasUser: !!user });

  useEffect(() => {
    if (authLoading) {
      return;
    }

    if (!user) {
      router.replace('/');
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
        setPageLoading(false);
      });
  }, [authLoading, user, router, setMaxCombinations, setThreads]);

  useEffect(() => {
    if (!user || !isDesktop) return;
    listBlizzardCredentialProfiles()
      .then(setCredentialProfiles)
      .catch(() => setCredentialProfiles([]));
  }, [user]);

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
    if (!isDesktop) return;
    let cancelled = false;
    setCloseBehaviorLoading(true);
    (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const pref = await invoke<CloseBehaviorPreferenceResponse>('get_close_behavior_preference');
        if (cancelled) return;
        const savedValue = pref?.minimize_to_tray_on_close;
        setCloseBehaviorMode(savedValue == null ? 'ask' : savedValue ? 'tray' : 'close');
      } catch {
      } finally {
        if (!cancelled) setCloseBehaviorLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isDesktop) return;
    let cancelled = false;
    (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const pref = await invoke<SimcUpdateChannelResponse>('get_simc_update_channel');
        const versionPref = await invoke<SimcRuntimeVersionPreferenceResponse>(
          'get_simc_runtime_version'
        );
        if (cancelled) return;
        setSelectedSimcChannelState(pref?.channel === 'nightly' ? 'nightly' : 'weekly');
        setSelectedSimcRuntimeVersionState(versionPref?.version || null);
      } catch {
        if (!cancelled) {
          setSelectedSimcChannelState('weekly');
          setSelectedSimcRuntimeVersionState(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (dataCacheRefreshMinutes >= 7 * 24 * 60) {
      setRefreshPreset('weekly');
      return;
    }
    if (dataCacheRefreshMinutes >= 24 * 60) {
      setRefreshPreset('daily');
      return;
    }
    setRefreshPreset('disabled');
  }, [dataCacheRefreshMinutes]);

  const testBlizzardCredentials = async () => {
    setBlizzardTesting(true);
    setBlizzardMessage(null);
    try {
      const payload: Record<string, string> = { client_id: clientId.trim() };
      payload.client_secret = clientSecret.trim();
      await fetchJson(`${API_URL}/api/user/blizzard/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      setBlizzardMessage({ type: 'success', text: 'Blizzard credentials verified successfully.' });
    } catch (err: any) {
      setBlizzardMessage({
        type: 'error',
        text: err.message || 'Failed to verify Blizzard credentials.',
      });
    }
    setBlizzardTesting(false);
  };

  const saveBlizzardSettings = async () => {
    if (!clientId.trim() && !clientSecret.trim()) return;
    setBlizzardSaving(true);
    setBlizzardMessage(null);
    try {
      await fetchJson(`${API_URL}/api/user/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'blizzard_client_id', value: clientId.trim() }),
      });

      if (clientSecret.trim()) {
        const profile = await saveBlizzardCredentialProfile({
          name: credentialName.trim() || 'Main credentials',
          client_id: clientId.trim(),
          client_secret: clientSecret.trim(),
        });
        setCredentialProfiles((profiles) => {
          const next = profiles.filter((item) => item.id !== profile.id);
          return [...next, profile];
        });
        setHasSecret(true);
        setCredentialName('');
        setClientSecret('');
        setSecretTouched(false);
      }
      setBlizzardMessage({ type: 'success', text: 'Blizzard credentials saved securely.' });
    } catch (err: any) {
      setBlizzardMessage({
        type: 'error',
        text: err?.message || 'Failed to save Blizzard settings.',
      });
    } finally {
      setBlizzardSaving(false);
    }
  };

  const renameSavedCredential = async (id: string, nextName: string) => {
    const trimmedName = nextName.trim();
    if (!trimmedName) return;
    try {
      const profile = await renameBlizzardCredentialProfile(id, trimmedName);
      setCredentialProfiles((profiles) =>
        profiles.map((item) => (item.id === id ? profile : item))
      );
    } catch (err: any) {
      setBlizzardMessage({ type: 'error', text: err?.message || 'Failed to rename credentials.' });
    }
  };

  const deleteSavedCredential = async (id: string) => {
    if (!window.confirm('Remove these saved Blizzard credentials from this device?')) return;
    try {
      await deleteBlizzardCredentialProfile(id);
      setCredentialProfiles((profiles) => profiles.filter((profile) => profile.id !== id));
    } catch (err: any) {
      setBlizzardMessage({ type: 'error', text: err?.message || 'Failed to remove credentials.' });
    }
  };

  const updateCloseBehavior = async (nextMode: CloseBehaviorMode) => {
    if (!isDesktop) return;
    setCloseBehaviorMessage(null);
    const previous = closeBehaviorMode;
    setCloseBehaviorMode(nextMode);
    setCloseBehaviorLoading(true);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      if (nextMode === 'ask') {
        await invoke('clear_close_behavior_preference');
      } else {
        const nextValue = nextMode === 'tray';
        try {
          await invoke('set_close_behavior_preference', {
            minimizeToTrayOnClose: nextValue,
          });
        } catch {
          await invoke('set_close_behavior_preference', {
            minimize_to_tray_on_close: nextValue,
          });
        }
      }
      setCloseBehaviorMessage({
        type: 'success',
        text:
          nextMode === 'ask'
            ? 'Close action updated: ask every time.'
            : `Close action updated: ${nextMode === 'tray' ? 'minimize to tray' : 'close app'}.`,
      });
    } catch (err: any) {
      const detail =
        err?.message || err?.toString?.() || (typeof err === 'string' ? err : '') || '';
      setCloseBehaviorMode(previous);
      setCloseBehaviorMessage({
        type: 'error',
        text:
          nextMode === 'ask' && /command not found|not allowed/i.test(detail)
            ? 'Ask Every Time requires the latest desktop runtime. Restart the app and try again.'
            : detail || 'Failed to update close behavior.',
      });
    } finally {
      setCloseBehaviorLoading(false);
    }
  };

  const loadSimcRuntimeInfo = async (
    channel: SimcUpdateChannel,
    options?: { forceRefresh?: boolean }
  ) => {
    if (!isDesktop) return;
    setSimcRuntimeInfoLoading(true);
    const info = await fetchSimcRuntimeInfo(channel, options);
    setSimcRuntimeInfo(info);
    setSimcRuntimeInfoLoading(false);
  };

  const loadSimcRuntimeVersions = async () => {
    setSimcRuntimeVersionsLoading(true);
    const versions = await fetchSimcRuntimeVersions();
    setSimcRuntimeVersions(versions);
    setSimcRuntimeVersionsLoading(false);
  };

  useEffect(() => {
    if (!isDesktop) return;
    void loadSimcRuntimeInfo(selectedSimcChannel);
  }, [selectedSimcChannel]);

  useEffect(() => {
    if (!isDesktop) return;
    let cancelled = false;
    setSimcRuntimeVersionsLoading(true);
    fetchSimcRuntimeVersions()
      .then((versions) => {
        if (!cancelled) setSimcRuntimeVersions(versions);
      })
      .finally(() => {
        if (!cancelled) setSimcRuntimeVersionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setSelectedSimcChannel = async (nextChannel: SimcUpdateChannel) => {
    if (!isDesktop) return;
    const previous = selectedSimcChannel;
    setSelectedSimcChannelState(nextChannel);
    setSimcChannelMessage(null);
    const { invoke } = await import('@tauri-apps/api/core');
    let savedChannel: SimcUpdateChannel;
    try {
      const pref = await invoke<SimcUpdateChannelResponse>('set_simc_update_channel', {
        channel: nextChannel,
      });
      await invoke('set_simc_runtime_version', { version: null });
      savedChannel = pref?.channel === 'nightly' ? 'nightly' : 'weekly';
      setSelectedSimcChannelState(savedChannel);
      setSelectedSimcRuntimeVersionState(null);
    } catch (err: any) {
      setSelectedSimcChannelState(previous);
      setSimcChannelMessage({
        type: 'error',
        text: err?.message || err?.toString?.() || 'Failed to update SimC channel.',
      });
      return;
    }

    setSimcChannelMessage({
      type: 'success',
      text: `SimC channel saved as ${savedChannel}.`,
    });
  };

  const setSelectedSimcRuntimeVersion = async (value: string) => {
    if (!isDesktop) return;
    const previousChannel = selectedSimcChannel;
    const previousVersion = selectedSimcRuntimeVersion;
    const { invoke } = await import('@tauri-apps/api/core');
    const [mode, selected] = value.split(':', 2);
    const nextChannel =
      selected === 'nightly' || selected?.startsWith('nightly-') ? 'nightly' : 'weekly';
    const nextVersion = mode === 'version' ? selected : null;
    setSelectedSimcChannelState(nextChannel);
    setSelectedSimcRuntimeVersionState(nextVersion);
    setSimcChannelMessage(null);
    try {
      await invoke<SimcUpdateChannelResponse>('set_simc_update_channel', { channel: nextChannel });
      const pref = await invoke<SimcRuntimeVersionPreferenceResponse>('set_simc_runtime_version', {
        version: nextVersion,
      });
      setSelectedSimcRuntimeVersionState(pref?.version || null);
      setSimcChannelMessage({
        type: 'success',
        text: nextVersion
          ? `SimC pinned to ${nextVersion}.`
          : `SimC will follow latest ${nextChannel}.`,
      });
    } catch (err: any) {
      setSelectedSimcChannelState(previousChannel);
      setSelectedSimcRuntimeVersionState(previousVersion);
      setSimcChannelMessage({
        type: 'error',
        text: err?.message || err?.toString?.() || 'Failed to update SimC version.',
      });
    }
  };

  const downloadSelectedSimcRuntime = async () => {
    if (!isDesktop || simcRuntimeDownloading) return;
    const channel = selectedSimcChannel;
    setSimcRuntimeDownloading(true);
    setSimcChannelMessage({
      type: 'success',
      text: `Downloading ${channel} SimC runtime...`,
    });
    const { invoke } = await import('@tauri-apps/api/core');
    try {
      const status = await invoke<SimcRuntimeStatusResponse>('update_simc_runtime', {
        channel,
        version: selectedSimcRuntimeVersion,
      });
      const version = status?.version ? ` (${status.version})` : '';
      setSimcChannelMessage({
        type: 'success',
        text: status?.updated
          ? `SimC ${channel} runtime downloaded${version}.`
          : `SimC ${selectedSimcRuntimeVersion || channel} runtime is already up to date${version}.`,
      });
      await loadSimcRuntimeInfo(channel);
    } catch (err: any) {
      setSimcChannelMessage({
        type: 'error',
        text: err?.message || err?.toString?.() || `SimC ${channel} runtime download failed.`,
      });
    } finally {
      setSimcRuntimeDownloading(false);
    }
  };

  const activePresetIdx = PRESETS.findIndex(
    (p) => maxThreads > 0 && Math.max(1, Math.round(maxThreads * p.pct)) === threads
  );

  if (authLoading || pageLoading) {
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
        <p className="mt-2 text-zinc-400">Manage your account and integrations.</p>
      </header>

      <div className="flex flex-wrap gap-2">
        {[
          { id: 'simulation', label: 'Simulation' },
          { id: 'integrations', label: 'Integrations' },
          { id: 'data', label: 'Data Cache' },
          { id: 'updates', label: 'App Updates' },
          { id: 'about', label: 'About' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as SettingsTab)}
            className={`rounded-lg border px-4 py-2 text-sm font-semibold transition-colors ${
              activeTab === tab.id
                ? 'border-gold/40 bg-gold/15 text-gold'
                : 'border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'simulation' && <DefaultOptionsSettingsCard />}

      {activeTab === 'integrations' && (
        <IntegrationsSettingsSection
          clientId={clientId}
          setClientId={setClientId}
          clientSecret={clientSecret}
          setClientSecret={setClientSecret}
          credentialName={credentialName}
          setCredentialName={setCredentialName}
          credentialProfiles={credentialProfiles}
          renameSavedCredential={renameSavedCredential}
          deleteSavedCredential={deleteSavedCredential}
          secretTouched={secretTouched}
          setSecretTouched={setSecretTouched}
          hasSecret={hasSecret}
          blizzardTesting={blizzardTesting}
          blizzardSaving={blizzardSaving}
          testBlizzardCredentials={testBlizzardCredentials}
          saveBlizzardSettings={saveBlizzardSettings}
          blizzardMessage={blizzardMessage}
        />
      )}

      {activeTab === 'simulation' && (
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
          </div>
        </section>
      )}

      {activeTab === 'simulation' && (
        <section className="rounded-xl border border-border/50 bg-surface/30 p-6 backdrop-blur-sm">
          <h2 className="mb-3 text-xl font-semibold text-white">Clipboard Import</h2>
          <p className="mb-5 text-sm text-zinc-400">
            When the app regains focus, it can check the latest clipboard text and auto-fill the
            SimC export box if it looks like a valid SimC string.
          </p>

          <div className="space-y-4">
            <div className="flex max-w-2xl items-center justify-between gap-4 rounded-lg border border-border/60 bg-surface-2/60 px-4 py-3">
              <div className="space-y-1">
                <p className="text-sm font-medium text-zinc-200">
                  Auto paste latest SimC from clipboard
                </p>
                <p className="text-[13px] text-zinc-500">
                  Read the latest clipboard entry and automatically paste it into the main input if
                  it looks like a SimC profile.
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
          </div>
        </section>
      )}

      {activeTab === 'simulation' && isDesktop && (
        <section className="rounded-xl border border-border/50 bg-surface/30 p-6 backdrop-blur-sm">
          <h2 className="mb-3 text-xl font-semibold text-white">Close Behavior</h2>
          <p className="mb-5 text-sm text-zinc-400">
            Choose what happens when you close the app window.
          </p>

          <div className="max-w-2xl space-y-4">
            <div className="inline-flex rounded-lg border border-border bg-surface-2 p-1">
              <button
                type="button"
                disabled={closeBehaviorLoading}
                onClick={() => void updateCloseBehavior('ask')}
                className={`rounded-md px-4 py-2 text-sm font-semibold transition-colors ${
                  closeBehaviorMode === 'ask'
                    ? 'bg-white text-black'
                    : 'text-zinc-300 hover:text-white'
                }`}
              >
                Ask Every Time
              </button>
              <button
                type="button"
                disabled={closeBehaviorLoading}
                onClick={() => void updateCloseBehavior('close')}
                className={`rounded-md px-4 py-2 text-sm font-semibold transition-colors ${
                  closeBehaviorMode === 'close'
                    ? 'bg-white text-black'
                    : 'text-zinc-300 hover:text-white'
                }`}
              >
                Close App
              </button>
              <button
                type="button"
                disabled={closeBehaviorLoading}
                onClick={() => void updateCloseBehavior('tray')}
                className={`rounded-md px-4 py-2 text-sm font-semibold transition-colors ${
                  closeBehaviorMode === 'tray'
                    ? 'bg-gold/20 text-gold'
                    : 'text-zinc-300 hover:text-white'
                }`}
              >
                Minimize to Tray
              </button>
            </div>

            {closeBehaviorMessage ? (
              <p
                className={`text-xs ${
                  closeBehaviorMessage.type === 'success' ? 'text-emerald-300' : 'text-red-300'
                }`}
              >
                {closeBehaviorMessage.text}
              </p>
            ) : null}
          </div>
        </section>
      )}

      {activeTab === 'data' && (
        <DataCacheSettingsSection
          refreshPreset={refreshPreset}
          setRefreshPreset={setRefreshPreset}
          setDataCacheRefreshMinutes={setDataCacheRefreshMinutes}
          cacheSyncing={cacheSyncing}
          refreshDataCache={refreshDataCache}
          viewDataStates={viewDataStates}
          syncProgress={syncProgress}
          syncProgressPct={syncProgressPct}
          cacheMessage={cacheMessage}
        />
      )}

      {activeTab === 'updates' && (
        <UpdatesSettingsSection
          selectedSimcChannel={selectedSimcChannel}
          setSelectedSimcChannel={setSelectedSimcChannel}
          selectedSimcRuntimeVersion={selectedSimcRuntimeVersion}
          setSelectedSimcRuntimeVersion={setSelectedSimcRuntimeVersion}
          simcRuntimeVersions={simcRuntimeVersions}
          simcRuntimeVersionsLoading={simcRuntimeVersionsLoading}
          simcRuntimeInfo={simcRuntimeInfo}
          simcRuntimeInfoLoading={simcRuntimeInfoLoading}
          simcRuntimeDownloading={simcRuntimeDownloading}
          refreshSimcRuntimeInfo={() => {
            void loadSimcRuntimeInfo(selectedSimcChannel, { forceRefresh: true });
            void loadSimcRuntimeVersions();
          }}
          downloadSelectedSimcRuntime={downloadSelectedSimcRuntime}
          simcChannelMessage={simcChannelMessage}
          isDesktopRuntime={isDesktop}
          updateCheckState={updateCheckState}
          appReleases={appReleases}
          appReleaseMetadataStatus={appReleaseMetadataStatus}
          selectedAppVersion={selectedAppVersion}
          setSelectedAppVersion={setSelectedAppVersion}
          loadAppReleases={loadAppReleases}
          downloadAndInstallLatest={downloadAndInstallLatest}
          updateMessage={updateMessage}
        />
      )}

      {activeTab === 'about' && (
        <section className="rounded-xl border border-border/50 bg-surface/10 p-6 opacity-60">
          <h2 className="mb-4 text-xl font-semibold text-white">Account Security</h2>
          <p className="text-sm text-zinc-400">
            Your credentials are used solely to fetch character data directly from Blizzard. They
            are stored in on your device and are never shared with third parties.
          </p>
        </section>
      )}

      <DataFileStateModal
        isOpen={dataStateOpen}
        onClose={() => setDataStateOpen(false)}
        disableOutsideDismiss={dataFilePreviewOpen}
        isDesktop={isDesktop}
        dataFileStates={dataFileStates}
        dataStateLoading={dataStateLoading}
        dataStateError={dataStateError}
        dataStateMessage={dataStateMessage}
        dataActionBusyKey={dataActionBusyKey}
        groupedDataFiles={groupedDataFiles}
        refreshDataStates={refreshDataStates}
        downloadAllMissingFiles={downloadAllMissingFiles}
        openDataRootDirectory={openDataRootDirectory}
        downloadFile={downloadFile}
        showFileContent={showFileContent}
        dataFilePreviewLoading={dataFilePreviewLoading}
      />
      <DataFilePreviewModal
        isOpen={dataFilePreviewOpen}
        onClose={() => setDataFilePreviewOpen(false)}
        dataFilePreview={dataFilePreview}
        dataFilePreviewLoading={dataFilePreviewLoading}
        dataFilePreviewError={dataFilePreviewError}
      />
    </div>
  );
}
