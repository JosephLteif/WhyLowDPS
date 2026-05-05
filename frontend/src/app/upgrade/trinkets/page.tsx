'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import ErrorAlert from '../../components/ErrorAlert';
import ComboSummary from '../../components/ComboSummary';
import StickyPageHeader from '../../components/StickyPageHeader';
import SimReturnNotice from '../../components/shared/SimReturnNotice';
import { useSimContext } from '../../components/SimContext';
import { API_URL } from '../../lib/api';
import { getIconUrl, getWowheadData, getWowheadUrl, useItemInfo } from '../../lib/useItemInfo';
import { useSimSubmit } from '../../lib/useSimSubmit';
import { useWowheadTooltips } from '../../lib/useWowheadTooltips';
import { consumeSimAgainState, consumeSimReturnNotice, type SimReturnNotice as SimReturnNoticeType } from '../../lib/sim-return';

type TrinketSimMode = 'matrix' | 'lock_trinket1' | 'lock_trinket2';
type TrinketRolePool = 'auto' | 'dps' | 'tank' | 'healer';
type SourceKey = string;

type ParsedTrinket = {
  slot: 'trinket1' | 'trinket2';
  itemId: number;
  bonusIds: number[];
  ilevel: number;
};

type DropItem = {
  item_id: number;
  name: string;
  icon?: string;
  ilevel?: number;
  specs?: number[];
  source_type?: string;
  mplus_rotation?: boolean;
  difficulty_info?: Record<string, { ilvl?: number; level?: number; max?: number; track?: string }>;
  dungeon_info?: Record<string, { ilvl?: number; level?: number; max?: number; track?: string }>;
};

type TrackRow = {
  name: string;
  level: number;
  max: number;
  itemLevel: number;
};

type IlevelOption = {
  ilevel: number;
  label: string;
};

type TierOption = {
  key: string;
  label: string;
  ilevelOptions: IlevelOption[];
  maxIlevel: number;
};

enum RolePool {
  Dps = 'dps',
  Tank = 'tank',
  Healer = 'healer',
}

const DEFAULT_SOURCE_TYPES: SourceKey[] = ['raid', 'dungeon', 'delve', 'pvp', 'profession'];
const UPGRADE_TRINKETS_SIM_AGAIN_KEY = 'upgrade-trinkets';

interface UpgradeTrinketsSimAgainState {
  targetIlevel?: number;
  includeRaid?: boolean;
  includeDungeon?: boolean;
  simMode?: TrinketSimMode;
  rolePool?: TrinketRolePool;
  ignoreSpecRestrictions?: boolean;
}

const SPEC_TO_CLASS_ID = new Map<number, number>([
  [62, 8],
  [63, 8],
  [64, 8],
  [65, 2],
  [66, 2],
  [70, 2],
  [71, 1],
  [72, 1],
  [73, 1],
  [102, 11],
  [103, 11],
  [104, 11],
  [105, 11],
  [250, 6],
  [251, 6],
  [252, 6],
  [253, 3],
  [254, 3],
  [255, 3],
  [256, 5],
  [257, 5],
  [258, 5],
  [259, 4],
  [260, 4],
  [261, 4],
  [262, 7],
  [263, 7],
  [264, 7],
  [265, 9],
  [266, 9],
  [267, 9],
  [268, 10],
  [269, 10],
  [270, 10],
  [577, 12],
  [581, 12],
  [1467, 13],
  [1468, 13],
  [1473, 13],
]);

const CLASS_SPEC_ID_FALLBACK: Record<string, Record<string, number>> = {
  warrior: { arms: 71, fury: 72, protection: 73 },
  paladin: { holy: 65, protection: 66, retribution: 70 },
  hunter: { beast_mastery: 253, marksmanship: 254, survival: 255 },
  rogue: { assassination: 259, outlaw: 260, subtlety: 261 },
  priest: { discipline: 256, holy: 257, shadow: 258 },
  death_knight: { blood: 250, frost: 251, unholy: 252 },
  shaman: { elemental: 262, enhancement: 263, restoration: 264 },
  mage: { arcane: 62, fire: 63, frost: 64 },
  warlock: { affliction: 265, demonology: 266, destruction: 267 },
  monk: { brewmaster: 268, windwalker: 269, mistweaver: 270 },
  druid: { balance: 102, feral: 103, guardian: 104, restoration: 105 },
  demon_hunter: { havoc: 577, vengeance: 581 },
  evoker: { devastation: 1467, preservation: 1468, augmentation: 1473 },
};

function normalizeClass(raw: string) {
  const n = raw.trim().toLowerCase().replace(/[-\s]/g, '_');
  if (n === 'deathknight') return 'death_knight';
  if (n === 'demonhunter') return 'demon_hunter';
  return n;
}

