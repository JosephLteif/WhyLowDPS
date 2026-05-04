'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../components/AuthContext';
import { useRouter } from 'next/navigation';
import { API_URL, fetchJson, isDesktop } from '../lib/api';
import { formatBytesDecimal } from '../lib/format';
import { useSimContext } from '../components/SimContext';
import { useDismissOnOutside } from '../lib/useDismissOnOutside';
import DefaultOptionsSettingsCard from '../components/DefaultOptionsSettingsCard';
import { isValidUpdateChannel } from '../lib/update-channel';
import { chooseBestRefreshUnit, type RefreshUnit } from './refreshInterval';
import DataCacheSettingsSection from './components/DataCacheSettingsSection';
import IntegrationsSettingsSection from './components/IntegrationsSettingsSection';
import UpdatesSettingsSection from './components/UpdatesSettingsSection';
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

type SettingsTab = 'simulation' | 'integrations' | 'data' | 'updates' | 'about';

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
  const [blizzardSaving, setBlizzardSaving] = useState(false);
  const [blizzardTesting, setBlizzardTesting] = useState(false);
  const [blizzardMessage, setBlizzardMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [performanceSaved, setPerformanceSaved] = useState(false);
  const {
    cacheSyncing,
    cacheSyncProgress,
    cacheMessage,
    syncProgress,
    syncProgressPct,
    refreshDataCache,
  } = useDataCacheRefresh();
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
    sectionSummaries,
  } = useDataFileStateManager();
  const initialRefresh = chooseBestRefreshUnit(dataCacheRefreshMinutes);
  const [refreshEveryValue, setRefreshEveryValue] = useState(initialRefresh.value);
  const [refreshEveryUnit, setRefreshEveryUnit] = useState<RefreshUnit>(initialRefresh.unit);
  const [activeTab, setActiveTab] = useState<SettingsTab>('simulation');
  const [minimizeToTrayOnClose, setMinimizeToTrayOnClose] = useState(true);
  const [closeBehaviorLoading, setCloseBehaviorLoading] = useState(false);
  const [closeBehaviorMessage, setCloseBehaviorMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const {
    updateCheckState,
    updateMessage,
    selectedUpdateChannel,
    setSelectedUpdateChannel,
    checkForUpdatesNow,
    downloadAndInstallLatest,
  } = useSettingsUpdater({ performanceSaved, hasUser: !!user });
  const dataStateModalRef = useRef<HTMLDivElement | null>(null);
  const dataFilePreviewModalRef = useRef<HTMLDivElement | null>(null);
  useDismissOnOutside(dataStateModalRef, dataStateOpen && !dataFilePreviewOpen, () =>
    setDataStateOpen(false)
  );
  useDismissOnOutside(dataFilePreviewModalRef, dataFilePreviewOpen, () => setDataFilePreviewOpen(false));

  useEffect(() => {
    if (!user) {
      router.push('/');
      return;
    }

    fetchJson<any>(`${API_URL}/api/user/config`)
      .then((data) => {
        setClientId(data.blizzard_client_id || '');
        setHasSecret(data.has_blizzard_client_secret || false);
        const serverUpdateChannel =
          typeof data.app_update_channel === 'string'
            ? data.app_update_channel.toLowerCase()
            : '';
        if (isValidUpdateChannel(serverUpdateChannel)) {
          setSelectedUpdateChannel(serverUpdateChannel);
        }
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
    if (!isDesktop) return;
    let cancelled = false;
    setCloseBehaviorLoading(true);
    (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const pref = await invoke<CloseBehaviorPreferenceResponse>('get_close_behavior_preference');
        if (cancelled) return;
        const savedValue = pref?.minimize_to_tray_on_close;
        setMinimizeToTrayOnClose(savedValue !== false);
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
    const derived = chooseBestRefreshUnit(dataCacheRefreshMinutes);
    setRefreshEveryValue(derived.value);
    setRefreshEveryUnit(derived.unit);
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
      setBlizzardMessage({ type: 'error', text: err.message || 'Failed to verify Blizzard credentials.' });
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
      setBlizzardMessage({ type: 'success', text: 'Blizzard settings saved successfully.' });
    } catch (err: any) {
      setBlizzardMessage({ type: 'error', text: err?.message || 'Failed to save Blizzard settings.' });
    } finally {
      setBlizzardSaving(false);
    }
  };

  const updateCloseBehavior = async (nextValue: boolean) => {
    if (!isDesktop) return;
    setCloseBehaviorMessage(null);
    setMinimizeToTrayOnClose(nextValue);
    setCloseBehaviorLoading(true);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      try {
        await invoke('set_close_behavior_preference', {
          minimizeToTrayOnClose: nextValue,
        });
      } catch {
        await invoke('set_close_behavior_preference', {
          minimize_to_tray_on_close: nextValue,
        });
      }
      setCloseBehaviorMessage({
        type: 'success',
        text: `Close action updated: ${nextValue ? 'minimize to tray' : 'close app'}.`,
      });
    } catch (err: any) {
      setMinimizeToTrayOnClose(!nextValue);
      setCloseBehaviorMessage({
        type: 'error',
        text: err?.message || 'Failed to update close behavior.',
      });
    } finally {
      setCloseBehaviorLoading(false);
    }
  };

  const formatBytes = (n: number) =>
    formatBytesDecimal(n, { empty: '0 B', includeBytes: true, kbDigits: 1, mbDigits: 1 });

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

      {activeTab === 'simulation' && <section className="rounded-xl border border-border/50 bg-surface/30 p-6 backdrop-blur-sm">
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
              <div className="rounded-lg border border-border/70 bg-surface px-4 py-3">
                <p className="text-sm font-medium text-zinc-200">SimulationCraft Engine</p>
                <p className="mt-1 text-[12px] text-zinc-400">
                  SimulationCraft is now bundled at build time with the app installer.
                  Runtime/background SimC downloading is disabled.
                </p>
                <p className="mt-2 text-[12px] text-zinc-500">
                  To get newer SimC binaries, switch update channel in App Updates
                  (Stable, Weekly, Nightly) and install that release build.
                </p>
              </div>
              <div className="space-y-3 rounded-lg border border-border/70 bg-surface px-4 py-3">
                <div className="flex items-center justify-between gap-4">
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-zinc-200">Minimize to tray on close</p>
                    <p className="text-[12px] text-zinc-500">
                      If enabled, closing the main window hides the app to the system tray instead
                      of exiting.
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={closeBehaviorLoading}
                    onClick={() => void updateCloseBehavior(!minimizeToTrayOnClose)}
                    className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
                      minimizeToTrayOnClose ? 'bg-gold' : 'border border-border bg-surface'
                    }`}
                    aria-pressed={minimizeToTrayOnClose}
                  >
                    <span
                      className={`absolute top-0.5 h-5 w-5 rounded-full transition-all ${
                        minimizeToTrayOnClose ? 'left-[22px] bg-black' : 'left-0.5 bg-gray-500'
                      }`}
                    />
                  </button>
                </div>
                {closeBehaviorMessage && (
                  <div
                    className={`rounded-md border px-3 py-2 text-[12px] ${
                      closeBehaviorMessage.type === 'success'
                        ? 'border-emerald-700/40 bg-emerald-950/25 text-emerald-300'
                        : 'border-red-700/40 bg-red-950/25 text-red-300'
                    }`}
                  >
                    {closeBehaviorMessage.text}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </section>}

      {activeTab === 'simulation' && <section className="rounded-xl border border-border/50 bg-surface/30 p-6 backdrop-blur-sm">
        <h2 className="mb-3 text-xl font-semibold text-white">Clipboard Import</h2>
        <p className="mb-5 text-sm text-zinc-400">
          When the app regains focus, it can check the latest clipboard text and auto-fill the SimC
          export box if it looks like a valid SimC string.
        </p>

        <div className="space-y-4">
          <div className="flex max-w-2xl items-center justify-between gap-4 rounded-lg border border-border/60 bg-surface-2/60 px-4 py-3">
            <div className="space-y-1">
              <p className="text-sm font-medium text-zinc-200">
                Auto paste latest SimC from clipboard
              </p>
              <p className="text-[13px] text-zinc-500">
                Read the latest clipboard entry and automatically paste it into the main input if it
                looks like a SimC profile.
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
      </section>}

      {activeTab === 'data' && (
        <DataCacheSettingsSection
          refreshEveryValue={refreshEveryValue}
          setRefreshEveryValue={setRefreshEveryValue}
          refreshEveryUnit={refreshEveryUnit}
          setRefreshEveryUnit={setRefreshEveryUnit}
          setDataCacheRefreshMinutes={setDataCacheRefreshMinutes}
          cacheSyncing={cacheSyncing}
          refreshDataCache={refreshDataCache}
          viewDataStates={viewDataStates}
          syncProgress={syncProgress}
          syncProgressPct={syncProgressPct}
          cacheSyncProgress={cacheSyncProgress}
          cacheMessage={cacheMessage}
        />
      )}

      {activeTab === 'updates' && (
        <UpdatesSettingsSection
          selectedUpdateChannel={selectedUpdateChannel}
          setSelectedUpdateChannel={setSelectedUpdateChannel}
          updateCheckState={updateCheckState}
          checkForUpdatesNow={checkForUpdatesNow}
          downloadAndInstallLatest={downloadAndInstallLatest}
          updateMessage={updateMessage}
        />
      )}

      {activeTab === 'about' && <section className="rounded-xl border border-border/50 bg-surface/10 p-6 opacity-60">
        <h2 className="mb-4 text-xl font-semibold text-white">Account Security</h2>
        <p className="text-sm text-zinc-400">
          Your credentials are used solely to fetch character data directly from Blizzard. They are
          stored in our secure database and are never shared with third parties.
        </p>
      </section>}

      {dataStateOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 p-4">
          <div ref={dataStateModalRef} className="max-h-[80vh] w-full max-w-3xl overflow-hidden rounded-xl border border-border bg-[#121212] shadow-2xl">
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
          <div ref={dataFilePreviewModalRef} className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-border bg-[#101010] shadow-2xl">
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

