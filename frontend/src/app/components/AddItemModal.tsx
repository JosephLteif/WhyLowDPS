'use client';

import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { SLOT_LABELS, type DifficultyDef } from '../lib/types';
import { API_URL } from '../lib/api';
import { useWowheadTooltips } from '../lib/useWowheadTooltips';
import { getWowheadData, QUALITY_COLORS } from '../lib/useItemInfo';
import {
  type EmbellishmentOption,
  type ExternalItem,
  type MissiveOption,
  useAddItemState,
} from './add-item/useAddItemState';
import AddItemDifficultyToggle from './add-item/AddItemDifficultyToggle';
import AddItemInstanceSidebar from './add-item/AddItemInstanceSidebar';
import CustomSelect from './shared/CustomSelect';

interface AddItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (
    item: ExternalItem,
    difficulty: string,
    overrides?: {
      bonus_ids: number[];
      ilvl: number;
      track_name: string;
      level: number;
      quality?: number;
      crafted_stats?: string[];
      crafted_selected_bonus_ids?: number[];
      crafted_variable_bonus_pool?: number[];
      embellishment?: {
        item_id: number;
        name: string;
        icon: string;
        bonus_ids: number[];
      };
      gem?: {
        gem_id: number;
        name: string;
        icon: string;
        quality: number;
      };
    }
  ) => void;
  className?: string | null;
  spec?: string | null;
  preferredSlot?: string | null;
}

const RAID_TRACK_BY_DIFFICULTY: Record<string, string> = {
  lfr: 'Veteran',
  normal: 'Champion',
  heroic: 'Hero',
  mythic: 'Myth',
};

const UPGRADE_TRACK_MAX_LEVEL = 6;

/**
 * Fixed track tiers for Delves, Prey, and PvP.
 * These categories don't use raid difficulty_info — they have fixed loot tracks
 * sourced from dungeon_info on each item.
 *
 *   Prey  → Adventurer, Champion
 *   Delve → Adventurer, Champion, Hero
 *   PvP   → Champion (fixed)
 */
const DELVE_TRACKS = [
  { key: 'adventurer', label: 'Adventurer', infoSource: 'dungeon_info', infoDiff: 'heroic' },
  { key: 'champion',   label: 'Champion',   infoSource: 'dungeon_info', infoDiff: 'mythic' },
  { key: 'hero',       label: 'Hero',       infoSource: 'difficulty_info', infoDiff: 'heroic' },
] as const;

const PREY_TRACKS = [
  { key: 'adventurer', label: 'Adventurer', infoSource: 'dungeon_info', infoDiff: 'heroic' },
  { key: 'champion',   label: 'Champion',   infoSource: 'dungeon_info', infoDiff: 'mythic' },
] as const;

/** PvP items all drop at a single fixed track level. */
const PVP_TRACKS = [
  { key: 'champion', label: 'Champion', infoSource: 'dungeon_info', infoDiff: 'mythic' },
] as const;

type FixedTrackDef = { key: string; label: string; infoSource: string; infoDiff: string };

function getFixedTracksForCategory(
  category: string,
  item: ExternalItem
): FixedTrackDef[] | null {
  const instName = (item.instance_name || item.encounter || '').toLowerCase();
  if (category === 'delves') {
    // If the item is from Prey, restrict to Prey tracks
    if (instName.includes('prey') || item.source_type?.toLowerCase().includes('prey')) {
      return PREY_TRACKS as unknown as FixedTrackDef[];
    }
    return DELVE_TRACKS as unknown as FixedTrackDef[];
  }
  if (category === 'pvp') return PVP_TRACKS as unknown as FixedTrackDef[];
  return null;
}

/** Track colors – mirrors the Drop Finder page to keep the app consistent. */
const TRACK_COLORS: Record<string, { text: string; bg: string; border: string; badge: string }> = {
  Adventurer: { text: 'text-green-400', bg: 'bg-green-400/10', border: 'border-green-400/30', badge: 'bg-surface-2 text-white border-border' },
  Veteran:    { text: 'text-blue-400',  bg: 'bg-blue-400/10',  border: 'border-blue-400/30',  badge: 'bg-surface-2 text-white border-border' },
  Champion:   { text: 'text-purple-400', bg: 'bg-purple-400/10', border: 'border-purple-400/30', badge: 'bg-surface-2 text-white border-border' },
  Hero:       { text: 'text-orange-400', bg: 'bg-orange-400/10', border: 'border-orange-400/30', badge: 'bg-surface-2 text-white border-border' },
  Myth:       { text: 'text-amber-300',  bg: 'bg-amber-300/10',  border: 'border-amber-300/30',  badge: 'bg-surface-2 text-white border-border' },
  Crafted:    { text: 'text-cyan-400',   bg: 'bg-cyan-400/10',   border: 'border-cyan-400/30',   badge: 'bg-surface-2 text-white border-border' },
};

const DEFAULT_BADGE = 'bg-surface-2 text-white border-border';

function isWorldBossInstance(inst: { name?: string; type?: string }): boolean {
  const name = String(inst.name || '').toLowerCase();
  const type = String(inst.type || '').toLowerCase();
  return (
    name.includes('world boss') ||
    type.includes('world-boss') ||
    type.includes('world_boss')
  );
}

function isDelveInstance(inst: { type?: string }): boolean {
  return String(inst.type || '').toLowerCase().includes('delve');
}

function isPvpInstance(inst: { type?: string }): boolean {
  return String(inst.type || '').toLowerCase().includes('pvp');
}

function isCraftedInstance(inst: { type?: string }): boolean {
  return String(inst.type || '').toLowerCase().includes('profession');
}

function isPreyInstance(inst: { type?: string }): boolean {
  return String(inst.type || '').toLowerCase().includes('prey');
}

function isDungeonType(type: string): boolean {
  return type === 'dungeon' || type === 'expansion-dungeon' || type === 'mplus-chest';
}