function normalizeSpec(raw: string) {
  let n = raw.trim().toLowerCase().replace(/[-\s]/g, '_');
  if (n === 'beastmastery') n = 'beast_mastery';
  if (n === 'holy_priest') n = 'holy';
  if (n === 'restoration_shaman') n = 'restoration';
  return n;
}

function parseClassAndSpec(simcInput: string): { className: string; specName: string } {
  const className = normalizeClass(simcInput.match(/^([a-z_]+)=/m)?.[1] || '');
  const specName = normalizeSpec(simcInput.match(/^spec=([a-z_]+)/m)?.[1] || '');
  return { className, specName };
}

function parseEquippedTrinket(simcInput: string, slot: 'trinket1' | 'trinket2'): ParsedTrinket {
  const lineMatch = simcInput.match(new RegExp(`^${slot}=([^\\r\\n]*)$`, 'm'));
  const line = lineMatch?.[1] || '';
  const itemId = Number(line.match(/(?:^|,)id=(\d+)/)?.[1] || 0);
  const bonusRaw = line.match(/(?:^|,)bonus_id=([0-9/]+)/)?.[1] || '';
  const bonusIds = bonusRaw
    .split('/')
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n) && n > 0);
  const ilevel = Number(line.match(/(?:^|,)ilevel=(\d+)/)?.[1] || 0);
  return { slot, itemId, bonusIds, ilevel };
}

function specToRole(specId: number): RolePool {
  if ([66, 73, 104, 250, 268, 581].includes(specId)) return RolePool.Tank;
  if ([65, 105, 257, 264, 270, 1468].includes(specId)) return RolePool.Healer;
  return RolePool.Dps;
}

function classSupportsRole(classId: number, role: RolePool): boolean {
  switch (classId) {
    case 1:
      return role === RolePool.Dps || role === RolePool.Tank;
    case 2:
      return true;
    case 3:
    case 4:
    case 8:
    case 9:
      return role === RolePool.Dps;
    case 5:
    case 7:
    case 13:
      return role === RolePool.Dps || role === RolePool.Healer;
    case 6:
    case 12:
      return role === RolePool.Dps || role === RolePool.Tank;
    case 10:
    case 11:
      return true;
    default:
      return true;
  }
}

function selectedRoleSet(rolePool: TrinketRolePool, activeSpecId: number): Set<RolePool> {
  if (rolePool === 'dps') return new Set([RolePool.Dps]);
  if (rolePool === 'tank') return new Set([RolePool.Tank]);
  if (rolePool === 'healer') return new Set([RolePool.Healer]);
  return new Set([specToRole(activeSpecId || 0)]);
}

function itemSpecsMatchActiveSpec(
  specs: number[] | undefined,
  activeSpecId: number,
  ignoreSpec: boolean,
) {
  if (ignoreSpec) return true;
  if (!specs || specs.length === 0) return true;
  const specEntries = specs.filter((id) => id > 13);
  if (specEntries.length > 0) return activeSpecId > 0 && specEntries.includes(activeSpecId);
  const classEntries = specs.filter((id) => id >= 1 && id <= 13);
  if (classEntries.length === 0) return true;
  const classId = SPEC_TO_CLASS_ID.get(activeSpecId) || 0;
  return classId > 0 && classEntries.includes(classId);
}

function itemSpecsMatchRole(specs: number[] | undefined, roles: Set<RolePool>) {
  if (!specs || specs.length === 0) return true;
  const specEntries = specs.filter((id) => id > 13);
  if (specEntries.length > 0) return specEntries.some((sid) => roles.has(specToRole(sid)));
  const classEntries = specs.filter((id) => id >= 1 && id <= 13);
  if (classEntries.length === 0) return true;
  return classEntries.some((cid) => [...roles].some((r) => classSupportsRole(cid, r)));
}

