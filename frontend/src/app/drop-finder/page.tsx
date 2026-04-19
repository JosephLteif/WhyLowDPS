'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ErrorAlert from '../components/ErrorAlert';
import { useSimContext } from '../components/SimContext';
import ToggleButtonGroup from '../components/ToggleButtonGroup';
import { API_URL, fetchJson } from '../lib/api';
import { useSimSubmit } from '../lib/useSimSubmit';
import { consumeSimAgainState } from '../lib/sim-return';
import type { SeasonConfigResponse, DifficultyDef, DungeonCategory } from '../lib/types';
import CategorySelector from './CategorySelector';
import DropSlotList from './DropSlotList';
import DungeonGrid from './DungeonGrid';
import {
  detectClass,
  getClassId,
  detectSpec,
  formatSpecName,
  getClassSpecs,
  getSpecId,
  getTrackInfo,
  resolveUpgrade,
  type DropItem,
  type Instance,
  type UpgradeTracks,
} from './types';

type Category = 'raids' | string;
type SimDropItem = DropItem & { slot?: string };

const DROP_FINDER_SIM_AGAIN_KEY = 'drop-finder';

interface DropFinderSimAgainState {
  activeSpecs?: string[];
  selected?: number[];
  difficulty?: string;
  dungeonDiff?: string;
  upgradeLevel?: number;
  category?: string;
  selectedId?: string;
}

const TRACK_SHORT: Record<string, string> = {
  Adventurer: 'Adv',
  Veteran: 'Vet',
  Champion: 'Champ',
  Hero: 'Hero',
  Myth: 'Myth',
};

const TRACK_COLORS: Record<string, { text: string; bg: string; border: string }> = {
  Adventurer: { text: 'text-green-400', bg: 'bg-green-400/10', border: 'border-green-400/30' },
  Veteran: { text: 'text-blue-400', bg: 'bg-blue-400/10', border: 'border-blue-400/30' },
  Champion: { text: 'text-purple-400', bg: 'bg-purple-400/10', border: 'border-purple-400/30' },
  Hero: { text: 'text-orange-400', bg: 'bg-orange-400/10', border: 'border-orange-400/30' },
  Myth: { text: 'text-amber-300', bg: 'bg-amber-300/10', border: 'border-amber-300/30' },
};

const UPGRADE_TRACK_MAX_LEVEL = 6;

function getRaidDifficultyDisplayLevel(key: string): number {
  return key ? 1 : 0;
}

function slotFromInventoryType(inventoryType?: number): string | null {
  switch (inventoryType) {
    case 1:
      return 'head';
    case 3:
      return 'shoulder';
    case 5:
      return 'chest';
    case 6:
      return 'waist';
    case 7:
      return 'legs';
    case 8:
      return 'feet';
    case 9:
      return 'wrist';
    case 10:
      return 'hands';
    case 11:
      return 'finger1';
    case 16:
      return 'back';
    case 21:
      return 'main_hand';
    case 22:
      return 'off_hand';
    default:
      return null;
  }
}

