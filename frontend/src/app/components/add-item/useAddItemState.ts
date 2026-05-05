import { useCallback, useEffect, useState } from 'react';
import { API_URL, fetchJson } from '../../lib/api';
import type { SeasonConfigResponse } from '../../lib/types';

export interface ExternalItem {
  item_id: number;
  name: string;
  icon: string;
  quality: number;
  ilevel: number;
  expansion?: number;
  inventory_type: number;
  encounter: string;
  instance_name: string;
  source_type?: string;
  is_catalyst?: boolean;
  can_catalyst?: boolean;
  off_spec?: boolean;
  season_id?: number;
  difficulty_info?: Record<string, any>;
  dungeon_info?: Record<string, any>;
  bonus_lists?: number[];
  crafted_base_bonus_ids?: number[];
  crafted_levels?: number[];
  socket_count?: number;
  hasSockets?: boolean;
  stats?: Array<{ id: number; alloc?: number }>;
  missive_count?: number;
  embellishment_options?: EmbellishmentOption[];
}

export interface EmbellishmentOption {
  id: number;
  item_id: number;
  name: string;
  icon: string;
  quality: number;
  bonus_ids: number[];
  item_limit_category?: number;
  item_limit_quantity?: number;
}

export interface MissiveOption {
  token: string;
  label: string;
  bonus_ids?: number[];
  item_id?: number;
  icon?: string;
  quality?: number;
  stat_count?: number;
}

export type AddItemCategory =
  | 'raid'
  | 'dungeon'
  | 'tier'
  | 'crafted'
  | 'delves'
  | 'pvp'
  | 'world_bosses';

function mergeDropMaps(...maps: Array<Record<string, ExternalItem[]>>): Record<string, ExternalItem[]> {
  const merged: Record<string, ExternalItem[]> = {};

  for (const map of maps) {
    for (const [slot, items] of Object.entries(map || {})) {
      if (!merged[slot]) merged[slot] = [];
      merged[slot].push(...items);
    }
  }

  return merged;
}

function scoreSearchDisplayItem(item: ExternalItem): number {
  const encounter = String(item.encounter || '').trim().toLowerCase();
  const instanceName = String(item.instance_name || '').trim().toLowerCase();
  let score = 0;

  if (encounter && encounter !== instanceName) score += 2;
  if (instanceName) score += 1;
  if (item.dungeon_info) score += 1;

  return score;
}

function dedupeDropMapForSearch(data: Record<string, ExternalItem[]>): Record<string, ExternalItem[]> {
  const deduped: Record<string, ExternalItem[]> = {};

  for (const [slot, items] of Object.entries(data || {})) {
    const byItemId = new Map<number, ExternalItem>();

    for (const item of items || []) {
      const existing = byItemId.get(item.item_id);
      if (!existing || scoreSearchDisplayItem(item) > scoreSearchDisplayItem(existing)) {
        byItemId.set(item.item_id, item);
      }
    }

    deduped[slot] = Array.from(byItemId.values());
  }

  return deduped;
}

function normalizeUpgradeTracks(input: any): Record<string, any[]> {
  if (!input) return {};

  // New API shape: flat array [{ name, level, max, itemLevel, bonus_id, quality }]
  if (Array.isArray(input)) {
    const grouped: Record<string, any[]> = {};
    for (const row of input) {
      const name = typeof row?.name === 'string' ? row.name : '';
      if (!name) continue;
      if (!grouped[name]) grouped[name] = [];
      grouped[name].push({
        level: Number(row.level || 0),
        max: Number(row.max || 0),
        ilvl: Number(row.itemLevel || row.ilevel || 0),
        bonus_id: Number(row.bonus_id || 0),
        quality: Number(row.quality || 0),
      });
    }
    for (const key of Object.keys(grouped)) {
      grouped[key].sort((a, b) => a.level - b.level);
    }
    return grouped;
  }

  // Legacy API shape: { [trackName]: [{ level, ilvl, bonus_id, ... }] }
  if (typeof input === 'object') {
    return input as Record<string, any[]>;
  }

  return {};
}