/** Categories in the Loot Browser — order matters for the tab row. */
const LOOT_CATEGORIES = [
  { key: 'raid', label: 'RAID' },
  { key: 'dungeon', label: 'DUNGEON' },
  { key: 'tier', label: 'TIER' },
  { key: 'crafted', label: 'CRAFTED' },
  { key: 'delves', label: 'DELVES/PREY' },
  { key: 'pvp', label: 'PVP' },
  { key: 'world_bosses', label: 'WORLD BOSSES' },
] as const;

type LootCategory = (typeof LOOT_CATEGORIES)[number]['key'];

interface RawGem {
  id?: number;
  item_id?: number;
  name?: string;
  icon?: string;
  displayName?: string;
  itemId?: number;
  itemName?: string;
  itemIcon?: string;
  quality?: number;
  expansion?: number;
  craftingQuality?: number;
}

interface GemDisplay {
  gem_id: number;
  name: string;
  icon: string;
  quality: number;
  expansion: number;
}

const CRAFTED_ALL_ITEMS_ID = -100;
const CRAFTED_SIDEBAR_FILTERS = [
  { id: CRAFTED_ALL_ITEMS_ID, name: 'All Items', filter: null as string | null },
  { id: -101, name: 'Head', filter: 'head' },
  { id: -102, name: 'Neck', filter: 'neck' },
  { id: -103, name: 'Shoulders', filter: 'shoulder' },
  { id: -104, name: 'Back', filter: 'back' },
  { id: -105, name: 'Chest', filter: 'chest' },
  { id: -106, name: 'Wrists', filter: 'wrist' },
  { id: -107, name: 'Hands', filter: 'hands' },
  { id: -108, name: 'Waist', filter: 'waist' },
  { id: -109, name: 'Legs', filter: 'legs' },
  { id: -110, name: 'Feet', filter: 'feet' },
  { id: -111, name: 'Rings', filter: 'finger1' },
  { id: -112, name: 'Trinkets', filter: 'trinket1' },
  { id: -113, name: 'Main Hand', filter: 'main_hand' },
  { id: -114, name: 'Off Hand', filter: 'off_hand' },
] as const;

const SLOT_FILTER_OPTIONS = [
  { value: '', label: 'All Item Types' },
  { value: 'head', label: 'Head' },
  { value: 'neck', label: 'Neck' },
  { value: 'shoulder', label: 'Shoulders' },
  { value: 'back', label: 'Back' },
  { value: 'chest', label: 'Chest' },
  { value: 'wrist', label: 'Wrists' },
  { value: 'hands', label: 'Hands' },
  { value: 'waist', label: 'Waist' },
  { value: 'legs', label: 'Legs' },
  { value: 'feet', label: 'Feet' },
  { value: 'finger1', label: 'Rings' },
  { value: 'trinket1', label: 'Trinkets' },
  { value: 'main_hand', label: 'Main Hand' },
  { value: 'off_hand', label: 'Off Hand' },
] as const;

function normalizeSlotFilter(slot: string | null | undefined): string | null {
  if (!slot) return null;
  const lower = slot.toLowerCase();
  if (lower.startsWith('finger') || lower.startsWith('ring')) return 'finger1';
  if (lower.startsWith('trinket')) return 'trinket1';
  return lower;
}

