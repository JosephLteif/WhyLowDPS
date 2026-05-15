'use client';
import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, Clock3, Download, Loader2, Map, SlidersHorizontal } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSimContext } from './SimContext';
import FightStyleSelector from './FightStyleSelector';
import ScenarioBuilder from './ScenarioBuilder';
import { CLASS_COLORS, specDisplayName } from '../lib/types';
import type { PullInfo } from '@/lib/simc-parser';
import { getFightStyleParamRules } from '../lib/fight-style';
import { parseCharacterInfo } from '@/lib/simc-parser';
import { useWowheadTooltips } from '../lib/useWowheadTooltips';
import { useConsumableOptions } from '../lib/useConsumableOptions';
import { RAID_BUFF_MATRIX_OPTIONS } from '../lib/sim-options-catalog';
import {
  getAllAppDefaultOptions,
  getCharacterDefaultsKeyFromSimcInput,
} from '../lib/default-options';
import ConsumableSelect, { buildQualityMaxByFamily } from './shared/ConsumableSelect';
import RaidBuffGrid from './shared/RaidBuffGrid';
import ToggleOptionCard from './shared/ToggleOptionCard';
import ConsumablePicker from './shared/ConsumablePicker';

const EXPERT_TABS = [
  {
    key: 'header',
    label: 'Header',
    desc: 'Injected before the base actor. Use for global options and initial overrides.',
  },
  {
    key: 'base_player',
    label: 'Base Player',
    desc: 'Injected after the base actor definition. Use for custom APL (actions=...) or player-specific overrides.',
  },
  {
    key: 'raid_actors',
    label: 'Raid Actors',
    desc: 'Extremely experimental! Adds additional raid actors. Disables single_actor_batch when used.',
  },
  {
    key: 'post_combos',
    label: 'Post Combos',
    desc: 'Injected after all profileset combinations. Use for additional actors after gear combos.',
  },
  {
    key: 'footer',
    label: 'Footer',
    desc: 'Injected at the very end. Use for dungeon routes, fight overrides, or custom enemy configs.',
  },
] as const;

type ExpertTabKey = (typeof EXPERT_TABS)[number]['key'];