const FALLBACK_SEASON_CONFIG: SeasonConfigResponse = {
  season: '',
  raid_difficulties: [
    { key: 'lfr', label: 'Raid Finder', track: 'Veteran', level: 1, sortOrder: 1 },
    { key: 'normal', label: 'Normal', track: 'Champion', level: 2, sortOrder: 2 },
    { key: 'heroic', label: 'Heroic', track: 'Hero', level: 3, sortOrder: 3 },
    { key: 'mythic', label: 'Mythic', track: 'Myth', level: 4, sortOrder: 4 },
  ],
  dungeon_categories: [
    {
      key: 'mplus',
      label: 'Mythic+',
      poolInstanceId: -1,
      defaultDifficulty: 'mythic+10',
      difficulties: [
        { key: 'heroic', label: 'Heroic', track: 'Adventurer', level: 2, sortOrder: 1 },
        { key: 'mythic', label: 'Mythic 0', track: 'Champion', level: 1, sortOrder: 2 },
        { key: 'mythic+2', label: '+2', track: 'Champion', level: 2, sortOrder: 3 },
        { key: 'mythic+3', label: '+3', track: 'Champion', level: 2, sortOrder: 4 },
        { key: 'mythic+4', label: '+4', track: 'Champion', level: 3, sortOrder: 5 },
        { key: 'mythic+5', label: '+5', track: 'Champion', level: 4, sortOrder: 6 },
        { key: 'mythic+6', label: '+6', track: 'Champion', level: 5, sortOrder: 7 },
        { key: 'mythic+7', label: '+7', track: 'Hero', level: 1, sortOrder: 8 },
        { key: 'mythic+8', label: '+8', track: 'Hero', level: 2, sortOrder: 9 },
        { key: 'mythic+9', label: '+9', track: 'Hero', level: 2, sortOrder: 10 },
        { key: 'mythic+10', label: '+10', track: 'Hero', level: 3, sortOrder: 11 },
        { key: 'vault+7-9', label: 'Vault +7-9', track: 'Hero', level: 4, sortOrder: 12 },
        { key: 'vault+10', label: 'Vault +10', track: 'Myth', level: 1, sortOrder: 13 },
      ],
    },
    {
      key: 'normal-dungeons',
      label: 'Dungeons',
      poolInstanceId: -32,
      defaultDifficulty: 'heroic',
      difficulties: [
        {
          key: 'normal',
          label: 'Normal',
          track: null,
          level: 0,
          sortOrder: 1,
          fixedIlvl: 214,
          fixedQuality: 3,
        },
        { key: 'heroic', label: 'Heroic', track: 'Adventurer', level: 2, sortOrder: 2 },
        { key: 'mythic', label: 'Mythic', track: 'Champion', level: 1, sortOrder: 3 },
      ],
    },
  ],
};

// --- Data loading hook ---

