import { UNIT_TO_MINUTES, type RefreshUnit } from '../refreshInterval';
import type { SettingsStatusMessage } from '../types';
import type { DataCacheSyncProgress } from '../useDataCacheRefresh';
import { formatBytesDecimal, formatElapsedCompact, formatTransferSpeed } from '../../lib/format';

type DataCacheSettingsSectionProps = {
  refreshEveryValue: number;
  setRefreshEveryValue: (value: number) => void;
  refreshEveryUnit: RefreshUnit;
  setRefreshEveryUnit: (unit: RefreshUnit) => void;
  setDataCacheRefreshMinutes: (minutes: number) => void;
  cacheSyncing: boolean;
  refreshDataCache: () => Promise<void>;
  viewDataStates: () => Promise<void>;
  syncProgress: DataCacheSyncProgress;
  syncProgressPct: number;
  cacheMessage: SettingsStatusMessage | null;
};

export default function DataCacheSettingsSection({
  refreshEveryValue,
  setRefreshEveryValue,
  refreshEveryUnit,
  setRefreshEveryUnit,
  setDataCacheRefreshMinutes,
  cacheSyncing,
  refreshDataCache,
  viewDataStates,
  syncProgress,
  syncProgressPct,
  cacheMessage,
}: DataCacheSettingsSectionProps) {
  const fileProgressPct =
    syncProgress.totalBytes > 0
      ? Math.min(100, Math.round((syncProgress.downloadedBytes / syncProgress.totalBytes) * 100))
      : null;

  return (
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
            onClick={() => void refreshDataCache()}
            disabled={cacheSyncing}
            className="rounded-lg bg-gold/10 px-6 py-2.5 text-sm font-semibold text-gold transition-colors hover:bg-gold/20 disabled:opacity-50"
          >
            {cacheSyncing ? 'Refreshing Cache...' : 'Refresh Game Data Cache'}
          </button>
          <button
            onClick={() => void viewDataStates()}
            className="rounded-lg border border-white/10 bg-white/5 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/10"
          >
            View Data State
          </button>
          {cacheSyncing && (
            <span className="text-xs uppercase tracking-wide text-zinc-500">Sync in progress</span>
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
            {syncProgress.task === 'Files' && (
              <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-zinc-500">
                <span>File size</span>
                <span className="text-right text-zinc-300">
                  {formatBytesDecimal(syncProgress.totalBytes)}
                </span>
                <span>Downloaded</span>
                <span className="text-right text-zinc-300">
                  {formatBytesDecimal(syncProgress.downloadedBytes)}
                  {fileProgressPct != null ? ` (${fileProgressPct}%)` : ''}
                </span>
                <span>Speed</span>
                <span className="text-right text-zinc-300">
                  {formatTransferSpeed(syncProgress.speedBytesPerSec)}
                </span>
                <span>Time spent</span>
                <span className="text-right text-zinc-300">
                  {formatElapsedCompact(syncProgress.elapsedSeconds)}
                </span>
              </div>
            )}
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
  );
}