export function useAddItemState(
  isOpen: boolean,
  className: string | null | undefined,
  spec: string | null | undefined,
  preferredSlot: string | null | undefined
) {
  const [instances, setInstances] = useState<any[]>([]);
  const [selectedInstance, setSelectedInstance] = useState<number>(0);
  const [drops, setDrops] = useState<Record<string, ExternalItem[]>>({});
  const [loading, setLoading] = useState(false);
  const [globalSearch, setGlobalSearch] = useState('');
  const [localSearch, setLocalSearch] = useState('');
  const [seasonConfig, setSeasonConfig] = useState<SeasonConfigResponse | null>(null);
  const [selectedDifficulty, setSelectedDifficulty] = useState<string>('heroic');
  const [filterSlot, setFilterSlot] = useState<string | null>(null);
  const [category, setCategory] = useState<AddItemCategory>('raid');
  const [upgradeTracks, setUpgradeTracks] = useState<Record<string, any>>({});
  const [itemTiers, setItemTiers] = useState<Record<number, number>>({});
  const [allPossibleDrops, setAllPossibleDrops] = useState<Record<string, ExternalItem[]>>({});
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);
  const [isGlobalLoading, setIsGlobalLoading] = useState(false);
  const [groupBy, setGroupBy] = useState<'slot' | 'boss'>('slot');
  const [missives, setMissives] = useState<MissiveOption[]>([]);
  const [itemMissives, setItemMissives] = useState<Record<number, string[]>>({});
  const [itemEmbellishments, setItemEmbellishments] = useState<
    Record<number, EmbellishmentOption | null>
  >({});

  const buildQueryString = useCallback(() => {
    const query = new URLSearchParams();
    if (className) query.set('class_name', className);
    if (spec) query.set('spec', spec);
    return query.toString();
  }, [className, spec]);

  useEffect(() => {
    if (isOpen) {
      setFilterSlot(preferredSlot || null);
      setGlobalSearch('');
      setLocalSearch('');
      setCategory('raid');
      setGroupBy('slot');
      setItemTiers({});
      setItemMissives({});
      setItemEmbellishments({});
    }
  }, [isOpen, preferredSlot]);

  useEffect(() => {
    if (!isOpen) return;
    const fetchInitial = async () => {
      try {
        const [instData, seasonData, tracksData, missiveData] = await Promise.all([
          fetchJson<any[]>(`${API_URL}/api/instances`),
          fetchJson<any>(`${API_URL}/api/season-config`),
          fetchJson<any>(`${API_URL}/api/upgrade-tracks`),
          fetchJson<any[]>(`${API_URL}/api/data/missives`),
        ]);
        setInstances(instData);
        setSeasonConfig(seasonData);
        setUpgradeTracks(normalizeUpgradeTracks(tracksData));
        setMissives(missiveData);

        if (instData.length > 0 && !selectedInstance) {
          const firstRaid = instData.find((i: any) => i.type.toLowerCase() === 'raid');
          if (firstRaid) setSelectedInstance(firstRaid.id);
          else setSelectedInstance(instData[0].id);
        }
      } catch (e) {
        console.error('Failed to fetch initial data', e);
      }
    };
    fetchInitial();
  }, [isOpen, selectedInstance]);

  useEffect(() => {
    if (!isOpen || selectedInstance === null) return;
    let cancelled = false;
    const fetchDrops = async () => {
      setLoading(true);
      setDrops({});
      try {
        const queryString = buildQueryString();
        let data: Record<string, ExternalItem[]> = {};
        if (category === 'crafted') {
          const res = await fetch(`${API_URL}/api/instances/type/profession/drops?${queryString}`, {
            credentials: 'include',
          });
          data = await res.json();
        } else if (category === 'delves') {
          const [delveRes, preyRes] = await Promise.all([
            fetch(`${API_URL}/api/instances/type/delve-mid1/drops?${queryString}`, { credentials: 'include' }),
            fetch(`${API_URL}/api/instances/type/prey-mid1/drops?${queryString}`, { credentials: 'include' }),
          ]);
          const delveData = await delveRes.json();
          const preyData = await preyRes.json();
          data = mergeDropMaps(delveData, preyData);
        } else if (category === 'tier') {
          const res = await fetch(`${API_URL}/api/instances/type/catalyst/drops?${queryString}`, {
            credentials: 'include',
          });
          data = await res.json();
        } else if (selectedInstance === 0) {
          const [raidRes, dungRes] = await Promise.all([
            fetch(`${API_URL}/api/instances/type/raid/drops?${queryString}`, {
              credentials: 'include',
            }),
            fetch(`${API_URL}/api/instances/type/dungeon/drops?${queryString}`, {
              credentials: 'include',
            }),
          ]);
          const raidData = await raidRes.json();
          const dungData = await dungRes.json();
          data = mergeDropMaps(raidData, dungData);
        } else {
          const res = await fetch(
            `${API_URL}/api/instances/${selectedInstance}/drops?${queryString}`,
            { credentials: 'include' }
          );
          data = await res.json();
        }
        if (!cancelled) setDrops(data);
      } catch (e) {
        if (!cancelled) setDrops({});
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchDrops();
    return () => {
      // The next category/source request owns the UI now; ignore late responses.
      cancelled = true;
    };
  }, [isOpen, selectedInstance, category, buildQueryString]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const fetchAllPossible = async () => {
      setIsGlobalLoading(true);
      try {
        const queryString = buildQueryString();
        let data: Record<string, ExternalItem[]> = {};

        if (category === 'crafted') {
          data = await fetchJson<Record<string, ExternalItem[]>>(
            `${API_URL}/api/instances/type/profession/drops?${queryString}`
          );
        } else if (category === 'delves') {
          const [delveData, preyData] = await Promise.all([
            fetchJson<Record<string, ExternalItem[]>>(
              `${API_URL}/api/instances/type/delve-mid1/drops?${queryString}`
            ),
            fetchJson<Record<string, ExternalItem[]>>(
              `${API_URL}/api/instances/type/prey-mid1/drops?${queryString}`
            ),
          ]);
          data = mergeDropMaps(delveData, preyData);
        } else if (category === 'tier') {
          data = await fetchJson<Record<string, ExternalItem[]>>(
            `${API_URL}/api/instances/type/catalyst/drops?${queryString}`
          );
        } else if (category === 'raid' || category === 'dungeon' || category === 'pvp' || category === 'world_bosses') {
          const ids = instances
            .filter((inst) => {
              const type = String(inst.type || '').toLowerCase();
              const name = String(inst.name || '').toLowerCase();
              if (category === 'raid') return type === 'raid' && !name.includes('world boss');
              if (category === 'dungeon') {
                return type === 'dungeon' || type === 'expansion-dungeon' || type === 'mplus-chest';
              }
              if (category === 'pvp') return type.includes('pvp');
              if (category === 'world_bosses') {
                return name.includes('world boss') || type.includes('world-boss') || type.includes('world_boss');
              }
              return false;
            })
            .map((inst) => Number(inst.id))
            .filter((id) => Number.isFinite(id));

          if (ids.length > 0) {
            data = await fetchJson<Record<string, ExternalItem[]>>(
              `${API_URL}/api/instances/drops?ids=${ids.join(',')}${queryString ? `&${queryString}` : ''}`
            );
          }
        }

        if (!cancelled) setAllPossibleDrops(dedupeDropMapForSearch(data));
      } catch (e) {
        if (!cancelled) setAllPossibleDrops({});
      } finally {
        if (!cancelled) setIsGlobalLoading(false);
      }
    };
    fetchAllPossible();
    return () => {
      cancelled = true;
    };
  }, [isOpen, category, instances, buildQueryString]);

  return {
    instances,
    setInstances,
    selectedInstance,
    setSelectedInstance,
    drops,
    setDrops,
    loading,
    setLoading,
    globalSearch,
    setGlobalSearch,
    localSearch,
    setLocalSearch,
    seasonConfig,
    setSeasonConfig,
    selectedDifficulty,
    setSelectedDifficulty,
    filterSlot,
    setFilterSlot,
    category,
    setCategory,
    upgradeTracks,
    setUpgradeTracks,
    itemTiers,
    setItemTiers,
    allPossibleDrops,
    setAllPossibleDrops,
    showSearchDropdown,
    setShowSearchDropdown,
    isGlobalLoading,
    setIsGlobalLoading,
    groupBy,
    setGroupBy,
    missives,
    itemMissives,
    setItemMissives,
    itemEmbellishments,
    setItemEmbellishments,
  };
}
