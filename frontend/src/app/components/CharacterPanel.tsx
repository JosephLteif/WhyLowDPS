'use client';

import { useEffect, useMemo, useState } from 'react';
import type { EnchantInfo, GemInfo, ItemInfo } from '../lib/useItemInfo';
import {
  getIconUrl,
  getWowheadData,
  getWowheadUrl,
  QUALITY_COLORS,
  useEnchantInfo,
  useGemInfo,
  useItemInfo,
} from '../lib/useItemInfo';
import { SLOT_LABELS } from '../lib/types';
import { useWowheadTooltips } from '../lib/useWowheadTooltips';
import type { BlizzardItem } from '../lib/simc-generator';
import TalentTree from './TalentTree';
import { useTalentTree } from '../lib/useTalentTree';
import { encodeTalentString, normalizeTalentString } from '../lib/talentEncode';
import type { NodeSelection } from '../lib/talentDecode';
import { decodeHeader } from '../lib/talentDecode';
import RaidProgressionGrid from './RaidProgressionGrid';
import {
  getMythicKeystoneDungeonDetail,
  getMythicKeystoneDungeonIndex,
  type MythicKeystoneDungeonDetail,
} from '../lib/api';

const GEAR_ORDER_LEFT = ['HEAD', 'NECK', 'SHOULDER', 'BACK', 'CHEST', 'WRIST'];
const GEAR_ORDER_RIGHT = [
  'HANDS',
  'WAIST',
  'LEGS',
  'FEET',
  'FINGER_1',
  'FINGER_2',
  'TRINKET_1',
  'TRINKET_2',
];
const TALENT_EXPORT_RE = /^[A-Za-z0-9+/]+$/;

function isTalentExportString(value: string, expectedSpecId?: number | null): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 16 || !TALENT_EXPORT_RE.test(trimmed)) return false;
  try {
    const header = decodeHeader(trimmed);
    if (header.bits.length <= header.offset) return false;
    if (header.specId <= 0) return false;
    return !(expectedSpecId && header.specId !== expectedSpecId);
  } catch {
    return false;
  }
}

function findTalentExportString(input: unknown, expectedSpecId?: number | null): string | null {
  if (!input || typeof input !== 'object') return null;
  const seen = new Set<unknown>();
  const stack: unknown[] = [input];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || seen.has(current)) continue;
    seen.add(current);

    if (typeof current === 'string') {
      if (isTalentExportString(current, expectedSpecId)) return current.trim();
      continue;
    }

    if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
      continue;
    }

    if (typeof current === 'object') {
      for (const value of Object.values(current as Record<string, unknown>)) {
        if (typeof value === 'string') {
          if (isTalentExportString(value, expectedSpecId)) return value.trim();
        } else if (value && typeof value === 'object') {
          stack.push(value);
        }
      }
    }
  }

  return null;
}

interface CharacterPanelProps {
  name: string;
  realm: string;
  region: string;
  characterClass: string;
  race: string;
  level: number;
  equipment: { equipped_items: BlizzardItem[] };
  statistics: any;
  specializations: any;
  professions: any;
  mythicPlus: any;
  raidEncounters: any;
  dungeons?: any;
  characterMediaUrl?: string | null;
}

