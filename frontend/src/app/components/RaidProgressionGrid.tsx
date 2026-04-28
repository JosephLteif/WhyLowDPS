'use client';

import { useEffect, useMemo, useState } from 'react';

type DifficultyKey = 'lfr' | 'normal' | 'heroic' | 'mythic';

type BossDifficultyStats = {
  kills: number;
  lastKillTs: number;
};

type BossProgress = {
  key: string;
  id: number | null;
  name: string;
  order: number;
  lastKillTs: number;
  totalKills: number;
  byDifficulty: Record<DifficultyKey, BossDifficultyStats>;
};

type RaidProgression = {
  key: string;
  name: string;
  expansionKey: string;
  expansionLabel: string;
  lastKillTs: number;
  bosses: BossProgress[];
  progressionBossKey: string | null;
};

type DifficultyTotals = Record<DifficultyKey, number>;

const DIFFICULTIES: DifficultyKey[] = ['lfr', 'normal', 'heroic', 'mythic'];
const CURRENT_TIER_GROUP_KEY = 'midnight_s1_group';
const CURRENT_TIER_LABEL = 'VS / TD / MOQ';
const CURRENT_TIER_CODES = new Set(['VS', 'TD', 'MOQ']);

function normalizeDifficulty(input: unknown): DifficultyKey | null {
  const raw = String(input ?? '')
    .trim()
    .toLowerCase();
  if (!raw) return null;
  if (raw.includes('raid_finder') || raw === 'lfr' || raw.includes('finder')) return 'lfr';
  if (raw.includes('mythic')) return 'mythic';
  if (raw.includes('heroic')) return 'heroic';
  if (raw.includes('normal')) return 'normal';
  return null;
}

