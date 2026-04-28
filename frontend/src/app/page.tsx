'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { API_URL, fetchJson, getHistoryStats, getSystemStats, listCharacterProfiles, type HistoryStats, isDesktop, listSims } from './lib/api';
import { useSimContext } from './components/SimContext';
import VaultRewardsGrid, { type VaultRewardItem } from './components/VaultRewardsGrid';
import { simResultHref } from './lib/routes';
import { CLASS_COLORS, type SimSummary } from './lib/types';

type SimStatus = SimSummary['status'];

const STATUS_STYLES: Record<SimStatus, string> = {
  done: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30',
  running: 'bg-amber-500/15 text-amber-300 border border-amber-500/30',
  failed: 'bg-red-500/15 text-red-300 border border-red-500/30',
  pending: 'bg-zinc-600/20 text-zinc-300 border border-zinc-600/40',
  cancelled: 'bg-zinc-700/30 text-zinc-300 border border-zinc-600/50',
};

const SIM_TYPE_LABELS: Record<string, string> = {
  quick: 'Quick Sim',
  top_gear: 'Top Gear',
  droptimizer: 'Drop Finder',
  upgrade_compare: 'Upgrade Compare',
  stat_weights: 'Stat Weights',
  stat_plot: 'Stat Plot',
  external_buff_matrix: 'External Buff Matrix',
  consumable_matrix: 'Consumable Matrix',
  trinket_tier_heatmap: 'Trinket / Tier Heatmaps',
};

const relativeFormatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

function StatIcon({ children }: { children: ReactNode }) {
  return (
    <div
      className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-surface-2 text-zinc-200">
      {children}
    </div>
  );
}

function ActiveIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 6v6l4 2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="8" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M8 7h10M8 12h10M8 17h10" strokeLinecap="round" />
      <circle cx="5" cy="7" r="1" fill="currentColor" />
      <circle cx="5" cy="12" r="1" fill="currentColor" />
      <circle cx="5" cy="17" r="1" fill="currentColor" />
    </svg>
  );
}

function DatabaseIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <ellipse cx="12" cy="6" rx="7" ry="3" />
      <path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6" />
      <path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" />
    </svg>
  );
}

function CpuIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="7" y="7" width="10" height="10" rx="1.5" />
      <path d="M10 10h4v4h-4z" />
      <path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3" />
    </svg>
  );
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[i]}`;
}

function formatRelativeTime(dateIso: string): string {
  const target = new Date(dateIso).getTime();
  if (!Number.isFinite(target)) return '-';
  const diffSec = Math.round((target - Date.now()) / 1000);
  const absSec = Math.abs(diffSec);
  if (absSec < 60) return relativeFormatter.format(diffSec, 'second');
  const diffMin = Math.round(diffSec / 60);
  if (Math.abs(diffMin) < 60) return relativeFormatter.format(diffMin, 'minute');
  const diffHour = Math.round(diffMin / 60);
  if (Math.abs(diffHour) < 24) return relativeFormatter.format(diffHour, 'hour');
  const diffDay = Math.round(diffHour / 24);
  return relativeFormatter.format(diffDay, 'day');
}

function classColor(playerClass?: string): string {
  if (!playerClass) return '#d4d4d8';
  const key = playerClass.toLowerCase().replace(/[\s-]+/g, '_');
  return CLASS_COLORS[key] || CLASS_COLORS[key.replace(/_/g, '')] || '#d4d4d8';
}

function chartDateLabel(date: Date): string {
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function buildActivityData(sims: SimSummary[], days = 14): { date: string; count: number }[] {
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  const start = new Date(end);
  start.setDate(start.getDate() - (days - 1));

  const byDay = new Map<string, number>();
  for (let i = 0; i < days; i += 1) {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    byDay.set(day.toISOString().slice(0, 10), 0);
  }

  for (const sim of sims) {
    const created = new Date(sim.created_at);
    if (!Number.isFinite(created.getTime())) continue;
    created.setHours(0, 0, 0, 0);
    const key = created.toISOString().slice(0, 10);
    if (!byDay.has(key)) continue;
    byDay.set(key, (byDay.get(key) || 0) + 1);
  }

  return [...byDay.entries()].map(([iso, count]) => ({
    date: chartDateLabel(new Date(iso)),
    count,
  }));
}

function toTimestampMs(raw: unknown): number {
  const n = Number(raw || 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n < 1_000_000_000_000 ? n * 1000 : n;
}

function computeMythicVaultRuns(mythicPlus: any): number {
  const isRunLike = (value: any) =>
    value &&
    typeof value === 'object' &&
    (typeof value.keystone_level === 'number' ||
      typeof value.keystoneLevel === 'number' ||
      value.keystone_dungeon ||
      value.dungeon ||
      value.completed_challenge_mode);

  const collectRuns = (root: any): any[] => {
    const out: any[] = [];
    const stack: any[] = [root];
    const seen = new Set<any>();
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current || seen.has(current)) continue;
      seen.add(current);
      if (Array.isArray(current)) {
        if (current.some((item) => isRunLike(item))) out.push(...current.filter((item) => isRunLike(item)));
        else for (const item of current) if (item && typeof item === 'object') stack.push(item);
        continue;
      }
      if (typeof current === 'object') {
        if (isRunLike(current)) out.push(current);
        for (const value of Object.values(current)) if (value && typeof value === 'object') stack.push(value);
      }
    }
    return out;
  };

  const getRunLevel = (run: any) => Number(run?.keystone_level ?? run?.keystoneLevel ?? 0);
  const getRunTimestamp = (run: any) =>
    toTimestampMs(
      run?.completed_timestamp ??
        run?.completedTimestamp ??
        run?.end_timestamp ??
        run?.endTimestamp ??
        run?.start_timestamp ??
        run?.startTimestamp ??
        run?.timestamp ??
        0,
    );

  const allRuns = collectRuns(mythicPlus).filter((run) => getRunLevel(run) > 0);
  const recentSource = Array.isArray(mythicPlus?.recent_runs) ? mythicPlus.recent_runs : allRuns;
  const recentRuns = [...recentSource].sort((a, b) => getRunTimestamp(b) - getRunTimestamp(a)).slice(0, 20);
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recentWeekCount = recentRuns.filter((run) => {
    const ts = getRunTimestamp(run);
    return ts > 0 && ts >= weekAgo;
  }).length;
  const currentPeriodCount = collectRuns(mythicPlus?.current_period || {}).length;
  let runsForVault = Math.max(recentWeekCount, currentPeriodCount);
  if (runsForVault > 0) return runsForVault;

  // Fallbacks for variant payload shapes.
  const directRecent = Array.isArray(mythicPlus?.recent_runs) ? mythicPlus.recent_runs.length : 0;
  const directCurrent = Array.isArray(mythicPlus?.current_period?.runs)
    ? mythicPlus.current_period.runs.length
    : 0;
  runsForVault = Math.max(runsForVault, directRecent, directCurrent);
  if (runsForVault > 0) return runsForVault;

  // Last resort: recursively find a plausible weekly run counter field.
  const stack: any[] = [mythicPlus];
  const seen = new Set<any>();
  let best = 0;
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || seen.has(node) || typeof node !== 'object') continue;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) stack.push(item);
      continue;
    }
    const candidates = [
      node.runs_for_vault,
      node.vault_runs,
      node.weekly_runs,
      node.completed_runs,
      node.completed_count,
    ]
      .map((v: any) => Number(v))
      .filter((v) => Number.isFinite(v) && v > 0 && v < 1000);
    for (const v of candidates) if (v > best) best = v;
    for (const value of Object.values(node)) if (value && typeof value === 'object') stack.push(value);
  }
  return best;
}

function computeRaidVaultKills(raidEncounters: any): number {
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  let weeklyKills = 0;
  let fallbackBestDefeated = 0;
  const expansions = Array.isArray(raidEncounters?.expansions) ? raidEncounters.expansions : [];

  for (const expansion of expansions) {
    for (const instance of Array.isArray(expansion?.instances) ? expansion.instances : []) {
      for (const mode of Array.isArray(instance?.modes) ? instance.modes : []) {
        const defeated = Number(mode?.progress?.encounters_defeated ?? mode?.progress?.completed_count ?? 0);
        if (Number.isFinite(defeated) && defeated > fallbackBestDefeated) fallbackBestDefeated = defeated;

        const encounters = Array.isArray(mode?.progress?.encounters) ? mode.progress.encounters : [];
        for (const encounter of encounters) {
          const ts = toTimestampMs(encounter?.last_kill_timestamp ?? encounter?.lastKillTimestamp ?? 0);
          if (ts >= weekAgo) weeklyKills += 1;
        }
      }
    }
  }

  if (weeklyKills > 0) return weeklyKills;
  if (fallbackBestDefeated > 0) return fallbackBestDefeated;

  // Last-resort fallback: some payload variants only expose progression as strings like "6/8".
  const seen = new Set<any>();
  const stack: any[] = [raidEncounters];
  let bestFromStrings = 0;
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || seen.has(node)) continue;
    seen.add(node);

    if (typeof node === 'string') {
      const m = node.match(/^(\d+)\s*\/\s*(\d+)$/);
      if (m) {
        const defeated = Number(m[1]);
        const total = Number(m[2]);
        if (Number.isFinite(defeated) && Number.isFinite(total) && total >= defeated && defeated > bestFromStrings) {
          bestFromStrings = defeated;
        }
      }
      continue;
    }

    if (Array.isArray(node)) {
      for (const item of node) stack.push(item);
      continue;
    }

    if (typeof node === 'object') {
      for (const value of Object.values(node)) {
        if (value && (typeof value === 'object' || typeof value === 'string')) {
          stack.push(value);
        }
      }
    }
  }

  if (bestFromStrings > 0) return bestFromStrings;

  // Final fallback: recursively scan for plausible defeated/completed counters.
  const stack2: any[] = [raidEncounters];
  const seen2 = new Set<any>();
  let bestCounter = 0;
  while (stack2.length > 0) {
    const node = stack2.pop();
    if (!node || seen2.has(node) || typeof node !== 'object') continue;
    seen2.add(node);
    if (Array.isArray(node)) {
      for (const item of node) stack2.push(item);
      continue;
    }
    const counters = [
      node.encounters_defeated,
      node.completed_count,
      node.completedCount,
      node.bosses_defeated,
      node.kills,
      node.progress?.encounters_defeated,
      node.progress?.completed_count,
      node.progress?.completedCount,
    ]
      .map((v: any) => Number(v))
      .filter((v) => Number.isFinite(v) && v > 0 && v <= 40);
    for (const v of counters) if (v > bestCounter) bestCounter = v;
    for (const value of Object.values(node)) if (value && typeof value === 'object') stack2.push(value);
  }
  return bestCounter;
}

export default function Home() {
  const router = useRouter();
  const { setSimcInput } = useSimContext();
  const [sims, setSims] = useState<SimSummary[]>([]);
  const [historyStats, setHistoryStats] = useState<HistoryStats | null>(null);
  const [cpuUsage, setCpuUsage] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mainCharacter, setMainCharacter] = useState<{ region: string; realm: string; name: string } | null>(null);
  const [mainVault, setMainVault] = useState<{ mplusRuns: number; raidKills: number } | null>(null);
  const [mainMeta, setMainMeta] = useState<{ level?: number; className?: string; ilvl?: number } | null>(null);
  const [mainVaultRewards, setMainVaultRewards] = useState<VaultRewardItem[]>([]);
  const [mainSimcInput, setMainSimcInput] = useState<string>('');

  const loadAll = useCallback(async () => {
    try {
      const [simData, statData, systemStats] = await Promise.all([
        listSims(),
        getHistoryStats(),
        isDesktop ? getSystemStats().catch(() => null) : Promise.resolve(null),
      ]);
      setSims(simData || []);
      setHistoryStats(statData);
      setCpuUsage(systemStats?.cpu_usage ?? null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard data.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadVolatile = useCallback(async () => {
    try {
      const [simData, systemStats] = await Promise.all([
        listSims(),
        isDesktop ? getSystemStats().catch(() => null) : Promise.resolve(null),
      ]);
      setSims(simData || []);
      if (isDesktop) setCpuUsage(systemStats?.cpu_usage ?? null);
    } catch {
      // Keep stale values; avoid disrupting dashboard on transient polling failures.
    }
  }, []);

  useEffect(() => {
    const loadMainCharacter = async () => {
      try {
        const cfgRes = await fetch('/api/user/config', { credentials: 'include' });
        if (!cfgRes.ok) return;
        const cfg = await cfgRes.json();
        const key = String(cfg?.main_character || '');
        if (!key) return;
        const [region, realm, name] = key.split('|');
        if (!region || !realm || !name) return;
        setMainCharacter({ region, realm, name });

        const query = `?region=${region}`;
        const base = `/api/blizzard/character/${realm}/${name}`;
        const [profileRes, mythicPlus, raidEncounters] = await Promise.all([
          fetchJson<any>(`${API_URL}${base}/profile${query}`).catch(() => ({})),
          fetchJson<any>(`${API_URL}${base}/mythic-keystone-profile${query}`).catch(() => ({})),
          fetchJson<any>(`${API_URL}${base}/encounters/raids${query}`).catch(() => ({})),
        ]);
        setMainMeta({
          level: Number(profileRes?.level || 0) || undefined,
          className: profileRes?.character_class?.name || undefined,
          ilvl: Number(profileRes?.equipped_item_level || 0) || undefined,
        });

        const profiles = await listCharacterProfiles({ name, realm, region }).catch(() => []);
        const latestSimc = profiles[0]?.simc_input || '';
        const lines = String(latestSimc).split(/\r?\n/);
        const rewards: VaultRewardItem[] = [];
        let inBlock = false;
        for (const raw of lines) {
          const line = raw.trim();
          const lower = line.toLowerCase();
          if (lower.includes('weekly reward choices') && !lower.includes('end of weekly reward choices')) {
            inBlock = true;
            continue;
          }
          if (lower.includes('end of weekly reward choices')) {
            inBlock = false;
            continue;
          }
          if (!inBlock) continue;
          const m = line.replace(/^#\s*/, '').match(/^([a-z0-9_]+)\s*=\s*(.+)$/i);
          if (!m) continue;
          const id = m[2].match(/id=(\d+)/i)?.[1];
          if (!id) continue;
          const ilvl = m[2].match(/ilevel=(\d+)/i)?.[1] || '-';
          const bonusMatch = m[2].match(/bonus_id=([0-9/]+)/i);
          const bonusIds = bonusMatch
            ? bonusMatch[1]
                .split('/')
                .map((v) => Number(v))
                .filter((v) => Number.isFinite(v) && v > 0)
            : [];
          rewards.push({ slot: m[1], itemId: id, ilevel: ilvl, bonusIds });
        }
        setMainVaultRewards(rewards.slice(0, 6));
        setMainSimcInput(latestSimc);

        const mplusRuns = computeMythicVaultRuns(mythicPlus);
        const raidKills = computeRaidVaultKills(raidEncounters);
        setMainVault({ mplusRuns, raidKills });
      } catch {
        // ignore
      }
    };
    void loadMainCharacter();
  }, []);

  const openMainWorkflow = useCallback(
    (path: string) => {
      if (mainSimcInput.trim()) {
        setSimcInput(mainSimcInput);
        sessionStorage.setItem('whylowdps_simc_input', mainSimcInput);
      }
      router.push(path);
    },
    [mainSimcInput, router, setSimcInput],
  );

  useEffect(() => {
    let active = true;
    (async () => {
      await loadAll();
      if (!active) return;
    })();
    return () => {
      active = false;
    };
  }, [loadAll]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadVolatile();
    }, 10000);
    return () => window.clearInterval(timer);
  }, [loadVolatile]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadAll();
    }, 60000);
    return () => window.clearInterval(timer);
  }, [loadAll]);

  const activeSims = useMemo(() => sims.filter((sim) => sim.status === 'running').length, [sims]);
  const sortedRecent = useMemo(
    () =>
      [...sims]
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 10),
    [sims],
  );
  const activity = useMemo(() => buildActivityData(sims, 14), [sims]);

  if (loading) {
    return (
      <div className="py-12 text-center">
        <p className="text-sm text-muted">Loading dashboard...</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">Simulation Dashboard</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Live simulation activity, system health, and recent results.
          </p>
        </div>
        <Link
          href="/history"
          className="rounded-md border border-border bg-surface-2 px-3 py-1.5 text-sm text-zinc-200 transition-colors hover:border-border-light hover:bg-surface"
        >
          Open Full History
        </Link>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="card p-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs uppercase tracking-wide text-zinc-500">Active Sims</p>
              <p className="mt-2 text-3xl font-semibold text-zinc-100">{activeSims}</p>
            </div>
            <StatIcon>
              <ActiveIcon />
            </StatIcon>
          </div>
        </div>
        <div className="card p-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs uppercase tracking-wide text-zinc-500">Total Sims</p>
              <p className="mt-2 text-3xl font-semibold text-zinc-100">{historyStats?.count ?? 0}</p>
            </div>
            <StatIcon>
              <ListIcon />
            </StatIcon>
          </div>
        </div>
        <div className="card p-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs uppercase tracking-wide text-zinc-500">History Size</p>
              <p className="mt-2 text-3xl font-semibold text-zinc-100">
                {formatBytes(historyStats?.size_bytes ?? 0)}
              </p>
            </div>
            <StatIcon>
              <DatabaseIcon />
            </StatIcon>
          </div>
        </div>
        <div className="card p-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs uppercase tracking-wide text-zinc-500">System Load</p>
              <p className="mt-2 text-3xl font-semibold text-zinc-100">
                {isDesktop ? (cpuUsage != null ? `${Math.round(cpuUsage)}%` : 'N/A') : 'N/A'}
              </p>
            </div>
            <StatIcon>
              <CpuIcon />
            </StatIcon>
          </div>
        </div>
      </section>

      <section className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-200">Main Character</h2>
          <Link href="/characters" className="text-xs text-gold hover:text-gold-light">Manage</Link>
        </div>
        {!mainCharacter ? (
          <p className="text-sm text-zinc-500">No main character selected yet. Open a character and click Set as Main.</p>
        ) : (
          <div className="space-y-3">
            <div className="text-sm text-zinc-200">
              <span className="font-semibold">{mainCharacter.name}</span>
              <span className="text-zinc-500"> · {mainCharacter.realm} · {mainCharacter.region.toUpperCase()}</span>
            </div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
              <div className="rounded border border-white/10 bg-black/20 p-2 text-xs text-zinc-300">
                Level: <span className="font-semibold text-zinc-100">{mainMeta?.level ?? '-'}</span>
              </div>
              <div className="rounded border border-white/10 bg-black/20 p-2 text-xs text-zinc-300">
                Class: <span className="font-semibold text-zinc-100">{mainMeta?.className ?? '-'}</span>
              </div>
              <div className="rounded border border-white/10 bg-black/20 p-2 text-xs text-zinc-300">
                iLvl: <span className="font-semibold text-zinc-100">{mainMeta?.ilvl ?? '-'}</span>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <div className="rounded border border-white/10 bg-black/20 p-2">
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-zinc-500">Mythic+ Vault</p>
                <div className="space-y-2">
                  {[1, 4, 8].map((threshold, idx) => {
                    const current = mainVault?.mplusRuns ?? 0;
                    const unlocked = current >= threshold;
                    const progress = Math.min(1, current / threshold);
                    return (
                      <div key={`main-mplus-${threshold}`} className="rounded border border-white/10 bg-black/25 p-2">
                        <div className="mb-1 flex items-center justify-between text-[11px]">
                          <span className="font-semibold text-zinc-200">Slot {idx + 1}</span>
                          <span className={unlocked ? 'font-bold text-emerald-400' : 'text-zinc-500'}>
                            {unlocked ? 'Unlocked' : `${Math.max(0, threshold - current)} more`}
                          </span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                          <div
                            className={`h-full rounded-full ${unlocked ? 'bg-emerald-400' : 'bg-gold/70'}`}
                            style={{ width: `${Math.max(6, progress * 100)}%` }}
                          />
                        </div>
                        <p className="mt-1 text-[10px] text-zinc-500">Requires {threshold} runs</p>
                      </div>
                    );
                  })}
                </div>
                <p className="mt-2 text-[11px] text-zinc-500">{mainVault?.mplusRuns ?? 0} runs completed this week.</p>
              </div>
              <div className="rounded border border-white/10 bg-black/20 p-2">
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-zinc-500">Raid Vault</p>
                <div className="space-y-2">
                  {[2, 4, 6].map((threshold, idx) => {
                    const current = mainVault?.raidKills ?? 0;
                    const unlocked = current >= threshold;
                    const progress = Math.min(1, current / threshold);
                    return (
                      <div key={`main-raid-${threshold}`} className="rounded border border-white/10 bg-black/25 p-2">
                        <div className="mb-1 flex items-center justify-between text-[11px]">
                          <span className="font-semibold text-zinc-200">Slot {idx + 1}</span>
                          <span className={unlocked ? 'font-bold text-emerald-400' : 'text-zinc-500'}>
                            {unlocked ? 'Unlocked' : `${Math.max(0, threshold - current)} more`}
                          </span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                          <div
                            className={`h-full rounded-full ${unlocked ? 'bg-emerald-400' : 'bg-gold/70'}`}
                            style={{ width: `${Math.max(6, progress * 100)}%` }}
                          />
                        </div>
                        <p className="mt-1 text-[10px] text-zinc-500">Requires {threshold} boss kills</p>
                      </div>
                    );
                  })}
                </div>
                <p className="mt-2 text-[11px] text-zinc-500">{mainVault?.raidKills ?? 0} boss kills completed this week.</p>
              </div>
            </div>
            <div className="rounded border border-white/10 bg-black/20 p-2">
              <div className="mb-2 text-xs font-semibold text-zinc-200">Vault Rewards (if available)</div>
              <VaultRewardsGrid items={mainVaultRewards} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href={`/character/${mainCharacter.region}/${mainCharacter.realm}/${mainCharacter.name}`} className="rounded-md border border-border bg-surface-2 px-3 py-1.5 text-xs text-zinc-200 hover:bg-surface">Open Character</Link>
              <button onClick={() => openMainWorkflow('/quick-sim')} className="rounded-md border border-border bg-surface-2 px-3 py-1.5 text-xs text-zinc-200 hover:bg-surface">Run Sim</button>
              <button onClick={() => openMainWorkflow('/top-gear')} className="rounded-md border border-border bg-surface-2 px-3 py-1.5 text-xs text-zinc-200 hover:bg-surface">Top Gear</button>
              <Link href={`/character/${mainCharacter.region}/${mainCharacter.realm}/${mainCharacter.name}?tab=vault`} className="rounded-md border border-border bg-surface-2 px-3 py-1.5 text-xs text-zinc-200 hover:bg-surface">Open Vault</Link>
            </div>
          </div>
        )}
      </section>

      <section className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <div className="card p-4 xl:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-200">Simulation Activity (Last 14 Days)</h2>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={activity} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="activityGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#d4a843" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="#d4a843" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
                <XAxis dataKey="date" stroke="#71717a" tickLine={false} axisLine={false} />
                <YAxis allowDecimals={false} stroke="#71717a" tickLine={false} axisLine={false} />
                <Tooltip
                  cursor={{ stroke: '#3f3f46' }}
                  contentStyle={{
                    backgroundColor: '#18181b',
                    border: '1px solid #3f3f46',
                    borderRadius: '8px',
                    color: '#e4e4e7',
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="count"
                  stroke="#d4a843"
                  strokeWidth={2}
                  fill="url(#activityGradient)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card p-4">
          <h2 className="mb-3 text-sm font-semibold text-zinc-200">Quick Links</h2>
          <div className="space-y-2">
            <Link
              href="/quick-sim"
              className="block rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-zinc-200 transition-colors hover:border-border-light hover:bg-surface"
            >
              New Quick Sim
            </Link>
            <Link
              href="/top-gear"
              className="block rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-zinc-200 transition-colors hover:border-border-light hover:bg-surface"
            >
              Top Gear
            </Link>
            <Link
              href="/drop-finder"
              className="block rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-zinc-200 transition-colors hover:border-border-light hover:bg-surface"
            >
              Drop Finder
            </Link>
            <Link
              href="/history"
              className="block rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-zinc-200 transition-colors hover:border-border-light hover:bg-surface"
            >
              Simulation History
            </Link>
          </div>
        </div>
      </section>

      <section className="card overflow-hidden">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-zinc-200">Recent Results</h2>
        </div>
        {sortedRecent.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-zinc-500">No simulations yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-surface-2/60 text-left text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-3">Player</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Result</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
              </thead>
              <tbody>
              {sortedRecent.map((sim) => (
                <tr key={sim.id} className="border-t border-border/80 text-zinc-300">
                  <td className="px-4 py-3">
                    <div className="font-medium text-zinc-100">
                      {sim.player_name || sim.linked_name || 'Unknown Player'}
                    </div>
                    {sim.player_class && (
                      <div className="text-xs" style={{ color: classColor(sim.player_class) }}>
                        {sim.player_class}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-zinc-300">
                    {SIM_TYPE_LABELS[sim.sim_type] || sim.sim_type}
                  </td>
                  <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLES[sim.status]}`}
                      >
                        {sim.status}
                      </span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-zinc-100">
                    {sim.dps != null ? Math.round(sim.dps).toLocaleString() : '-'}
                  </td>
                  <td className="px-4 py-3 text-zinc-400">{formatRelativeTime(sim.created_at)}</td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={simResultHref(sim.id)}
                      className="text-gold transition-colors hover:text-gold-light"
                    >
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
