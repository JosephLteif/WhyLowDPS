'use client';

import { useEffect, useState, useMemo } from 'react';
import { API_URL } from '../lib/api';
import { SLOT_LABELS, type DifficultyDef, type SeasonConfigResponse } from '../lib/types';
import { useWowheadTooltips } from '../lib/useWowheadTooltips';
import { getWowheadData } from '../lib/useItemInfo';

const getEffectiveTier = (
  item: ExternalItem,
  selectedDifficulty: string,
  itemTiers: Record<number, number>,
  upgradeTracks: Record<string, { level: number; ilvl: number }[]>
) => {
  const info =
    item.difficulty_info?.[selectedDifficulty] || item.dungeon_info?.[selectedDifficulty];
  if (!info?.track) return null;

  const currentLevel = itemTiers[item.item_id] || info.level || 1;
  const track = upgradeTracks[info.track];
  if (!track) return null;

  const levelInfo = track.find((t) => t.level === currentLevel);
  return {
    track: info.track,
    level: currentLevel,
    maxLevel: info.max_level || track[track.length - 1].level,
    ilvl: levelInfo?.ilvl || info.ilvl,
    bonus_id: info.bonus_id,
  };
};

interface ExternalItem {
  item_id: number;
  name: string;
  icon: string;
  quality: number;
  ilevel: number;
  expansion?: number;
  inventory_type: number;
  encounter: string;
  instance_name: string;
  difficulty_info?: Record<
    string,
    {
      ilvl: number;
      bonus_id: number;
      quality: number;
      track: string;
      level: number;
      max_level: number;
    }
  >;
  dungeon_info?: Record<
    string,
    {
      ilvl: number;
      bonus_id: number;
      quality: number;
      track?: string;
      level?: number;
      max_level?: number;
    }
  >;
}

interface UpgradeTrack {
  bonus_id: number;
  ilvl: number;
  level: number;
  max_level: number;
  quality: number;
}

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

type CategoryType = 'raid' | 'dungeon';