function normalizeSlug(input: unknown): string {
  return String(input ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');
}

function normalizeExpansionLabel(input: unknown): string {
  const raw = String(input ?? '').trim();
  if (!raw) return 'Unknown expansion';
  const lower = raw.toLowerCase();
  if (lower === 'current season' || lower === 'current expansion') return 'Current expansion';
  return raw;
}

function parseNumber(input: unknown): number {
  const value = Number(input ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function raidAcronym(name: string): string {
  const cleaned = String(name || '').trim();
  if (!cleaned) return '';
  const lowered = cleaned.toLowerCase();
  if (lowered.includes('voidspire')) return 'VS';
  if (lowered.includes('dusk') || lowered.includes('dread')) return 'TD';
  if (lowered.includes('march') || lowered.includes("quel'danas") || lowered.includes('quel?')) return 'MOQ';
  const words = cleaned
    .split(/[\s'’-]+/)
    .map((w) => w.trim())
    .filter(Boolean);
  if (words.length === 0) return '';
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return words
    .slice(0, 3)
    .map((w) => w[0]?.toUpperCase() || '')
    .join('');
}

function getProgressionBossKey(bosses: BossProgress[]): string | null {
  if (bosses.length === 0) return null;
  const nonFinal = bosses.slice(0, -1);
  const candidates = nonFinal.length > 0 ? nonFinal : bosses;
  const sorted = [...candidates]
    .filter((boss) => boss.lastKillTs > 0)
    .sort((a, b) => b.lastKillTs - a.lastKillTs);
  return sorted[0]?.key ?? null;
}

function parseRaidData(raidEncounters: any): {
  raids: RaidProgression[];
  totalsByExpansion: Record<string, DifficultyTotals>;
} {
  const expansions = Array.isArray(raidEncounters?.expansions) ? raidEncounters.expansions : [];
  const raids = new Map<string, RaidProgression>();
  const totalsByExpansion: Record<string, DifficultyTotals> = {};

  for (const expansion of expansions) {
    const rawExpansion =
      expansion?.expansion?.name || expansion?.expansion_name || expansion?.label || expansion?.name;
    const expansionLabel = normalizeExpansionLabel(rawExpansion);
    const expansionKey = normalizeSlug(expansionLabel) || 'unknown-expansion';
    if (!totalsByExpansion[expansionKey]) {
      totalsByExpansion[expansionKey] = { lfr: 0, normal: 0, heroic: 0, mythic: 0 };
    }

    const instances = Array.isArray(expansion?.instances) ? expansion.instances : [];
    for (const instance of instances) {
      const raidName = String(instance?.instance?.name || instance?.name || 'Raid').trim() || 'Raid';
      const raidKey = `${expansionKey}::${normalizeSlug(raidName)}`;

      if (!raids.has(raidKey)) {
        raids.set(raidKey, {
          key: raidKey,
          name: raidName,
          expansionKey,
          expansionLabel,
          lastKillTs: 0,
          bosses: [],
          progressionBossKey: null,
        });
      }

      const raid = raids.get(raidKey)!;
      const bossByKey = new Map<string, BossProgress>(raid.bosses.map((boss) => [boss.key, boss]));

      const modes = Array.isArray(instance?.modes) ? instance.modes : [];
      for (const mode of modes) {
        const difficulty =
          normalizeDifficulty(mode?.difficulty?.type) ||
          normalizeDifficulty(mode?.difficulty?.name) ||
          normalizeDifficulty(mode?.difficulty);
        if (!difficulty) continue;

        const progress = mode?.progress ?? {};
        totalsByExpansion[expansionKey][difficulty] += parseNumber(
          progress?.encounters_defeated ?? progress?.completed_count,
        );

        const encounters = Array.isArray(progress?.encounters)
          ? progress.encounters
          : Array.isArray(mode?.encounters)
            ? mode.encounters
            : [];

        encounters.forEach((encounter: any, index: number) => {
          const rawId = parseNumber(
            encounter?.encounter?.id ?? encounter?.id ?? encounter?.journal_encounter_id,
          );
          const id = rawId > 0 ? rawId : null;
          const name = String(
            encounter?.encounter?.name || encounter?.name || encounter?.encounter_name || `Boss ${index + 1}`,
          );
          const order = parseNumber(encounter?.display_order ?? encounter?.order_index) || index;
          const key = `${raidKey}::${id ?? normalizeSlug(name)}`;
          const kills = parseNumber(encounter?.completed_count);
          const lastKillTs = parseNumber(encounter?.last_kill_timestamp ?? encounter?.lastKillTimestamp);

          const existing = bossByKey.get(key);
          if (!existing) {
            bossByKey.set(key, {
              key,
              id,
              name,
              order,
              lastKillTs,
              totalKills: kills,
              byDifficulty: {
                lfr: { kills: 0, lastKillTs: 0 },
                normal: { kills: 0, lastKillTs: 0 },
                heroic: { kills: 0, lastKillTs: 0 },
                mythic: { kills: 0, lastKillTs: 0 },
              },
            });
          }

          const boss = bossByKey.get(key)!;
          boss.byDifficulty[difficulty].kills = Math.max(boss.byDifficulty[difficulty].kills, kills);
          boss.byDifficulty[difficulty].lastKillTs = Math.max(
            boss.byDifficulty[difficulty].lastKillTs,
            lastKillTs,
          );
          boss.lastKillTs = Math.max(boss.lastKillTs, lastKillTs);
          boss.totalKills = Math.max(
            boss.totalKills,
            DIFFICULTIES.reduce((sum, diff) => sum + boss.byDifficulty[diff].kills, 0),
          );
        });
      }

      raid.bosses = Array.from(bossByKey.values()).sort((a, b) => a.order - b.order);
      raid.lastKillTs = raid.bosses.reduce((max, boss) => Math.max(max, boss.lastKillTs), raid.lastKillTs);
      raid.progressionBossKey = getProgressionBossKey(raid.bosses);
    }
  }

  return {
    raids: Array.from(raids.values()).sort((a, b) => b.lastKillTs - a.lastKillTs),
    totalsByExpansion,
  };
}

export default function RaidProgressionGrid({
  raidEncounters,
  selectedExpansion,
  selectedRaidName,
  onActiveRaidNameChange,
}: {
  raidEncounters: any;
  selectedExpansion: string;
  selectedRaidName?: string;
  onActiveRaidNameChange?: (raidName: string | null) => void;
}) {
  const parsed = useMemo(() => parseRaidData(raidEncounters), [raidEncounters]);
  const [selectedRaidGroup, setSelectedRaidGroup] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'overall' | 'weekly'>('overall');

  const visibleRaids = useMemo(() => {
    if (selectedExpansion === 'all') return parsed.raids;
    return parsed.raids.filter((raid) => raid.expansionKey === selectedExpansion);
  }, [parsed.raids, selectedExpansion]);

  const groupOptions = useMemo(() => {
    const raidCodes = Array.from(new Set(visibleRaids.map((r) => raidAcronym(r.name)).filter(Boolean)));
    const hasCurrentTier = raidCodes.some((code) => CURRENT_TIER_CODES.has(code));
    const standalone = raidCodes
      .filter((code) => !CURRENT_TIER_CODES.has(code))
      .sort((a, b) => a.localeCompare(b));
    const options = ['all', ...(hasCurrentTier ? [CURRENT_TIER_GROUP_KEY] : []), ...standalone];
    return options;
  }, [visibleRaids]);

  useEffect(() => {
    if (selectedRaidGroup === 'all') return;
    if (!groupOptions.includes(selectedRaidGroup)) {
      setSelectedRaidGroup('all');
    }
  }, [groupOptions, selectedRaidGroup]);

  const groupedRaids = useMemo(() => {
    if (selectedRaidGroup === 'all') return visibleRaids;
    if (selectedRaidGroup === CURRENT_TIER_GROUP_KEY) {
      return visibleRaids.filter((raid) => CURRENT_TIER_CODES.has(raidAcronym(raid.name)));
    }
    return visibleRaids.filter((raid) => raidAcronym(raid.name) === selectedRaidGroup);
  }, [visibleRaids, selectedRaidGroup]);

  const weeklyWindowMs = 7 * 24 * 60 * 60 * 1000;
  const weekCutoffTs = Date.now() - weeklyWindowMs;

  useEffect(() => {
    if (!onActiveRaidNameChange) return;
    if (selectedRaidName && selectedRaidName !== 'all') {
      onActiveRaidNameChange(selectedRaidName);
      return;
    }
    onActiveRaidNameChange(null);
  }, [onActiveRaidNameChange, selectedRaidName]);

  const groupedRaidsWithViewBosses = useMemo(() => {
    return groupedRaids.map((raid) => ({ ...raid, bosses: raid.bosses }));
  }, [groupedRaids]);

  const bossProgressSummary = useMemo(() => {
    const allBosses = groupedRaidsWithViewBosses.flatMap((raid) => raid.bosses);
    const totalBosses = allBosses.length;
    const fullyCleared = allBosses.filter((boss) => {
      if (viewMode === 'overall') {
        return DIFFICULTIES.some((diff) => boss.byDifficulty[diff].kills > 0);
      }
      return DIFFICULTIES.some((diff) => boss.byDifficulty[diff].lastKillTs >= weekCutoffTs);
    }).length;
    return { totalBosses, fullyCleared };
  }, [groupedRaidsWithViewBosses, viewMode, weekCutoffTs]);

  if (groupedRaidsWithViewBosses.length === 0) {
    return (
      <div className="rounded-md border border-white/5 bg-white/[0.02] p-3">
        <p className="text-[11px] italic text-zinc-600">No per-boss raid progression available yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 rounded-md border border-white/10 bg-black/20 p-1">
          <button
            type="button"
            onClick={() => setViewMode('overall')}
            className={`rounded px-2 py-1 text-[11px] font-semibold ${viewMode === 'overall' ? 'bg-gold/20 text-gold' : 'text-zinc-300 hover:bg-white/10'}`}
          >
            Overall
          </button>
          <button
            type="button"
            onClick={() => setViewMode('weekly')}
            className={`rounded px-2 py-1 text-[11px] font-semibold ${viewMode === 'weekly' ? 'bg-gold/20 text-gold' : 'text-zinc-300 hover:bg-white/10'}`}
          >
            Weekly kills
          </button>
        </div>
        <select
          aria-label="Raid group"
          value={selectedRaidGroup}
          onChange={(e) => setSelectedRaidGroup(e.target.value)}
          className="input-field h-9 w-[180px] px-2 py-1 text-[11px] text-zinc-100"
          style={{ colorScheme: 'dark' }}
        >
          {groupOptions.map((group) => (
            <option key={group} value={group}>
              {group === 'all'
                ? 'All raid groups'
                : group === CURRENT_TIER_GROUP_KEY
                  ? CURRENT_TIER_LABEL
                  : group}
            </option>
          ))}
        </select>
      </div>

      <div className="rounded-md border border-white/5 bg-white/[0.02] p-3">
        <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-zinc-500">
          Bosses by raid
        </p>
        <div className="mb-2 flex items-center justify-between text-[11px] text-zinc-400">
          <span>{`${bossProgressSummary.fullyCleared}/${bossProgressSummary.totalBosses} fully cleared`}</span>
          <span className="font-mono text-zinc-300">{`${bossProgressSummary.totalBosses} total`}</span>
        </div>
        <div className="mb-2 grid grid-cols-[minmax(240px,1fr)_repeat(4,36px)_60px] items-center gap-2 border-b border-white/10 pb-1 text-[10px] font-bold uppercase tracking-wide text-zinc-500">
          <span>Boss</span>
          <span className="text-center">LFR</span>
          <span className="text-center">N</span>
          <span className="text-center">H</span>
          <span className="text-center">M</span>
          <span className="text-right">Kills</span>
        </div>
        <div className="space-y-4">
          {groupedRaidsWithViewBosses.map((raid) => (
            <div key={raid.key} className="space-y-2">
              <div className="rounded-md border border-white/10 bg-black/25 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-zinc-300">
                {raid.name}
              </div>
              {raid.bosses.map((boss) => {
                const totalKills = DIFFICULTIES.reduce((sum, diff) => sum + boss.byDifficulty[diff].kills, 0);
                const weeklyKills = DIFFICULTIES.reduce(
                  (sum, diff) => sum + (boss.byDifficulty[diff].lastKillTs >= weekCutoffTs ? 1 : 0),
                  0,
                );
                const dotClass = (active: boolean, diff: DifficultyKey) => {
                  if (!active) return 'bg-zinc-700/60 ring-white/10';
                  if (diff === 'mythic') return 'bg-violet-400 ring-violet-300/60';
                  if (diff === 'heroic') return 'bg-amber-400 ring-amber-300/60';
                  if (diff === 'normal') return 'bg-sky-400 ring-sky-300/60';
                  return 'bg-emerald-400 ring-emerald-300/60';
                };
                return (
                  <div
                    key={boss.key}
                    className="rounded-md border border-white/10 bg-black/20 px-3 py-2"
                  >
                    <div className="grid grid-cols-[minmax(240px,1fr)_repeat(4,36px)_60px] items-center gap-2">
                      <p className="truncate text-sm font-semibold text-zinc-100">{boss.name}</p>
                      {DIFFICULTIES.map((diff) => {
                        const killed =
                          viewMode === 'overall'
                            ? boss.byDifficulty[diff].kills > 0
                            : boss.byDifficulty[diff].lastKillTs >= weekCutoffTs;
                        return (
                          <span key={`${boss.key}-${diff}`} className="flex justify-center">
                            <span
                              className={`h-3 w-3 rounded-full ring-1 ${dotClass(killed, diff)}`}
                              title={killed ? `${diff} cleared` : `${diff} not cleared`}
                            />
                          </span>
                        );
                      })}
                      <span className="justify-self-end rounded border border-white/10 bg-black/30 px-1.5 py-0.5 text-[10px] font-bold text-zinc-300">
                        {viewMode === 'weekly' ? weeklyKills : totalKills}x
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
