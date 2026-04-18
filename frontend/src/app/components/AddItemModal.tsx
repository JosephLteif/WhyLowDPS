'use client';

import { useEffect, useMemo } from 'react';
import { SLOT_LABELS } from '../lib/types';
import { useWowheadTooltips } from '../lib/useWowheadTooltips';
import { getWowheadData } from '../lib/useItemInfo';
import { useAddItemState, type ExternalItem } from './add-item/useAddItemState';
import AddItemDifficultyToggle from './add-item/AddItemDifficultyToggle';
import AddItemInstanceSidebar from './add-item/AddItemInstanceSidebar';
import AddItemSearchOverlay from './add-item/AddItemSearchOverlay';

interface AddItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (
    item: ExternalItem,
    difficulty: string,
    overrides?: { bonus_ids: number[]; ilvl: number; track_name: string; level: number }
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

const getMappedTrackName = (
  selectedDifficulty: string,
  info: { track?: string } | null | undefined
): string => {
  const raidTrack = RAID_TRACK_BY_DIFFICULTY[selectedDifficulty?.toLowerCase()];
  return raidTrack || info?.track || '';
};

const getEffectiveTier = (
  item: ExternalItem,
  selectedDifficulty: string,
  itemTiers: Record<number, number>,
  upgradeTracks: Record<string, any>
) => {
  const info =
    item.difficulty_info?.[selectedDifficulty] || item.dungeon_info?.[selectedDifficulty];
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
    setLocalSearch,
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
    allPossibleDrops,
    showSearchDropdown,
    setShowSearchDropdown,
    isGlobalLoading,
    groupBy,
    setGroupBy,
  } = state;

  const filteredInstances = useMemo(() => {
    if (selectedInstance === -2)
      return [{ id: -2, name: 'Search Results', type: 'search' }, ...instances];
    return instances.filter((inst) => {
      const type = inst.type.toLowerCase();
      if (category === 'raid') return type === 'raid';
      return type === 'dungeon' || type === 'expansion-dungeon' || type === 'mplus-chest';
    });
  }, [instances, category, selectedInstance]);

  // Reset per-item ilvl slider selections when top filters change.
  useEffect(() => {
    setItemTiers({});
  }, [category, selectedDifficulty, globalSearch, setItemTiers]);

  const globalSearchResults = useMemo(() => {
    if (!globalSearch || globalSearch.length < 2) return [];
    const lowerQuery = globalSearch.toLowerCase();
    const results: ExternalItem[] = [];
    for (const items of Object.values(allPossibleDrops)) {
      for (const item of items) {
        if (
          item.name.toLowerCase().includes(lowerQuery) ||
          item.encounter.toLowerCase().includes(lowerQuery) ||
          item.instance_name.toLowerCase().includes(lowerQuery)
        ) {
          if (!results.find((r) => r.item_id === item.item_id)) results.push(item);
        }
        if (results.length > 50) break;
      }
      if (results.length > 50) break;
    }
    return results;
  }, [allPossibleDrops, globalSearch]);

  const filteredDrops = useMemo(() => {
    const result: Record<string, ExternalItem[]> = {};
    const sourceData =
      selectedInstance === -2
        ? globalSearchResults.reduce(
            (acc, item) => {
              const slotKey = inventoryTypeToSlot[item.inventory_type] || 'unknown';
              const slot = SLOT_LABELS[slotKey] || 'Unknown';
              if (!acc[slot]) acc[slot] = [];
              acc[slot].push(item);
              return acc;
            },
            {} as Record<string, ExternalItem[]>
          )
        : drops;

    if (groupBy === 'boss' && category === 'raid') {
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
        const lowerFilter = filterSlot?.toLowerCase() || null;

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
          Object.keys(SLOT_LABELS).find((key) => SLOT_LABELS[key] === slot)?.toLowerCase() ||
          slot.toLowerCase();
        const lowerFilter = filterSlot?.toLowerCase() || null;
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
    filterSlot,
    selectedInstance,
    globalSearchResults,
    groupBy,
    category,
    inventoryTypeToSlot,
  ]);

  const difficulties = useMemo(() => {
    if (!seasonConfig) return [];

    // If we are in Raid category, prioritize raid difficulties
    if (category === 'raid') return seasonConfig.raid_difficulties;

    const instance = instances.find((i) => i.id === selectedInstance);
    if (!instance) {
      // Fallback for dungeon category if no specific instance selected
      return seasonConfig.dungeon_categories[0]?.difficulties || [];
    }

    if (instance.type === 'raid') return seasonConfig.raid_difficulties;
    let group = seasonConfig.dungeon_categories.find(
      (c) =>
        c.poolInstanceId === instance.id ||
        instance.type === 'mplus-chest' ||
        instance.type === 'expansion-dungeon'
    );
    if (!group && (instance.type === 'dungeon' || instance.type === 'expansion-dungeon'))
      group = seasonConfig.dungeon_categories[0];
    return group?.difficulties || seasonConfig.raid_difficulties;
  }, [seasonConfig, selectedInstance, instances, category]);

  // Ensure selected difficulty is valid for the current instance/category
  useEffect(() => {
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

  useWowheadTooltips([drops, globalSearchResults, selectedDifficulty, category]);

  const handleAdd = (item: ExternalItem) => {
    const info =
      item.difficulty_info?.[selectedDifficulty] || item.dungeon_info?.[selectedDifficulty];
    const trackName = getMappedTrackName(selectedDifficulty, info);
    const selectedLevel = itemTiers[item.item_id];
    const baseBonusIds = info?.bonus_id ? [info.bonus_id] : [];

    if (trackName && selectedLevel && upgradeTracks[trackName]) {
      const track = upgradeTracks[trackName];
      const levelInfo = track.find((t: any) => t.level === selectedLevel);
      if (levelInfo) {
        onAdd(item, selectedDifficulty, {
          bonus_ids: Array.from(new Set([...baseBonusIds, levelInfo.bonus_id])),
          ilvl: levelInfo.ilvl,
          track_name: trackName,
          level: selectedLevel,
        });
        return;
      }
    }
    onAdd(
      item,
      selectedDifficulty,
      info
        ? {
            bonus_ids: baseBonusIds,
            ilvl: info.ilvl,
            track_name: info.track || '',
            level: info.level || 0,
          }
        : undefined
    );
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/75 backdrop-blur-md" onClick={onClose} />
      <div className="animate-in fade-in zoom-in relative flex h-[90vh] w-full max-w-7xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#0a0a0c] shadow-2xl duration-200">
        <div className="border-b border-white/5 bg-white/[0.02] p-4">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-8">
              <div>
                <h2 className="text-xl font-bold text-white">Loot Browser</h2>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                  Expansion 11 • World of Warcraft
                </p>
              </div>
              <div className="flex rounded-2xl border border-white/5 bg-black/40 p-1.5 shadow-inner">
                {['raid', 'dungeon'].map((cat: any) => (
                  <button
                    key={cat}
                    onClick={() => {
                      setCategory(cat);
                      setGlobalSearch('');
                      setShowSearchDropdown(false);
                      const first = instances.find(
                        (i) => i.type.toLowerCase() === (cat === 'raid' ? 'raid' : 'dungeon')
                      );
                      if (first) setSelectedInstance(first.id);
                    }}
                    className={`rounded-xl px-5 py-2 text-xs font-bold transition-all ${category === cat ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
                  >
                    {cat.toUpperCase()}
                  </button>
                ))}
              </div>
              {category === 'raid' && (
                <div className="flex rounded-2xl border border-white/5 bg-black/40 p-1.5 shadow-inner">
                  {[
                    { id: 'slot', label: 'Slot' },
                    { id: 'boss', label: 'Boss' },
                  ].map((mode: any) => (
                    <button
                      key={mode.id}
                      onClick={() => setGroupBy(mode.id)}
                      className={`rounded-xl px-4 py-2 text-[10px] font-bold transition-all ${
                        groupBy === mode.id
                          ? 'bg-zinc-700 text-white shadow-lg'
                          : 'text-slate-500 hover:text-slate-300'
                      }`}
                    >
                      {mode.label.toUpperCase()}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={onClose}
              className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/5 bg-white/[0.03] text-slate-500 transition-all hover:bg-red-500/10 hover:text-white"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2.5}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
          <div className="relative flex items-center gap-6">
            <div className="group relative flex-1">
              <input
                type="text"
                placeholder="Global Item Search..."
                value={globalSearch}
                onChange={(e) => {
                  setGlobalSearch(e.target.value);
                  setShowSearchDropdown(true);
                }}
                className="w-full rounded-2xl border border-white/5 bg-black/60 px-12 py-3 text-sm font-medium text-white transition-all placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              />
              <svg
                className="absolute left-4 top-3.5 h-5 w-5 text-slate-600 transition-colors group-focus-within:text-blue-500"
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
              <AddItemSearchOverlay
                isVisible={showSearchDropdown}
                isGlobalLoading={isGlobalLoading}
                globalSearch={globalSearch}
                results={globalSearchResults}
                onSelect={(item) => {
                  setSelectedInstance(-2);
                  setGlobalSearch(item.name);
                  setShowSearchDropdown(false);
                }}
                onShowAll={() => {
                  setSelectedInstance(-2);
                  setShowSearchDropdown(false);
                }}
              />
            </div>
            <AddItemDifficultyToggle
              difficulties={difficulties}
              selectedDifficulty={selectedDifficulty}
              onSelect={setSelectedDifficulty}
            />
          </div>
        </div>

        <div className="flex flex-1 overflow-hidden">
          <AddItemInstanceSidebar
            instances={filteredInstances}
            selectedInstance={selectedInstance}
            onSelect={setSelectedInstance}
          />
          <div className="scrollbar-thin scrollbar-thumb-white/10 flex-1 overflow-y-auto bg-[#08080a] p-8">
            {loading ? (
              <div className="flex h-full items-center justify-center">
                <div className="h-16 w-16 animate-spin rounded-full border-4 border-white/5 border-t-blue-500" />
              </div>
            ) : Object.keys(filteredDrops).length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center italic text-slate-600">
                No loot items match your filters
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
                {Object.entries(filteredDrops).map(([slot, items]) => (
                  <div key={slot} className="space-y-3">
                    <h3 className="ml-1 text-[10px] font-black uppercase tracking-[0.3em] text-slate-700">
                      {slot}
                    </h3>
                    <div className="space-y-2">
                      {items.map((item) => {
                        const tier = getEffectiveTier(
                          item,
                          selectedDifficulty,
                          itemTiers,
                          upgradeTracks
                        );
                        const currentIlvl = tier?.ilvl || item.ilevel;
                        const whData = getWowheadData(
                          tier?.bonus_id ? [tier.bonus_id] : [],
                          currentIlvl
                        );
                        return (
                          <div
                            key={`${item.item_id}-${item.encounter}`}
                            className="group relative rounded-2xl border border-white/5 bg-white/[0.03] p-3 shadow-sm transition-all hover:border-white/10 hover:bg-white/[0.06] hover:shadow-blue-900/10"
                          >
                            <div
                              className="flex cursor-pointer items-center gap-4"
                              onClick={() => handleAdd(item)}
                            >
                              <img
                                src={`https://wow.zamimg.com/images/wow/icons/large/${item.icon}.jpg`}
                                className="h-12 w-12 rounded-xl border border-white/10 shadow-lg"
                                alt=""
                                data-wowhead={whData}
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="truncate text-[13px] font-bold text-white transition-colors group-hover:text-blue-400">
                                    {item.name}
                                  </span>
                                  <span className="shrink-0 rounded-lg border border-blue-500/10 bg-blue-500/5 px-1.5 py-0.5 font-mono text-[10px] font-black text-blue-500/80">
                                    {currentIlvl}
                                  </span>
                                </div>
                                <div className="truncate text-[11px] font-medium text-slate-500">
                                  {item.encounter}
                                </div>
                              </div>
                            </div>
                            {tier && tier.maxLevel > 1 && (
                              <div className="mt-3 pl-16 pr-1">
                                <div className="mb-1 flex items-center justify-between text-[10px] font-semibold text-slate-400">
                                  <span>
                                    Selected: {tier.track} {tier.level}/{UPGRADE_TRACK_MAX_LEVEL}
                                  </span>
                                  <span className="font-mono text-blue-300/90">
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
                                  onClick={(e) => e.stopPropagation()}
                                  className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/15 accent-blue-500"
                                />
                              </div>
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
        </div>
      </div>
    </div>
  );
}
