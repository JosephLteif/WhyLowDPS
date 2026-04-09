'use client';

import { useMemo } from 'react';
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

const getEffectiveTier = (
  item: ExternalItem,
  selectedDifficulty: string,
  itemTiers: Record<number, number>,
  upgradeTracks: Record<string, any>
) => {
  const info =
    item.difficulty_info?.[selectedDifficulty] || item.dungeon_info?.[selectedDifficulty];
  if (!info?.track) return null;

  const currentLevel = itemTiers[item.item_id] || info.level || 1;
  const track = upgradeTracks[info.track];
  if (!track || !Array.isArray(track)) return null;

  const levelInfo = track.find((t: any) => t.level === currentLevel);
  return {
    track: info.track,
    level: currentLevel,
    maxLevel: info.max_level || track[track.length - 1].level,
    ilvl: levelInfo?.ilvl || info.ilvl,
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
              const slot = SLOT_LABELS[item.inventory_type] || 'Unknown';
              if (!acc[slot]) acc[slot] = [];
              acc[slot].push(item);
              return acc;
            },
            {} as Record<string, ExternalItem[]>
          )
        : drops;

    for (const [slot, items] of Object.entries(sourceData)) {
      const lowerSlot = slot.toLowerCase();
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
    return result;
  }, [drops, globalSearch, localSearch, filterSlot, selectedInstance, globalSearchResults]);

  const difficulties = useMemo(() => {
    if (!seasonConfig || !selectedInstance) return [];
    const instance = instances.find((i) => i.id === selectedInstance);
    if (!instance) return [];
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
  }, [seasonConfig, selectedInstance, instances]);

  useWowheadTooltips([drops, globalSearchResults, selectedDifficulty, category]);

  const handleAdd = (item: ExternalItem) => {
    const info =
      item.difficulty_info?.[selectedDifficulty] || item.dungeon_info?.[selectedDifficulty];
    const trackName = info?.track;
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
                            className="group relative flex cursor-pointer items-center gap-4 rounded-2xl border border-white/5 bg-white/[0.03] p-3 shadow-sm transition-all hover:border-white/10 hover:bg-white/[0.06] hover:shadow-blue-900/10"
                          >
                            <img
                              src={`https://wow.zamimg.com/images/wow/icons/large/${item.icon}.jpg`}
                              className="h-12 w-12 rounded-xl border border-white/10 shadow-lg"
                              alt=""
                              data-wowhead={whData}
                            />
                            <div className="min-w-0 flex-1" onClick={() => handleAdd(item)}>
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
                            {tier && (
                              <div className="flex flex-col gap-1 pr-2">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setItemTiers((prev) => ({
                                      ...prev,
                                      [item.item_id]: Math.min(tier.maxLevel, tier.level + 1),
                                    }));
                                  }}
                                  className="text-slate-500 hover:text-white"
                                >
                                  <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                    <path d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z" />
                                  </svg>
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setItemTiers((prev) => ({
                                      ...prev,
                                      [item.item_id]: Math.max(1, tier.level - 1),
                                    }));
                                  }}
                                  className="text-slate-500 hover:text-white"
                                >
                                  <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                    <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
                                  </svg>
                                </button>
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
