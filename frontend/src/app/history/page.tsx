'use client';

import Link from 'next/link';
import { useEffect, useState, useCallback, useMemo } from 'react';
import { API_URL, deleteSim, clearHistory, getHistoryStats, getConfig, updateConfig, type HistoryStats } from '../lib/api';
import { useSimContext } from '../components/SimContext';

interface JobSummary {
  id: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  sim_type: string;
  created_at: string;
  fight_style: string;
  iterations: number;
  error_message: string | null;
  player_name: string | null;
  player_class: string | null;
  realm: string | null;
  dps: number | null;
  batch_id: string | null;
  size_bytes: number;
  upgrades?: number | null;
  downgrades?: number | null;
}

const STATUS_COLORS: Record<string, string> = {
  done: 'bg-emerald-500',
  running: 'bg-amber-500',
  failed: 'bg-red-500',
  pending: 'bg-zinc-500',
  cancelled: 'bg-zinc-600',
};

const FIGHT_STYLE_SHORT: Record<string, string> = {
  Patchwerk: 'Patch',
  HecticAddCleave: 'Cleave',
  LightMovement: 'Move',
};

const SIM_TYPE_LABELS: Record<string, string> = {
  quick: 'Quick Sim',
  top_gear: 'Top Gear',
  droptimizer: 'Drop Finder',
  stat_weights: 'Stat Weights',
};

function TrashIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`h-4 w-4 text-zinc-500 transition-transform ${open ? 'rotate-180' : ''}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg className="h-4 w-4 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
  );
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatDateHeader(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());

  if (target.getTime() === today.getTime()) return 'Today';
  if (target.getTime() === yesterday.getTime()) return 'Yesterday';

  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
}

function extractCharacter(simcInput: string): { name: string; realm: string } | null {
  let name = '';
  let realm = '';
  for (const line of simcInput.split('\n')) {
    const trimmed = line.trim();
    if (!name) {
      const match = trimmed.match(
        /^(?:warrior|paladin|hunter|rogue|priest|death_knight|deathknight|shaman|mage|warlock|monk|druid|demon_hunter|demonhunter|evoker)\s*=\s*"(.+)"/
      );
      if (match) name = match[1];
    }
    if (!realm && trimmed.startsWith('server=')) {
      realm = trimmed.slice(7);
    }
    if (name && realm) break;
  }
  if (name && realm) {
    try {
      localStorage.setItem('whylowdps_last_character', JSON.stringify({ name, realm }));
    } catch {}
    return { name, realm };
  }
  return null;
}

function SimRow({ sim, compact, onDelete }: { sim: JobSummary; compact?: boolean; onDelete?: (id: string) => void }) {
  return (
    <div className="group relative flex items-center">
      <Link
        href={`/sim/${sim.id}`}
        className={`flex min-w-0 flex-1 items-center gap-3 transition-colors hover:bg-white/[0.03] ${compact ? 'px-4 py-2' : 'px-5 py-3'}`}
      >
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_COLORS[sim.status] || STATUS_COLORS.pending}`}
        />
        {!compact && (
          <span className="shrink-0 rounded-md bg-gold/[0.08] px-2 py-0.5 text-[12px] font-medium text-gold w-[80px] text-center">
            {SIM_TYPE_LABELS[sim.sim_type] || sim.sim_type}
          </span>
        )}
        <div className="min-w-0 flex-1">
          {sim.player_name ? (
            <span className={`block truncate text-zinc-200 ${compact ? 'text-xs' : 'text-sm'}`}>
              {sim.player_name}
              {sim.player_class && <span className="ml-1.5 text-zinc-500">{sim.player_class}</span>}
              {sim.status === 'done' && sim.upgrades != null && sim.downgrades != null && (
                <span className="ml-2 text-zinc-400 text-xs">
                  &middot;{' '}
                  {sim.sim_type === 'droptimizer'
                    ? `${sim.upgrades} items upgrade vs ${sim.downgrades} downgrade`
                    : `${sim.upgrades} upgrade combinations vs ${sim.downgrades} downgrade combinations`}
                </span>
              )}
            </span>
          ) : sim.status === 'failed' ? (
            <span className={`block truncate text-red-400/80 ${compact ? 'text-xs' : 'text-sm'}`}>
              {sim.error_message || 'Failed'}
            </span>
          ) : (
            <span className={`block truncate text-zinc-500 ${compact ? 'text-xs' : 'text-sm'}`}>
              {sim.status === 'running' ? 'Simulating...' : 'Pending...'}
            </span>
          )}
        </div>
        <span
          className="shrink-0 text-right font-mono tabular-nums text-zinc-200 w-20 text-sm"
        >
          {sim.dps ? Math.round(sim.dps).toLocaleString() : '—'}
        </span>
        <span
          className="hidden shrink-0 text-right text-zinc-500 sm:block w-20 text-[13px]"
        >
          {FIGHT_STYLE_SHORT[sim.fight_style] || sim.fight_style}
        </span>
        <div className="shrink-0 text-right group-hover:opacity-0 w-20">
          <div className="text-[12px] text-zinc-500">{timeAgo(sim.created_at)}</div>
          {sim.size_bytes > 0 && (
            <div className="text-[10px] text-zinc-600 tabular-nums">{formatSize(sim.size_bytes)}</div>
          )}
        </div>
      </Link>
      <div className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        {onDelete && (
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onDelete(sim.id);
            }}
            className="rounded p-1 text-zinc-500 hover:bg-red-500/10 hover:text-red-400"
            title="Delete Record"
          >
            <TrashIcon />
          </button>
        )}
      </div>
    </div>
  );
}