function deduplicateGems(raw: RawGem[]): GemDisplay[] {
  const byBase = new Map<string, RawGem>();
  for (const gem of raw) {
    const baseName =
      gem.itemName || gem.displayName || gem.name || `gem-${gem.item_id ?? gem.itemId ?? gem.id ?? 0}`;
    const existing = byBase.get(baseName);
    if (!existing || (gem.craftingQuality ?? 0) > (existing.craftingQuality ?? 0)) {
      byBase.set(baseName, gem);
    }
  }

  return Array.from(byBase.values())
    .map((gem) => ({
      gem_id: gem.item_id ?? gem.itemId ?? gem.id ?? 0,
      name: gem.itemName || gem.displayName || gem.name || 'Unknown Gem',
      icon: gem.itemIcon || gem.icon || 'inv_misc_questionmark',
      quality: gem.quality ?? 3,
      expansion: gem.expansion ?? 0,
    }))
    .filter((gem) => gem.gem_id > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function missivesForItem(item: ExternalItem, missives: MissiveOption[]): MissiveOption[] {
  const expectedCount = Number(item.missive_count || 0);
  if (expectedCount <= 0) return [];
  const matching = missives.filter((missive) => {
    const statCount = Number(missive.stat_count || missive.token.split('/').filter(Boolean).length);
    return statCount === expectedCount;
  });
  return matching.length > 0 ? matching : missives;
}

function getDisplayQuality(item: ExternalItem, tierQuality: number | undefined, category: LootCategory): number {
  const effective = tierQuality ?? item.quality;
  const sourceType = String(item.source_type || '').toLowerCase();
  // Crafted quality rank (Q5) is not item rarity; keep crafted items in Epic color unless explicitly lower.
  if ((category === 'crafted' || sourceType.includes('profession')) && effective >= 5) {
    return 4;
  }
  return effective;
}

function instanceMatchesCategory(inst: { name?: string; type?: string }, cat: string): boolean {
  const type = String(inst.type || '').toLowerCase();
  switch (cat) {
    case 'raid':        return type === 'raid' && !isWorldBossInstance(inst);
    case 'dungeon':     return isDungeonType(type);
    case 'tier':        return type === 'catalyst';
    case 'delves':      return isDelveInstance(inst) || isPreyInstance(inst);
    case 'pvp':         return isPvpInstance(inst);
    case 'crafted':     return isCraftedInstance(inst);
    case 'world_bosses': return isWorldBossInstance(inst);
    default:            return false;
  }
}

const getMappedTrackName = (
  selectedDifficulty: string,
  info: { track?: string } | null | undefined
): string => {
  const raidTrack = RAID_TRACK_BY_DIFFICULTY[selectedDifficulty?.toLowerCase()];
  return info?.track || raidTrack || '';
};

function collectCraftedIlevels(item: ExternalItem, upgradeTracks: Record<string, any>): Array<{ ilvl: number; bonus_id: number; key: string }> {
  const out = [];
  if (item.difficulty_info) {
    for (const [key, entry] of Object.entries(item.difficulty_info)) {
      if (entry?.ilvl && entry.ilvl > 0) {
        out.push({ ilvl: entry.ilvl, bonus_id: entry.bonus_id || 0, key });
        if (key === 'mythic' && entry.track && upgradeTracks[entry.track]) {
          const track = upgradeTracks[entry.track];
          // Crests typically allow crafting up to maxLevel - 1 of their respective track
          const maxTrackLevel = Math.max(...track.map((t: any) => t.max || 0));
          const gilded = track.find((t: any) => t.level === maxTrackLevel - 1);
          if (gilded) {
            out.push({ ilvl: gilded.ilvl || gilded.itemLevel || 0, bonus_id: gilded.bonus_id || gilded.bonusIds?.[0] || 0, key: 'gilded' });
          }
        }
      }
    }
  }
  return out.sort((a, b) => a.ilvl - b.ilvl);
}

const getEffectiveTier = (
  item: ExternalItem,
  selectedDifficulty: string,
  itemTiers: Record<number, number>,
  upgradeTracks: Record<string, any>,
  category: string
) => {
  // ── Fixed-track categories (delves, prey, pvp) ──────────────────
  const fixedTracks = getFixedTracksForCategory(category, item);
  if (fixedTracks) {
    // Pick track based on selectedDifficulty. If not available, fallback to the highest track.
    let chosenIdx = fixedTracks.findIndex((t) => t.key === selectedDifficulty);
    if (chosenIdx === -1) {
      chosenIdx = fixedTracks.length - 1;
    }
    const chosen = fixedTracks[chosenIdx];
    const infoBlock =
      chosen.infoSource === 'dungeon_info'
        ? item.dungeon_info?.[chosen.infoDiff]
        : item.difficulty_info?.[chosen.infoDiff];
    if (!infoBlock) return null;

    const baseLevel = infoBlock.level || 1;
    const currentLevel = itemTiers[item.item_id] || baseLevel;
    const trackName = infoBlock.track || chosen.label;
    const track = upgradeTracks[trackName];

    const levelInfo = track?.find((t: any) => t.level === currentLevel);

    return {
      track: trackName,
      level: currentLevel,
      maxLevel: infoBlock.max_level || (track ? track[track.length - 1].level : UPGRADE_TRACK_MAX_LEVEL),
      ilvl: levelInfo?.ilvl || infoBlock.ilvl,
      baseLevel,
      baseIlvl: infoBlock.ilvl,
      bonus_id: infoBlock.bonus_id || 0,
      quality: infoBlock.quality ?? item.quality,
    };
  }

  const info =
    item.difficulty_info?.[selectedDifficulty] || item.dungeon_info?.[selectedDifficulty];

  if (category === 'crafted') {
    const levels = collectCraftedIlevels(item, upgradeTracks);
    if (levels.length === 0) return null;
    
    const currentLevel = itemTiers[item.item_id] || 1;
    const boundedLevel = Math.min(levels.length, Math.max(1, currentLevel));
    const levelInfo = levels[boundedLevel - 1];

    return {
      track: 'Crafted',
      level: boundedLevel,
      maxLevel: levels.length,
      ilvl: levelInfo.ilvl,
      baseLevel: 1,
      baseIlvl: levels[0].ilvl,
      bonus_id: levelInfo.bonus_id,
      crafted_key: levelInfo.key,
      quality: item.quality,
    };
  }

  const trackName = getMappedTrackName(selectedDifficulty, info);
  if (!info || !trackName) return null;

  const baseLevel = info.level || 1;
  const currentLevel = itemTiers[item.item_id] || baseLevel;
  const track = upgradeTracks[trackName];
  if (!track || !Array.isArray(track)) return null;

  const levelInfo = track.find((t: any) => t.level === currentLevel);
  return {
    track: trackName,
    level: currentLevel,
    maxLevel: info.max_level || track[track.length - 1].level,
    ilvl: levelInfo?.ilvl || info.ilvl,
    baseLevel,
    baseIlvl: info.ilvl,
    bonus_id: info.bonus_id,
    quality: info.quality || item.quality,
  };
};

export default function AddItemModal({
  isOpen,
  onClose,
  onAdd,
  className,
  spec,
  preferredSlot,
}: AddItemModalProps) {
  const state = useAddItemState(isOpen, className, spec, preferredSlot);
  const [embellishmentOptionsByItem, setEmbellishmentOptionsByItem] = useState<
    Record<number, EmbellishmentOption[]>
  >({});
  const [rawGems, setRawGems] = useState<RawGem[]>([]);
  const [itemGems, setItemGems] = useState<Record<number, GemDisplay | null>>({});
  const [craftedFilterSlot, setCraftedFilterSlot] = useState<string | null>(null);

  const inventoryTypeToSlot = useMemo<Record<number, string>>(
    () => ({
      1: 'head',
      2: 'neck',
      3: 'shoulder',
      16: 'back',
      5: 'chest',
      20: 'chest',
      9: 'wrist',
      10: 'hands',
      6: 'waist',
      7: 'legs',
      8: 'feet',
      11: 'finger1',
      12: 'trinket1',
      13: 'main_hand',
      17: 'main_hand',
      21: 'main_hand',
      14: 'off_hand',
      22: 'off_hand',
      23: 'off_hand',
    }),
    []
  );

  const {
    instances,
    selectedInstance,
    setSelectedInstance,
    drops,
    loading,
    globalSearch,
    setGlobalSearch,
    localSearch,
    seasonConfig,
    selectedDifficulty,
    setSelectedDifficulty,
    filterSlot,
    setFilterSlot,
    category,
    setCategory,
    upgradeTracks,
    itemTiers,
    setItemTiers,
    groupBy,
    setGroupBy,
    missives,
    itemMissives,
    setItemMissives,
    itemEmbellishments,
    setItemEmbellishments,
  } = state;

  const filteredInstances = useMemo(() => {
    if (category === 'crafted') {
      return CRAFTED_SIDEBAR_FILTERS.map((entry) => ({
        id: entry.id,
        name: entry.name,
        type: 'crafted-slot',
      }));
    }
    return instances.filter((inst) => instanceMatchesCategory(inst, category));
  }, [instances, category]);

  const activeFilterSlot = category === 'crafted' ? craftedFilterSlot : filterSlot;

  const craftedSidebarSelectedId = useMemo(() => {
    if (category !== 'crafted') return selectedInstance;
    const normalized = normalizeSlotFilter(craftedFilterSlot);
    if (!normalized) return CRAFTED_ALL_ITEMS_ID;
    const selectedEntry = CRAFTED_SIDEBAR_FILTERS.find((entry) => entry.filter === normalized);
    return selectedEntry?.id ?? CRAFTED_ALL_ITEMS_ID;
  }, [category, selectedInstance, craftedFilterSlot]);

  const handleSidebarSelect = (id: number) => {
    if (category === 'crafted') {
      const entry = CRAFTED_SIDEBAR_FILTERS.find((opt) => opt.id === id);
      if (entry) {
        setCraftedFilterSlot(entry.filter);
        return;
      }
    }
    setSelectedInstance(id);
  };

  const effectiveDifficulty = (category === 'world_bosses' || category === 'pvp' || category === 'crafted') ? 'normal' : selectedDifficulty;

  // Reset per-item ilvl slider selections when top filters change.
  useEffect(() => {
    setItemTiers({});
    setItemMissives({});
    setItemEmbellishments({});
    setItemGems({});
  }, [
    category,
    selectedDifficulty,
    globalSearch,
    setItemTiers,
    setItemMissives,
    setItemEmbellishments,
  ]);

  useEffect(() => {
    if (isOpen) {
      setCraftedFilterSlot(preferredSlot || null);
    }
  }, [isOpen, preferredSlot]);

  const filteredDrops = useMemo(() => {
    const result: Record<string, ExternalItem[]> = {};
    const sourceData = drops;

    if (groupBy === 'boss' && category !== 'dungeon') {
      // Flatten items then regroup by boss
      const flattened = Object.values(sourceData).flat();
      for (const item of flattened) {
        const boss = item.encounter || 'Unknown';

        // 1. Search filter logic
        const lowerQuery = globalSearch.toLowerCase();
        const localQuery = localSearch.toLowerCase();
        const matchesGlobal =
          item.name.toLowerCase().includes(lowerQuery) ||
          item.encounter.toLowerCase().includes(lowerQuery);
        const matchesLocal =
          item.name.toLowerCase().includes(localQuery) ||
          item.encounter.toLowerCase().includes(localQuery);

        if (!matchesGlobal || !matchesLocal) continue;

        // 2. Slot filter logic
        const slotKey = inventoryTypeToSlot[item.inventory_type] || 'unknown';
        const lowerSlot = slotKey.toLowerCase();
        const lowerFilter = activeFilterSlot?.toLowerCase() || null;

        if (lowerFilter && lowerSlot !== lowerFilter) {
          const isTrinket = lowerFilter.startsWith('trinket') && lowerSlot.startsWith('trinket');
          const isRing =
            (lowerFilter.startsWith('finger') || lowerFilter.startsWith('ring')) &&
            (lowerSlot.startsWith('finger') || lowerSlot.startsWith('ring'));
          if (!isTrinket && !isRing) continue;
        }

        if (!result[boss]) result[boss] = [];
        result[boss].push(item);
      }
    } else {
      // Group by slot (existing behavior)
      for (const [slot, items] of Object.entries(sourceData)) {
        const lowerSlot =
          Object.keys(SLOT_LABELS)
            .find((key) => SLOT_LABELS[key] === slot)
            ?.toLowerCase() || slot.toLowerCase();
        const lowerFilter = activeFilterSlot?.toLowerCase() || null;
        if (lowerFilter && lowerSlot !== lowerFilter) {
          const isTrinket = lowerFilter.startsWith('trinket') && lowerSlot.startsWith('trinket');
          const isRing =
            (lowerFilter.startsWith('finger') || lowerFilter.startsWith('ring')) &&
            (lowerSlot.startsWith('finger') || lowerSlot.startsWith('ring'));
          if (!isTrinket && !isRing) continue;
        }
        const matching = items.filter(
          (i) =>
            (i.name.toLowerCase().includes(globalSearch.toLowerCase()) ||
              i.encounter.toLowerCase().includes(globalSearch.toLowerCase())) &&
            (i.name.toLowerCase().includes(localSearch.toLowerCase()) ||
              i.encounter.toLowerCase().includes(localSearch.toLowerCase()))
        );
        if (matching.length > 0) result[slot] = matching;
      }
    }
    return result;
  }, [
    drops,
    globalSearch,
    localSearch,
    activeFilterSlot,
    groupBy,
    category,
    inventoryTypeToSlot,
  ]);

  const difficulties = useMemo(() => {
    if (!seasonConfig) return [];
    if (category === 'world_bosses') return [];

    // If we are in Raid category, prioritize raid difficulties
    if (category === 'raid') return seasonConfig.raid_difficulties;

    const instance = instances.find((i) => i.id === selectedInstance);
    if (!instance) {
      // Fallback for dungeon category if no specific instance selected
      return seasonConfig.dungeon_categories[0]?.difficulties || [];
    }

    let group = seasonConfig.dungeon_categories.find(
      (c) =>
        c.poolInstanceId === instance.id ||
        instance.type === 'mplus-chest' ||
        instance.type === 'expansion-dungeon'
    );
    if (!group && (instance.type === 'dungeon' || instance.type === 'expansion-dungeon'))
      group = seasonConfig.dungeon_categories[0];

    if (group) return group.difficulties;
    
    // Default to raid diffs but filter for Delves
    if (category === 'delves') {
      const isPrey = instances.find((i) => i.id === selectedInstance)?.name?.toLowerCase().includes('prey');
      const makeTrack = (key: string, label: string, sortOrder: number): DifficultyDef => ({
        key,
        label,
        track: label,
        level: 1,
        sortOrder,
      });
      if (isPrey) {
        return [
          makeTrack('adventurer', 'Adventurer', 1),
          makeTrack('champion', 'Champion', 2),
        ];
      }
      return [
        makeTrack('adventurer', 'Adventurer', 1),
        makeTrack('champion', 'Champion', 2),
        makeTrack('hero', 'Hero', 3),
      ];
    }
    return seasonConfig.raid_difficulties;
  }, [seasonConfig, selectedInstance, instances, category]);

  // Ensure selected difficulty is valid for the current instance/category
  useEffect(() => {
    if (category === 'world_bosses') {
      if (selectedDifficulty !== 'normal') setSelectedDifficulty('normal');
      return;
    }
    if (difficulties.length > 0) {
      const isValid = difficulties.some((d: any) => d.key === selectedDifficulty);
      if (!isValid) {
        // Default to heroic for raids, or a middle ground for dungeons
        const defaultDiff =
          category === 'raid'
            ? difficulties.find((d: any) => d.key === 'heroic') || difficulties[0]
            : difficulties.find((d: any) => d.key === '+10') || difficulties[0];
        if (defaultDiff) {
          setSelectedDifficulty(defaultDiff.key);
        }
      }
    }
  }, [difficulties, category, selectedDifficulty, setSelectedDifficulty]);

  const gems = useMemo(() => deduplicateGems(rawGems), [rawGems]);
  const currentGemExpansion = useMemo(
    () => gems.reduce((max, gem) => (gem.expansion > max ? gem.expansion : max), 0),
    [gems]
  );
  const seasonalGems = useMemo(
    () =>
      currentGemExpansion > 0
        ? gems.filter((gem) => gem.expansion === currentGemExpansion)
        : gems,
    [gems, currentGemExpansion]
  );

  useWowheadTooltips([drops, selectedDifficulty, category, seasonalGems.length]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/gear/gem-options`, { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setRawGems(Array.isArray(data) ? data : []);
      } catch {
        if (!cancelled) setRawGems([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  useEffect(() => {
    const itemIds = new Set<number>();
    Object.values(drops).forEach((items) => {
      items.forEach((item) => {
        if (
          item.item_id > 0 &&
          !((item.embellishment_options || []).length > 0) &&
          embellishmentOptionsByItem[item.item_id] === undefined
        ) {
          itemIds.add(item.item_id);
        }
      });
    });
    const idsToFetch = Array.from(itemIds);
    if (idsToFetch.length === 0) return;
    let cancelled = false;
    (async () => {
      const fetched = await Promise.all(
        idsToFetch.map(async (itemId) => {
          try {
            const res = await fetch(
              `${API_URL}/api/gear/embellishment-options?item_id=${encodeURIComponent(String(itemId))}`,
              { credentials: 'include' }
            );
            if (!res.ok) return [itemId, [] as EmbellishmentOption[]] as const;
            const data = await res.json();
            return [itemId, Array.isArray(data) ? (data as EmbellishmentOption[]) : []] as const;
          } catch {
            return [itemId, [] as EmbellishmentOption[]] as const;
          }
        })
      );
      if (cancelled) return;
      setEmbellishmentOptionsByItem((prev) => {
        const next = { ...prev };
        for (const [itemId, options] of fetched) {
          next[itemId] = options;
        }
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [drops, isOpen, category, embellishmentOptionsByItem]);

  const handleAdd = (item: ExternalItem) => {
    const selectedLevel = itemTiers[item.item_id] || 1;
    const selectedEmbellishment = itemEmbellishments[item.item_id] || null;
    const selectedGem = itemGems[item.item_id] || null;
    const availableMissives = missivesForItem(item, missives);
    const gemOverride = selectedGem
      ? {
          gem_id: selectedGem.gem_id,
          name: selectedGem.name,
          icon: selectedGem.icon,
          quality: selectedGem.quality,
        }
      : undefined;
    const embellishmentBonusIds = selectedEmbellishment?.bonus_ids || [];
    const withEmbellishment = (baseBonusIds: number[]) =>
      Array.from(new Set([...baseBonusIds, ...embellishmentBonusIds]));
    const embellishmentOverride = selectedEmbellishment
      ? {
          item_id: selectedEmbellishment.item_id,
          name: selectedEmbellishment.name,
          icon: selectedEmbellishment.icon,
          bonus_ids: selectedEmbellishment.bonus_ids,
        }
      : undefined;
    const missiveTokens =
      (itemMissives[item.item_id] || []).length > 0
        ? itemMissives[item.item_id]
        : item.missive_count && item.missive_count > 0 && availableMissives.length > 0
          ? availableMissives[0].token.split('/')
          : [];
    const selectedMissiveToken = [...missiveTokens].sort().join('/');
    const selectedMissive = availableMissives.find((m: MissiveOption) => m.token === selectedMissiveToken);
    const missiveBonusIds = selectedMissive?.bonus_ids || [];
    const missivePoolBonusIds = Array.from(
      new Set(
        missives.flatMap((m: MissiveOption) =>
          Array.isArray(m.bonus_ids) ? m.bonus_ids : []
        )
      )
    );
    const embellishmentPoolBonusIds = Array.from(
      new Set(
        (((item.embellishment_options || []).length > 0
          ? item.embellishment_options
          : embellishmentOptionsByItem[item.item_id] || []) as EmbellishmentOption[]).flatMap(
          (opt) => (Array.isArray(opt.bonus_ids) ? opt.bonus_ids : [])
        )
      )
    );
    const craftedVariableBonusPool = Array.from(
      new Set([...missivePoolBonusIds, ...embellishmentPoolBonusIds])
    );
    const craftedSelectedBonusIds = Array.from(
      new Set([...(missiveBonusIds || []), ...(embellishmentBonusIds || [])])
    );
    const withCraftingBonuses = (baseBonusIds: number[]) =>
      Array.from(new Set([...baseBonusIds, ...missiveBonusIds]));

    // Fixed-track categories: resolve from getEffectiveTier directly
    const fixedTracks = getFixedTracksForCategory(category, item);
    if (fixedTracks) {
      const tier = getEffectiveTier(item, effectiveDifficulty, itemTiers, upgradeTracks, category);
      if (tier) {
        onAdd(item, 'normal', {
          bonus_ids: withEmbellishment(withCraftingBonuses(tier.bonus_id ? [tier.bonus_id] : [])),
          ilvl: tier.ilvl,
          track_name: tier.track,
          level: tier.level,
          quality: tier.quality,
          crafted_stats: missiveTokens.length > 0 ? missiveTokens : undefined,
          crafted_selected_bonus_ids: craftedSelectedBonusIds,
          crafted_variable_bonus_pool: craftedVariableBonusPool,
          embellishment: embellishmentOverride,
          gem: gemOverride,
        });
      } else {
        onAdd(item, 'normal', {
          bonus_ids: withEmbellishment(withCraftingBonuses([])),
          ilvl: item.ilevel,
          track_name: '',
          level: 0,
          crafted_stats: missiveTokens.length > 0 ? missiveTokens : undefined,
          crafted_selected_bonus_ids: craftedSelectedBonusIds,
          crafted_variable_bonus_pool: craftedVariableBonusPool,
          embellishment: embellishmentOverride,
          gem: gemOverride,
        });
      }
      return;
    }

    const info =
      item.difficulty_info?.[effectiveDifficulty] || item.dungeon_info?.[effectiveDifficulty];
    const trackName = getMappedTrackName(effectiveDifficulty, info);
    const baseBonusIds = info?.bonus_id ? [info.bonus_id] : [];

    if (category === 'crafted') {
      const levels = collectCraftedIlevels(item, upgradeTracks);
      const boundedLevel = Math.min(levels.length, Math.max(1, selectedLevel));
      const levelInfo = levels[boundedLevel - 1] || { ilvl: item.ilevel, bonus_id: 0, key: 'normal' };
      const craftedBaseBonusIds = Array.isArray(item.crafted_base_bonus_ids)
        ? item.crafted_base_bonus_ids
        : [];
      
      onAdd(item, levelInfo.key, {
        bonus_ids: withEmbellishment(withCraftingBonuses(craftedBaseBonusIds)),
        ilvl: levelInfo.ilvl,
        track_name: 'Radiance Crafted',
        level: boundedLevel,
        quality: getDisplayQuality(item, undefined, category as LootCategory),
        crafted_stats: missiveTokens.length > 0 ? missiveTokens : undefined,
        crafted_selected_bonus_ids: craftedSelectedBonusIds,
        crafted_variable_bonus_pool: craftedVariableBonusPool,
        embellishment: embellishmentOverride,
        gem: gemOverride,
      });
      return;
    }

    if (trackName && selectedLevel && upgradeTracks[trackName]) {
      const track = upgradeTracks[trackName];
      const levelInfo = track.find((t: any) => t.level === selectedLevel);
      if (levelInfo) {
        onAdd(item, effectiveDifficulty, {
          bonus_ids: withEmbellishment(
            withCraftingBonuses(Array.from(new Set([...baseBonusIds, levelInfo.bonus_id])))
          ),
          ilvl: levelInfo.ilvl,
          track_name: trackName,
          level: selectedLevel,
          quality: levelInfo.quality ?? info?.quality,
          crafted_stats: missiveTokens.length > 0 ? missiveTokens : undefined,
          crafted_selected_bonus_ids: craftedSelectedBonusIds,
          crafted_variable_bonus_pool: craftedVariableBonusPool,
          embellishment: embellishmentOverride,
          gem: gemOverride,
        });
        return;
      }
    }
    onAdd(
      item,
      effectiveDifficulty,
      info
        ? {
            bonus_ids: withEmbellishment(withCraftingBonuses(baseBonusIds)),
            ilvl: info.ilvl,
            track_name: info.track || '',
            level: info.level || 0,
            quality: info.quality,
            crafted_stats: missiveTokens.length > 0 ? missiveTokens : undefined,
            crafted_selected_bonus_ids: craftedSelectedBonusIds,
            crafted_variable_bonus_pool: craftedVariableBonusPool,
            embellishment: embellishmentOverride,
            gem: gemOverride,
          }
        : {
            bonus_ids: withEmbellishment(withCraftingBonuses([])),
            ilvl: item.ilevel,
            track_name: '',
            level: 0,
            crafted_stats: missiveTokens.length > 0 ? missiveTokens : undefined,
            crafted_selected_bonus_ids: craftedSelectedBonusIds,
            crafted_variable_bonus_pool: craftedVariableBonusPool,
            embellishment: embellishmentOverride,
            gem: gemOverride,
          }
    );
  };

  const handleCardClick = (item: ExternalItem, event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest('[data-stop-add="true"]')) return;
    if (target.closest('button,input,a,select,textarea')) return;

    const selection = window.getSelection?.();
    if (selection && selection.toString().trim().length > 0) return;

    handleAdd(item);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/75 backdrop-blur-md" onClick={onClose} />
      <div className="animate-in fade-in zoom-in relative flex h-[90vh] w-full max-w-[88rem] flex-col overflow-hidden rounded-2xl border border-border bg-bg shadow-2xl duration-200">
        {/* ── Header ─────────────────────────────────────────── */}
        <div className="border-b border-border bg-surface/80 px-5 py-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-6">
              {/* Title */}
              <div>
                <h2 className="text-lg font-bold tracking-tight text-white">Loot Browser</h2>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-white">
                  Expansion 11 • World of Warcraft
                </p>
              </div>
              {/* Category Switcher */}
              <div className="flex flex-wrap rounded-lg border border-border bg-surface-2 p-0.5">
                {LOOT_CATEGORIES.map((cat) => (
                  <button
                    key={cat.key}
                    onClick={() => {
                      setCategory(cat.key);
                      setGlobalSearch('');
                      if (cat.key === 'crafted') {
                        setSelectedInstance(0);
                        return;
                      }
                      const first = instances.find((i) => instanceMatchesCategory(i, cat.key));
                      if (first) setSelectedInstance(first.id);
                    }}
                    className={`rounded-md px-3 py-1.5 text-[11px] font-bold tracking-wide transition-all ${category === cat.key ? 'bg-gold text-black shadow-sm' : 'text-zinc-300 hover:text-white'}`}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>
              {/* Group-by toggle for raids */}
              {!['dungeon', 'delves', 'pvp', 'tier'].includes(category) && (
                <div className="flex items-center gap-3">
                  <div className="flex rounded-lg border border-border bg-surface-2 p-0.5">
                    {[
                      { id: 'slot', label: 'Slot' },
                      { id: 'boss', label: category === 'crafted' ? 'Profession' : 'Boss' },
                    ].map((mode: any) => (
                      <button
                        key={mode.id}
                        onClick={() => setGroupBy(mode.id)}
                        className={`rounded-md px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-all ${
                          groupBy === mode.id
                            ? 'bg-gold text-black shadow-sm border-transparent'
                            : 'border-transparent text-zinc-300 hover:text-white hover:bg-white/5'
                        }`}
                      >
                        {mode.label}
                      </button>
                    ))}
                  </div>
                  {category === 'crafted' && (
                    <span className="rounded-md bg-gold px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-black shadow-sm">
                      Quality 5
                    </span>
                  )}
                </div>
              )}
            </div>
            <div className="flex items-center gap-3">
              {category !== 'crafted' && (
              <div className="w-48 shrink-0">
                <CustomSelect
                  variant="header"
                  value={normalizeSlotFilter(filterSlot) || ''}
                  placeholder="All Item Types"
                  options={SLOT_FILTER_OPTIONS.map((slot) => ({
                    value: slot.value,
                    label: slot.label,
                  }))}
                  onChange={(val) => setFilterSlot(val || null)}
                />
              </div>
              )}
              <button
                onClick={onClose}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface-2 text-zinc-500 transition-all hover:border-red-500/30 hover:bg-red-500/10 hover:text-white"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2.5}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
          </div>
          {/* Search + Difficulty */}
          <div className="relative flex items-center gap-4">
            <div className="group relative flex-1">
              <input
                type="text"
                placeholder="Global Item Search..."
                value={globalSearch}
                onChange={(e) => {
                  setGlobalSearch(e.target.value);
                }}
                className="input-field w-full pl-10 pr-4 py-2.5 text-sm"
              />
              <svg
                className="absolute left-3.5 top-3 h-4 w-4 text-zinc-500 transition-colors group-focus-within:text-gold"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
            </div>
            {(category === 'raid' || category === 'dungeon' || category === 'tier' || (category === 'delves' && difficulties.length > 1)) && (
              <AddItemDifficultyToggle
                difficulties={difficulties}
                selectedDifficulty={selectedDifficulty}
                onSelect={setSelectedDifficulty}
                label={category === 'delves' || category === 'tier' ? 'Track' : 'Difficulty'}
              />
            )}
          </div>
        </div>

        {/* ── Body ────────────────────────────────────────────── */}
        <div className="flex flex-1 overflow-hidden">
          <AddItemInstanceSidebar
            instances={filteredInstances}
            selectedInstance={craftedSidebarSelectedId}
            onSelect={handleSidebarSelect}
          />
          <div className="scrollbar-thin scrollbar-thumb-white/10 flex-1 overflow-y-auto bg-bg p-6">
            {loading ? (
              <div className="flex h-full items-center justify-center">
                <div className="h-12 w-12 animate-spin rounded-full border-[3px] border-border border-t-gold" />
              </div>
            ) : Object.keys(filteredDrops).length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-sm italic text-zinc-600">
                No loot items match your filters
              </div>
            ) : (
              <div>
                {Object.entries(filteredDrops).map(([slot, items]) => (
                  <section
                    key={slot}
                    className="grid grid-cols-1 gap-4 border-t border-white/35 py-7 first:border-t-0 lg:grid-cols-[5.75rem_minmax(0,1fr)] xl:grid-cols-[6.5rem_minmax(0,1fr)]"
                  >
                    <div className="flex items-center lg:justify-center">
                      <div className="min-w-20 lg:text-center">
                        <div className="text-sm font-black uppercase tracking-[0.18em] text-gold/85 xl:text-base">
                          {slot}
                        </div>
                        <div className="mt-2 text-[10px] font-bold uppercase tracking-[0.18em] text-white">
                          {items.length} item{items.length === 1 ? '' : 's'}
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
                      {items.map((item, index) => {
                        const tier = getEffectiveTier(
                          item,
                          effectiveDifficulty,
                          itemTiers,
                          upgradeTracks,
                          category
                        );
                        const currentIlvl = tier?.ilvl || item.ilevel;
                        const trackName = tier?.track || '';
                        const tc = trackName ? TRACK_COLORS[trackName] : null;
                        const badgeClass = tc?.badge || DEFAULT_BADGE;
                        const displayQuality = getDisplayQuality(item, tier?.quality, category as LootCategory);
                        const availableMissives = missivesForItem(item, missives);
                        const defaultMissive =
                          item.missive_count && item.missive_count > 0 && availableMissives.length > 0
                            ? availableMissives[0]
                            : null;
                        const effectiveMissiveTokens =
                          (itemMissives[item.item_id] || []).length > 0
                            ? itemMissives[item.item_id]
                            : defaultMissive
                              ? defaultMissive.token.split('/')
                              : [];
                        const selectedMissiveToken = [...effectiveMissiveTokens]
                          .sort()
                          .join('/');
                        const selectedMissive = availableMissives.find(
                          (m: MissiveOption) => m.token === selectedMissiveToken
                        );
                        const selectedEmbellishment = itemEmbellishments[item.item_id] || null;
                        const selectedGem = itemGems[item.item_id] || null;
                        const canSocketItem =
                          Number(item.socket_count || 0) > 0 || Boolean(item.hasSockets);
                        const tooltipBonusIds =
                          category === 'crafted'
                            ? Array.from(
                                new Set([
                                  ...(item.crafted_base_bonus_ids || []),
                                  ...((selectedMissive?.bonus_ids as number[]) || []),
                                  ...((selectedEmbellishment?.bonus_ids as number[]) || []),
                                ])
                              )
                            : (tier?.bonus_id ? [tier.bonus_id] : []);
                        const whData = getWowheadData(
                          tooltipBonusIds,
                          currentIlvl,
                          undefined,
                          selectedGem?.gem_id
                        );
                        const embellishmentOptions = ((item.embellishment_options || []).length > 0
                          ? item.embellishment_options || []
                          : embellishmentOptionsByItem[item.item_id] || []).filter(
                          (opt): opt is EmbellishmentOption =>
                            !!opt &&
                            Number.isFinite(opt.item_id) &&
                            Number.isFinite(opt.id) &&
                            Array.isArray(opt.bonus_ids) &&
                            opt.bonus_ids.length > 0
                        );
                        return (
                          <div
                            key={`${item.item_id}-${item.encounter}-${item.instance_name}-${item.inventory_type}-${index}`}
                            className="group card p-2.5 transition-all hover:border-border-light hover:shadow-card-hover cursor-pointer"
                            onClick={(event) => handleCardClick(item, event)}
                          >
                            <div className="flex items-center gap-3">
                              <a
                                href={`https://www.wowhead.com/item=${item.item_id}`}
                                data-wowhead={`item=${item.item_id}&${whData}`}
                                onClick={(e) => e.preventDefault()}
                                className="shrink-0"
                              >
                                <img
                                  src={`https://wow.zamimg.com/images/wow/icons/large/${item.icon}.jpg`}
                                  className="h-10 w-10 rounded-lg border border-border shadow-sm"
                                  alt=""
                                />
                              </a>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center justify-between gap-2">
                                  <span 
                                    className="truncate text-xs font-bold transition-colors group-hover:text-gold"
                                    style={{ color: QUALITY_COLORS[displayQuality] || '#f4f4f5' }}
                                  >
                                    {item.name}
                                  </span>
                                  <span className={`shrink-0 rounded-md border px-1.5 py-0.5 font-mono text-[11px] font-black ${badgeClass}`}>
                                    {currentIlvl}
                                  </span>
                                </div>
                                <div className="truncate text-[12px] font-medium text-zinc-300">
                                  {item.encounter}
                                </div>
                              </div>
                            </div>
                            {category === 'crafted' && (
                              <div
                                className="mt-2 space-y-2 border-t border-white/5 pt-2"
                                data-stop-add="true"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                                    Embellishment
                                  </span>
                                </div>
                                  <CustomSelect
                                    value={
                                      itemEmbellishments[item.item_id]
                                        ? String(itemEmbellishments[item.item_id]?.item_id || '')
                                        : ''
                                    }
                                    placeholder="No Embellishment"
                                    options={[
                                      { value: '', label: 'No Embellishment' },
                                      ...embellishmentOptions.map((opt) => ({
                                        value: String(opt.item_id),
                                        label: opt.name,
                                        icon: opt.icon,
                                        href: `https://www.wowhead.com/item=${opt.item_id}`,
                                        wowheadData: `item=${opt.item_id}`,
                                      })),
                                    ]}
                                  onChange={(val) => {
                                    if (!val) {
                                      setItemEmbellishments({
                                        ...itemEmbellishments,
                                        [item.item_id]: null,
                                      });
                                      return;
                                    }
                                    const selected =
                                      embellishmentOptions.find(
                                        (opt) => String(opt.item_id) === val
                                      ) || null;
                                    setItemEmbellishments({
                                      ...itemEmbellishments,
                                      [item.item_id]: selected,
                                    });
                                  }}
                                />
                              </div>
                            )}
                            {category === 'crafted' && canSocketItem && (
                              <div
                                className="mt-2 space-y-2 border-t border-white/5 pt-2"
                                data-stop-add="true"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                                    Gem
                                  </span>
                                </div>
                                <CustomSelect
                                  value={selectedGem ? String(selectedGem.gem_id) : ''}
                                  placeholder="Empty Socket"
                                  options={[
                                    { value: '', label: 'Empty Socket' },
                                    ...seasonalGems.map((gem) => ({
                                      value: String(gem.gem_id),
                                      label: gem.name,
                                      icon: gem.icon,
                                      href: `https://www.wowhead.com/item=${gem.gem_id}`,
                                      wowheadData: `item=${gem.gem_id}`,
                                    })),
                                  ]}
                                  onChange={(val) => {
                                    if (!val) {
                                      setItemGems({ ...itemGems, [item.item_id]: null });
                                      return;
                                    }
                                    const gem =
                                      seasonalGems.find((candidate) => String(candidate.gem_id) === val) ||
                                      null;
                                    setItemGems({ ...itemGems, [item.item_id]: gem });
                                  }}
                                />
                              </div>
                            )}
                            {item.missive_count && item.missive_count > 0 && (
                              <div
                                className="mt-2 space-y-2 border-t border-white/5 pt-2"
                                data-stop-add="true"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                                    Crafted Item Stats
                                  </span>
                                </div>
                                <div className="flex flex-col gap-1.5">
                                  <CustomSelect
                                    value={effectiveMissiveTokens.join('/')}
                                    placeholder="Select Stats..."
                                    options={availableMissives.map((m) => ({ value: m.token, label: m.label }))}
                                    onChange={(val) => {
                                      const stats = val ? val.split('/') : [];
                                      setItemMissives({ ...itemMissives, [item.item_id]: stats });
                                    }}
                                  />
                                </div>
                              </div>
                            )}
                            {tier && tier.maxLevel > 1 && (
                              <div className="mt-2 space-y-1">
                                <div className="flex items-center justify-between text-[11px] font-semibold text-white">
                                  <span>
                                    {tier.track === 'Crafted'
                                      ? `Level ${tier.level}/${tier.maxLevel}`
                                      : `${tier.track} ${tier.level}/${tier.maxLevel}`}
                                  </span>
                                  <span className="font-mono">
                                    {tier.ilvl} ilvl
                                  </span>
                                </div>
                                <input
                                  type="range"
                                  min={1}
                                  max={tier.maxLevel}
                                  step={1}
                                  value={tier.level}
                                  onChange={(e) => {
                                    const nextLevel = Number(e.target.value);
                                    setItemTiers((prev) => ({
                                      ...prev,
                                      [item.item_id]: nextLevel,
                                    }));
                                  }}
                                  onMouseDown={(e) => e.stopPropagation()}
                                  onClick={(e) => e.stopPropagation()}
                                  className="w-full"
                                />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
