import { useMemo } from 'react';
import { SLOT_LABELS, type DifficultyDef, type SeasonConfigResponse } from '../../lib/types';
import type { ExternalItem, AddItemCategory } from './useAddItemState';
import {
  CRAFTED_ALL_ITEMS_ID,
  CRAFTED_PVP_FILTER,
  CRAFTED_SIDEBAR_FILTERS,
  SLOT_FILTER_LABELS,
  LOOT_BROWSER_SLOT_ORDER_INDEX,
  compareLootBrowserItems,
  deduplicateGems,
  isPvpCraftedItem,
  normalizeSlotFilter,
  slotLabelToOrderKey,
  type RawGem,
} from './addItemDomain';

interface UseAddItemDerivedStateArgs {
  category: AddItemCategory;
  instances: Array<{ id: number; name: string; type: string }>;
  selectedInstance: number;
  craftedFilterSlot: string | null;
  filterSlot: string | null;
  drops: Record<string, ExternalItem[]>;
  groupBy: 'slot' | 'boss';
  globalSearch: string;
  localSearch: string;
  selectedDifficulty: string;
  canUseOffhand: boolean;
  seasonConfig: SeasonConfigResponse | null;
  rawGems: RawGem[];
  inventoryTypeToSlot: Record<number, string>;
  instanceMatchesCategory: (inst: { name?: string; type?: string }, cat: string) => boolean;
  hasAvailableDifficulty: (item: ExternalItem, difficulty: string, category: string) => boolean;
}