type HistoryEntry =
  | { type: 'single'; sim: JobSummary }
  | { type: 'batch'; batchId: string; sims: JobSummary[] };

function groupByBatch(sims: JobSummary[]): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  const batchMap = new Map<string, JobSummary[]>();
  const singles: { index: number; sim: JobSummary }[] = [];

  sims.forEach((sim, index) => {
    if (sim.batch_id) {
      let group = batchMap.get(sim.batch_id);
      if (!group) {
        group = [];
        batchMap.set(sim.batch_id, group);
        singles.push({ index, sim });
      }
      group.push(sim);
    } else {
      singles.push({ index, sim });
    }
  });

  const seen = new Set<string>();
  for (const { sim } of singles) {
    if (sim.batch_id) {
      if (seen.has(sim.batch_id)) continue;
      seen.add(sim.batch_id);
      entries.push({ type: 'batch', batchId: sim.batch_id, sims: batchMap.get(sim.batch_id)! });
    } else {
      entries.push({ type: 'single', sim });
    }
  }
  return entries;
}

function BatchGroup({ entry, onDelete }: { entry: Extract<HistoryEntry, { type: 'batch' }>; onDelete?: (id: string) => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const first = entry.sims[0];
  const simType = SIM_TYPE_LABELS[first?.sim_type] || first?.sim_type || 'Sim';
  const bestDps = Math.max(...entry.sims.map((s) => s.dps ?? 0));
  const batchSize = entry.sims.reduce((acc, s) => acc + s.size_bytes, 0);

  return (
    <div className="border-b border-border last:border-b-0">
      <div className="group relative flex cursor-pointer items-center gap-3 px-5 py-3 transition-colors hover:bg-white/[0.03]" onClick={() => setIsOpen(!isOpen)}>
        <ChevronIcon open={isOpen} />

        <span className="shrink-0 rounded-md bg-gold/[0.08] px-2 py-0.5 text-[12px] font-medium text-gold w-[80px] text-center">
          {simType}
        </span>

        <div className="min-w-0 flex-1">
          <span className="text-sm font-medium text-zinc-200">
            {first?.player_name || 'Character'} &middot; {entry.sims.length} Scenarios
          </span>
        </div>

        <span className="shrink-0 text-right font-mono text-sm tabular-nums text-zinc-200 w-20">
          {bestDps > 0 ? Math.round(bestDps).toLocaleString() : '—'}
        </span>

        <span className="hidden shrink-0 w-20 sm:block" />

        <div className="w-20 shrink-0 text-right group-hover:opacity-0">
          <div className="text-[12px] text-zinc-600">{timeAgo(first?.created_at)}</div>
          {batchSize > 0 && (
            <div className="text-[10px] text-zinc-700 tabular-nums">{formatSize(batchSize)}</div>
          )}
        </div>

        <div className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          {onDelete && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (confirm(`Delete all ${entry.sims.length} scenarios in this batch?`)) {
                  entry.sims.forEach((s) => onDelete(s.id));
                }
              }}
              className="rounded p-1 text-zinc-500 hover:bg-red-500/10 hover:text-red-400"
              title="Delete Entire Batch"
            >
              <TrashIcon />
            </button>
          )}
        </div>
      </div>

      {isOpen && (
        <div className="border-t border-border/50 bg-surface-2/50 pl-4">
          <div className="divide-y divide-border/30">
            {entry.sims.map((sim) => (
              <SimRow key={sim.id} sim={sim} compact onDelete={onDelete} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function HistoryPage() {
  const { simcInput } = useSimContext();

  const [sims, setSims] = useState<JobSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [character, setCharacter] = useState<{ name: string; realm: string; region?: string } | null>(null);
  const [bnetCharacters, setBnetCharacters] = useState<{ name: string; realm: string; region: string; source?: 'bnet' | 'history' }[]>([]);
  const [stats, setStats] = useState<HistoryStats | null>(null);
  const [maxJobs, setMaxJobs] = useState<number>(50);
  const [search, setSearch] = useState('');

  useEffect(() => {
    // Optionally auto-select from SimC input
    let char = extractCharacter(simcInput);
    if (!char) {
      try {
        const stored = localStorage.getItem('whylowdps_last_character');
        if (stored) char = JSON.parse(stored);
      } catch {}
    }
    setCharacter(char);

    // Fetch account characters and historical characters
    Promise.all([
      fetch(`${API_URL}/api/bnet/user/characters`, { credentials: 'include' }).then(r => r.json().catch(() => ({ characters: [] }))),
      fetch(`${API_URL}/api/history/characters`, { credentials: 'include' }).then(r => r.json().catch(() => []))
    ]).then(([bnetResponse, historyData]) => {
      const bnetList = Array.isArray(bnetResponse) ? bnetResponse : (bnetResponse?.characters || []);
      const merged: any[] = bnetList.map((c: any) => ({ ...c, source: 'bnet' }));
      const historyList = Array.isArray(historyData) ? historyData : [];
      
      for (const h of historyList) {
        if (!merged.find(m => m.name.toLowerCase() === h.name.toLowerCase() && m.realm.toLowerCase() === h.realm.toLowerCase())) {
          merged.push({ ...h, source: 'history' });
        }
      }
      setBnetCharacters(merged);
    }).catch(() => {});
  }, [simcInput]);

  const refreshHistory = useCallback(async () => {
    try {
      let url = `${API_URL}/api/sims`;
      if (character && character.name && character.realm) {
        url += `?player=${encodeURIComponent(character.name)}&realm=${encodeURIComponent(character.realm)}&linked_only=true`;
      }
      
      const [simsRes, statsData] = await Promise.all([
        fetch(url, { credentials: 'include' }),
        getHistoryStats()
      ]);
      const data = simsRes.ok ? await simsRes.json() : [];
      setSims(data);
      setStats(statsData);
    } catch (err) {
      setSims([]);
    }
  }, [character]);

  useEffect(() => {
    setLoading(true);
    // Initial fetch for history and configuration
    Promise.all([
      refreshHistory(),
      getConfig().then(cfg => setMaxJobs(cfg.max_jobs))
    ]).finally(() => setLoading(false));
  }, [refreshHistory]);

  const handleDelete = async (id: string) => {
    await deleteSim(id);
    refreshHistory();
  };

  const handleClear = async () => {
    if (!confirm('Are you sure you want to clear ALL history?')) return;
    await clearHistory();
    refreshHistory();
  };

  const handleMaxJobsChange = async (val: string) => {
    const num = parseInt(val);
    if (isNaN(num) || num < 1) return;
    setMaxJobs(num);
    await updateConfig({ max_jobs: num });
    refreshHistory();
  };

  const filteredEntries = useMemo(() => {
    const query = search.toLowerCase().trim();
    const filtered = query
      ? sims.filter(s =>
          s.player_name?.toLowerCase().includes(query) ||
          s.sim_type.toLowerCase().includes(query) ||
          SIM_TYPE_LABELS[s.sim_type]?.toLowerCase().includes(query) ||
          s.player_class?.toLowerCase().includes(query)
        )
      : sims;

    const grouped = groupByBatch(filtered);

    // Group by date
    const dateGroups: Record<string, HistoryEntry[]> = {};
    grouped.forEach(entry => {
      const date = entry.type === 'single' ? entry.sim.created_at : entry.sims[0].created_at;
      const header = formatDateHeader(date);
      if (!dateGroups[header]) dateGroups[header] = [];
      dateGroups[header].push(entry);
    });

    return dateGroups;
  }, [sims, search]);



  if (loading) {
    return (
      <div className="py-12 text-center">
        <p className="text-sm text-muted">Loading history...</p>
      </div>
    );
  }

  const groupKeys = Object.keys(filteredEntries);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 px-1 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-baseline gap-2">
          <h2 className="text-lg font-medium text-zinc-100">Simulation History</h2>
          {stats && (
          <span className="text-xs text-zinc-500">
              {sims.length} records &middot; {formatSize(stats.size_bytes)}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 pr-2 border-r border-border">
            <span className="text-xs text-zinc-500">Filter by Character:</span>
            <select
              className="rounded-md border border-border bg-surface-2 px-2 py-1.5 text-xs text-zinc-200 focus:border-gold focus:outline-none"
              value={character ? `${character.name}-${character.realm}` : 'all'}
              onChange={(e) => {
                const val = e.target.value;
                if (val === 'all') {
                  setCharacter(null);
                  localStorage.removeItem('whylowdps_last_character');
                } else {
                  const [name, realm] = val.split('-');
                  setCharacter({ name, realm });
                }
              }}
            >
              <option value="all">All Sims</option>
              {character && !bnetCharacters.find(c => c.name === character.name && c.realm === character.realm) && (
                <option value={`${character.name}-${character.realm}`}>
                  {character.name} - {character.realm}
                </option>
              )}
              {bnetCharacters.map((c, i) => (
                <option key={i} value={`${c.name}-${c.realm}`}>
                  {c.name} - {c.realm} {c.source === 'history' ? '(History)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="relative">
            <div className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center">
              <SearchIcon />
            </div>
            <input
              type="text"
              placeholder="Search history..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-48 rounded-md border border-border bg-surface-2 py-1.5 pl-8 pr-3 text-xs text-zinc-200 placeholder:text-zinc-500 focus:border-gold focus:outline-none"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-zinc-500">Keep last:</label>
            <input
              type="number"
              value={maxJobs}
              onChange={(e) => setMaxJobs(parseInt(e.target.value) || 0)}
              onBlur={(e) => handleMaxJobsChange(e.target.value)}
              className="w-16 rounded border border-border bg-surface-2 px-1.5 py-1 text-xs text-zinc-300 focus:border-gold focus:outline-none"
            />
          </div>
          { sims.length > 0 && (
            <button
              onClick={handleClear}
              className="rounded bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/20"
            >
              Clear All
            </button>
          )}


        </div>
      </div>

      {groupKeys.length === 0 ? (
        <div className="card py-12 text-center">
          <p className="text-sm text-muted">
            {search
              ? 'No records match your search.'
              : character
                ? `No simulations found for ${character.name} on ${character.realm}.`
                : 'No simulations yet.'}
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {groupKeys.map(group => (
            <div key={group} className="space-y-2">
              <h3 className="px-1 text-[11px] font-bold uppercase tracking-wider text-zinc-500">
                {group}
              </h3>
              <div className="card overflow-hidden">
                {filteredEntries[group].map((entry, idx) => {
                  const id = entry.type === 'single' ? entry.sim.id : entry.batchId;
                  const isLast = idx === filteredEntries[group].length - 1;
                  return (
                    <div key={id} className={!isLast ? "border-b border-border" : ""}>
                      {entry.type === 'single' ? (
                        <SimRow sim={entry.sim} onDelete={handleDelete} />
                      ) : (
                        <BatchGroup entry={entry} onDelete={handleDelete} />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
