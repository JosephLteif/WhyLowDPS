'use client';

import { useMemo, useState } from 'react';
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
  const [showAll, setShowAll] = useState(false);
  const summary = useMemo(() => {
    if (!mythicPlus || typeof mythicPlus !== 'object') return null;
    const isRunLike = (value: any) =>
      value &&
      typeof value === 'object' &&
      (typeof value.keystone_level === 'number' ||
        typeof value.keystoneLevel === 'number' ||
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
          if (current.some((item) => isRunLike(item))) {
            out.push(...current.filter((item) => isRunLike(item)));
          } else {
            for (const item of current) {
              if (item && typeof item === 'object') stack.push(item);
            }
          }
          continue;
        }

        if (typeof current === 'object') {
          if (isRunLike(current)) out.push(current);
          for (const value of Object.values(current)) {
            if (value && typeof value === 'object') stack.push(value);
          }
        }
      }
      return out;
    };

    const combinedRuns = collectRuns(mythicPlus);
    const byDungeon = new Map<string, any>();
    for (const run of combinedRuns) {
      const dungeonName =
        run?.dungeon?.name || run?.completed_challenge_mode?.name || run?.name || 'Dungeon';
      const key = dungeonName.trim().toLowerCase();
      const level = Number(run?.keystone_level ?? run?.keystoneLevel ?? 0);
      const existing = byDungeon.get(key);
      const existingLevel = Number(existing?.keystone_level ?? existing?.keystoneLevel ?? 0);
      if (!existing || level > existingLevel) {
        byDungeon.set(key, run);
      }
    }
    const bestRuns = Array.from(byDungeon.values());

    const bestLevel = bestRuns.reduce((acc: number, run: any) => {
      const lvl = Number(run?.keystone_level ?? run?.keystoneLevel ?? 0);
      return Number.isFinite(lvl) ? Math.max(acc, lvl) : acc;
    }, 0);

    const bestDungeon = bestRuns.find(
      (run: any) => Number(run?.keystone_level ?? run?.keystoneLevel ?? 0) === bestLevel
    );

    const score = Number(
      mythicPlus.current_mythic_rating?.rating ??
        mythicPlus.currentMythicRating?.rating ??
        mythicPlus.current_mythic_rating?.value ??
        0
    );

    return {
      score: score > 0 ? Math.round(score) : null,
      runs: Array.isArray(bestRuns) ? bestRuns.length : 0,
      bestLevel: bestLevel > 0 ? bestLevel : null,
      bestDungeonName:
        bestDungeon?.dungeon?.name || bestDungeon?.completed_challenge_mode?.name || null,
      bestRuns: Array.isArray(bestRuns)
        ? [...bestRuns].sort((a: any, b: any) => {
            const aLvl = Number(a?.keystone_level ?? a?.keystoneLevel ?? 0);
            const bLvl = Number(b?.keystone_level ?? b?.keystoneLevel ?? 0);
            return bLvl - aLvl;
          })
        : [],
    };
  }, [mythicPlus]);

  return (
    <div className="card p-5">
      <h3 className="mb-4 text-xs font-bold uppercase tracking-wider text-zinc-500">Mythic+</h3>
      {summary ? (
        <div className="space-y-2">
          <StatRow
            label="Current Score"
            value={summary.score ? summary.score.toLocaleString() : '-'}
          />
          <StatRow label="Best Runs (Period)" value={summary.runs.toString()} />
          <StatRow label="Highest Key" value={summary.bestLevel ? `+${summary.bestLevel}` : '-'} />
          <StatRow label="Top Dungeon" value={summary.bestDungeonName || '-'} />
          {summary.bestRuns.length > 0 && (
            <>
              <div className="my-3 h-px bg-white/5" />
              <div className="space-y-1.5">
                {(showAll ? summary.bestRuns : summary.bestRuns.slice(0, 3)).map(
                  (run: any, i: number) => {
                    const level = Number(run?.keystone_level ?? run?.keystoneLevel ?? 0);
                    const dungeonName =
                      run?.dungeon?.name || run?.completed_challenge_mode?.name || 'Dungeon';
                    return (
                      <div
                        key={`${dungeonName}-${level}-${i}`}
                        className="flex items-center justify-between text-[12px]"
                      >
                        <span className="truncate pr-3 text-zinc-400">{dungeonName}</span>
                        <span className="font-mono font-bold text-zinc-200">+{level}</span>
                      </div>
                    );
                  }
                )}
              </div>
              {summary.bestRuns.length > 3 && (
                <button
                  type="button"
                  onClick={() => setShowAll((v) => !v)}
                  className="mt-2 text-[11px] font-bold text-gold/80 transition-colors hover:text-gold"
                >
                  {showAll ? 'Show Less' : `View All (${summary.bestRuns.length})`}
                </button>
              )}
            </>
          )}
        </div>
      ) : (
        <p className="text-[11px] italic text-zinc-600">Mythic+ data unavailable.</p>
      )}
    </div>
  );
}

function RaidProgressCard({ raidEncounters }: { raidEncounters: any }) {
  const [selectedExpansion, setSelectedExpansion] = useState<string>('all');
  const [showAll, setShowAll] = useState(false);

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
      <div className="mb-4 flex flex-col gap-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-500">Raid Progress</h3>
        {expansionOptions.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-[11px] font-bold uppercase tracking-wider text-zinc-600">
              <span className="block">Expansion</span>
              <select
                value={selectedExpansion}
                onChange={(e) => {
                  setSelectedExpansion(e.target.value);
                }}
                className="input-field w-full text-sm"
              >
                <option value="all">All expansions</option>
                {expansionOptions.map((exp) => (
                  <option key={exp.key} value={exp.key}>
                    {exp.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
      </div>
      {visibleRaids.length > 0 ? (
        <div className="space-y-4">
          {(showAll ? visibleRaids : visibleRaids.slice(0, 3)).map((raid) => (
            <div key={raid.name} className="rounded-md border border-white/5 bg-white/[0.02] p-3">
              <p className="mb-1 truncate text-[12px] font-bold text-zinc-200">{raid.name}</p>
              <p className="mb-2 text-[10px] uppercase tracking-wider text-zinc-500">
                {raid.expansionLabel}
              </p>
              <div className="grid grid-cols-2 gap-1 text-[11px] text-zinc-400">
                <span>LFR: {raid.lfr}</span>
                <span>Normal: {raid.normal}</span>
                <span>Heroic: {raid.heroic}</span>
                <span>Mythic: {raid.mythic}</span>
              </div>
            </div>
          ))}
          {visibleRaids.length > 3 && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="mt-2 text-[11px] font-bold text-gold/80 transition-colors hover:text-gold"
            >
              {showAll ? 'Show Less' : `View All (${visibleRaids.length})`}
            </button>
          )}
        </div>
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
          {enchant && <span className="text-emerald-400/80">· {enchant.name}</span>}
          {gem && <span className="text-sky-400/80">· {gem.name}</span>}
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