export default function CharacterPanel({
  name,
  realm,
  region,
  equipment,
  statistics,
  specializations,
  mythicPlus,
  raidEncounters,
  characterMediaUrl,
}: CharacterPanelProps) {
  const realmSlug = realm.toLowerCase().replace(/'/g, '').replace(/\s+/g, '-');
  const armoryUrl = `https://worldofwarcraft.blizzard.com/en-us/character/${region.toLowerCase()}/${realmSlug}/${name.toLowerCase()}`;

  const itemsBySlot = useMemo(() => {
    const map: Record<string, BlizzardItem> = {};
    for (const item of equipment.equipped_items || []) {
      map[item.slot.type] = item;
    }
    return map;
  }, [equipment]);

  // --- Talent & Spec Logic (Lifted for SimC Generation) ---
  const activeSpec = useMemo(() => {
    if (!specializations?.specializations) return null;
    const activeId = specializations.active_specialization?.id;
    if (activeId) {
      return specializations.specializations.find((s: any) => s.specialization.id === activeId);
    }
    return specializations.specializations.find((s: any) =>
      s.loadouts?.some((l: any) => l.is_active)
    );
  }, [specializations]);

  const activeLoadout = useMemo(() => {
    if (!activeSpec?.loadouts) return null;
    return activeSpec.loadouts.find((l: any) => l.is_active);
  }, [activeSpec]);

  const specId = activeSpec?.specialization?.id ?? null;
  const tree = useTalentTree(specId);

  const talentString = useMemo(() => {
    if (!tree || !specId) return null;
    try {
      const directCandidates = [
        activeLoadout?.talent_loadout_code,
        activeLoadout?.talentLoadoutCode,
        activeLoadout?.loadout_code,
        activeLoadout?.code,
        activeSpec?.talent_loadout_code,
        activeSpec?.talentLoadoutCode,
      ].filter((v): v is string => typeof v === 'string');
      const direct = directCandidates.find((v) => isTalentExportString(v, specId));
      if (direct) return normalizeTalentString(direct, tree);

      const discovered =
        findTalentExportString(activeLoadout, specId) ?? findTalentExportString(activeSpec, specId);
      if (discovered) return normalizeTalentString(discovered, tree);

      const selections = new Map<number, NodeSelection>();
      const selectedTalents = [
        ...(activeLoadout?.selected_class_talents || []),
        ...(activeLoadout?.selected_spec_talents || []),
        ...(activeLoadout?.selected_hero_talents || []),
      ];
      const talents = [...selectedTalents, ...(activeSpec.talents || [])];
      const allNodes = [...tree.classNodes, ...tree.specNodes, ...tree.heroNodes];

      for (const t of talents) {
        const candidateIds = [
          t.id,
          t.talent?.id,
          t.tooltip_spell?.id,
          t.spell_tooltip?.spell?.id,
          t.selected_tooltip?.spell?.id,
        ].filter((id): id is number => typeof id === 'number' && Number.isFinite(id));
        if (candidateIds.length === 0) continue;

        const node = allNodes.find((n) =>
          candidateIds.some(
            (id) => n.id === id || n.entries.some((e) => e.id === id || e.spellId === id)
          )
        );
        if (node) {
          const choiceIndex = node.entries.findIndex((e) =>
            candidateIds.some((id) => e.id === id || e.spellId === id)
          );
          const existing = selections.get(node.id);
          const nextRanks = Math.max(existing?.ranks ?? 0, t.rank ?? node.maxRanks ?? 1);
          const nextChoice = choiceIndex >= 0 ? choiceIndex : (existing?.choiceIndex ?? -1);
          selections.set(node.id, {
            ranks: nextRanks,
            choiceIndex: nextChoice,
          });
        }
      }
      if (selections.size === 0) return null;
      return normalizeTalentString(encodeTalentString(selections, tree, specId), tree);
    } catch (err) {
      console.warn('Failed to encode talent string:', err);
      return null;
    }
  }, [activeLoadout, tree, specId, activeSpec]);
  // --- End Talent & SimC Logic ---

  const allItemQueries = useMemo(() => {
    return (equipment.equipped_items || []).map((it) => ({
      item_id: it.item.id,
      bonus_ids: it.bonus_list,
    }));
  }, [equipment]);

  const itemInfoMap = useItemInfo(allItemQueries);

  const allEnchantIds = useMemo(() => {
    const ids = new Set<number>();
    for (const it of equipment.equipped_items || []) {
      for (const e of it.enchantments || []) {
        if (e.enchantment_id) ids.add(e.enchantment_id);
      }
    }
    return [...ids];
  }, [equipment]);

  const enchantInfoMap = useEnchantInfo(allEnchantIds);

  const allGemIds = useMemo(() => {
    const ids = new Set<number>();
    for (const it of equipment.equipped_items || []) {
      for (const s of it.sockets || []) {
        if (s.item?.id) ids.add(s.item.id);
      }
    }
    return [...ids];
  }, [equipment]);

  const gemInfoMap = useGemInfo(allGemIds);
  useWowheadTooltips([equipment, itemInfoMap]);

  return (
    <div className="flex flex-col gap-6">
      {/* Quick Links Bar (Top Left) */}
      <div className="flex flex-wrap items-center gap-3">
        <a
          href={armoryUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-bold text-zinc-300 ring-1 ring-white/5 transition-all hover:bg-white/10 hover:text-white active:scale-95"
        >
          <img
            src="/icons/blizzard.png"
            alt=""
            className="h-3.5 w-3.5 opacity-70"
            onError={(e) => (e.currentTarget.style.display = 'none')}
          />
          Official Armory
        </a>
        <a
          href={`https://www.warcraftlogs.com/character/${region.toLowerCase()}/${realmSlug}/${name.toLowerCase()}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-lg border border-[#ca3333]/20 bg-[#ca3333]/10 px-3 py-1.5 text-xs font-bold text-[#ff4d4d] ring-1 ring-white/5 transition-all hover:bg-[#ca3333]/20 hover:text-[#ff6666] active:scale-95"
        >
          Warcraft Logs
        </a>
        <a
          href={`https://raider.io/characters/${region.toLowerCase()}/${realmSlug}/${name.toLowerCase()}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-lg border border-[#fb8c00]/20 bg-[#fb8c00]/10 px-3 py-1.5 text-xs font-bold text-[#ffb74d] ring-1 ring-white/5 transition-all hover:bg-[#fb8c00]/20 hover:text-[#ffcc80] active:scale-95"
        >
          Raider.io
        </a>
      </div>

      {/* Upper Section: Gear & Stats */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        {/* Gear Panel */}
        <div className="card relative flex h-full flex-col overflow-hidden p-4 sm:p-6">
          {characterMediaUrl && (
            <div className="relative z-10 mb-4 flex justify-center lg:absolute lg:inset-0 lg:mb-0 lg:items-center">
              <img
                src={characterMediaUrl}
                alt={name}
                className="lg:opacity-62 pointer-events-none mx-auto h-64 w-auto object-contain opacity-85 sm:h-80 lg:h-[172%] lg:-translate-y-[10%] lg:mix-blend-lighten"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = 'none';
                }}
              />
            </div>
          )}

          <div className="relative z-20 flex flex-1 flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,1fr)_210px_minmax(0,1fr)] lg:gap-x-6 xl:grid-cols-[minmax(0,1fr)_260px_minmax(0,1fr)]">
            {/* Left Column */}
            <div className="min-w-0 space-y-3">
              {GEAR_ORDER_LEFT.map((slot) => (
                <BlizzardGearSlot
                  key={slot}
                  slot={slot}
                  item={itemsBySlot[slot]}
                  itemInfoMap={itemInfoMap}
                  enchantInfoMap={enchantInfoMap}
                  gemInfoMap={gemInfoMap}
                />
              ))}
            </div>

            <div className="hidden lg:block" />

            {/* Right Column */}
            <div className="min-w-0 space-y-3">
              {GEAR_ORDER_RIGHT.map((slot) => (
                <BlizzardGearSlot
                  key={slot}
                  slot={slot}
                  item={itemsBySlot[slot]}
                  itemInfoMap={itemInfoMap}
                  enchantInfoMap={enchantInfoMap}
                  gemInfoMap={gemInfoMap}
                  align="right"
                />
              ))}
            </div>
          </div>

          {/* Bottom Weapons Row */}
          <div className="relative z-20 mt-auto grid grid-cols-1 gap-3 pt-8 sm:grid-cols-2 sm:gap-8 lg:grid-cols-[minmax(300px,1fr)_minmax(300px,1fr)] lg:justify-center lg:gap-12">
            <BlizzardGearSlot
              slot="MAIN_HAND"
              item={itemsBySlot.MAIN_HAND}
              itemInfoMap={itemInfoMap}
              enchantInfoMap={enchantInfoMap}
              gemInfoMap={gemInfoMap}
              align="right"
              compactNearIcon
            />
            <BlizzardGearSlot
              slot="OFF_HAND"
              item={itemsBySlot.OFF_HAND}
              itemInfoMap={itemInfoMap}
              enchantInfoMap={enchantInfoMap}
              gemInfoMap={gemInfoMap}
              align="left"
            />
          </div>
        </div>

        {/* Stats Column */}
        <div className="flex flex-col gap-4">
          <StatsCard statistics={statistics} />
          <MythicPlusCard mythicPlus={mythicPlus} />
          <RaidProgressCard raidEncounters={raidEncounters} />
        </div>
      </div>

      {/* Lower Section: Talents (Full Width) */}
      <div className="w-full">
        <TalentsCard
          activeSpec={activeSpec}
          activeLoadout={activeLoadout}
          talentString={talentString}
          specId={specId}
          tree={tree}
        />
      </div>
    </div>
  );
}

function MythicPlusCard({ mythicPlus }: { mythicPlus: any }) {
  const [activeTab, setActiveTab] = useState<'overview' | 'runs'>('overview');
  const [mplusDungeonDetailsByName, setMplusDungeonDetailsByName] = useState<
    Record<string, MythicKeystoneDungeonDetail>
  >({});

  useEffect(() => {
    let cancelled = false;
    getMythicKeystoneDungeonIndex('us')
      .then(async (indexData) => {
        const indexEntries = Array.isArray(indexData?.dungeons) ? indexData.dungeons : [];
        const detailResults = await Promise.all(
          indexEntries.map((entry) =>
            getMythicKeystoneDungeonDetail(Number(entry?.id), 'us').catch(() => null),
          ),
        );
        if (cancelled) return;
        const map: Record<string, MythicKeystoneDungeonDetail> = {};
        for (const detail of detailResults) {
          if (!detail || typeof detail !== 'object') continue;
          const name = String(detail?.name || '')
            .trim()
            .toLowerCase();
          if (name) map[name] = detail;
        }
        setMplusDungeonDetailsByName(map);
      })
      .catch(() => {
        if (!cancelled) setMplusDungeonDetailsByName({});
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const summary = useMemo(() => {
    if (!mythicPlus || typeof mythicPlus !== 'object') return null;

    const normalizeName = (value: unknown) =>
      String(value ?? '')
        .trim()
        .toLowerCase();

    const getRunLevel = (run: any) => Number(run?.keystone_level ?? run?.keystoneLevel ?? 0);
    const getRunDurationMs = (run: any) => Number(run?.duration ?? run?.run_duration ?? 0);
    const getRunName = (run: any) =>
      run?.keystone_dungeon?.name ||
      run?.dungeon?.name ||
      run?.completed_challenge_mode?.name ||
      run?.name ||
      'Dungeon';
    const getMplusDungeonDetail = (run: any): MythicKeystoneDungeonDetail | null => {
      const key = normalizeName(getRunName(run));
      if (!key) return null;
      return mplusDungeonDetailsByName[key] || null;
    };
    const getTimedByDurationFallback = (run: any): boolean | null => {
      const detail = getMplusDungeonDetail(run);
      if (!detail) return null;
      const oneChestDuration = detail.keystone_upgrades?.find((u) => Number(u?.upgrade_level) === 1)
        ?.qualifying_duration;
      const durationMs = getRunDurationMs(run);
      if (!oneChestDuration || !durationMs) return null;
      return durationMs <= oneChestDuration;
    };
    const getRunTimed = (run: any): boolean | null => {
      if (typeof run?.is_completed_within_timeout === 'boolean') return run.is_completed_within_timeout;
      if (typeof run?.completed_in_time === 'boolean') return run.completed_in_time;
      if (typeof run?.completedWithinTime === 'boolean') return run.completedWithinTime;
      return getTimedByDurationFallback(run);
    };
    const getRunTimestamp = (run: any) =>
      Number(
        run?.completed_timestamp ??
          run?.completedTimestamp ??
          run?.end_timestamp ??
          run?.endTimestamp ??
          run?.start_timestamp ??
          run?.startTimestamp ??
          run?.timestamp ??
          0,
      );

    const formatDuration = (ms: number) => {
      if (!Number.isFinite(ms) || ms <= 0) return '-';
      const totalSec = Math.floor(ms / 1000);
      const min = Math.floor(totalSec / 60);
      const sec = totalSec % 60;
      return `${min}:${String(sec).padStart(2, '0')}`;
    };

    const formatClockDelta = (run: any) => {
      const detail = getMplusDungeonDetail(run);
      const timerMs = detail?.keystone_upgrades?.find((u) => Number(u?.upgrade_level) === 1)
        ?.qualifying_duration;
      const durationMs = getRunDurationMs(run);
      if (!timerMs || !durationMs) return null;
      const diff = timerMs - durationMs;
      const absSec = Math.floor(Math.abs(diff) / 1000);
      const min = Math.floor(absSec / 60);
      const sec = absSec % 60;
      const sign = diff >= 0 ? '+' : '-';
      return `${sign}${min}:${String(sec).padStart(2, '0')}`;
    };

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

    const collectRewardMap = (root: any): Map<number, number> => {
      const map = new Map<number, number>();
      const stack: any[] = [root];
      const seen = new Set<any>();
      while (stack.length > 0) {
        const current = stack.pop();
        if (!current || seen.has(current) || typeof current !== 'object') continue;
        seen.add(current);
        if (Array.isArray(current)) {
          for (const item of current) stack.push(item);
          continue;
        }
        const level = Number(current.keystone_level ?? current.keystoneLevel ?? current.level ?? 0);
        const ilvl = Number(
          current.item_level ??
            current.itemLevel ??
            current.reward_item_level ??
            current.rewardItemLevel ??
            0,
        );
        if (level > 0 && ilvl > 0) map.set(level, Math.max(ilvl, map.get(level) || 0));
        for (const value of Object.values(current)) if (value && typeof value === 'object') stack.push(value);
      }
      return map;
    };

    const allRuns = collectRuns(mythicPlus).filter((run) => getRunLevel(run) > 0);
    const byDungeon = new Map<string, any>();
    for (const run of allRuns) {
      const dungeonName = getRunName(run);
      const key = normalizeName(dungeonName);
      const level = getRunLevel(run);
      const existing = byDungeon.get(key);
      const existingLevel = getRunLevel(existing);
      if (!existing || level > existingLevel) byDungeon.set(key, run);
    }
    const bestRuns = Array.from(byDungeon.values());
    const bestLevel = bestRuns.reduce((acc, run) => Math.max(acc, getRunLevel(run)), 0);
    const bestDungeon = bestRuns.find((run) => getRunLevel(run) === bestLevel);
    const recentSource = Array.isArray(mythicPlus?.recent_runs) ? mythicPlus.recent_runs : allRuns;
    const recentRuns = [...recentSource]
      .sort((a, b) => getRunTimestamp(b) - getRunTimestamp(a))
      .slice(0, 20);
    const timedRuns = recentRuns.filter((run) => getRunTimed(run) === true).length;
    const depletedRuns = recentRuns.filter((run) => getRunTimed(run) === false).length;
    const timedStatusKnownCount = recentRuns.filter((run) => getRunTimed(run) !== null).length;

    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recentWeekCount = recentRuns.filter((run) => {
      const ts = getRunTimestamp(run);
      return ts > 0 && ts >= weekAgo;
    }).length;

    const currentPeriodCandidates = collectRuns(mythicPlus?.current_period || {});
    const currentPeriodCount = currentPeriodCandidates.length;
    const runsForVault = Math.max(recentWeekCount, currentPeriodCount);
    const topLevels = [...recentRuns].map(getRunLevel).sort((a, b) => b - a);
    const rewardMap = collectRewardMap(mythicPlus?.current_period || mythicPlus);
    const slotThresholds = [1, 4, 8];
    const vaultSlots = slotThresholds.map((threshold, i) => {
      const unlocked = runsForVault >= threshold;
      const keyLevel = topLevels[threshold - 1] || null;
      const rewardIlvl = keyLevel ? rewardMap.get(keyLevel) || null : null;
      return {
        slot: i + 1,
        threshold,
        unlocked,
        keyLevel,
        rewardIlvl,
        progress: Math.min(1, runsForVault / threshold),
      };
    });
    const hasAnyVaultIlvl = vaultSlots.some((slot) => slot.rewardIlvl != null);

    const score = Number(
      mythicPlus.current_mythic_rating?.rating ??
        mythicPlus.currentMythicRating?.rating ??
        mythicPlus.current_mythic_rating?.value ??
        0,
    );

    return {
      score: score > 0 ? Math.round(score) : null,
      runs: bestRuns.length,
      bestLevel: bestLevel > 0 ? bestLevel : null,
      bestDungeonName: bestDungeon ? getRunName(bestDungeon) : null,
      recentRuns: recentRuns.map((run: any, i: number) => ({
        id: `${getRunName(run)}-${getRunLevel(run)}-${getRunTimestamp(run)}-${i}`,
        dungeon: getRunName(run),
        level: getRunLevel(run),
        duration: formatDuration(getRunDurationMs(run)),
        timed: getRunTimed(run),
        clockDelta: formatClockDelta(run),
        timestamp: getRunTimestamp(run),
        members: Array.isArray(run?.members) ? run.members : [],
        dungeonId: getMplusDungeonDetail(run)?.id ?? null,
        keystoneUpgrades: getMplusDungeonDetail(run)?.keystone_upgrades ?? [],
      })),
      timedRuns,
      depletedRuns,
      hasTimedStatusData: timedStatusKnownCount > 0,
      vaultSlots,
      vaultProgressCount: runsForVault,
      hasAnyVaultIlvl,
    };
  }, [mplusDungeonDetailsByName, mythicPlus]);

  const formatRelative = (timestamp: number) => {
    if (!timestamp || timestamp <= 0) return 'Unknown time';
    const deltaMs = Date.now() - timestamp;
    if (deltaMs <= 0) return 'Just now';
    const hours = Math.floor(deltaMs / (60 * 60 * 1000));
    if (hours < 24) return `${hours || 1}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  return (
    <div className="card p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-500">Mythic+</h3>
        <div className="inline-flex rounded-md border border-white/10 bg-black/20 p-0.5">
          <button
            type="button"
            onClick={() => setActiveTab('overview')}
            className={`rounded px-2 py-1 text-[11px] font-bold ${
              activeTab === 'overview' ? 'bg-gold/20 text-gold' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Overview
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('runs')}
            className={`rounded px-2 py-1 text-[11px] font-bold ${
              activeTab === 'runs' ? 'bg-gold/20 text-gold' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Recent Runs
          </button>
        </div>
      </div>
      {summary ? (
        activeTab === 'overview' ? (
          <div className="space-y-3">
            <StatRow label="Current Score" value={summary.score ? summary.score.toLocaleString() : '-'} />
            <StatRow label="Best Runs (Period)" value={summary.runs.toString()} />
            <StatRow label="Highest Key" value={summary.bestLevel ? `+${summary.bestLevel}` : '-'} />
            <StatRow label="Top Dungeon" value={summary.bestDungeonName || '-'} />
            <div className="my-2 h-px bg-white/5" />
            <div className="rounded-md border border-white/5 bg-white/[0.02] p-3">
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-zinc-500">
                Weekly Vault Tracker
              </p>
              <p className="mb-3 text-[11px] text-zinc-400">
                Completed runs counted: <span className="font-bold text-zinc-200">{summary.vaultProgressCount}</span>
              </p>
              <div className="space-y-2">
                {summary.vaultSlots.map((slot) => (
                  <div key={slot.slot} className="rounded border border-white/5 bg-black/20 p-2">
                    <div className="mb-1 flex items-center justify-between text-[11px]">
                      <span className="font-bold text-zinc-300">Slot {slot.slot}</span>
                      <span className={slot.unlocked ? 'text-emerald-300' : 'text-zinc-500'}>
                        {slot.unlocked ? 'Unlocked' : `${slot.threshold - summary.vaultProgressCount} more`}
                      </span>
                    </div>
                    <div className="mb-1 h-1.5 overflow-hidden rounded-full bg-white/10">
                      <div
                        className={`h-full rounded-full ${slot.unlocked ? 'bg-emerald-400/90' : 'bg-gold/80'}`}
                        style={{ width: `${Math.round(slot.progress * 100)}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-zinc-400">
                      <span>{slot.keyLevel ? `Based on +${slot.keyLevel}` : 'Run more keys'}</span>
                      {summary.hasAnyVaultIlvl && slot.rewardIlvl ? (
                        <span>{`iLvl ${slot.rewardIlvl}`}</span>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[11px] text-zinc-400">
              <span>Showing {summary.recentRuns.length} recent runs</span>
              {summary.hasTimedStatusData ? (
                <span>
                  <span className="text-emerald-300">{summary.timedRuns} timed</span> ·{' '}
                  <span className="text-red-300">{summary.depletedRuns} depleted</span>
                </span>
              ) : null}
            </div>
            <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
              {summary.recentRuns.map((run) => {
                const runStatus = run.timed === true ? 'Timed' : run.timed === false ? 'Depleted' : null;
                const statusOrDelta = run.clockDelta || runStatus;
                return (
                  <div key={run.id} className="rounded-md border border-white/5 bg-white/[0.02] p-2.5">
                    <div className="flex items-center gap-2">
                      {run.timed !== null ? (
                        <span
                          className={`h-7 w-1.5 shrink-0 rounded-full ${
                            run.timed === true
                              ? 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.6)]'
                              : 'bg-red-400 shadow-[0_0_10px_rgba(248,113,113,0.6)]'
                          }`}
                        />
                      ) : null}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12px] font-semibold text-zinc-100">
                          {run.dungeon} <span className="font-mono text-gold">+{run.level}</span>
                        </p>
                        <p className="text-[10px] text-zinc-500">{formatRelative(run.timestamp)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[11px] font-mono text-zinc-200">{run.duration}</p>
                        {statusOrDelta ? (
                          <p
                            className={`text-[10px] font-bold ${
                              run.timed === true
                                ? 'text-emerald-300'
                                : run.timed === false
                                  ? 'text-red-300'
                                  : run.clockDelta?.startsWith('+')
                                    ? 'text-emerald-300'
                                    : run.clockDelta?.startsWith('-')
                                      ? 'text-red-300'
                                      : 'text-zinc-400'
                            }`}
                          >
                            {statusOrDelta}
                          </p>
                        ) : null}
                      </div>
                    </div>
                    {run.members.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {run.members.slice(0, 5).map((member: any, idx: number) => {
                          const memberName =
                            member?.profile?.name || member?.character?.name || member?.name || 'Player';
                          const memberClass =
                            member?.profile?.character_class?.name ||
                            member?.character_class?.name ||
                            member?.class?.name ||
                            member?.class ||
                            '';
                          return (
                            <span
                              key={`${memberName}-${idx}`}
                              className="rounded border border-white/10 bg-black/30 px-1.5 py-0.5 text-[10px] text-zinc-300"
                            >
                              {memberName}
                              {memberClass ? ` (${memberClass})` : ''}
                            </span>
                          );
                        })}
                        {run.members.length > 5 && (
                          <span className="rounded border border-white/10 bg-black/30 px-1.5 py-0.5 text-[10px] text-zinc-400">
                            +{run.members.length - 5} more
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )
      ) : (
        <p className="text-[11px] italic text-zinc-600">Mythic+ data unavailable.</p>
      )}
    </div>
  );
}

function RaidProgressCard({ raidEncounters }: { raidEncounters: any }) {
  const [selectedExpansion, setSelectedExpansion] = useState<string>('all');

  const raids = useMemo(() => {
    if (!raidEncounters || typeof raidEncounters !== 'object') return [];
    const expansions = Array.isArray(raidEncounters.expansions) ? raidEncounters.expansions : [];
    const byName = new Map<
      string,
      {
        name: string;
        expansionKey: string;
        expansionLabel: string;
        placeholderExpansion?: boolean;
        normal: string;
        heroic: string;
        mythic: string;
        lfr: string;
      }
    >();

    const mergeProgress = (a: string, b: string) => {
      const parse = (v: string) => {
        const m = /^(\d+)\/(\d+)$/.exec(v || '');
        if (!m) return null;
        return { k: Number(m[1]), t: Number(m[2]) };
      };
      const pa = parse(a);
      const pb = parse(b);
      if (!pa) return b;
      if (!pb) return a;
      if (pb.t > pa.t) return b;
      if (pb.t < pa.t) return a;
      return pb.k > pa.k ? b : a;
    };

    const flattened: Array<{
      name: string;
      expansionKey: string;
      expansionLabel: string;
      placeholderExpansion?: boolean;
      normal: string;
      heroic: string;
      mythic: string;
      lfr: string;
    }> = [];

    const normalize = (value: any) =>
      String(value ?? '')
        .trim()
        .toLowerCase()
        .replace(/[\s_]+/g, '-');

    const canonicalExpansionKey = (value: string | null) => {
      const lower = (value || '').trim().toLowerCase();
      if (lower === 'current season' || lower === 'current expansion') return 'midnight';
      return normalize(value);
    };

    const canonicalExpansionLabel = (value: string | null) => {
      const raw = (value || '').trim();
      if (!raw) return 'Unknown expansion';
      const lower = raw.toLowerCase();
      if (lower === 'current season' || lower === 'current expansion') return 'Midnight';
      return raw;
    };

    const isPlaceholderExpansion = (value: string | null) => {
      const lower = (value || '').trim().toLowerCase();
      return lower === 'current season' || lower === 'current expansion';
    };

    for (const exp of expansions) {
      const rawExpansionLabel =
        exp?.expansion?.name || exp?.expansion_name || exp?.label || exp?.name || null;
      const expansionLabel = canonicalExpansionLabel(rawExpansionLabel);
      // Keep filtering stable even when backend keys/slugs are inconsistent:
      // use the same canonical label for both display and grouping/filter keys.
      const expansionKey = normalize(expansionLabel) || canonicalExpansionKey(rawExpansionLabel);
      const instances = Array.isArray(exp?.instances) ? exp.instances : [];
      for (const inst of instances) {
        const modes = Array.isArray(inst?.modes) ? inst.modes : [];
        const getMode = (modeName: string) =>
          modes.find((m: any) => (m?.difficulty?.type || '').toLowerCase() === modeName);
        const fmtProgress = (mode: any) => {
          const p = mode?.progress;
          const k = Number(p?.encounters_defeated ?? p?.completed_count ?? 0);
          const t = Number(p?.total_encounters ?? p?.total_count ?? 0);
          return t > 0 ? `${k}/${t}` : '-';
        };

        flattened.push({
          name: inst?.instance?.name || inst?.name || 'Raid',
          expansionKey: expansionKey || 'unknown-expansion',
          expansionLabel: expansionLabel || 'Unknown expansion',
          // Track whether this row came from a generic "current season/expansion" bucket.
          placeholderExpansion: isPlaceholderExpansion(rawExpansionLabel),
          normal: fmtProgress(getMode('normal')),
          heroic: fmtProgress(getMode('heroic')),
          mythic: fmtProgress(getMode('mythic')),
          lfr: fmtProgress(getMode('lfr')),
        });
      }
    }
    const byRaidNameHasConcrete = new Set(
      flattened
        .filter((r: any) => !r.placeholderExpansion && r.expansionKey !== 'unknown-expansion')
        .map((r: any) => r.name.trim().toLowerCase().replace(/\s+/g, ' '))
    );

    for (const raid of flattened as Array<any>) {
      const normalizedRaidName = raid.name.trim().toLowerCase().replace(/\s+/g, ' ');
      if (raid.placeholderExpansion && byRaidNameHasConcrete.has(normalizedRaidName)) {
        // Prefer concrete expansion labels over generic current-season placeholders.
        continue;
      }
      const key = `${raid.expansionKey}::${normalizedRaidName}`;
      const existing = byName.get(key);
      if (!existing) {
        byName.set(key, raid);
        continue;
      }
      existing.lfr = mergeProgress(existing.lfr, raid.lfr);
      existing.normal = mergeProgress(existing.normal, raid.normal);
      existing.heroic = mergeProgress(existing.heroic, raid.heroic);
      existing.mythic = mergeProgress(existing.mythic, raid.mythic);
    }

    return Array.from(byName.values());
  }, [raidEncounters]);

  const expansionOptions = useMemo(() => {
    const map = new Map<string, { key: string; label: string }>();
    for (const raid of raids) {
      if (!map.has(raid.expansionKey)) {
        map.set(raid.expansionKey, { key: raid.expansionKey, label: raid.expansionLabel });
      }
    }
    return Array.from(map.values());
  }, [raids]);

  const visibleRaids = useMemo(() => {
    return raids.filter((raid) => {
      return selectedExpansion === 'all' || raid.expansionKey === selectedExpansion;
    });
  }, [raids, selectedExpansion]);

  return (
    <div className="card p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-500">Raid Progress</h3>
        {expansionOptions.length > 0 && (
          <select
            aria-label="Expansion"
            value={selectedExpansion}
            onChange={(e) => {
              setSelectedExpansion(e.target.value);
            }}
            className="input-field max-w-[170px] text-sm"
          >
            <option value="all">All expansions</option>
            {expansionOptions.map((exp) => (
              <option key={exp.key} value={exp.key}>
                {exp.label}
              </option>
            ))}
          </select>
        )}
      </div>
      {visibleRaids.length > 0 ? (
        <RaidProgressionGrid raidEncounters={raidEncounters} selectedExpansion={selectedExpansion} />
      ) : (
        <p className="text-[11px] italic text-zinc-600">
          Raid progression data unavailable for the selected filter.
        </p>
      )}
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-[13px]">
      <span className="text-zinc-400">{label}</span>
      <span className="font-mono font-bold text-zinc-200">{value}</span>
    </div>
  );
}

function BlizzardGearSlot({
  slot,
  item,
  itemInfoMap,
  enchantInfoMap,
  gemInfoMap,
  align = 'left',
  compactNearIcon = false,
}: {
  slot: string;
  item?: BlizzardItem;
  itemInfoMap: Record<number, ItemInfo>;
  enchantInfoMap: Record<number, EnchantInfo>;
  gemInfoMap: Record<number, GemInfo>;
  align?: 'left' | 'right';
  compactNearIcon?: boolean;
}) {
  const rtl = align === 'right';
  const label = SLOT_LABELS[slot.toLowerCase()] || slot;

  if (!item) {
    return (
      <div className={`flex items-center gap-3 ${rtl ? 'flex-row-reverse' : ''}`}>
        <div className="h-12 w-12 shrink-0 rounded-lg border border-white/5 bg-white/[0.02]" />
        <div className={rtl ? 'text-right' : ''}>
          <p className="text-[13px] font-medium text-zinc-500">{label}</p>
        </div>
      </div>
    );
  }

  const info = itemInfoMap[item.item.id];
  const qc = info ? QUALITY_COLORS[info.quality] || '#fff' : '#fff';
  const icon = info?.icon || 'inv_misc_questionmark';

  // Extract first enchant and gem for display
  const enchantId = item.enchantments?.[0]?.enchantment_id;
  const gemId = item.sockets?.[0]?.item?.id;

  const enchant = enchantId ? enchantInfoMap[enchantId] : undefined;
  const gem = gemId ? gemInfoMap[gemId] : undefined;

  const whData = getWowheadData(item.bonus_list, item.level?.value, enchantId, gemId);

  return (
    <a
      href={getWowheadUrl(item.item.id)}
      data-wowhead={whData}
      target="_blank"
      rel="noopener noreferrer"
      className={`flex w-full min-w-0 items-start gap-3 rounded-md px-1 py-1 transition-colors hover:bg-white/[0.03] ${rtl ? 'flex-row-reverse' : ''}`}
    >
      <div
        className="group relative h-11 w-11 shrink-0 overflow-hidden rounded-lg border transition-transform hover:scale-105 sm:h-12 sm:w-12"
        style={{ borderColor: `${qc}44` }}
      >
        <img src={getIconUrl(icon)} alt="" className="h-full w-full object-cover" />
        <div
          className="absolute inset-0 ring-1 ring-inset ring-white/10"
          style={{ boxShadow: `inset 0 0 10px ${qc}33` }}
        />
      </div>
      <div
        className={`min-w-0 ${compactNearIcon ? 'w-auto max-w-[420px]' : 'flex-1'} ${rtl ? 'text-right' : ''}`}
      >
        <span
          title={item.name}
          className="block truncate text-[13px] font-bold leading-tight hover:underline sm:text-[14px]"
          style={{ color: qc }}
        >
          {item.name}
        </span>
        <div
          className={`mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] font-medium text-zinc-500 ${
            compactNearIcon && rtl ? 'justify-end' : ''
          }`}
        >
          <span className="text-zinc-400">
            {item.level?.value} {label}
          </span>
          {enchant && <span className="text-emerald-400/80">Â· {enchant.name}</span>}
          {gem && <span className="text-sky-400/80">Â· {gem.name}</span>}
        </div>
      </div>
    </a>
  );
}

function StatsCard({ statistics }: { statistics: any }) {
  const stats = useMemo(() => {
    if (!statistics) return [];

    const getEffectiveValue = (stat?: any) => {
      if (typeof stat === 'number') return stat.toLocaleString();
      if (stat?.effective !== undefined) return Math.round(stat.effective).toLocaleString();
      if (stat?.value !== undefined) return Math.round(stat.value).toLocaleString();
      return '0';
    };

    const getPercentValue = (stat?: any, rating?: any) => {
      const p =
        stat?.value ??
        stat?.percent ??
        stat?.rating_bonus ??
        (typeof stat === 'number' ? stat : null);
      if (p === null) return null;

      const r =
        rating?.rating_normalized ?? rating?.rating ?? (typeof rating === 'number' ? rating : null);
      const percStr = p.toFixed(2) + '%';
      return r !== null ? `${Math.round(r)} (${percStr})` : percStr;
    };

    // Find the relevant primary stat (Int/Agi/Str)
    const mainStat = statistics.intellect || statistics.agility || statistics.strength;

    // Find the relevant crit/haste/mastery (they are usually mirrored in modern WoW, but we pick the best one)
    const crit =
      statistics.melee_crit || statistics.spell_crit || statistics.ranged_crit || statistics.crit;
    const haste =
      statistics.melee_haste ||
      statistics.spell_haste ||
      statistics.ranged_haste ||
      statistics.haste;
    const mastery = statistics.mastery;
    const versatility = statistics.versatility_offensive_modifier ?? statistics.versatility;

    return [
      { label: 'Main Stat', value: getEffectiveValue(mainStat) },
      { label: 'Stamina', value: getEffectiveValue(statistics.stamina) },
      null,
      { label: 'Crit', value: getPercentValue(crit, crit) ?? '0.0%' },
      { label: 'Haste', value: getPercentValue(haste, haste) ?? '0.0%' },
      { label: 'Mastery', value: getPercentValue(mastery, mastery) ?? '0.0%' },
      {
        label: 'Versatility',
        value: getPercentValue(versatility, statistics.versatility) ?? '0.0%',
      },
    ];
  }, [statistics]);

  if (!statistics) {
    return (
      <div className="card p-5 opacity-40">
        <h1 className="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-500">
          Attributes
        </h1>
        <p className="text-[11px] italic text-zinc-600">Loading attributes...</p>
      </div>
    );
  }

  return (
    <div className="card p-5">
      <h3 className="mb-4 text-xs font-bold uppercase tracking-wider text-zinc-500">Attributes</h3>
      <div className="space-y-2">
        {stats.map((s, i) =>
          s === null ? (
            <div key={`sep-${i}`} className="my-3 h-px bg-white/5" />
          ) : (
            <div key={s.label} className="flex justify-between text-[13px]">
              <span className="text-zinc-400">{s.label}</span>
              <span className="font-mono font-bold text-zinc-200">{s.value}</span>
            </div>
          )
        )}
      </div>
    </div>
  );
}

function TalentsCard({
  activeSpec,
  activeLoadout,
  talentString,
  specId,
  tree,
}: {
  activeSpec: any;
  activeLoadout: any;
  talentString: string | null;
  specId: number | null;
  tree: any;
}) {
  const loading = specId !== null && !tree;

  if (!activeSpec) {
    return (
      <div className="card p-5 opacity-40">
        <h1 className="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-500">Talents</h1>
        <p className="text-[11px] italic text-zinc-600">
          Talent data unavailable for this character (Privacy settings or 404).
        </p>
      </div>
    );
  }

  const talentNames = [
    ...(activeLoadout?.selected_class_talents || []),
    ...(activeLoadout?.selected_spec_talents || []),
    ...(activeLoadout?.selected_hero_talents || []),
    ...(activeSpec?.talents || []),
  ]
    .map((t: any) => t.tooltip_spell?.name || t.talent?.name)
    .filter(Boolean);

  return (
    <div className="card overflow-hidden">
      <div className="border-b border-white/5 bg-white/[0.01] p-5">
        <div className="flex items-center justify-between">
          <h1 className="text-xs font-bold uppercase tracking-wider text-zinc-500">
            Specialization: <span className="text-gold">{activeSpec.specialization.name}</span>
          </h1>
          <div className="flex items-center gap-2">
            {loading && (
              <div className="h-3 w-3 animate-spin rounded-full border-2 border-gold border-t-transparent" />
            )}
          </div>
        </div>
      </div>

      {talentString ? (
        <div className="bg-black/20 p-2">
          <div
            className="origin-top scale-100 transform transition-opacity duration-500"
            style={{ opacity: loading ? 0.3 : 1 }}
          >
            <TalentTree talentString={talentString} specId={specId ?? undefined} bare />
          </div>
        </div>
      ) : (
        <div className="p-5">
          <div className="flex flex-wrap gap-1.5">
            {talentNames.length > 0 ? (
              talentNames.map((name: string, i: number) => (
                <span
                  key={`${name}-${i}`}
                  className="rounded-md bg-white/[0.03] px-2 py-1 text-[10px] font-bold text-zinc-400 ring-1 ring-inset ring-white/5"
                >
                  {name}
                </span>
              ))
            ) : (
              <p className="text-[11px] italic text-zinc-600">No talent data available</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
