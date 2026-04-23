'use client';

import { useEffect, useMemo } from 'react';

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

  const visibleRaids = useMemo(() => {
    if (selectedExpansion === 'all') return parsed.raids;
    return parsed.raids.filter((raid) => raid.expansionKey === selectedExpansion);
  }, [parsed.raids, selectedExpansion]);

  const currentRaid = useMemo(() => {
    if (visibleRaids.length === 0) return null;
    if (selectedRaidName && selectedRaidName !== 'all') {
      const direct = visibleRaids.find(
        (raid) => raid.name.toLowerCase() === selectedRaidName.toLowerCase(),
      );
      if (direct) return direct;
    }
    return [...visibleRaids].sort((a, b) => {
      if (b.lastKillTs !== a.lastKillTs) return b.lastKillTs - a.lastKillTs;
      return b.bosses.length - a.bosses.length;
    })[0];
  }, [visibleRaids, selectedRaidName]);

  useEffect(() => {
    if (!onActiveRaidNameChange) return;
    if (selectedRaidName && selectedRaidName !== 'all') {
      onActiveRaidNameChange(selectedRaidName);
      return;
    }
    onActiveRaidNameChange(null);
  }, [onActiveRaidNameChange, selectedRaidName]);

  const difficultyTotals = useMemo(() => {
    if (!currentRaid) return { lfr: 0, normal: 0, heroic: 0, mythic: 0 };
    return currentRaid.bosses.reduce<DifficultyTotals>(
      (acc, boss) => {
        for (const diff of DIFFICULTIES) {
          if (boss.byDifficulty[diff].kills > 0) acc[diff] += 1;
        }
        return acc;
      },
      { lfr: 0, normal: 0, heroic: 0, mythic: 0 },
    );
  }, [currentRaid]);

  const maxDifficultyCount = Math.max(
    1,
    difficultyTotals.lfr,
    difficultyTotals.normal,
    difficultyTotals.heroic,
    difficultyTotals.mythic,
  );

  if (!currentRaid || currentRaid.bosses.length === 0) {
    return (
      <div className="rounded-md border border-white/5 bg-white/[0.02] p-3">
        <p className="text-[11px] italic text-zinc-600">No per-boss raid progression available yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-white/5 bg-white/[0.02] p-3">
        <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-zinc-500">
          Difficulty Comparison (Selected Raid)
        </p>
        <div className="space-y-2">
          {DIFFICULTIES.map((difficulty) => {
            const count = difficultyTotals[difficulty];
            const pct = (count / maxDifficultyCount) * 100;
            const color =
              difficulty === 'mythic'
                ? 'bg-violet-400/80'
                : difficulty === 'heroic'
                  ? 'bg-amber-400/80'
                  : difficulty === 'normal'
                    ? 'bg-sky-400/80'
                    : 'bg-emerald-400/80';
            const label =
              difficulty === 'lfr'
                ? 'LFR'
                : difficulty === 'normal'
                  ? 'Normal'
                  : difficulty === 'heroic'
                    ? 'Heroic'
                    : 'Mythic';
            return (
              <div key={difficulty} className="grid grid-cols-[72px_1fr_38px] items-center gap-2">
                <span className="text-[11px] text-zinc-400">{label}</span>
                <div className="h-2 overflow-hidden rounded-full bg-white/10">
                  <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
                </div>
                <span className="text-right text-[11px] font-mono text-zinc-300">{count}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
