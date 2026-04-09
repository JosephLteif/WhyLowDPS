import { useCallback, useEffect, useState, useMemo } from 'react';
import { API_URL } from '../../lib/api';
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
  difficulty_info?: Record<string, any>;
  dungeon_info?: Record<string, any>;
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
  const [category, setCategory] = useState<'raid' | 'dungeon'>('raid');
  const [upgradeTracks, setUpgradeTracks] = useState<Record<string, any>>({});
  const [itemTiers, setItemTiers] = useState<Record<number, number>>({});
  const [allPossibleDrops, setAllPossibleDrops] = useState<Record<string, ExternalItem[]>>({});
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);
  const [isGlobalLoading, setIsGlobalLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setFilterSlot(preferredSlot || null);
      setGlobalSearch('');
      setLocalSearch('');
      setCategory('raid');
      setItemTiers({});
    }
  }, [isOpen, preferredSlot]);

  useEffect(() => {
    if (!isOpen) return;
    const fetchInitial = async () => {
      try {
        const [instRes, seasonRes, tracksRes] = await Promise.all([
          fetch(`${API_URL}/api/instances`, { credentials: 'include' }),
          fetch(`${API_URL}/api/season-config`, { credentials: 'include' }),
          fetch(`${API_URL}/api/upgrade-tracks`, { credentials: 'include' }),
        ]);
        const instData = await instRes.json();
        const seasonData = await seasonRes.json();
        const tracksData = await tracksRes.json();
        setInstances(instData);
        setSeasonConfig(seasonData);
        setUpgradeTracks(tracksData);
        if (instData.length > 0 && !selectedInstance) setSelectedInstance(instData[0].id);
      } catch (e) {
        console.error('Failed to fetch initial data', e);
      }
    };
    fetchInitial();
  }, [isOpen, selectedInstance]);

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
          const [raidRes, dungRes] = await Promise.all([
            fetch(`${API_URL}/api/instances/type/raid/drops?${query.toString()}`, {
              credentials: 'include',
            }),
            fetch(`${API_URL}/api/instances/type/dungeon/drops?${query.toString()}`, {
              credentials: 'include',
            }),
          ]);
          const raidData = await raidRes.json();
          const dungData = await dungRes.json();
          for (const slot of Object.keys({ ...raidData, ...dungData })) {
            data[slot] = [...(raidData[slot] || []), ...(dungData[slot] || [])];
          }
        } else {
          const res = await fetch(
            `${API_URL}/api/instances/${selectedInstance}/drops?${query.toString()}`,
            { credentials: 'include' }
          );
          data = await res.json();
        }
        setDrops(data);
      } catch (e) {
        setDrops({});
      } finally {
        setLoading(false);
      }
    };
    fetchDrops();
  }, [isOpen, selectedInstance, className, spec]);

  useEffect(() => {
    if (!isOpen) return;
    const fetchAllPossible = async () => {
      setIsGlobalLoading(true);
      try {
        const query = new URLSearchParams();
        if (className) query.set('class_name', className);
        if (spec) query.set('spec', spec);
        const [raidRes, dungRes] = await Promise.all([
          fetch(`${API_URL}/api/instances/type/raid/drops?${query.toString()}`, {
            credentials: 'include',
          }),
          fetch(`${API_URL}/api/instances/type/dungeon/drops?${query.toString()}`, {
            credentials: 'include',
          }),
        ]);
        const raidData = await raidRes.json();
        const dungData = await dungRes.json();
        const data: Record<string, ExternalItem[]> = {};
        for (const slot of Object.keys({ ...raidData, ...dungData })) {
          data[slot] = [...(raidData[slot] || []), ...(dungData[slot] || [])];
        }
        setAllPossibleDrops(data);
      } catch (e) {
      } finally {
        setIsGlobalLoading(false);
      }
    };
    fetchAllPossible();
  }, [isOpen, className, spec]);

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
  };
}