function normalizeTrackName(raw: string) {
  return raw.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

function normalizeDropTag(raw: string) {
  const k = raw.toLowerCase();
  if (k === 'mythic') return 'Mythic';
  if (k === 'heroic') return 'Heroic';
  if (k === 'normal') return 'Normal';
  if (k === 'lfr') return 'LFR';
  if (k.includes('mythic_plus')) return k.replace('mythic_plus_', 'M+ ');
  return normalizeTrackName(raw);
}

function pickIlevel(candidates: number[], target: number): number {
  const sorted = [...new Set(candidates)].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  if (sorted.includes(target)) return target;
  const lower = sorted.filter((n) => n <= target);
  if (lower.length > 0) return lower[lower.length - 1];
  return sorted[0];
}

function collectItemIlevels(item: DropItem): Array<{ ilevel: number; tag: string }> {
  const out: Array<{ ilevel: number; tag: string }> = [];
  if (item.ilevel && item.ilevel > 0) out.push({ ilevel: item.ilevel, tag: 'Base Drop' });
  if (item.difficulty_info) {
    for (const [key, entry] of Object.entries(item.difficulty_info)) {
      if (entry?.ilvl && entry.ilvl > 0)
        out.push({ ilevel: entry.ilvl, tag: normalizeDropTag(key) });
    }
  }
  if (item.dungeon_info) {
    for (const [key, entry] of Object.entries(item.dungeon_info)) {
      if (entry?.ilvl && entry.ilvl > 0)
        out.push({ ilevel: entry.ilvl, tag: normalizeDropTag(key) });
    }
  }
  return out;
}

function normalizeUpgradeTracks(input: unknown): Record<string, TrackRow[]> {
  if (!Array.isArray(input)) return {};
  const grouped: Record<string, TrackRow[]> = {};
  for (const row of input as any[]) {
    const name = typeof row?.name === 'string' ? row.name : '';
    const ilvl = Number(row?.itemLevel || row?.ilevel || 0);
    const level = Number(row?.level || 0);
    const max = Number(row?.max || 0);
    if (!name || !ilvl || !level) continue;
    if (!grouped[name]) grouped[name] = [];
    grouped[name].push({ name, level, max, itemLevel: ilvl });
  }
  for (const key of Object.keys(grouped)) grouped[key].sort((a, b) => a.level - b.level);
  return grouped;
}

export default function UpgradeTrinketsPage() {
  const { simcInput } = useSimContext();
  const { className, specName } = useMemo(() => parseClassAndSpec(simcInput), [simcInput]);
  const activeSpecId = useMemo(() => {
    if (!className || !specName) return 0;
    return CLASS_SPEC_ID_FALLBACK[className]?.[specName] || 0;
  }, [className, specName]);

  const [targetIlevel, setTargetIlevel] = useState(289);
  const [selectedTier, setSelectedTier] = useState<string>('all');
  const [includeRaid, setIncludeRaid] = useState(true);
  const [includeDungeon, setIncludeDungeon] = useState(true);
  const [includeDelves, setIncludeDelves] = useState(false);
  const [includePvp, setIncludePvp] = useState(false);
  const [includeCrafted, setIncludeCrafted] = useState(false);
  const [simMode, setSimMode] = useState<TrinketSimMode>('matrix');
  const [rolePool, setRolePool] = useState<TrinketRolePool>('auto');
  const [ignoreSpecRestrictions, setIgnoreSpecRestrictions] = useState(false);
  const [sourceTypes, setSourceTypes] = useState<SourceKey[]>(DEFAULT_SOURCE_TYPES);
  const [dropsBySource, setDropsBySource] = useState<Record<SourceKey, DropItem[]>>({});
  const [upgradeTracks, setUpgradeTracks] = useState<Record<string, TrackRow[]>>({});
  const [poolLoading, setPoolLoading] = useState(false);
  const [returnNotice, setReturnNotice] = useState<SimReturnNoticeType | null>(null);

  useEffect(() => {
    const restored = consumeSimAgainState<UpgradeTrinketsSimAgainState>(
      UPGRADE_TRINKETS_SIM_AGAIN_KEY
    );
    const notice = consumeSimReturnNotice(UPGRADE_TRINKETS_SIM_AGAIN_KEY);
    if (notice) setReturnNotice(notice);
    if (!restored) return;
    if (typeof restored.targetIlevel === 'number' && Number.isFinite(restored.targetIlevel)) {
      setTargetIlevel(Math.max(1, Math.floor(restored.targetIlevel)));
    }
    if (typeof restored.includeRaid === 'boolean') setIncludeRaid(restored.includeRaid);
    if (typeof restored.includeDungeon === 'boolean') setIncludeDungeon(restored.includeDungeon);
    if (
      restored.simMode === 'matrix' ||
      restored.simMode === 'lock_trinket1' ||
      restored.simMode === 'lock_trinket2'
    ) {
      setSimMode(restored.simMode);
    }
    if (
      restored.rolePool === 'auto' ||
      restored.rolePool === 'dps' ||
      restored.rolePool === 'tank' ||
      restored.rolePool === 'healer'
    ) {
      setRolePool(restored.rolePool);
    }
    if (typeof restored.ignoreSpecRestrictions === 'boolean') {
      setIgnoreSpecRestrictions(restored.ignoreSpecRestrictions);
    }
  }, []);

  const equippedTrinket1 = useMemo(() => parseEquippedTrinket(simcInput, 'trinket1'), [simcInput]);
  const equippedTrinket2 = useMemo(() => parseEquippedTrinket(simcInput, 'trinket2'), [simcInput]);
  const itemInfo = useItemInfo(
    [equippedTrinket1, equippedTrinket2]
      .filter((t) => t.itemId > 0)
      .map((t) => ({ item_id: t.itemId, bonus_ids: t.bonusIds }))
  );
  useWowheadTooltips([
    simMode,
    equippedTrinket1.itemId,
    equippedTrinket2.itemId,
    equippedTrinket1.bonusIds.join(':'),
    equippedTrinket2.bonusIds.join(':'),
    equippedTrinket1.ilevel,
    equippedTrinket2.ilevel,
  ]);

  /** Map abstract toggle → list of concrete instance types that match. */
  const sourceTypesByToggle = useMemo(() => {
    const map: Record<string, SourceKey[]> = {
      raid: [],
      dungeon: [],
      delves: [],
      pvp: [],
      crafted: [],
    };
    for (const src of sourceTypes) {
      const s = src.toLowerCase();
      if (s === 'raid') map.raid.push(src);
      else if (s === 'dungeon' || s === 'expansion-dungeon' || s.includes('mplus')) map.dungeon.push(src);
      else if (s.includes('delve') || s.includes('prey')) map.delves.push(src);
      else if (s.includes('pvp')) map.pvp.push(src);
      else if (s.includes('profession')) map.crafted.push(src);
    }
    return map;
  }, [sourceTypes]);

  const selectedSources = useMemo(() => {
    const out: SourceKey[] = [];
    if (includeRaid) out.push(...sourceTypesByToggle.raid);
    if (includeDungeon) out.push(...sourceTypesByToggle.dungeon);
    if (includeDelves) out.push(...sourceTypesByToggle.delves);
    if (includePvp) out.push(...sourceTypesByToggle.pvp);
    if (includeCrafted) out.push(...sourceTypesByToggle.crafted);
    return out;
  }, [sourceTypesByToggle, includeRaid, includeDungeon, includeDelves, includePvp, includeCrafted]);

  useEffect(() => {
    let cancelled = false;
    const fetchSourceTypes = async () => {
      try {
        const res = await fetch(`${API_URL}/api/instances`, { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json().catch(() => []);
        if (!Array.isArray(data)) return;
        const discovered = [
          ...new Set(
            data
              .map((inst) => (typeof inst?.type === 'string' ? inst.type.toLowerCase().trim() : ''))
              .filter((t): t is string => t.length > 0)
          ),
        ];
        const merged = [...new Set([...DEFAULT_SOURCE_TYPES, ...discovered])];
        if (!cancelled && merged.length > 0) setSourceTypes(merged);
      } catch {
        // Keep defaults when discovery fails.
      }
    };
    fetchSourceTypes();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const fetchPoolData = async () => {
      setPoolLoading(true);
      try {
        const query = new URLSearchParams();
        // For "all trinkets regardless of spec drop", keep class scoping (so we still
        // get class-relevant pools), but drop spec scoping.
        if (className) query.set('class_name', className);
        if (!ignoreSpecRestrictions && specName) query.set('spec', specName);
        const shouldFetchDrops = Boolean(className && (ignoreSpecRestrictions || specName));
        const sourcePromises = shouldFetchDrops
          ? sourceTypes.map((source) =>
              fetch(`${API_URL}/api/instances/type/${source}/drops?${query.toString()}`, {
                credentials: 'include',
              }).catch(() => null)
            )
          : sourceTypes.map(() => Promise.resolve(null));
        const [tracksRes, ...sourceResponses] = await Promise.all([
          fetch(`${API_URL}/api/upgrade-tracks`, { credentials: 'include' }),
          ...sourcePromises,
        ]);

        const tracksJson = tracksRes.ok ? await tracksRes.json() : [];
        const nextTracks = normalizeUpgradeTracks(tracksJson);
        const nextDrops: Record<SourceKey, DropItem[]> = {};
        for (const source of sourceTypes) nextDrops[source] = [];

        for (let i = 0; i < sourceTypes.length; i += 1) {
          const source = sourceTypes[i];
          const res = sourceResponses[i];
          if (!res || !res.ok) continue;
          const data = await res.json().catch(() => ({}));
          nextDrops[source] = Array.isArray(data?.Trinket) ? (data.Trinket as DropItem[]) : [];
        }
        if (!cancelled) {
          setUpgradeTracks(nextTracks);
          setDropsBySource(nextDrops);
        }
      } finally {
        if (!cancelled) setPoolLoading(false);
      }
    };
    fetchPoolData();
    return () => {
      cancelled = true;
    };
  }, [className, specName, sourceTypes, ignoreSpecRestrictions]);

  /** Normalize concrete instance types to abstract tokens the backend heatmap handler understands. */
  const sourceScope = useMemo(() => {
    const tokens = new Set<string>();
    for (const src of selectedSources) {
      const s = src.toLowerCase();
      if (s === 'raid') tokens.add('raid');
      else if (s === 'dungeon' || s === 'expansion-dungeon' || s.includes('mplus')) tokens.add('dungeon');
      else if (s.includes('delve') || s.includes('prey')) tokens.add('delve');
      else if (s.includes('pvp')) tokens.add('pvp');
      else if (s.includes('profession')) tokens.add('profession');
      else tokens.add(s);
    }
    return tokens.size > 0 ? [...tokens].join(',') : 'all';
  }, [selectedSources]);
  const selectedRoles = useMemo(
    () => selectedRoleSet(rolePool, activeSpecId),
    [rolePool, activeSpecId],
  );

  const filteredPool = useMemo(() => {
    const byItem = new Map<number, DropItem>();
    for (const source of selectedSources) {
      for (const item of dropsBySource[source] || []) {
        if (!item?.item_id) continue;
        if (source === 'dungeon' && item.mplus_rotation === false) continue;
        if (!itemSpecsMatchActiveSpec(item.specs, activeSpecId, ignoreSpecRestrictions)) continue;
        if (!ignoreSpecRestrictions && !itemSpecsMatchRole(item.specs, selectedRoles)) continue;
        if (!byItem.has(item.item_id)) byItem.set(item.item_id, item);
      }
    }
    return [...byItem.values()];
  }, [selectedSources, dropsBySource, activeSpecId, ignoreSpecRestrictions, selectedRoles]);

  const ilvlTrackHints = useMemo(() => {
    const map = new Map<number, Set<string>>();
    for (const [trackName, rows] of Object.entries(upgradeTracks)) {
      const maxLvl = rows.reduce((m, r) => Math.max(m, r.max || 0), 0);
      for (const row of rows) {
        const ilvl = row.itemLevel;
        if (!map.has(ilvl)) map.set(ilvl, new Set());
        const maxForRow = row.max || maxLvl || rows[rows.length - 1]?.level || row.level;
        map.get(ilvl)!.add(`${normalizeTrackName(trackName)} ${row.level}/${maxForRow}`);
      }
    }
    return map;
  }, [upgradeTracks]);

  const ilvlTrackRows = useMemo(() => {
    const map = new Map<number, TrackRow[]>();
    for (const rows of Object.values(upgradeTracks)) {
      for (const row of rows) {
        const ilvl = row.itemLevel;
        if (!ilvl || ilvl <= 0) continue;
        const list = map.get(ilvl) || [];
        list.push(row);
        map.set(ilvl, list);
      }
    }
    return map;
  }, [upgradeTracks]);

  const hasUpgradeableTrackMetadata = useMemo(
    () =>
      Object.values(upgradeTracks).some((rows) =>
        rows.some((row) => Number.isFinite(row.max) && row.max > 1)
      ),
    [upgradeTracks]
  );

  const ilevelOptions = useMemo<IlevelOption[]>(() => {
    const ilvlToTags = new Map<number, Set<string>>();
    for (const item of filteredPool) {
      const levels = collectItemIlevels(item);
      for (const level of levels) {
        if (!ilvlToTags.has(level.ilevel)) ilvlToTags.set(level.ilevel, new Set());
        ilvlToTags.get(level.ilevel)!.add(level.tag);
      }
    }
    const sortedFromDrops = [...ilvlToTags.keys()].sort((a, b) => b - a);
    const sortedFromTracks = [...ilvlTrackRows.keys()].sort((a, b) => b - a);
    const sorted =
      sortedFromDrops.length > 0
        ? sortedFromDrops
        : hasUpgradeableTrackMetadata
          ? sortedFromTracks
          : [];

    return sorted
      .filter((ilvl) => {
        // Preferred behavior: hide non-upgradable rows only when upgrade-track
        // metadata is available for this season; otherwise do not hide by track.
        if (!hasUpgradeableTrackMetadata) return true;
        const rows = ilvlTrackRows.get(ilvl) || [];
        // If tracks are present this season, only show ilvls that are explicitly
        // present in the track table and have an upgrade path.
        if (rows.length === 0) return false;
        return rows.some((row) => Number.isFinite(row.max) && row.max > 1);
      })
      .map((ilvl) => {
        const trackLabels = [...(ilvlTrackHints.get(ilvl) || new Set())];
        const sourceLabels = [...(ilvlToTags.get(ilvl) || new Set())];
        const primary = trackLabels.length > 0 ? trackLabels.slice(0, 2) : sourceLabels.slice(0, 2);
        return {
          ilevel: ilvl,
          label: primary.length > 0 ? `${ilvl} - ${primary.join(' or ')}` : `${ilvl}`,
        };
      });
  }, [filteredPool, ilvlTrackHints, ilvlTrackRows, hasUpgradeableTrackMetadata]);

  const tierOptions = useMemo<TierOption[]>(() => {
    const options: TierOption[] = [];

    for (const [trackName, rows] of Object.entries(upgradeTracks)) {
      const sortedRows = [...rows]
        .filter((row) => Number.isFinite(row.itemLevel) && row.itemLevel > 0)
        .sort((a, b) => b.itemLevel - a.itemLevel);
      if (sortedRows.length === 0) continue;

      const maxLvl = sortedRows.reduce((m, r) => Math.max(m, r.max || 0), 0);
      const byIlevel = new Map<number, string[]>();
      for (const row of sortedRows) {
        const maxForRow = row.max || maxLvl || row.level;
        const list = byIlevel.get(row.itemLevel) || [];
        list.push(`${row.level}/${maxForRow}`);
        byIlevel.set(row.itemLevel, list);
      }

      const tierIlevels = [...byIlevel.entries()]
        .sort((a, b) => b[0] - a[0])
        .map(([ilvl, levels]) => ({
          ilevel: ilvl,
          label: `${ilvl} - ${normalizeTrackName(trackName)} ${[...new Set(levels)].join(' or ')}`,
        }));
      if (tierIlevels.length === 0) continue;

      options.push({
        key: trackName,
        label: normalizeTrackName(trackName),
        ilevelOptions: tierIlevels,
        maxIlevel: tierIlevels[0].ilevel,
      });
    }

    return options.sort((a, b) => b.maxIlevel - a.maxIlevel);
  }, [upgradeTracks]);

  const selectedTierOption = useMemo(
    () => tierOptions.find((tier) => tier.key === selectedTier) ?? null,
    [tierOptions, selectedTier]
  );

  const targetIlevelOptions = useMemo<IlevelOption[]>(() => {
    if (selectedTierOption) return selectedTierOption.ilevelOptions;
    return ilevelOptions;
  }, [selectedTierOption, ilevelOptions]);

  useEffect(() => {
    if (tierOptions.length === 0) {
      setSelectedTier('all');
      return;
    }

    // Keep user selection when still valid.
    if (tierOptions.some((tier) => tier.key === selectedTier)) return;

    // Try to infer a tier from currently selected ilvl first.
    const inferred = tierOptions.find((tier) =>
      tier.ilevelOptions.some((opt) => opt.ilevel === targetIlevel)
    );
    setSelectedTier((inferred ?? tierOptions[0]).key);
  }, [tierOptions, selectedTier, targetIlevel]);

  useEffect(() => {
    if (targetIlevelOptions.length === 0) return;
    if (!targetIlevelOptions.some((o) => o.ilevel === targetIlevel)) {
      setTargetIlevel(targetIlevelOptions[0].ilevel);
    }
  }, [targetIlevelOptions, targetIlevel]);

  const expectedStats = useMemo(() => {
    const variants = filteredPool
      .map((item) => {
        const levels = collectItemIlevels(item).map((x) => x.ilevel);
        const chosen = pickIlevel(levels, targetIlevel);
        return { itemId: item.item_id, chosen };
      })
      .filter((v) => v.itemId > 0 && v.chosen > 0);

    const trinketCount = variants.length;
    if (trinketCount <= 0) return { trinketCount: 0, combos: 0 };
    if (simMode === 'lock_trinket1') {
      const combos = variants.filter((v) => v.itemId !== equippedTrinket1.itemId).length;
      return { trinketCount, combos };
    }
    if (simMode === 'lock_trinket2') {
      const combos = variants.filter((v) => v.itemId !== equippedTrinket2.itemId).length;
      return { trinketCount, combos };
    }
    return { trinketCount, combos: (trinketCount * (trinketCount - 1)) / 2 };
  }, [filteredPool, targetIlevel, simMode, equippedTrinket1.itemId, equippedTrinket2.itemId]);

  const buildPayload = useCallback(
    () => ({
      simc_input: simcInput,
      sim_type: 'trinket_tier_heatmap',
      include_trinket_matrix: true,
      include_tier_matrix: false,
      heatmap_target_ilevel: Math.max(1, Math.floor(targetIlevel || 289)),
      heatmap_trinket_sources: sourceScope || 'all',
      heatmap_lock_trinket_slot:
        simMode === 'lock_trinket1' ? 'trinket1' : simMode === 'lock_trinket2' ? 'trinket2' : '',
      heatmap_role_pools: rolePool,
      heatmap_ignore_spec_restrictions: ignoreSpecRestrictions,
    }),
    [simcInput, targetIlevel, sourceScope, simMode, rolePool, ignoreSpecRestrictions]
  );

  const validate = useCallback(() => {
    if (simcInput.trim().length < 10)
      return 'SimC input is too short. Paste your full addon export.';
    if (selectedSources.length === 0) return 'Pick at least one trinket source.';
    if (simMode === 'lock_trinket1' && equippedTrinket1.itemId <= 0) {
      return 'Could not detect your equipped Trinket 1 from the SimC export.';
    }
    if (simMode === 'lock_trinket2' && equippedTrinket2.itemId <= 0) {
      return 'Could not detect your equipped Trinket 2 from the SimC export.';
    }
    return null;
  }, [
    simcInput,
    selectedSources.length,
    simMode,
    equippedTrinket1.itemId,
    equippedTrinket2.itemId,
  ]);

  const { submit, submitting, error, buttonLabel } = useSimSubmit({
    endpoint: '/api/sim',
    buildPayload,
    validate,
    simAgain: {
      pageKey: UPGRADE_TRINKETS_SIM_AGAIN_KEY,
      captureState: () => ({
        targetIlevel,
        includeRaid,
        includeDungeon,
        simMode,
        rolePool,
        ignoreSpecRestrictions,
      }),
    },
  });

  const lockLabel = useCallback(
    (t: ParsedTrinket, fallback: string) => {
      const info = itemInfo[t.itemId];
      const itemName = info?.name || fallback;
      const icon = getIconUrl(info?.icon || 'inv_misc_questionmark');
      const wowheadData =
        t.itemId > 0
          ? `item=${t.itemId}${(() => {
              const extra = getWowheadData(t.bonusIds, t.ilevel || info?.ilevel || 0);
              return extra ? `&${extra}` : '';
            })()}`
          : undefined;
      return (
        <span className="inline-flex min-w-0 items-center gap-2 text-zinc-300">
          <span
            className="h-5 w-5 shrink-0 rounded border border-white/10 bg-cover bg-center"
            style={{ backgroundImage: `url(${icon})` }}
          />
          {t.itemId > 0 ? (
            <a
              href={getWowheadUrl(t.itemId)}
              target="_blank"
              rel="noreferrer"
              data-wowhead={wowheadData}
              className="truncate hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {itemName}
            </a>
          ) : (
            <span className="truncate">{fallback}</span>
          )}
        </span>
      );
    },
    [itemInfo]
  );

  const hasCharacter = simcInput.trim().length >= 10;
  if (!hasCharacter) {
    return (
      <p className="py-6 text-center text-sm text-muted">
        Paste your SimC addon export above to use Upgrade Trinkets.
      </p>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="space-y-6"
    >
      {returnNotice ? (
        <SimReturnNotice
          title={returnNotice.title}
          message={returnNotice.message}
          onDismiss={() => setReturnNotice(null)}
        />
      ) : null}

      <div className="space-y-1">
        <h2 className="text-xl font-bold tracking-tight text-zinc-100">Upgrade Trinkets</h2>
        <p className="text-sm text-zinc-400">
          Sim trinket pair upgrades by source and target item level.
        </p>
      </div>

      <ErrorAlert message={error} />

      <StickyPageHeader
        left={
          <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-300">
            Expected Run Size
          </span>
        }
        right={
          <ComboSummary
            comboCount={poolLoading ? 0 : expectedStats.combos}
            size="md"
            glowWhenActive
            activeBy="items"
            itemCount={poolLoading ? 0 : expectedStats.trinketCount}
            breakdown={
              poolLoading
                ? null
                : `${expectedStats.trinketCount.toLocaleString()} trinkets in pool`
            }
          />
        }
      />

      <div className="space-y-4 rounded-xl border border-zinc-700/70 bg-zinc-900/50 p-5 text-sm text-zinc-300">
        <p>Choose the trinket pool and ilvl target for the heatmap simulation.</p>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="block space-y-1.5 text-sm text-zinc-300">
            <span className="block">Tier</span>
            <select
              value={selectedTier}
              onChange={(e) => setSelectedTier(e.target.value)}
              disabled={tierOptions.length === 0}
              className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-100 focus:border-gold focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
            >
              {tierOptions.length > 0 ? (
                tierOptions.map((tier) => (
                  <option key={tier.key} value={tier.key}>
                    {tier.label}
                  </option>
                ))
              ) : (
                <option value="all">All Available</option>
              )}
            </select>
          </label>

          <label className="block space-y-1.5 text-sm text-zinc-300">
            <span className="block">Target Trinket iLvl</span>
            <select
              value={targetIlevel}
              onChange={(e) => setTargetIlevel(Number(e.target.value) || targetIlevel)}
              className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-100 focus:border-gold focus:outline-none"
            >
              {(targetIlevelOptions.length > 0
                ? targetIlevelOptions
                : [{ ilevel: 289, label: '289' }]
              ).map((opt) => (
                <option key={`${selectedTier}:${opt.ilevel}`} value={opt.ilevel}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <span className="block text-[11px] text-zinc-500">
          Tier and ilvl options are derived from current drop-pool data and upgrade tracks.
        </span>

        <div className="space-y-1.5 text-sm text-zinc-300">
          <span className="block">Simulation Mode</span>
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="flex min-h-12 items-center justify-between gap-2 rounded-md border border-zinc-700 bg-zinc-900/70 px-3 py-2.5">
              <span className="min-w-0">
                <span className="block text-zinc-100">Full Matrix</span>
                <span className="block text-[11px] text-zinc-400">No trinket is fixed</span>
              </span>
              <input
                type="radio"
                name="trinket-sim-mode"
                checked={simMode === 'matrix'}
                onChange={() => setSimMode('matrix')}
                className="h-5 w-5 accent-gold"
              />
            </label>
            <label className="flex min-h-12 items-center justify-between gap-2 rounded-md border border-zinc-700 bg-zinc-900/70 px-3 py-2.5">
              <span className="min-w-0">
                <span className="block text-[11px] text-zinc-400">Fixed: Trinket 1</span>
                {lockLabel(equippedTrinket1, 'Lock Trinket 1')}
              </span>
              <input
                type="radio"
                name="trinket-sim-mode"
                checked={simMode === 'lock_trinket1'}
                onChange={() => setSimMode('lock_trinket1')}
                className="h-5 w-5 accent-gold"
              />
            </label>
            <label className="flex min-h-12 items-center justify-between gap-2 rounded-md border border-zinc-700 bg-zinc-900/70 px-3 py-2.5">
              <span className="min-w-0">
                <span className="block text-[11px] text-zinc-400">Fixed: Trinket 2</span>
                {lockLabel(equippedTrinket2, 'Lock Trinket 2')}
              </span>
              <input
                type="radio"
                name="trinket-sim-mode"
                checked={simMode === 'lock_trinket2'}
                onChange={() => setSimMode('lock_trinket2')}
                className="h-5 w-5 accent-gold"
              />
            </label>
          </div>
        </div>

        <div className="space-y-1.5 text-sm text-zinc-300">
          <span className="block">Trinket Source Pool</span>
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {[
              ['Raid', includeRaid, setIncludeRaid],
              ['Dungeon', includeDungeon, setIncludeDungeon],
              ['Crafted', includeCrafted, setIncludeCrafted],
              ['Delves', includeDelves, setIncludeDelves],
              ['PvP', includePvp, setIncludePvp],
            ].map(([label, value, setter]) => (
              <label
                key={label as string}
                className="flex min-h-12 items-center justify-between rounded-md border border-zinc-700 bg-zinc-900/70 px-3 py-2.5"
              >
                <span className="text-zinc-100">{label as string}</span>
                <input
                  type="checkbox"
                  checked={Boolean(value)}
                  onChange={(e) => (setter as (v: boolean) => void)(e.target.checked)}
                  className="h-5 w-5 accent-gold"
                />
              </label>
            ))}
          </div>
        </div>

        <div className="space-y-1.5 text-sm text-zinc-300">
          <span className="block">Role Pool</span>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ['auto', 'Auto (Current Spec)'],
              ['dps', 'All DPS Trinkets'],
              ['tank', 'All Tank Trinkets'],
              ['healer', 'All Healer Trinkets'],
            ].map(([value, label]) => (
              <label
                key={value}
                className="flex min-h-12 items-center justify-between rounded-md border border-zinc-700 bg-zinc-900/70 px-3 py-2.5"
              >
                <span className="text-zinc-100">{label}</span>
                <input
                  type="radio"
                  name="trinket-role-pool"
                  checked={rolePool === (value as TrinketRolePool)}
                  onChange={() => setRolePool(value as TrinketRolePool)}
                  className="h-5 w-5 accent-gold"
                />
              </label>
            ))}
          </div>
        </div>

        <label className="flex min-h-12 items-center justify-between rounded-md border border-zinc-700 bg-zinc-900/70 px-3 py-2.5">
          <span className="text-zinc-100">Sim All Trinkets Regardless of Spec Drop</span>
          <input
            type="checkbox"
            checked={ignoreSpecRestrictions}
            onChange={(e) => setIgnoreSpecRestrictions(e.target.checked)}
            className="h-5 w-5 accent-gold"
          />
        </label>
      </div>

      <button
        type="submit"
        disabled={submitting || simcInput.trim().length < 10}
        className="btn-primary w-full py-3 text-sm"
      >
        {submitting ? 'Running...' : buttonLabel('Run Trinket Matrix')}
      </button>
    </form>
  );
}