function useDropFinderData(simcInput: string, activeSpecs: Set<string>) {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [seasonConfig, setSeasonConfig] = useState<SeasonConfigResponse | null>(
    FALLBACK_SEASON_CONFIG
  );
  const [upgradeTracks, setUpgradeTracks] = useState<UpgradeTracks>({});
  const [selectedId, setSelectedId] = useState('');
  const [drops, setDrops] = useState<Record<string, DropItem[]> | null>(null);
  const [loading, setLoading] = useState(false);

  const className = useMemo(() => detectClass(simcInput), [simcInput]);
  const specName = useMemo(() => detectSpec(simcInput), [simcInput]);
  const specParam = useMemo(() => [...activeSpecs].sort().join(','), [activeSpecs]);

  useEffect(() => {
    let cancelled = false;

    const loadSeasonConfig = async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
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

    void loadSeasonConfig();
    fetchJson<Instance[]>(`${API_URL}/api/instances`)
      .then(setInstances)
      .catch(() => {});
    fetchJson<UpgradeTracks>(`${API_URL}/api/upgrade-tracks`)
      .then(setUpgradeTracks)
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  const { raids, dungeonCats } = useMemo(() => {
    if (!seasonConfig)
      return {
        raids: [] as Instance[],
        dungeonCats: [] as { cat: DungeonCategory; instances: Instance[] }[],
      };

    const poolMap = new Map<number, Set<number>>();
    for (const cat of seasonConfig.dungeon_categories) {
      const meta = instances.find((i) => i.id === cat.poolInstanceId);
      if (meta) {
        poolMap.set(cat.poolInstanceId, new Set(meta.encounters.map((e) => e.id)));
      }
    }

    const raidList: Instance[] = [];
    const dcList: { cat: DungeonCategory; instances: Instance[] }[] =
      seasonConfig.dungeon_categories.map((cat) => ({ cat, instances: [] }));

    for (const inst of instances) {
      if (inst.type === 'raid' && inst.id > 0) {
        raidList.push(inst);
      } else if (inst.type === 'dungeon') {
        let placed = false;
        for (const dc of dcList) {
          const pool = poolMap.get(dc.cat.poolInstanceId);
          if (pool?.has(inst.id)) {
            dc.instances.push(inst);
            placed = true;
          }
        }
        if (!placed && dcList.length > 0) {
          dcList[dcList.length - 1].instances.push(inst);
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
    const qs = params.toString();
    const url = selectedId.startsWith('type:')
      ? `${API_URL}/api/instances/type/${selectedId.slice(5)}/drops`
      : `${API_URL}/api/instances/${selectedId}/drops`;
    fetchJson<any>(`${url}${qs ? `?${qs}` : ''}`)
      .then((data) => setDrops(data.detail ? null : data))
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

// --- Spinner ---

function Spinner() {
  return (
    <div className="flex justify-center py-8">
      <svg className="h-6 w-6 animate-spin text-gold" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.25" />
        <path d="M14 8a6 6 0 00-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </div>
  );
}

// --- Page ---

export default function DropFinderPage() {
  const { simcInput } = useSimContext();
  // Spec selection: main spec on by default, off-specs toggleable
  const detectedClass = useMemo(() => detectClass(simcInput), [simcInput]);
  const detectedSpec = useMemo(() => detectSpec(simcInput), [simcInput]);
  const allSpecs = useMemo(
    () => (detectedClass ? getClassSpecs(detectedClass) : []),
    [detectedClass]
  );
  const [activeSpecs, setActiveSpecs] = useState<Set<string>>(new Set());

  const activeSpecIds = useMemo(
    () =>
      detectedClass
        ? [...activeSpecs]
            .map((spec) => getSpecId(detectedClass, spec))
            .filter((id): id is number => id != null)
        : [],
    [detectedClass, activeSpecs]
  );
  const classSpecIds = useMemo(
    () =>
      detectedClass
        ? getClassSpecs(detectedClass)
            .map((spec) => getSpecId(detectedClass, spec))
            .filter((id): id is number => id != null)
        : [],
    [detectedClass]
  );
  const classId = useMemo(
    () => (detectedClass ? getClassId(detectedClass) : null),
    [detectedClass]
  );

  function toggleSpec(spec: string) {
    setActiveSpecs((prev) => {
      const next = new Set(prev);
      if (next.has(spec)) {
        // Don't allow deselecting the last spec
        if (next.size <= 1) return prev;
        next.delete(spec);
      } else {
        next.add(spec);
      }
      return next;
    });
  }

  const {
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
  } = useDropFinderData(simcInput, activeSpecs);

  const hasCharacter = simcInput.trim().length >= 10;
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [difficulty, setDifficulty] = useState('heroic');
  const [dungeonDiff, setDungeonDiff] = useState('mythic+10');
  const [upgradeLevel, setUpgradeLevel] = useState(0);
  const [category, setCategory] = useState<Category | ''>('');
  const skipNextDetectedSpecSyncRef = useRef(false);
  const skipNextDropsResetRef = useRef(false);

  useEffect(() => {
    const restored = consumeSimAgainState<DropFinderSimAgainState>(DROP_FINDER_SIM_AGAIN_KEY);
    if (!restored) return;

    if (Array.isArray(restored.activeSpecs) && restored.activeSpecs.length > 0) {
      setActiveSpecs(new Set(restored.activeSpecs.filter((spec) => typeof spec === 'string')));
      skipNextDetectedSpecSyncRef.current = true;
    }
    if (Array.isArray(restored.selected)) {
      setSelected(new Set(restored.selected.filter((id) => Number.isFinite(id))));
      skipNextDropsResetRef.current = true;
    }
    if (typeof restored.difficulty === 'string' && restored.difficulty.length > 0) {
      setDifficulty(restored.difficulty);
    }
    if (typeof restored.dungeonDiff === 'string' && restored.dungeonDiff.length > 0) {
      setDungeonDiff(restored.dungeonDiff);
    }
    if (typeof restored.upgradeLevel === 'number' && Number.isFinite(restored.upgradeLevel)) {
      setUpgradeLevel(Math.max(0, Math.floor(restored.upgradeLevel)));
    }
    if (typeof restored.category === 'string') setCategory(restored.category);
    if (typeof restored.selectedId === 'string') setSelectedId(restored.selectedId);
  }, [setSelectedId]);

  useEffect(() => {
    if (skipNextDetectedSpecSyncRef.current) {
      skipNextDetectedSpecSyncRef.current = false;
      return;
    }
    setActiveSpecs(detectedSpec ? new Set([detectedSpec]) : new Set());
  }, [detectedSpec]);

  useEffect(() => {
    if (skipNextDropsResetRef.current) {
      if (!drops) return;
      skipNextDropsResetRef.current = false;
      return;
    }
    setSelected(new Set());
  }, [drops]);

  const isRaid = category === 'raids';
  const activeDungeonCat = dungeonCats.find((dc) => dc.cat.key === category);
  const isDungeon = !!activeDungeonCat;
  const selectedInstance =
    selectedId && !selectedId.startsWith('type:')
      ? instances.find((i) => String(i.id) === selectedId)
      : null;

  const currentTrackInfo = useMemo(() => {
    if (!drops) return null;
    for (const items of Object.values(drops)) {
      for (const item of items) {
        const info = getTrackInfo(item, difficulty, dungeonDiff);
        if (info?.track && upgradeTracks[info.track]) {
          return { name: info.track, levels: upgradeTracks[info.track] };
        }
      }
    }
    return null;
  }, [drops, difficulty, dungeonDiff, upgradeTracks]);

  const activeDifficulties: DifficultyDef[] = useMemo(() => {
    if (!seasonConfig) return [];
    if (isRaid) return seasonConfig.raid_difficulties;
    if (activeDungeonCat) return activeDungeonCat.cat.difficulties;
    return [];
  }, [seasonConfig, isRaid, activeDungeonCat]);

  const dungeonInstances = useMemo(() => activeDungeonCat?.instances ?? [], [activeDungeonCat]);
  const activeInstances = isRaid ? raids : dungeonInstances;
  const hasImages = activeInstances.some((i) => i.image_url);

  const allKey = isRaid
    ? 'type:raid'
    : String(activeDungeonCat?.cat.poolInstanceId ?? 'type:dungeon');

  const instanceOptions = useMemo(() => {
    const list = isRaid ? raids : dungeonInstances;
    return [
      { key: allKey, label: `All ${isRaid ? 'Raids' : 'Dungeons'}` },
      ...list.map((inst) => ({ key: String(inst.id), label: inst.name })),
    ];
  }, [isRaid, raids, dungeonInstances, allKey]);

  const upgradeLevelOptions = useMemo(() => {
    if (!currentTrackInfo) return [];
    return [
      { key: 0, label: 'Base' },
      ...currentTrackInfo.levels.map((lvl) => ({
        key: lvl.level,
        label: `${currentTrackInfo.name} ${lvl.level}/${UPGRADE_TRACK_MAX_LEVEL}`,
        sublabel: String(lvl.ilvl),
      })),
    ];
  }, [currentTrackInfo]);

  function selectAll(itemIds: number[]) {
    setSelected(new Set(itemIds));
  }

  const headerLabel =
    selectedInstance?.name ||
    (selectedId.startsWith('type:') ? `All ${isRaid ? 'Raids' : 'Dungeons'}` : '');

  // Sim submission
  const buildPayload = useCallback(async () => {
    if (!drops || selected.size === 0) return null;
    const dropItems: DropItem[] = [];
    for (const [slot, items] of Object.entries(drops)) {
      for (const item of items) {
        if (selected.has(item.item_id)) {
          if (item.specs?.length && item.specs.length > 0) {
            const matchesSpec = item.specs.some((id) => activeSpecIds.includes(id));
            const matchesClass = classId != null && item.specs.includes(classId);
            if (!matchesSpec && !matchesClass) continue;
          }
          const resolved = resolveUpgrade(
            item,
            difficulty,
            dungeonDiff,
            upgradeLevel,
            upgradeTracks
          );
          let simItem: SimDropItem = {
            ...item,
            ilevel: resolved.ilvl,
            quality: resolved.quality,
            bonus_ids: resolved.bonus_id ? [resolved.bonus_id] : [],
            slot,
          };
          if (item.is_catalyst || item.can_catalyst) {
            const convertSlot =
              slot === 'Other' ? slotFromInventoryType(item.inventory_type) : slot;
            if (convertSlot) {
              try {
                simItem = await fetchJson<SimDropItem>(`${API_URL}/api/gear/catalyst-convert`, {
                  method: 'POST',
                  body: JSON.stringify({
                    class_name: className,
                    slot: convertSlot,
                    item: {
                      ...item,
                      ilevel: resolved.ilvl,
                      quality: resolved.quality,
                      bonus_ids: resolved.bonus_id ? [resolved.bonus_id] : [],
                    },
                  }),
                });
              } catch {
                simItem = {
                  ...simItem,
                  is_catalyst: false,
                  can_catalyst: false,
                };
              }
            }
          }
          dropItems.push(simItem);
        }
      }
    }
    return { simc_input: simcInput, drop_items: dropItems };
  }, [
    drops,
    selected,
    simcInput,
    difficulty,
    dungeonDiff,
    upgradeLevel,
    upgradeTracks,
    activeSpecIds,
    classId,
    className,
  ]);

  const validate = useCallback(() => {
    if (!drops || selected.size === 0) return 'Select at least one item to sim.';
    return null;
  }, [drops, selected]);

  const {
    submit: handleSubmit,
    submitting,
    error,
    buttonLabel,
  } = useSimSubmit({
    endpoint: '/api/droptimizer/sim',
    buildPayload,
    validate,
    simAgain: {
      pageKey: DROP_FINDER_SIM_AGAIN_KEY,
      captureState: () => ({
        activeSpecs: [...activeSpecs],
        selected: [...selected],
        difficulty,
        dungeonDiff,
        upgradeLevel,
        category,
        selectedId,
      }),
    },
  });

  const submitLabel = !hasCharacter
    ? 'Paste SimC export to simulate'
    : selected.size === 0
      ? 'Select items to simulate'
      : buttonLabel(`Find Upgrades (${selected.size} items)`);

  return (
    <div className="space-y-6">
      <CategorySelector
        category={category}
        onChange={(key) => {
          setCategory(key);
          setSelectedId('');
        }}
        dungeonCats={dungeonCats}
      />

      {category && hasImages ? (
        <DungeonGrid
          value={selectedId}
          onChange={setSelectedId}
          instances={activeInstances}
          allKey={allKey}
          allLabel={isRaid ? 'All Raids' : `All ${activeDungeonCat?.cat.label ?? 'Dungeons'}`}
        />
      ) : category ? (
        <div className="card p-5">
          <label className="label-text">{isRaid ? 'Select Raid' : 'Select Dungeon'}</label>
          <ToggleButtonGroup
            value={selectedId}
            onChange={setSelectedId}
            options={instanceOptions}
          />
        </div>
      ) : null}

      {(isRaid || isDungeon) && selectedId && activeDifficulties.length > 0 && (
        <div className="card space-y-4 p-6">
          <div>
            <label className="label-text">Difficulty</label>
            <div className="flex flex-wrap gap-2">
              {activeDifficulties.map((d) => {
                const currentDiff = isRaid ? difficulty : dungeonDiff;
                const isActive = currentDiff === d.key;
                const trackLevels = d.track ? upgradeTracks[d.track] : null;
                const displayLevel = isRaid ? getRaidDifficultyDisplayLevel(d.key) : d.level;
                const ilvl = trackLevels?.find((t) => t.level === d.level)?.ilvl ?? d.fixedIlvl;
                const tc = d.track ? TRACK_COLORS[d.track] : null;
                return (
                  <button
                    key={d.key}
                    onClick={() => {
                      if (isRaid) setDifficulty(d.key);
                      else setDungeonDiff(d.key);
                      setUpgradeLevel(0);
                    }}
                    className={`flex min-w-[5.25rem] flex-col items-center rounded-lg border px-3.5 py-2.5 text-center transition-all duration-150 ${
                      isActive && tc
                        ? `${tc.border} ${tc.bg}`
                        : isActive
                          ? 'border-gold/40 bg-gold/[0.08]'
                          : 'border-border bg-surface-2 hover:border-zinc-600'
                    }`}
                  >
                    <span
                      className={`text-lg font-black leading-none ${isActive && tc ? tc.text : isActive ? 'text-gold' : 'text-zinc-200'}`}
                    >
                      {d.label}
                    </span>
                    {ilvl && (
                      <span
                        className={`mt-1.5 text-[13px] font-semibold tabular-nums tracking-wide ${isActive ? 'text-zinc-100' : 'text-zinc-300'}`}
                      >
                        ilvl {ilvl}
                      </span>
                    )}
                    {d.track ? (
                      <span
                        className={`mt-1 text-xs font-semibold ${tc?.text ?? 'text-zinc-300'} ${isActive ? 'opacity-100' : 'opacity-90'}`}
                      >
                        {isRaid
                          ? d.track
                          : `${TRACK_SHORT[d.track] ?? d.track} ${displayLevel}/${UPGRADE_TRACK_MAX_LEVEL}`}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>

          {currentTrackInfo && drops && (
            <div>
              <label className="label-text">Upgrade Level</label>
              <ToggleButtonGroup
                value={upgradeLevel}
                onChange={setUpgradeLevel}
                options={upgradeLevelOptions}
                size="sm"
              />
            </div>
          )}
        </div>
      )}

      {className ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm text-zinc-300">
            Showing loot for{' '}
            <span className="font-semibold text-gold">{className.replace('_', ' ')}</span>
          </p>
          {allSpecs.length > 1 && (
            <>
              <span className="h-3.5 w-px bg-border" />
              <div className="flex flex-wrap gap-1">
                {allSpecs.map((spec) => {
                  const isActive = activeSpecs.has(spec);
                  const isMain = spec === detectedSpec;
                  return (
                    <button
                      key={spec}
                      onClick={() => toggleSpec(spec)}
                      className={`rounded-md border px-2.5 py-1.5 text-sm font-medium transition-all duration-150 ${
                        isActive
                          ? 'border-gold/40 bg-gold/[0.08] text-gold'
                          : 'border-border bg-surface-2 text-zinc-300 hover:border-zinc-500 hover:text-zinc-100'
                      }`}
                    >
                      {formatSpecName(spec)}
                      {isMain && <span className="ml-1 text-sm opacity-70">main</span>}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted">
          Paste a SimC export above to filter drops for your class.
        </p>
      )}

      {loading && <Spinner />}

      {!loading && selectedId && !drops && (
        <p className="py-6 text-center text-sm text-muted">
          No equippable drops found for this instance.
        </p>
      )}

      {!loading && drops && (
        <>
          <DropSlotList
            drops={drops}
            selected={selected}
            onToggle={(id) =>
              setSelected((prev) => {
                const next = new Set(prev);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              })
            }
            onSelectAll={selectAll}
            onClear={() => setSelected(new Set())}
            classSpecIds={classSpecIds}
            classId={classId}
            difficulty={difficulty}
            dungeonDiff={dungeonDiff}
            upgradeLevel={upgradeLevel}
            upgradeTracks={upgradeTracks}
            headerLabel={headerLabel}
          />

          <ErrorAlert message={error} />

          <div className="sticky bottom-0 z-50 -mx-4 bg-gradient-to-t from-[#111] via-[#111] to-transparent px-4 pb-4 pt-6">
            <button
              onClick={handleSubmit}
              disabled={submitting || selected.size === 0 || !hasCharacter}
              className="btn-primary flex w-full items-center justify-center gap-2 py-3 text-sm"
            >
              {submitting ? (
                <>
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 16 16" fill="none">
                    <circle
                      cx="8"
                      cy="8"
                      r="6"
                      stroke="currentColor"
                      strokeWidth="2"
                      opacity="0.25"
                    />
                    <path
                      d="M14 8a6 6 0 00-6-6"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  </svg>
                  Starting sim…
                </>
              ) : (
                submitLabel
              )}
            </button>
          </div>
        </>
      )}

      {!selectedId && !loading && !category && (
        <p className="py-6 text-center text-sm text-muted">Select a category to get started.</p>
      )}
    </div>
  );
}
