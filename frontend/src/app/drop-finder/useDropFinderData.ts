import { useEffect, useMemo, useState } from 'react';
import { API_URL, fetchJson } from '../lib/api';
import type { SeasonConfigResponse, DungeonCategory } from '../lib/types';
import { parseCharacterInfo } from '../../lib/simc-parser';
import {
  detectClass,
  detectSpec,
  normalizeUpgradeTracks,
  type DropItem,
  type Instance,
  type UpgradeTracks,
} from './types';
import { coerceDropsResponse, FALLBACK_SEASON_CONFIG, parseInstanceSelectionIds } from './utils';

export function useDropFinderData(simcInput: string, activeSpecs: Set<string>) {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [seasonConfig, setSeasonConfig] = useState<SeasonConfigResponse | null>(
    FALLBACK_SEASON_CONFIG,
  );
  const [upgradeTracks, setUpgradeTracks] = useState<UpgradeTracks>({});
  const [selectedId, setSelectedId] = useState('');
  const [drops, setDrops] = useState<Record<string, DropItem[]> | null>(null);
  const [loading, setLoading] = useState(false);

  const parsedCharacter = useMemo(() => parseCharacterInfo(simcInput), [simcInput]);
  const className = useMemo(() => {
    const detected = detectClass(simcInput);
    if (detected) return detected;
    if (parsedCharacter?.kind !== 'character') return null;
    const raw = parsedCharacter.className.trim().toLowerCase();
    if (!raw) return null;
    if (raw === 'deathknight') return 'death_knight';
    if (raw === 'demonhunter') return 'demon_hunter';
    return raw.replace(/[\s-]+/g, '_');
  }, [simcInput, parsedCharacter]);

  const specName = useMemo(() => {
    const detected = detectSpec(simcInput);
    if (detected) return detected;
    if (parsedCharacter?.kind !== 'character' || parsedCharacter.spec === 'unknown') return null;
    return parsedCharacter.spec.trim().toLowerCase().replace(/[\s-]+/g, '_');
  }, [simcInput, parsedCharacter]);

  const specParam = useMemo(() => [...activeSpecs].sort().join(','), [activeSpecs]);

  useEffect(() => {
    let cancelled = false;

    const loadSeasonConfig = async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const data = await fetchJson<SeasonConfigResponse>(`${API_URL}/api/season-config`);
          if (!cancelled) setSeasonConfig(data);
          return;
        } catch {
          if (attempt < 2) {
            await new Promise((resolve) => window.setTimeout(resolve, 400 * (attempt + 1)));
          }
        }
      }
    };

    const loadUpgradeTracks = async () => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          const data = await fetchJson<unknown>(`${API_URL}/api/upgrade-tracks`);
          const normalized = normalizeUpgradeTracks(data);
          if (!cancelled) setUpgradeTracks(normalized);
          if (Object.keys(normalized).length > 0) return;
        } catch {
          // retry below
        }
        if (attempt < 4) {
          await new Promise((resolve) => window.setTimeout(resolve, 350 * (attempt + 1)));
        }
      }
    };

    void loadSeasonConfig();
    void loadUpgradeTracks();
    fetchJson<Instance[]>(`${API_URL}/api/instances`).then(setInstances).catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  const { raids, dungeonCats } = useMemo(() => {
    if (!seasonConfig) {
      return {
        raids: [] as Instance[],
        dungeonCats: [] as { cat: DungeonCategory; instances: Instance[] }[],
      };
    }

    const poolMap = new Map<number, Set<number>>();
    for (const cat of seasonConfig.dungeon_categories) {
      const meta = instances.find((instance) => instance.id === cat.poolInstanceId);
      if (meta) {
        poolMap.set(cat.poolInstanceId, new Set(meta.encounters.map((encounter) => encounter.id)));
      }
    }

    const raidList: Instance[] = [];
    const dcList: { cat: DungeonCategory; instances: Instance[] }[] =
      seasonConfig.dungeon_categories.map((cat) => ({ cat, instances: [] }));

    for (const instance of instances) {
      if (instance.type === 'raid' && instance.id > 0) {
        raidList.push(instance);
      } else if (instance.type === 'dungeon') {
        let placed = false;
        for (const dc of dcList) {
          const pool = poolMap.get(dc.cat.poolInstanceId);
          if (pool?.has(instance.id)) {
            dc.instances.push(instance);
            placed = true;
          }
        }
        if (!placed && dcList.length > 0) {
          dcList[dcList.length - 1].instances.push(instance);
        }
      }
    }

    raidList.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    for (const dc of dcList) {
      dc.instances.sort((a, b) => a.name.localeCompare(b.name));
    }

    return { raids: raidList, dungeonCats: dcList };
  }, [instances, seasonConfig]);

  useEffect(() => {
    if (!selectedId) {
      setDrops(null);
      return;
    }

    setLoading(true);
    const params = new URLSearchParams();
    if (className) params.set('class_name', className);
    if (specParam) params.set('spec', specParam);

    let url = '';
    if (selectedId.startsWith('type:')) {
      url = `${API_URL}/api/instances/type/${selectedId.slice(5)}/drops`;
    } else if (selectedId.startsWith('ids:')) {
      const ids = parseInstanceSelectionIds(selectedId)
        .filter((id) => id !== '-1' && id !== '-32')
        .join(',');
      if (!ids) {
        setDrops(null);
        setLoading(false);
        return;
      }
      params.set('ids', ids);
      url = `${API_URL}/api/instances/drops`;
    } else {
      url = `${API_URL}/api/instances/${selectedId}/drops`;
    }

    const query = params.toString();
    fetchJson<unknown>(`${url}${query ? `?${query}` : ''}`)
      .then((data) => {
        const maybeDetail = (data as { detail?: unknown })?.detail;
        setDrops(maybeDetail ? null : coerceDropsResponse(data));
      })
      .catch(() => setDrops(null))
      .finally(() => setLoading(false));
  }, [selectedId, className, specParam]);

  return {
    instances,
    seasonConfig,
    upgradeTracks,
    selectedId,
    setSelectedId,
    drops,
    loading,
    raids,
    dungeonCats,
    className,
    specName,
  };
}