export default function AddItemModal({
  isOpen,
  onClose,
  onAdd,
  className,
  spec,
  preferredSlot,
}: AddItemModalProps) {
  const [instances, setInstances] = useState<any[]>([]);
  const [selectedInstance, setSelectedInstance] = useState<number>(0);
  const [drops, setDrops] = useState<Record<string, ExternalItem[]>>({});
  const [loading, setLoading] = useState(false);
  const [globalSearch, setGlobalSearch] = useState('');
  const [localSearch, setLocalSearch] = useState('');
  const [seasonConfig, setSeasonConfig] = useState<SeasonConfigResponse | null>(null);
  const [selectedDifficulty, setSelectedDifficulty] = useState<string>('heroic');
  const [filterSlot, setFilterSlot] = useState<string | null>(null);
  const [category, setCategory] = useState<CategoryType>('raid');
  const [upgradeTracks, setUpgradeTracks] = useState<Record<string, UpgradeTrack[]>>({});
  const [itemTiers, setItemTiers] = useState<Record<number, number>>({}); // item_id -> selected level
  const [allPossibleDrops, setAllPossibleDrops] = useState<Record<string, ExternalItem[]>>({});
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);
  const [isGlobalLoading, setIsGlobalLoading] = useState(false);

  // Sync filterSlot with preferredSlot when opening
  useEffect(() => {
    if (isOpen) {
      setFilterSlot(preferredSlot || null);
      setGlobalSearch('');
      setLocalSearch('');
      setCategory('raid');
      setItemTiers({});
    }
  }, [isOpen, preferredSlot]);

  // Load instances, season config, and upgrade tracks
  useEffect(() => {
    if (!isOpen) return;

    const fetchInitial = async () => {
      try {
        const [instRes, seasonRes, tracksRes] = await Promise.all([
          fetch(`${API_URL}/api/instances`),
          fetch(`${API_URL}/api/season-config`),
          fetch(`${API_URL}/api/upgrade-tracks`),
        ]);
        const instData = await instRes.json();
        const seasonData = await seasonRes.json();
        const tracksData = await tracksRes.json();

        setInstances(instData);
        setSeasonConfig(seasonData);
        setUpgradeTracks(tracksData);

        // Default to first instance
        if (instData.length > 0 && !selectedInstance) {
          setSelectedInstance(instData[0].id);
        }
      } catch (e) {
        console.error('Failed to fetch initial data', e);
      }
    };

    fetchInitial();
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load drops when instance changes
  useEffect(() => {
    if (!isOpen || selectedInstance === null || selectedInstance === -2) return;

    const fetchDrops = async () => {
      setLoading(true);
      try {
        const query = new URLSearchParams();
        if (className) query.set('class_name', className);
        if (spec) query.set('spec', spec);

        let data: Record<string, ExternalItem[]> = {};

        if (selectedInstance === 0) {
          // All Sources
          const [raidRes, dungRes] = await Promise.all([
            fetch(`${API_URL}/api/instances/type/raid/drops?${query.toString()}`),
            fetch(`${API_URL}/api/instances/type/dungeon/drops?${query.toString()}`),
          ]);
          const raidData = await raidRes.json();
          const dungData = await dungRes.json();

          // Merge logic
          for (const slot of Object.keys({ ...raidData, ...dungData })) {
            data[slot] = [...(raidData[slot] || []), ...(dungData[slot] || [])];
          }
        } else {
          const res = await fetch(
            `${API_URL}/api/instances/${selectedInstance}/drops?${query.toString()}`
          );
          data = await res.json();
        }

        setDrops(data);
      } catch (e) {
        console.error('Failed to fetch drops', e);
        setDrops({});
      } finally {
        setLoading(false);
      }
    };

    fetchDrops();
  }, [isOpen, selectedInstance, className, spec]);

  // Reset item level overrides when switching difficulty
  useEffect(() => {
    setItemTiers({});
  }, [selectedDifficulty]);

  // Load ALL possible drops for global search cache
  useEffect(() => {
    if (!isOpen) return;

    const fetchAllPossible = async () => {
      setIsGlobalLoading(true);
      try {
        const query = new URLSearchParams();
        if (className) query.set('class_name', className);
        if (spec) query.set('spec', spec);

        const [raidRes, dungRes] = await Promise.all([
          fetch(`${API_URL}/api/instances/type/raid/drops?${query.toString()}`),
          fetch(`${API_URL}/api/instances/type/dungeon/drops?${query.toString()}`),
        ]);
        const raidData = await raidRes.json();
        const dungData = await dungRes.json();

        const data: Record<string, ExternalItem[]> = {};
        for (const slot of Object.keys({ ...raidData, ...dungData })) {
          data[slot] = [...(raidData[slot] || []), ...(dungData[slot] || [])];
        }
        setAllPossibleDrops(data);
      } catch (e) {
        console.error('Failed to pre-fetch global loot', e);
      } finally {
        setIsGlobalLoading(false);
      }
    };

    fetchAllPossible();
  }, [isOpen, className, spec]); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredInstances = useMemo(() => {
    let base: any[] = [];
    if (selectedInstance === -2) {
      base = [{ id: -2, name: 'Search Results', type: 'search' }, ...instances];
    } else {
      base = instances.filter((inst) => {
        const type = inst.type.toLowerCase();
        if (category === 'raid') return type === 'raid';
        if (category === 'dungeon')
          return type === 'dungeon' || type === 'expansion-dungeon' || type === 'mplus-chest';
        return !type.includes('pvp') && !type.includes('profession');
      });
    }
    return base;
  }, [instances, category, selectedInstance]);

  const globalSearchResults = useMemo(() => {
    if (!globalSearch || globalSearch.length < 2) return [];

    const lowerQuery = globalSearch.toLowerCase();

    const results: ExternalItem[] = [];
    for (const items of Object.values(allPossibleDrops)) {
      for (const item of items) {
        const matchesName = item.name.toLowerCase().includes(lowerQuery);
        const matchesSource =
          item.encounter.toLowerCase().includes(lowerQuery) ||
          item.instance_name.toLowerCase().includes(lowerQuery);

        if (matchesName || matchesSource) {
          if (!results.find((r) => r.item_id === item.item_id)) {
            results.push(item);
          }
        }
        if (results.length > 50) break; // Cap for performance
      }
      if (results.length > 50) break;
    }
    return results;
  }, [allPossibleDrops, globalSearch]);

  useWowheadTooltips([drops, globalSearchResults, selectedDifficulty, category]);

  const filteredDrops = useMemo(() => {
    const result: Record<string, ExternalItem[]> = {};
    const lowerGlobal = globalSearch.toLowerCase();

    // If we are in "Search Results" mode, use globalSearchResults
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

      // Filter by slot if set
      if (lowerFilter && lowerSlot !== lowerFilter) {
        // Special case for trinkets/rings which can be either 1 or 2
        const isTrinketFilter = lowerFilter.startsWith('trinket');
        const isFingerFilter = lowerFilter.startsWith('finger') || lowerFilter.startsWith('ring');
        const isTrinketSlot = lowerSlot.startsWith('trinket');
        const isFingerSlot = lowerSlot.startsWith('finger') || lowerSlot.startsWith('ring');

        if (!((isTrinketFilter && isTrinketSlot) || (isFingerFilter && isFingerSlot))) {
          continue;
        }
      }

      const matching = items.filter(
        (i) =>
          (i.name.toLowerCase().includes(lowerGlobal) ||
            i.encounter.toLowerCase().includes(lowerGlobal)) &&
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

    if (instance.type === 'raid') {
      return seasonConfig.raid_difficulties;
    } else {
      // Dungeon - first look for a specific category matching the pool instance or type
      let group = seasonConfig.dungeon_categories.find(
        (c) =>
          c.poolInstanceId === instance.id ||
          instance.type === 'mplus-chest' ||
          instance.type === 'expansion-dungeon'
      );

      // If no specific group found but it's a dungeon, fallback to the default (first) dungeon category
      if (!group && (instance.type === 'dungeon' || instance.type === 'expansion-dungeon')) {
        group = seasonConfig.dungeon_categories[0];
      }

      return group?.difficulties || seasonConfig.raid_difficulties; // Fallback
    }
  }, [seasonConfig, selectedInstance, instances]);

  // Update default difficulty if not valid for selected instance
  useEffect(() => {
    if (difficulties.length > 0) {
      if (!difficulties.find((d) => d.key === selectedDifficulty)) {
        setSelectedDifficulty(difficulties[0].key);
      }
    }
  }, [difficulties, selectedDifficulty]);

  const handleAdd = (item: ExternalItem) => {
    // Identify if it's an upgrade track item
    const info =
      item.difficulty_info?.[selectedDifficulty] || item.dungeon_info?.[selectedDifficulty];
    const trackName = info?.track;
    const selectedLevel = itemTiers[item.item_id];

    // Base bonus IDs we always want (difficulty/source specific)
    const baseBonusIds = info?.bonus_id ? [info.bonus_id] : [];

    if (trackName && selectedLevel && upgradeTracks[trackName]) {
      const track = upgradeTracks[trackName];
      const levelInfo = track.find((t) => t.level === selectedLevel);
      if (levelInfo) {
        // Use a Set to ensure unique IDs, though they shouldn't overlap
        const combinedBonuses = Array.from(new Set([...baseBonusIds, levelInfo.bonus_id]));
        onAdd(item, selectedDifficulty, {
          bonus_ids: combinedBonuses,
          ilvl: levelInfo.ilvl,
          track_name: trackName,
          level: selectedLevel,
        });
        return;
      }
    }

    // For non-track items, just use base bonus ID
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

  const getEffectiveTierLocal = (item: ExternalItem) =>
    getEffectiveTier(item, selectedDifficulty, itemTiers, upgradeTracks);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      onClick={(e) => {
        // Close dropdown when clicking outside the input
        if (showSearchDropdown) setShowSearchDropdown(false);
      }}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      <div className="animate-in fade-in zoom-in relative flex h-[85vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0a0a0c] shadow-2xl duration-200">
        {/* Header */}
        <div className="border-b border-white/5 bg-white/[0.02]">
          {/* Top Row: Title, Categories, Close */}
          <div className="flex items-center justify-between border-b border-white/5 px-6 py-3">
            <div className="flex items-center gap-6">
              <div className="shrink-0">
                <h2 className="bg-gradient-to-br from-white to-white/60 bg-clip-text text-lg font-bold text-transparent">
                  External Gear{' '}
                  <span className="ml-1 align-top text-[10px] text-blue-500/50">v1.2</span>
                </h2>
                <p className="mt-0.5 text-[9px] font-bold uppercase tracking-widest text-slate-600">
                  Loot Browser
                </p>
              </div>

              <div className="mx-2 hidden h-8 w-px bg-white/5 md:block" />

              {/* Category selection */}
              <div className="flex shrink-0 rounded-xl border border-white/5 bg-black/40 p-1">
                {(['raid', 'dungeon'] as CategoryType[]).map((cat) => (
                  <button
                    key={cat}
                    onClick={() => {
                      setCategory(cat);
                      setGlobalSearch('');
                      setShowSearchDropdown(false);
                      const firstInCat = instances.find((inst) => {
                        const type = inst.type.toLowerCase();
                        if (cat === 'raid') return type === 'raid';
                        if (cat === 'dungeon')
                          return (
                            type === 'dungeon' ||
                            type === 'expansion-dungeon' ||
                            type === 'mplus-chest'
                          );
                        return !type.includes('pvp') && !type.includes('profession');
                      });
                      if (firstInCat) setSelectedInstance(firstInCat.id);
                    }}
                    className={`rounded-lg px-3 py-1.5 text-[10px] font-bold transition-all duration-200 ${
                      category === cat
                        ? 'bg-blue-600 text-white shadow-lg'
                        : 'text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    {cat.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={onClose}
              className="group relative flex h-8 w-8 items-center justify-center rounded-xl border border-white/5 bg-white/[0.03] text-slate-500 transition-all duration-200 hover:border-red-500/20 hover:bg-red-500/10 hover:text-white"
              title="Close Modal"
            >
              <svg
                className="h-4 w-4 transition-transform group-hover:rotate-90"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2.5}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          {/* Bottom Row: Search & Difficulty */}
          <div className="relative flex items-center gap-6 bg-black/10 px-6 py-2.5">
            <div className="group relative flex-1" onFocus={() => setShowSearchDropdown(true)}>
              <input
                type="text"
                placeholder="Global Research: Search all gear (name, boss, stats)..."
                value={globalSearch}
                onChange={(e) => {
                  setGlobalSearch(e.target.value);
                  setShowSearchDropdown(true);
                }}
                className="w-full rounded-xl border border-white/5 bg-black/40 px-10 py-2 text-xs font-medium text-white transition-all placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
              />
              <svg
                className="absolute left-3.5 top-2.5 h-3.5 w-3.5 text-slate-600 transition-colors group-focus-within:text-blue-400"
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

              {/* Dropdown Results */}
              {showSearchDropdown && globalSearch.length >= 2 && (
                <div
                  className="animate-in fade-in slide-in-from-top-2 absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-xl border border-white/10 bg-[#0d0d10] shadow-2xl duration-200"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="scrollbar-thin scrollbar-thumb-white/10 max-h-[400px] overflow-y-auto">
                    {isGlobalLoading ? (
                      <div className="animate-pulse p-4 text-center text-[10px] text-slate-500">
                        Syncing Global Loot...
                      </div>
                    ) : globalSearchResults.length === 0 ? (
                      <div className="p-4 text-center text-[10px] text-slate-500">
                        No matches found for &quot;{globalSearch}&quot;
                      </div>
                    ) : (
                      <>
                        {globalSearchResults.slice(0, 10).map((item) => (
                          <button
                            key={item.item_id}
                            onClick={() => {
                              setSelectedInstance(-2); // Switch to search result mode
                              setGlobalSearch(item.name); // Keep search term to refine
                              setShowSearchDropdown(false);
                            }}
                            className="group flex w-full items-center gap-3 border-b border-white/5 p-3 transition-colors last:border-0 hover:bg-white/[0.03]"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={item.icon || '/assets/unknown.png'}
                              className="h-8 w-8 rounded-lg shadow-lg"
                              alt=""
                            />
                            <div className="min-w-0 flex-1 text-left">
                              <div className="truncate text-xs font-bold text-white transition-colors group-hover:text-blue-400">
                                {item.name}
                              </div>
                              <div className="truncate text-[10px] text-slate-500">
                                {item.encounter} • {item.instance_name}
                              </div>
                            </div>
                            <div className="text-[10px] font-black uppercase tracking-tighter text-slate-700">
                              {SLOT_LABELS[item.inventory_type]}
                            </div>
                          </button>
                        ))}

                        {globalSearchResults.length > 10 && (
                          <div className="border-b border-white/5 bg-black/40 p-2 text-center text-[10px] italic text-slate-600">
                            +{globalSearchResults.length - 10} more results...
                          </div>
                        )}

                        <button
                          onClick={() => {
                            setSelectedInstance(-2);
                            setShowSearchDropdown(false);
                          }}
                          className="w-full bg-blue-600/10 p-3 text-xs font-black uppercase tracking-widest text-blue-400 transition-all hover:bg-blue-600/20"
                        >
                          Show All Results ({globalSearchResults.length})
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-3">
              <span className="hidden text-[9px] font-black uppercase tracking-widest text-slate-600 xl:block">
                Difficulty
              </span>
              <div className="flex gap-0.5 rounded-xl border border-white/5 bg-black/40 p-0.5">
                {difficulties.map((d) => {
                  const isSelected = selectedDifficulty === d.key;
                  const colorClass = d.key.includes('lfr')
                    ? 'text-green-400'
                    : d.key.includes('normal')
                      ? 'text-blue-400'
                      : d.key.includes('heroic')
                        ? 'text-purple-400'
                        : d.key.includes('mythic')
                          ? 'text-orange-400'
                          : 'text-slate-400';

                  const activeBg = d.key.includes('lfr')
                    ? 'bg-green-500/20 border-green-500/20'
                    : d.key.includes('normal')
                      ? 'bg-blue-500/20 border-blue-500/20'
                      : d.key.includes('heroic')
                        ? 'bg-purple-500/20 border-purple-500/20'
                        : d.key.includes('mythic')
                          ? 'bg-orange-500/20 border-orange-500/20'
                          : 'bg-white/10 border-white/10';

                  return (
                    <button
                      key={d.key}
                      onClick={() => setSelectedDifficulty(d.key)}
                      className={`rounded-lg border px-3 py-1 text-[9px] font-black uppercase tracking-wider transition-all ${
                        isSelected
                          ? `${activeBg} ${colorClass} border-white/10`
                          : 'border-transparent text-slate-600 hover:bg-white/5 hover:text-slate-400'
                      }`}
                    >
                      {d.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar - Instances */}
          <div className="scrollbar-thin scrollbar-thumb-white/10 w-72 space-y-1 overflow-y-auto border-r border-white/5 bg-black/20 p-2">
            {filteredInstances.map((inst) => (
              <button
                key={inst.id}
                onClick={() => setSelectedInstance(inst.id)}
                className={`group flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition-all duration-200 ${
                  selectedInstance === inst.id
                    ? 'border border-blue-500/20 bg-blue-600/10 text-blue-400 shadow-lg shadow-blue-900/5'
                    : 'border border-transparent text-slate-400 hover:bg-white/[0.03]'
                }`}
              >
                <div
                  className={`h-1.5 w-1.5 rounded-full transition-transform group-hover:scale-125 ${
                    inst.type === 'raid'
                      ? 'bg-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.4)]'
                      : inst.type.includes('pvp')
                        ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.4)]'
                        : 'bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.4)]'
                  }`}
                />
                <span className="truncate text-xs font-semibold leading-none">{inst.name}</span>
              </button>
            ))}
            {filteredInstances.length === 0 && (
              <div className="p-8 text-center text-xs italic text-slate-600">
                No instances found
              </div>
            )}
          </div>

          {/* Main Area - Drops */}
          <div className="scrollbar-thin scrollbar-thumb-white/10 flex-1 overflow-y-auto bg-[#0a0a0c] p-6">
            {loading ? (
              <div className="flex h-full flex-col items-center justify-center gap-4">
                <div className="relative h-16 w-16">
                  <div className="absolute inset-0 rounded-full border-2 border-white/5" />
                  <div className="absolute inset-0 animate-spin rounded-full border-t-2 border-blue-500" />
                </div>
                <span className="animate-pulse text-xs font-bold uppercase tracking-widest text-slate-500">
                  Scanning Loot Tables
                </span>
              </div>
            ) : Object.keys(filteredDrops).length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-4 text-slate-600 opacity-50">
                <div className="rounded-full border border-white/5 bg-white/[0.02] p-6">
                  <svg className="h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1}
                      d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
                    />
                  </svg>
                </div>
                <div className="text-center">
                  <p className="text-sm font-bold">
                    {selectedInstance === -2 ? `No results for "${globalSearch}"` : 'No Loot Found'}
                  </p>
                  <button
                    onClick={() => {
                      setGlobalSearch('');
                      setLocalSearch('');
                      setCategory('raid');
                      if (selectedInstance === -2) setSelectedInstance(0);
                    }}
                    className="mt-2 text-xs font-bold text-blue-500 hover:text-blue-400"
                  >
                    {selectedInstance === -2 ? 'Clear Search' : 'Reset Filters'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-8 pb-12">
                {/* Local Search Input */}
                <div className="relative mb-6">
                  <input
                    type="text"
                    placeholder={`Filter currently visible ${Object.keys(drops).length > 2 ? 'aggregated' : ''} items...`}
                    value={localSearch}
                    onChange={(e) => setLocalSearch(e.target.value)}
                    className="w-full rounded-xl border border-white/5 bg-white/[0.03] px-10 py-3 text-xs text-white transition-all placeholder:text-slate-600 focus:bg-white/[0.05] focus:outline-none"
                  />
                  <svg
                    className="absolute left-4 top-3.5 h-4 w-4 text-slate-600"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
                    />
                  </svg>
                  {localSearch && (
                    <button
                      onClick={() => setLocalSearch('')}
                      className="absolute right-4 top-3.5 text-slate-600 hover:text-white"
                    >
                      <svg
                        className="h-4 w-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                  )}
                </div>
                {Object.entries(filteredDrops).map(([slot, items]) => {
                  const renderItem = (item: ExternalItem) => {
                    const tier = getEffectiveTierLocal(item);
                    const currentIlvl = tier?.ilvl || item.ilevel;
                    const bonusId =
                      tier?.bonus_id ||
                      (
                        item.difficulty_info?.[selectedDifficulty] ||
                        item.dungeon_info?.[selectedDifficulty]
                      )?.bonus_id;
                    const bonusIds = bonusId ? [bonusId] : [];
                    const whData = getWowheadData(bonusIds, currentIlvl);

                    return (
                      <div
                        key={`${item.item_id}-${item.encounter}`}
                        className="group relative rounded-xl border border-white/5 bg-white/[0.02] p-3 px-4 transition-all duration-300 hover:-translate-y-0.5 hover:border-white/10 hover:bg-white/[0.04] hover:shadow-2xl hover:shadow-blue-500/5"
                      >
                        <div className="flex items-center gap-4">
                          <a
                            href={`https://www.wowhead.com/item=${item.item_id}`}
                            data-wowhead={whData}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="relative block shrink-0"
                            onClick={(e) => e.preventDefault()}
                          >
                            <img
                              src={`https://wow.zamimg.com/images/wow/icons/large/${item.icon}.jpg`}
                              alt=""
                              className={`h-10 w-10 rounded-lg border-2 shadow-lg transition-transform group-hover:scale-105 ${
                                item.quality === 5
                                  ? 'border-orange-500/50'
                                  : item.quality === 4
                                    ? 'border-purple-500/50'
                                    : item.quality === 3
                                      ? 'border-blue-500/50'
                                      : 'border-white/10'
                              }`}
                            />
                            <div className="absolute -right-1.5 -top-1.5 rounded border border-white/10 bg-black px-1 py-0.5 text-[8px] font-black text-blue-400 shadow-xl">
                              {currentIlvl}
                            </div>
                          </a>

                          <div className="min-w-0 flex-1 pr-12">
                            <a
                              href={`https://www.wowhead.com/item=${item.item_id}`}
                              data-wowhead={whData}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={`block truncate text-xs font-bold transition-colors hover:underline ${
                                item.quality === 5
                                  ? 'text-orange-400'
                                  : item.quality === 4
                                    ? 'text-purple-400'
                                    : item.quality === 3
                                      ? 'text-blue-400'
                                      : 'text-slate-200'
                              }`}
                              onClick={(e) => e.preventDefault()}
                            >
                              {item.name}
                            </a>
                            <p className="mt-0.5 truncate text-[9px] font-medium uppercase tracking-tighter text-slate-500">
                              {item.encounter}
                            </p>
                          </div>

                          <button
                            onClick={() => handleAdd(item)}
                            className="group/btn absolute right-3 top-3.5 rounded-lg bg-blue-600 p-2 text-white shadow-lg transition-all hover:bg-blue-500 active:scale-95"
                            title="Add To Gear List"
                          >
                            <svg
                              className="h-4 w-4"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={3}
                                d="M12 4v16m8-8H4"
                              />
                            </svg>
                          </button>
                        </div>

                        {tier && (
                          <div className="mt-3 flex items-center gap-4 border-t border-white/5 pt-3">
                            <div className="flex w-20 shrink-0 flex-col">
                              <span className="truncate text-[8px] font-black uppercase tracking-widest text-slate-600">
                                {tier.track}
                              </span>
                              <span className="font-mono text-[9px] font-bold text-blue-400">
                                {tier.level} / {tier.maxLevel}
                              </span>
                            </div>
                            <input
                              type="range"
                              min="1"
                              max={tier.maxLevel}
                              value={tier.level}
                              onChange={(e) => {
                                const val = parseInt(e.target.value);
                                setItemTiers((prev) => ({ ...prev, [item.item_id]: val }));
                              }}
                              className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-white/5 accent-blue-500 hover:accent-blue-400"
                            />
                          </div>
                        )}
                      </div>
                    );
                  };

                  return (
                    <div key={slot} className="space-y-4">
                      <div className="flex items-center gap-4">
                        <h3 className="whitespace-nowrap text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
                          {SLOT_LABELS[slot.toLowerCase()] || slot}
                        </h3>
                        <div className="h-px w-full bg-gradient-to-r from-white/5 to-transparent" />
                      </div>

                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        {items.map((item) => renderItem(item))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