export function useAddItemDerivedState(args: UseAddItemDerivedStateArgs) {
  const {
    category,
    instances,
    selectedInstance,
    craftedFilterSlot,
    filterSlot,
    drops,
    groupBy,
    globalSearch,
    localSearch,
    selectedDifficulty,
    seasonConfig,
    rawGems,
    inventoryTypeToSlot,
    instanceMatchesCategory,
    hasAvailableDifficulty,
  } = args;

  const craftedSidebarFilters = useMemo(
    () =>
      CRAFTED_SIDEBAR_FILTERS.filter(
        (entry) => entry.filter !== 'off_hand' || args.canUseOffhand,
      ),
    [args.canUseOffhand]
  );

  const filteredInstances = useMemo(() => {
    if (category === 'crafted') {
      return craftedSidebarFilters.map((entry) => ({ id: entry.id, name: entry.name, type: 'crafted-slot' }));
    }
    return instances.filter((inst) => instanceMatchesCategory(inst, category));
  }, [instances, category, craftedSidebarFilters, instanceMatchesCategory]);

  const activeFilterSlot = category === 'crafted' ? craftedFilterSlot : filterSlot;
  const normalizedActiveFilterSlot = normalizeSlotFilter(activeFilterSlot);
  const activeFilterSlotLabel = useMemo(() => {
    if (normalizedActiveFilterSlot === CRAFTED_PVP_FILTER) return 'PvP';
    return normalizedActiveFilterSlot ? SLOT_FILTER_LABELS.get(normalizedActiveFilterSlot) || null : null;
  }, [normalizedActiveFilterSlot]);

  const craftedPvpOnly =
    category === 'crafted' && normalizeSlotFilter(craftedFilterSlot) === CRAFTED_PVP_FILTER;
  const effectiveSlotFilter =
    normalizedActiveFilterSlot === CRAFTED_PVP_FILTER ? null : normalizedActiveFilterSlot;

  const craftedSidebarSelectedId = useMemo(() => {
    if (category !== 'crafted') return selectedInstance;
    const normalized = normalizeSlotFilter(craftedFilterSlot);
    if (!normalized) return CRAFTED_ALL_ITEMS_ID;
    const selectedEntry = craftedSidebarFilters.find((entry) => entry.filter === normalized);
    return selectedEntry?.id ?? CRAFTED_ALL_ITEMS_ID;
  }, [category, selectedInstance, craftedFilterSlot, craftedSidebarFilters]);

  const filteredDrops = useMemo(() => {
    const result: Record<string, ExternalItem[]> = {};
    const includeCraftedItem = (item: ExternalItem) => {
      if (category !== 'crafted') return true;
      const isPvpItem = isPvpCraftedItem(item);
      if (craftedPvpOnly) return isPvpItem;
      return !isPvpItem;
    };

    if (groupBy === 'boss' && category !== 'dungeon') {
      const flattened = Object.values(drops).flat();
      for (const item of flattened) {
        if (!includeCraftedItem(item)) continue;
        const boss = item.encounter || 'Unknown';
        const lowerQuery = globalSearch.toLowerCase();
        const localQuery = localSearch.toLowerCase();
        const matchesGlobal =
          item.name.toLowerCase().includes(lowerQuery) || item.encounter.toLowerCase().includes(lowerQuery);
        const matchesLocal =
          item.name.toLowerCase().includes(localQuery) || item.encounter.toLowerCase().includes(localQuery);

        if (!matchesGlobal || !matchesLocal) continue;

        const slotKey = inventoryTypeToSlot[item.inventory_type] || 'unknown';
        const lowerSlot = slotKey.toLowerCase();
        const lowerFilter = effectiveSlotFilter?.toLowerCase() || null;

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
      for (const [slot, items] of Object.entries(drops)) {
        const lowerSlot =
          Object.keys(SLOT_LABELS).find((key) => SLOT_LABELS[key] === slot)?.toLowerCase() ||
          slot.toLowerCase();
        const lowerFilter = effectiveSlotFilter?.toLowerCase() || null;
        if (lowerFilter && lowerSlot !== lowerFilter) {
          const isTrinket = lowerFilter.startsWith('trinket') && lowerSlot.startsWith('trinket');
          const isRing =
            (lowerFilter.startsWith('finger') || lowerFilter.startsWith('ring')) &&
            (lowerSlot.startsWith('finger') || lowerSlot.startsWith('ring'));
          if (!isTrinket && !isRing) continue;
        }
        const matching = items.filter(
          (item) =>
            includeCraftedItem(item) &&
            (category !== 'dungeon' || hasAvailableDifficulty(item, selectedDifficulty, category)) &&
            (item.name.toLowerCase().includes(globalSearch.toLowerCase()) ||
              item.encounter.toLowerCase().includes(globalSearch.toLowerCase())) &&
            (item.name.toLowerCase().includes(localSearch.toLowerCase()) ||
              item.encounter.toLowerCase().includes(localSearch.toLowerCase())),
        );
        if (matching.length > 0) result[slot] = matching;
      }
    }

    for (const key of Object.keys(result)) {
      result[key] = [...result[key]].sort(compareLootBrowserItems);
    }

    return result;
  }, [
    category,
    craftedPvpOnly,
    drops,
    effectiveSlotFilter,
    globalSearch,
    groupBy,
    hasAvailableDifficulty,
    inventoryTypeToSlot,
    localSearch,
    selectedDifficulty,
  ]);

  const orderedFilteredDropEntries = useMemo(() => {
    const entries = Object.entries(filteredDrops);
    if (groupBy === 'boss' && category !== 'dungeon') {
      return entries.sort(([a], [b]) => a.localeCompare(b));
    }

    return entries.sort(([a], [b]) => {
      const aKey = slotLabelToOrderKey(a);
      const bKey = slotLabelToOrderKey(b);
      const aIndex = LOOT_BROWSER_SLOT_ORDER_INDEX.get(aKey) ?? Number.MAX_SAFE_INTEGER;
      const bIndex = LOOT_BROWSER_SLOT_ORDER_INDEX.get(bKey) ?? Number.MAX_SAFE_INTEGER;
      if (aIndex !== bIndex) return aIndex - bIndex;
      return a.localeCompare(b);
    });
  }, [filteredDrops, groupBy, category]);

  const difficulties = useMemo(() => {
    if (!seasonConfig) return [];
    if (category === 'world_bosses') return [];
    if (category === 'raid') return seasonConfig.raid_difficulties;

    const instance = instances.find((item) => item.id === selectedInstance);
    if (!instance) {
      return seasonConfig.dungeon_categories[0]?.difficulties || [];
    }

    let group = seasonConfig.dungeon_categories.find(
      (entry) =>
        entry.poolInstanceId === instance.id ||
        instance.type === 'mplus-chest' ||
        instance.type === 'expansion-dungeon',
    );
    if (!group && (instance.type === 'dungeon' || instance.type === 'expansion-dungeon')) {
      group = seasonConfig.dungeon_categories[0];
    }

    if (group) return group.difficulties;

    if (category === 'delves') {
      const isPrey = instances
        .find((item) => item.id === selectedInstance)
        ?.name?.toLowerCase()
        .includes('prey');
      const makeTrack = (key: string, label: string, sortOrder: number): DifficultyDef => ({
        key,
        label,
        track: label,
        level: 1,
        sortOrder,
      });
      if (isPrey) {
        return [makeTrack('adventurer', 'Adventurer', 1), makeTrack('champion', 'Champion', 2)];
      }
      return [
        makeTrack('adventurer', 'Adventurer', 1),
        makeTrack('champion', 'Champion', 2),
        makeTrack('hero', 'Hero', 3),
      ];
    }

    return seasonConfig.raid_difficulties;
  }, [seasonConfig, selectedInstance, instances, category]);

  const gems = useMemo(() => deduplicateGems(rawGems), [rawGems]);
  const currentGemExpansion = useMemo(
    () => gems.reduce((max, gem) => (gem.expansion > max ? gem.expansion : max), 0),
    [gems]
  );
  const seasonalGems = useMemo(
    () => (currentGemExpansion > 0 ? gems.filter((gem) => gem.expansion === currentGemExpansion) : gems),
    [gems, currentGemExpansion]
  );

  return {
    craftedSidebarFilters,
    filteredInstances,
    activeFilterSlot,
    normalizedActiveFilterSlot,
    activeFilterSlotLabel,
    craftedPvpOnly,
    effectiveSlotFilter,
    craftedSidebarSelectedId,
    filteredDrops,
    orderedFilteredDropEntries,
    difficulties,
    gems,
    currentGemExpansion,
    seasonalGems,
  };
}