export function CharacterInfoBar({
  info,
}: {
  info: {
    className: string;
    name: string;
    spec: string;
    level: string | null;
    race: string | null;
    region: string | null;
    server: string | null;
    role: string | null;
    professions: string | null;
    lootSpec: string | null;
    addonVersion: string | null;
    wowVersion: string | null;
    requiresVersion: string | null;
    talentsCount: number;
    savedLoadouts: number;
    checksum: string | null;
  };
}) {
  const [expanded, setExpanded] = useState(false);
  const profileUrl =
    info.region && info.server && info.name
      ? `/character/${info.region.toLowerCase()}/${info.server
          .toLowerCase()
          .replace(/'/g, '')
          .replace(/\s+/g, '-')}/${info.name.toLowerCase()}`
      : null;

  const classColor = CLASS_COLORS[info.className.toLowerCase().replace(/\s+/g, '')] || '#fff';

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-xl border border-white/5 bg-white/[0.03] transition-all hover:border-white/10 hover:bg-white/[0.05]">
      <div className="flex items-center justify-between gap-4 p-3">
        <div className="flex min-w-0 items-center gap-3">
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-black/40 text-[10px] font-bold uppercase tracking-tighter shadow-inner"
            style={{ color: classColor }}
          >
            {info.spec.slice(0, 3)}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-[15px] font-bold tracking-tight text-white">
                {info.name}
              </span>
              {info.level && (
                <span className="shrink-0 rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10px] font-medium text-zinc-500">
                  L{info.level}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 truncate text-[12px] font-medium">
              <span style={{ color: classColor }}>{specDisplayName(info.spec)}</span>
              <span className="text-zinc-500">{info.className}</span>
              <span className="mx-0.5 h-1 w-1 rounded-full bg-zinc-700" />
              <span className="text-zinc-400">
                {info.region?.toUpperCase()}·{info.server}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {profileUrl && (
            <Link
              href={profileUrl}
              className="hidden rounded-md border border-gold/45 bg-gold/[0.12] px-2.5 py-1 text-[12px] font-semibold text-gold transition-colors hover:bg-gold/[0.2] sm:block"
            >
              Profile
            </Link>
          )}
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className={`rounded-lg p-2 text-zinc-400 transition-colors hover:bg-white/5 hover:text-white ${expanded ? 'bg-white/5 text-white' : ''}`}
          >
            <ChevronDown
              className={`h-4 w-4 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
              strokeWidth={2.5}
            />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-white/5 bg-black/20 px-4 py-2 text-[11px] font-medium">
        {info.role && (
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] font-black uppercase tracking-widest text-zinc-600">
              Role
            </span>
            <span className="text-zinc-300">{info.role}</span>
          </div>
        )}
        {info.race && (
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] font-black uppercase tracking-widest text-zinc-600">
              Race
            </span>
            <span className="text-zinc-300">{info.race}</span>
          </div>
        )}
        {info.lootSpec && (
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] font-black uppercase tracking-widest text-zinc-600">
              Loot
            </span>
            <span className="text-zinc-300">{info.lootSpec}</span>
          </div>
        )}
      </div>

      {expanded && (
        <div className="grid grid-cols-2 gap-x-8 gap-y-3 border-t border-white/5 bg-black/40 p-4">
          <div className="space-y-3">
            <div>
              <p className="mb-1 text-[9px] font-black uppercase tracking-[0.2em] text-zinc-600">
                Addon Info
              </p>
              <div className="space-y-1 text-[11px]">
                <div className="flex justify-between border-b border-white/[0.03] pb-1">
                  <span className="text-zinc-500">Version</span>
                  <span className="text-zinc-300">{info.addonVersion || 'Unknown'}</span>
                </div>
                <div className="flex justify-between border-b border-white/[0.03] pb-1">
                  <span className="text-zinc-500">WoW Version</span>
                  <span className="text-zinc-300">{info.wowVersion || 'Unknown'}</span>
                </div>
              </div>
            </div>
            <div>
              <p className="mb-1 text-[9px] font-black uppercase tracking-[0.2em] text-zinc-600">
                Sim Info
              </p>
              <div className="space-y-1 text-[11px]">
                <div className="flex justify-between border-b border-white/[0.03] pb-1">
                  <span className="text-zinc-500">Talent Blocks</span>
                  <span className="text-zinc-300">{info.talentsCount}</span>
                </div>
                <div className="flex justify-between border-b border-white/[0.03] pb-1">
                  <span className="text-zinc-500">Saved Loadouts</span>
                  <span className="text-zinc-300">{info.savedLoadouts}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            {info.professions && (
              <div>
                <p className="mb-1 text-[9px] font-black uppercase tracking-[0.2em] text-zinc-600">
                  Professions
                </p>
                <p className="text-[11px] leading-relaxed text-zinc-300">{info.professions}</p>
              </div>
            )}
            {info.checksum && (
              <div>
                <p className="mb-1 text-[9px] font-black uppercase tracking-[0.2em] text-zinc-600">
                  Verification
                </p>
                <div className="rounded border border-emerald-500/10 bg-emerald-500/5 px-2 py-1 font-mono text-[10px] text-emerald-400/80">
                  {info.checksum}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function DungeonInfoBar({
  info,
  onSave,
  onViewDetails,
  isSaving,
  isAlreadySaved,
}: {
  info: {
    title: string;
    dungeon: string | null;
    level: string | null;
    maxTime: string | null;
    pullCount: number | null;
    pulls: PullInfo[];
    extras: string[];
  };
  onSave?: () => void;
  onViewDetails?: () => void;
  isSaving?: boolean;
  isAlreadySaved?: boolean;
}) {
  const hasBloodlust = info.pulls.some((p) => p.bloodlust);

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-xl border border-white/5 bg-white/[0.03] transition-all hover:border-white/10 hover:bg-white/[0.05]">
      <div className="flex items-center gap-3 p-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-sky-500/10 bg-sky-500/5 text-sky-400 shadow-inner">
          <Map className="h-5 w-5" strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 overflow-hidden">
              <span className="truncate text-[15px] font-bold tracking-tight text-white">
                {info.dungeon || 'Unknown Dungeon'}
              </span>
              {info.level && (
                <span className="shrink-0 rounded bg-sky-500/10 px-1.5 py-0.5 font-mono text-[10px] font-black text-sky-400">
                  +{info.level}
                </span>
              )}
              {hasBloodlust && (
                <span
                  className="shrink-0 rounded bg-red-500/10 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-red-400"
                  title="Route includes Bloodlust/Heroism"
                >
                  BL
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onViewDetails?.();
                }}
                className="flex shrink-0 items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] font-bold text-zinc-300 transition-all hover:border-white/20 hover:bg-white/10 hover:text-white"
              >
                View Details
              </button>
              {onSave && (
                <button
                  onClick={onSave}
                  disabled={isSaving || isAlreadySaved}
                  className={`flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-bold transition-all ${
                    isAlreadySaved
                      ? 'cursor-default border-emerald-500/20 bg-emerald-500/5 text-emerald-400/80'
                      : 'border-white/10 bg-white/5 text-zinc-300 hover:border-white/20 hover:bg-white/10 hover:text-white disabled:opacity-50'
                  }`}
                >
                  {isSaving ? (
                    <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
                  ) : isAlreadySaved ? (
                    <Check className="h-3 w-3" strokeWidth={2} />
                  ) : (
                    <Download className="h-3 w-3" strokeWidth={2} />
                  )}
                  {isAlreadySaved ? 'Saved' : 'Save Route'}
                </button>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5 truncate text-[12px] font-medium text-zinc-500">
            <span>{info.title}</span>
            {info.maxTime && (
              <>
                <span className="mx-0.5 h-1 w-1 rounded-full bg-zinc-700" />
                <span className="flex items-center gap-1">
                  <Clock3 className="h-3 w-3" strokeWidth={2} />
                  {Math.round(Number(info.maxTime) / 60)}m
                </span>
              </>
            )}
            {info.pullCount && (
              <>
                <span className="mx-0.5 h-1 w-1 rounded-full bg-zinc-700" />
                <span>{info.pullCount} Pulls</span>
              </>
            )}
          </div>
        </div>
      </div>

      {info.extras.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t border-white/5 bg-black/20 px-4 py-2">
          {info.extras.map((extra) => (
            <span
              key={extra}
              className="text-[10px] font-bold uppercase tracking-wider text-zinc-500"
            >
              {extra}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function FightSetupOptions() {
  const {
    simcInput,
    simcFooter,
    customApl,
    fightStyle,
    setFightStyle,
    targetCount,
    setTargetCount,
    fightLength,
    setFightLength,
  } = useSimContext();
  const fightStyleRules = getFightStyleParamRules(fightStyle);
  const hasDungeonRouteInput = useMemo(() => {
    const footerInfo = parseCharacterInfo(simcFooter || '');
    if (footerInfo?.kind === 'dungeon') return true;
    const inputInfo = parseCharacterInfo(simcInput || '');
    return inputInfo?.kind === 'dungeon';
  }, [simcInput, simcFooter]);
  const allowedFightStyles = hasDungeonRouteInput
    ? ['DungeonRoute']
    : ['Patchwerk', 'CastingPatchwerk', 'HecticAddCleave', 'CleaveAdd', 'LightMovement', 'HeavyMovement', 'DungeonSlice', 'HelterSkelter'];

  useEffect(() => {
    if (hasDungeonRouteInput) {
      if (fightStyle !== 'DungeonRoute') setFightStyle('DungeonRoute');
      return;
    }
    if (fightStyle === 'DungeonRoute') setFightStyle('Patchwerk');
  }, [hasDungeonRouteInput, fightStyle, setFightStyle]);
  const showFightLength = fightStyleRules.usesFightLength;
  const showTargetCount = fightStyleRules.usesTargetCount;

  return (
    <div className="card space-y-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[15px] font-medium text-zinc-100">Fight Setup</p>
          <p className="text-[14px] text-zinc-300">
            Configure fight style and scenario variants together.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            const defaults = getAllAppDefaultOptions({
              characterKey: getCharacterDefaultsKeyFromSimcInput(simcInput),
            });
            setFightStyle(defaults['fight.fightStyle']);
            setFightLength(defaults['fight.fightLength']);
            setTargetCount(defaults['fight.targetCount']);
          }}
          className="rounded-md border border-gold/45 bg-gold/[0.12] px-2.5 py-1 text-[12px] font-semibold text-gold transition-colors hover:bg-gold/[0.2]"
        >
          Apply Defaults
        </button>
      </div>

      <div
        className={`grid gap-4 ${
          showFightLength && showTargetCount
            ? 'grid-cols-3'
            : showFightLength || showTargetCount
              ? 'grid-cols-2'
              : 'grid-cols-1'
        }`}
      >
        <div className="space-y-2">
          <label className="label-text">Fight Style</label>
            <FightStyleSelector
              value={fightStyle}
              onChange={setFightStyle}
              allowedValues={allowedFightStyles}
            />
        </div>

        {showFightLength && (
          <div className="space-y-2">
            <label className="label-text">Fight Length</label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={30}
                max={600}
                step={30}
                value={fightLength}
                onChange={(e) => setFightLength(Number(e.target.value))}
                className="flex-1 accent-gold"
              />
              <span className="w-16 text-right font-mono text-sm tabular-nums text-white">
                {Math.floor(fightLength / 60)}:{String(fightLength % 60).padStart(2, '0')}
              </span>
            </div>
          </div>
        )}

        {showTargetCount && (
          <div className="space-y-2">
            <label className="label-text">Number of Bosses</label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={1}
                max={10}
                value={targetCount}
                onChange={(e) => setTargetCount(Number(e.target.value))}
                className="flex-1 accent-gold"
              />
              <span className="w-6 text-right font-mono text-sm tabular-nums text-white">
                {targetCount}
              </span>
            </div>
          </div>
        )}

        {!showFightLength && !showTargetCount && (
          <div className="text-[14px] text-zinc-300">
            This fight style uses built-in timing and target scripting.
          </div>
        )}
      </div>

      <ScenarioBuilder />
    </div>
  );
}

export function ConsumablesAndRaidBuffsOptions() {
  const collapseStorageKey = 'whylowdps_consumables_raid_buffs_collapsed';
  const pathname = usePathname();
  const multiSelectAllowed =
    pathname.startsWith('/top-gear') ||
    pathname.startsWith('/analysis/consumable-matrix') ||
    pathname.startsWith('/drop-finder');
  const {
    simcInput,
    simcFooter,
    customApl,
    externalBuffChaosBrand,
    setExternalBuffChaosBrand,
    externalBuffMysticTouch,
    setExternalBuffMysticTouch,
    externalBuffSkyfury,
    setExternalBuffSkyfury,
    externalBuffPowerInfusion,
    setExternalBuffPowerInfusion,
    raidBuffBloodlust,
    setRaidBuffBloodlust,
    raidBuffArcaneIntellect,
    setRaidBuffArcaneIntellect,
    raidBuffPowerWordFortitude,
    setRaidBuffPowerWordFortitude,
    raidBuffMarkOfTheWild,
    setRaidBuffMarkOfTheWild,
    raidBuffBattleShout,
    setRaidBuffBattleShout,
    raidBuffHuntersMark,
    setRaidBuffHuntersMark,
    raidBuffBleeding,
    setRaidBuffBleeding,
    consumableFlask,
    setConsumableFlask,
    consumableFood,
    setConsumableFood,
    consumablePotion,
    setConsumablePotion,
    consumableAugmentation,
    setConsumableAugmentation,
    consumableTemporaryEnchant,
    setConsumableTemporaryEnchant,
    lockSingleConsumableOptions,
  } = useSimContext();

  const { flasks, foods, potions, augments, tempEnchants } = useConsumableOptions(11);
  const qualityMaxByFamily = useMemo(
    () => buildQualityMaxByFamily([flasks, potions, augments, tempEnchants]),
    [flasks, potions, augments, tempEnchants]
  );
  const raidBuffBindings: Record<string, { checked: boolean; setChecked: (v: boolean) => void }> = {
    bloodlust: { checked: raidBuffBloodlust, setChecked: setRaidBuffBloodlust },
    arcane_intellect: { checked: raidBuffArcaneIntellect, setChecked: setRaidBuffArcaneIntellect },
    power_word_fortitude: {
      checked: raidBuffPowerWordFortitude,
      setChecked: setRaidBuffPowerWordFortitude,
    },
    mark_of_the_wild: { checked: raidBuffMarkOfTheWild, setChecked: setRaidBuffMarkOfTheWild },
    battle_shout: { checked: raidBuffBattleShout, setChecked: setRaidBuffBattleShout },
    hunters_mark: { checked: raidBuffHuntersMark, setChecked: setRaidBuffHuntersMark },
    bleeding: { checked: raidBuffBleeding, setChecked: setRaidBuffBleeding },
    mystic_touch: { checked: externalBuffMysticTouch, setChecked: setExternalBuffMysticTouch },
    chaos_brand: { checked: externalBuffChaosBrand, setChecked: setExternalBuffChaosBrand },
    skyfury: { checked: externalBuffSkyfury, setChecked: setExternalBuffSkyfury },
    power_infusion: {
      checked: externalBuffPowerInfusion,
      setChecked: setExternalBuffPowerInfusion,
    },
  };
  const [buffSource, setBuffSource] = useState<Record<string, 'default' | 'manual' | 'override'>>({});
  const arraysEqual = (a: string[], b: string[]) =>
    a.length === b.length && a.every((v, i) => v === b[i]);
  const readStoredTokens = (key: string): string[] => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : [];
    } catch {
      return [];
    }
  };
  const [multiConsumableMode, setMultiConsumableMode] = useState(() => {
    try {
      return localStorage.getItem('whylowdps_multi_consumables_enabled') === 'true';
    } catch {
      return false;
    }
  });
  const [isCollapsed, setIsCollapsed] = useState(() => {
    try {
      return localStorage.getItem(collapseStorageKey) === 'true';
    } catch {
      return false;
    }
  });
  const [matrixFlasks, setMatrixFlasks] = useState<string[]>(() => readStoredTokens('whylowdps_matrix_flasks'));
  const [matrixFoods, setMatrixFoods] = useState<string[]>(() => readStoredTokens('whylowdps_matrix_foods'));
  const [matrixPotions, setMatrixPotions] = useState<string[]>(() => readStoredTokens('whylowdps_matrix_potions'));
  const [matrixAugments, setMatrixAugments] = useState<string[]>(() => readStoredTokens('whylowdps_matrix_augments'));
  const [matrixTempEnchants, setMatrixTempEnchants] = useState<string[]>(() => readStoredTokens('whylowdps_matrix_temp_enchants'));
  useEffect(() => {
    const rehydrate = () => {
      try {
        const nextEnabled = localStorage.getItem('whylowdps_multi_consumables_enabled') === 'true';
        setMultiConsumableMode((prev) => (prev === nextEnabled ? prev : nextEnabled));
      } catch {}
      const nextFlasks = readStoredTokens('whylowdps_matrix_flasks');
      const nextFoods = readStoredTokens('whylowdps_matrix_foods');
      const nextPotions = readStoredTokens('whylowdps_matrix_potions');
      const nextAugments = readStoredTokens('whylowdps_matrix_augments');
      const nextTempEnchants = readStoredTokens('whylowdps_matrix_temp_enchants');
      setMatrixFlasks((prev) => (arraysEqual(prev, nextFlasks) ? prev : nextFlasks));
      setMatrixFoods((prev) => (arraysEqual(prev, nextFoods) ? prev : nextFoods));
      setMatrixPotions((prev) => (arraysEqual(prev, nextPotions) ? prev : nextPotions));
      setMatrixAugments((prev) => (arraysEqual(prev, nextAugments) ? prev : nextAugments));
      setMatrixTempEnchants((prev) =>
        arraysEqual(prev, nextTempEnchants) ? prev : nextTempEnchants
      );
    };
    window.addEventListener('whylowdps-consumables-matrix-changed', rehydrate);
    return () => window.removeEventListener('whylowdps-consumables-matrix-changed', rehydrate);
  }, []);
  useEffect(() => {
    if (!multiSelectAllowed && multiConsumableMode) {
      setMultiConsumableMode(false);
    }
  }, [multiSelectAllowed, multiConsumableMode]);

  useEffect(() => {
    try {
      localStorage.setItem('whylowdps_multi_consumables_enabled', String(multiConsumableMode));
      localStorage.setItem('whylowdps_matrix_flasks', JSON.stringify(matrixFlasks));
      localStorage.setItem('whylowdps_matrix_foods', JSON.stringify(matrixFoods));
      localStorage.setItem('whylowdps_matrix_potions', JSON.stringify(matrixPotions));
      localStorage.setItem('whylowdps_matrix_augments', JSON.stringify(matrixAugments));
      localStorage.setItem('whylowdps_matrix_temp_enchants', JSON.stringify(matrixTempEnchants));
    } catch {}
  }, [
    multiConsumableMode,
    matrixFlasks,
    matrixFoods,
    matrixPotions,
    matrixAugments,
    matrixTempEnchants,
  ]);

  useEffect(() => {
    const allowed = (options: { token?: string; key: string }[]) =>
      new Set(options.map((opt) => opt.token || opt.key).filter(Boolean));
    const prune = (values: string[], options: { token?: string; key: string }[]) => {
      if (!options.length) return values;
      const allowedTokens = allowed(options);
      return values.filter((value) => allowedTokens.has(value));
    };
    const clearStaleSingle = (
      value: string,
      options: { token?: string; key: string }[],
      setValue: (next: string) => void
    ) => {
      if (!value || !options.length) return;
      if (!allowed(options).has(value)) setValue('');
    };

    setMatrixFlasks((prev) => {
      const next = prune(prev, flasks);
      return arraysEqual(prev, next) ? prev : next;
    });
    setMatrixFoods((prev) => {
      const next = prune(prev, foods);
      return arraysEqual(prev, next) ? prev : next;
    });
    setMatrixPotions((prev) => {
      const next = prune(prev, potions);
      return arraysEqual(prev, next) ? prev : next;
    });
    setMatrixAugments((prev) => {
      const next = prune(prev, augments);
      return arraysEqual(prev, next) ? prev : next;
    });
    setMatrixTempEnchants((prev) => {
      const next = prune(prev, tempEnchants);
      return arraysEqual(prev, next) ? prev : next;
    });

    if (!lockSingleConsumableOptions) {
      clearStaleSingle(consumableFlask, flasks, setConsumableFlask);
      clearStaleSingle(consumableFood, foods, setConsumableFood);
      clearStaleSingle(consumablePotion, potions, setConsumablePotion);
      clearStaleSingle(consumableAugmentation, augments, setConsumableAugmentation);
      clearStaleSingle(
        consumableTemporaryEnchant,
        tempEnchants,
        setConsumableTemporaryEnchant
      );
    }
  }, [
    flasks,
    foods,
    potions,
    augments,
    tempEnchants,
    consumableFlask,
    consumableFood,
    consumablePotion,
    consumableAugmentation,
    consumableTemporaryEnchant,
    lockSingleConsumableOptions,
    setConsumableFlask,
    setConsumableFood,
    setConsumablePotion,
    setConsumableAugmentation,
    setConsumableTemporaryEnchant,
  ]);
  useEffect(() => {
    try {
      localStorage.setItem(collapseStorageKey, String(isCollapsed));
    } catch {}
  }, [collapseStorageKey, isCollapsed]);


  const setBuffManual = (key: string, value: boolean) => {
    const binding = raidBuffBindings[key];
    if (!binding) return;
    binding.setChecked(value);
    setBuffSource((prev) => ({ ...prev, [key]: 'manual' }));
  };

  useEffect(() => {
    const combined = `${simcInput || ''}\n${simcFooter || ''}\n${customApl || ''}`;
    if (!combined.trim()) return;
    const overrideMap: Record<string, boolean> = {};
    const re = /^\s*override\.([a-z0-9_]+)\s*=\s*([01])\s*$/gim;
    let match: RegExpExecArray | null;
    while ((match = re.exec(combined)) !== null) {
      overrideMap[match[1].toLowerCase()] = match[2] === '1';
    }
    for (const [key, value] of Object.entries(overrideMap)) {
      const binding = raidBuffBindings[key];
      if (binding) {
        binding.setChecked(value);
        setBuffSource((prev) => ({ ...prev, [key]: 'override' }));
      }
    }
    // Any previously overridden buff that no longer has override in SimC falls back to manual source.
    setBuffSource((prev) => {
      const next = { ...prev };
      for (const key of Object.keys(next)) {
        if (next[key] === 'override' && !(key in overrideMap)) next[key] = 'manual';
      }
      return next;
    });
  }, [simcInput, simcFooter, customApl]);

  useWowheadTooltips([
    externalBuffChaosBrand,
    externalBuffMysticTouch,
    externalBuffSkyfury,
    externalBuffPowerInfusion,
    raidBuffBloodlust,
    raidBuffArcaneIntellect,
    raidBuffPowerWordFortitude,
    raidBuffMarkOfTheWild,
    raidBuffBattleShout,
    raidBuffHuntersMark,
    raidBuffBleeding,
    consumableFlask,
    consumablePotion,
    consumableAugmentation,
    consumableTemporaryEnchant,
    consumableFood,
  ]);

  if (lockSingleConsumableOptions) {
    return null;
  }

  const selectedConsumableCount = multiConsumableMode
    ? [
        matrixFlasks.length,
        matrixPotions.length,
        matrixAugments.length,
        matrixTempEnchants.length,
        matrixFoods.length,
      ].filter((count) => count > 0).length
    : [
        consumableFlask,
        consumablePotion,
        consumableAugmentation,
        consumableTemporaryEnchant,
        consumableFood,
      ].filter(Boolean).length;
  const enabledRaidBuffCount = Object.values(raidBuffBindings).filter((binding) => binding.checked).length;
  const collapsedSummary = `${selectedConsumableCount} consumable categories set - ${enabledRaidBuffCount} raid buffs enabled`;

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-medium text-zinc-100">Consumables &amp; Raid Buffs</p>
          <p className="text-[14px] text-zinc-300">
            Manage consumable picks and raid buff assumptions outside of Advanced Options.
          </p>
          {isCollapsed && (
            <p className="mt-3 text-[13px] font-medium text-gold">{collapsedSummary}</p>
          )}
        </div>
        <div className="flex shrink-0 items-start gap-2">
          <button
            type="button"
            onClick={() => {
              const defaults = getAllAppDefaultOptions({
                characterKey: getCharacterDefaultsKeyFromSimcInput(simcInput),
              });
              setConsumableFlask(defaults['consumable.flask']);
              setConsumableFood(defaults['consumable.food']);
              setConsumablePotion(defaults['consumable.potion']);
              setConsumableAugmentation(defaults['consumable.augmentation']);
              setConsumableTemporaryEnchant(defaults['consumable.temporaryEnchant']);
              setRaidBuffBloodlust(defaults['raid.bloodlust']);
              setRaidBuffArcaneIntellect(defaults['raid.arcaneIntellect']);
              setRaidBuffPowerWordFortitude(defaults['raid.powerWordFortitude']);
              setRaidBuffMarkOfTheWild(defaults['raid.markOfTheWild']);
              setRaidBuffBattleShout(defaults['raid.battleShout']);
              setRaidBuffHuntersMark(defaults['raid.huntersMark']);
              setRaidBuffBleeding(defaults['raid.bleeding']);
              setExternalBuffMysticTouch(defaults['raid.mysticTouch']);
              setExternalBuffChaosBrand(defaults['raid.chaosBrand']);
              setExternalBuffSkyfury(defaults['raid.skyfury']);
              setExternalBuffPowerInfusion(defaults['raid.powerInfusion']);
              setBuffSource({
                bloodlust: 'default',
                arcane_intellect: 'default',
                power_word_fortitude: 'default',
                mark_of_the_wild: 'default',
                battle_shout: 'default',
                hunters_mark: 'default',
                bleeding: 'default',
                mystic_touch: 'default',
                chaos_brand: 'default',
                skyfury: 'default',
                power_infusion: 'default',
              });
            }}
            className="rounded-md border border-gold/45 bg-gold/[0.12] px-2.5 py-1 text-[12px] font-semibold text-gold transition-colors hover:bg-gold/[0.2]"
          >
            Apply Defaults
          </button>
          <button
            type="button"
            onClick={() => setIsCollapsed((prev) => !prev)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface-2 text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white"
            aria-expanded={!isCollapsed}
            aria-label={isCollapsed ? 'Expand consumables and raid buffs' : 'Collapse consumables and raid buffs'}
            title={isCollapsed ? 'Expand' : 'Collapse'}
          >
            <svg
              viewBox="0 0 16 16"
              className={`h-3.5 w-3.5 transition-transform duration-200 ${isCollapsed ? '' : 'rotate-180'}`}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 6l4 4 4-4" />
            </svg>
          </button>
        </div>
      </div>

      <div
        className={`grid transition-[grid-template-rows,opacity,margin] duration-300 ease-out ${
          isCollapsed ? 'mt-0 grid-rows-[0fr] opacity-0' : 'mt-5 grid-rows-[1fr] opacity-100'
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="space-y-5 pt-1">
            <div className="space-y-3 rounded-lg border border-border/70 bg-surface-2/70 p-3.5">
              <div>
                <p className="text-[15px] font-medium text-zinc-100">Consumables</p>
                <p className="text-[14px] text-zinc-300">
                  Select one per category for normal sims. Use Stat Weights matrix to compare many at
                  once.
                </p>
              </div>
              {multiSelectAllowed && (
                <ToggleOptionCard
                  checked={multiConsumableMode}
                  onToggle={() => {
                    setMultiConsumableMode((v) => !v);
                  }}
                  title="Multi-select"
                  description="Enable selecting several options and tiers per category."
                />
              )}
              <div className="grid gap-3 lg:grid-cols-2">
                <ConsumablePicker
                  title="Flask"
                  label="Active Flask"
                  mode={multiConsumableMode ? 'multi' : 'single'}
                  singleValue={consumableFlask}
                  onSingleChange={setConsumableFlask}
                  multiValues={matrixFlasks}
                  onMultiChange={setMatrixFlasks}
                  options={flasks}
                  disabled={lockSingleConsumableOptions}
                />

                <ConsumablePicker
                  title="Potion"
                  label="Active Potion"
                  mode={multiConsumableMode ? 'multi' : 'single'}
                  singleValue={consumablePotion}
                  onSingleChange={setConsumablePotion}
                  multiValues={matrixPotions}
                  onMultiChange={setMatrixPotions}
                  options={potions}
                  disabled={lockSingleConsumableOptions}
                />

                <ConsumablePicker
                  title="Augmentation Rune"
                  label="Active Augmentation Rune"
                  mode={multiConsumableMode ? 'multi' : 'single'}
                  singleValue={consumableAugmentation}
                  onSingleChange={setConsumableAugmentation}
                  multiValues={matrixAugments}
                  onMultiChange={setMatrixAugments}
                  options={augments}
                  disabled={lockSingleConsumableOptions}
                />

                <ConsumablePicker
                  title="Temporary Enchant"
                  label="Main Hand Temporary Enchant"
                  mode={multiConsumableMode ? 'multi' : 'single'}
                  singleValue={consumableTemporaryEnchant}
                  onSingleChange={setConsumableTemporaryEnchant}
                  multiValues={matrixTempEnchants}
                  onMultiChange={setMatrixTempEnchants}
                  options={tempEnchants}
                  disabled={lockSingleConsumableOptions}
                />

                <ConsumablePicker
                  title="Food"
                  label="Active Food Buff"
                  mode={multiConsumableMode ? 'multi' : 'single'}
                  singleValue={consumableFood}
                  onSingleChange={setConsumableFood}
                  multiValues={matrixFoods}
                  onMultiChange={setMatrixFoods}
                  options={foods}
                  disabled={lockSingleConsumableOptions}
                />
              </div>
            </div>

            <div className="space-y-3 rounded-lg border border-border/70 bg-surface-2/70 p-3.5">
              <div>
                <p className="text-[15px] font-medium text-zinc-100">Raid Buffs</p>
                <p className="text-[14px] text-zinc-300">
                  Control default raid buffs for normal sims.
                </p>
              </div>
              <RaidBuffGrid
                entries={RAID_BUFF_MATRIX_OPTIONS.map((buff) => {
                  const binding = raidBuffBindings[buff.key] || {
                    checked: false,
                    setChecked: (_: boolean) => {},
                  };
                  return {
                    id: buff.key,
                    label: buff.label,
                    sourceLabel: buffSource[buff.key] || 'manual',
                    disabled: buffSource[buff.key] === 'override',
                    spellId: buff.spellId || 0,
                    icon: buff.icon,
                    checked: binding.checked,
                    onChange: (checked: boolean) => setBuffManual(buff.key, checked),
                  };
                })}
                onSelectAll={() => {
                  Object.entries(raidBuffBindings).forEach(([key, b]) => {
                    b.setChecked(true);
                    setBuffSource((prev) => ({ ...prev, [key]: 'manual' }));
                  });
                }}
                onClear={() => {
                  Object.entries(raidBuffBindings).forEach(([key, b]) => {
                    b.setChecked(false);
                    setBuffSource((prev) => ({ ...prev, [key]: 'manual' }));
                  });
                }}
              />
              <p className="text-[12px] text-zinc-300">
                If your character provides one of these buffs, SimC may still include it.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AdvancedOptions() {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<ExpertTabKey>('footer');
  const {
    customApl,
    setCustomApl,
    includeTimeline,
    setIncludeTimeline,
    simcHeader,
    setSimcHeader,
    simcBasePlayer,
    setSimcBasePlayer,
    simcRaidActors,
    setSimcRaidActors,
    simcPostCombos,
    setSimcPostCombos,
    simcFooter,
    setSimcFooter,
  } = useSimContext();

  const expertValues: Record<ExpertTabKey, string> = useMemo(
    () => ({
      header: simcHeader,
      base_player: simcBasePlayer,
      raid_actors: simcRaidActors,
      post_combos: simcPostCombos,
      footer: simcFooter,
    }),
    [simcHeader, simcBasePlayer, simcRaidActors, simcPostCombos, simcFooter]
  );

  const expertSetters: Record<ExpertTabKey, (v: string) => void> = useMemo(
    () => ({
      header: setSimcHeader,
      base_player: setSimcBasePlayer,
      raid_actors: setSimcRaidActors,
      post_combos: setSimcPostCombos,
      footer: setSimcFooter,
    }),
    [setSimcHeader, setSimcBasePlayer, setSimcRaidActors, setSimcPostCombos, setSimcFooter]
  );

  const hasExpertContent = Object.values(expertValues).some((v) => v.trim());
  const isDefault = includeTimeline && !customApl && !hasExpertContent;
  const activeTabInfo = EXPERT_TABS.find((t) => t.key === activeTab)!;

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <SlidersHorizontal className="h-4 w-4 text-zinc-400" strokeWidth={1.5} />
          <span className="text-[15px] font-medium text-zinc-100">Advanced Options</span>
          {!open && !isDefault && (
            <span className="rounded-md bg-gold/10 px-1.5 py-0.5 text-[12px] font-medium text-gold">
              Modified
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface-2 text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white"
          aria-expanded={open}
          aria-label={open ? 'Collapse advanced options' : 'Expand advanced options'}
          title={open ? 'Collapse' : 'Expand'}
        >
          <svg
            viewBox="0 0 16 16"
            className={`h-3.5 w-3.5 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 6l4 4 4-4" />
          </svg>
        </button>
      </div>
      {open && (
        <div className="animate-fade-in space-y-5 border-t border-border px-5 pb-5">
          <div className="pt-4" />

          {/* Custom APL */}
          <div className="space-y-2">
            <label className="label-text">Custom APL / SimC Options</label>
            <textarea
              value={customApl}
              onChange={(e) => setCustomApl(e.target.value)}
              placeholder="Custom APL or expansion options (e.g., actions=..., midnight.*, use_blizzard_action_list=1)..."
              className="input-field h-28 resize-y font-mono text-[14px] leading-relaxed"
            />
            <p className="text-[14px] text-zinc-300">
              Override action priority lists or set expansion-specific options. Injected after the
              base actor.
            </p>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border/70 bg-surface-2/70 px-3.5 py-2.5">
            <div>
              <p className="text-[15px] font-medium text-zinc-100">Timeline &amp; APL Analyzer</p>
              <p className="text-[14px] text-zinc-300">
                Include action sequence, cooldown timing, and buff uptime data in sim results.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIncludeTimeline(!includeTimeline)}
              className={`relative h-5 w-9 rounded-full transition-colors ${
                includeTimeline ? 'bg-gold' : 'border border-border bg-surface'
              }`}
            >
              <span
                className={`absolute top-0.5 h-4 w-4 rounded-full transition-all ${
                  includeTimeline ? 'left-[18px] bg-black' : 'left-0.5 bg-gray-500'
                }`}
              />
            </button>
          </div>

          {/* Expert Mode */}
          <ExpertToggle
            hasContent={hasExpertContent}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            expertValues={expertValues}
            expertSetters={expertSetters}
            activeTabInfo={activeTabInfo}
          />
        </div>
      )}
    </div>
  );
}

function ExpertToggle({
  hasContent,
  activeTab,
  setActiveTab,
  expertValues,
  expertSetters,
  activeTabInfo,
}: {
  hasContent: boolean;
  activeTab: ExpertTabKey;
  setActiveTab: (v: ExpertTabKey) => void;
  expertValues: Record<ExpertTabKey, string>;
  expertSetters: Record<ExpertTabKey, (v: string) => void>;
  activeTabInfo: (typeof EXPERT_TABS)[number];
}) {
  const [open, setOpen] = useState(hasContent);

  return (
    <div className="space-y-3 border-t border-border/60 pt-3">
      <button type="button" onClick={() => setOpen(!open)} className="flex items-center gap-2.5">
        <div
          className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
            open ? 'bg-gold' : 'border border-border bg-surface-2'
          }`}
        >
          <div
            className={`absolute top-0.5 h-4 w-4 rounded-full transition-all ${
              open ? 'left-[18px] bg-black' : 'left-0.5 bg-gray-500'
            }`}
          />
        </div>
        <span className="text-[15px] font-medium text-zinc-100">Expert Mode</span>
        {!open && hasContent && (
          <span className="rounded-md bg-gold/10 px-1.5 py-0.5 text-xs font-medium text-gold">
            Modified
          </span>
        )}
      </button>
      {open && (
        <div className="space-y-3">
          <div className="flex gap-1 overflow-x-auto">
            {EXPERT_TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`whitespace-nowrap rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-all duration-150 ${
                  activeTab === tab.key
                    ? 'border-gold/40 bg-gold/[0.08] text-gold'
                    : expertValues[tab.key].trim()
                      ? 'border-gold/30 bg-gold/[0.06] text-gold hover:border-gold/50'
                      : 'border-border bg-surface-2 text-zinc-200 hover:border-zinc-500 hover:text-white'
                }`}
              >
                {tab.label}
                {expertValues[tab.key].trim() && activeTab !== tab.key && (
                  <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-gold" />
                )}
              </button>
            ))}
          </div>
          <textarea
            value={expertValues[activeTab]}
            onChange={(e) => expertSetters[activeTab](e.target.value)}
            placeholder={`Paste ${activeTabInfo.label.toLowerCase()} SimC input here...`}
            className="input-field h-32 resize-y font-mono text-[14px] leading-relaxed"
          />
          <p className="text-[14px] text-zinc-200">{activeTabInfo.desc}</p>
        </div>
      )}
    </div>
  );
}
