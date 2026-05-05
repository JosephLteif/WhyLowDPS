'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useSimContext } from './SimContext';
import FightStyleSelector from './FightStyleSelector';
import ScenarioBuilder from './ScenarioBuilder';
import { CLASS_COLORS, specDisplayName } from '../lib/types';
import type { PullInfo } from '@/lib/simc-parser';
import { getFightStyleParamRules } from '../lib/fight-style';
import { useWowheadTooltips } from '../lib/useWowheadTooltips';
import { useConsumableOptions } from '../lib/useConsumableOptions';
import { RAID_BUFF_MATRIX_OPTIONS } from '../lib/sim-options-catalog';
import {
  getAllAppDefaultOptions,
  getCharacterDefaultsKeyFromSimcInput,
} from '../lib/default-options';
import ConsumableSelect, { buildQualityMaxByFamily } from './shared/ConsumableSelect';
import RaidBuffGrid from './shared/RaidBuffGrid';

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
            <svg
              className={`h-4 w-4 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2.5}
                d="M19 9l-7 7-7-7"
              />
            </svg>
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
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L16 4m0 13V4m0 0L9 7"
            />
          </svg>
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
                    <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24">
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                        fill="none"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                  ) : isAlreadySaved ? (
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  ) : (
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"
                      />
                    </svg>
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
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
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
    fightStyle,
    setFightStyle,
    targetCount,
    setTargetCount,
    fightLength,
    setFightLength,
  } = useSimContext();
  const fightStyleRules = getFightStyleParamRules(fightStyle);
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
          <FightStyleSelector value={fightStyle} onChange={setFightStyle} />
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
  const {
    simcInput,
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

  return (
    <div className="card space-y-5 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[15px] font-medium text-zinc-100">Consumables &amp; Raid Buffs</p>
          <p className="text-[14px] text-zinc-300">
            Manage consumable picks and raid buff assumptions outside of Advanced Options.
          </p>
        </div>
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
          }}
          className="rounded-md border border-gold/45 bg-gold/[0.12] px-2.5 py-1 text-[12px] font-semibold text-gold transition-colors hover:bg-gold/[0.2]"
        >
          Apply Defaults
        </button>
      </div>

      <div className="space-y-3 rounded-lg border border-border/70 bg-surface-2/70 p-3.5">
        <div>
          <p className="text-[15px] font-medium text-zinc-100">Consumables</p>
          <p className="text-[14px] text-zinc-300">
            Select one per category for normal sims. Use Stat Weights matrix to compare many at
            once.
          </p>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="space-y-2 rounded-md border border-border/70 bg-surface p-2.5">
            <p className="text-[13px] font-semibold uppercase tracking-wider text-zinc-300">
              Flask
            </p>
            <ConsumableSelect
              label="Active Flask"
              value={consumableFlask}
              onChange={setConsumableFlask}
              options={flasks}
              qualityMaxByFamily={qualityMaxByFamily}
              disabled={lockSingleConsumableOptions}
            />
          </div>

          <div className="space-y-2 rounded-md border border-border/70 bg-surface p-2.5">
            <p className="text-[13px] font-semibold uppercase tracking-wider text-zinc-300">
              Potion
            </p>
            <ConsumableSelect
              label="Active Potion"
              value={consumablePotion}
              onChange={setConsumablePotion}
              options={potions}
              qualityMaxByFamily={qualityMaxByFamily}
              disabled={lockSingleConsumableOptions}
            />
          </div>

          <div className="space-y-2 rounded-md border border-border/70 bg-surface p-2.5">
            <p className="text-[13px] font-semibold uppercase tracking-wider text-zinc-300">
              Augmentation Rune
            </p>
            <ConsumableSelect
              label="Active Augmentation Rune"
              value={consumableAugmentation}
              onChange={setConsumableAugmentation}
              options={augments}
              qualityMaxByFamily={qualityMaxByFamily}
              disabled={lockSingleConsumableOptions}
            />
          </div>

          <div className="space-y-2 rounded-md border border-border/70 bg-surface p-2.5">
            <p className="text-[13px] font-semibold uppercase tracking-wider text-zinc-300">
              Temporary Enchant
            </p>
            <ConsumableSelect
              label="Main Hand Temporary Enchant"
              value={consumableTemporaryEnchant}
              onChange={setConsumableTemporaryEnchant}
              options={tempEnchants}
              qualityMaxByFamily={qualityMaxByFamily}
              disabled={lockSingleConsumableOptions}
            />
          </div>

          <div className="space-y-2 rounded-md border border-border/70 bg-surface p-2.5">
            <p className="text-[13px] font-semibold uppercase tracking-wider text-zinc-300">Food</p>
            <ConsumableSelect
              label="Active Food Buff"
              value={consumableFood}
              onChange={setConsumableFood}
              options={foods}
              qualityMaxByFamily={qualityMaxByFamily}
              disabled={lockSingleConsumableOptions}
            />
          </div>
        </div>
      </div>

      <div className="space-y-3 rounded-lg border border-border/70 bg-surface-2/70 p-3.5">
        <div>
          <p className="text-[15px] font-medium text-zinc-100">Raid Buffs</p>
          <p className="text-[14px] text-zinc-300">Control default raid buffs for normal sims.</p>
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
              spellId: buff.spellId || 0,
              icon: buff.icon,
              checked: binding.checked,
              onChange: binding.setChecked,
            };
          })}
          onSelectAll={() => {
            Object.values(raidBuffBindings).forEach((b) => b.setChecked(true));
          }}
          onClear={() => {
            Object.values(raidBuffBindings).forEach((b) => b.setChecked(false));
          }}
        />
        <p className="text-[12px] text-zinc-300">
          If your character provides one of these buffs, SimC may still include it.
        </p>
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
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-5 py-3.5 transition-colors hover:bg-white/[0.02]"
      >
        <div className="flex items-center gap-2.5">
          <svg
            className="h-4 w-4 text-zinc-400"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="8" cy="8" r="2" />
            <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" />
          </svg>
          <span className="text-[15px] font-medium text-zinc-100">Advanced Options</span>
          {!open && !isDefault && (
            <span className="rounded-md bg-gold/10 px-1.5 py-0.5 text-[12px] font-medium text-gold">
              Modified
            </span>
          )}
        </div>
        <svg
          className={`h-3.5 w-3.5 text-zinc-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>
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



