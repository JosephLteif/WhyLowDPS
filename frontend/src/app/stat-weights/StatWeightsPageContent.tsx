'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import ErrorAlert from '../components/ErrorAlert';
import { useSimContext } from '../components/SimContext';
import SimReturnNotice from '../components/shared/SimReturnNotice';
import { useSimSubmit } from '../lib/useSimSubmit';
import { useWowheadTooltips } from '../lib/useWowheadTooltips';
import { useItemIcons, useSpellIcons } from '../lib/useWowheadIcons';
import { useConsumableOptions } from '../lib/useConsumableOptions';
import { OptionEntry, RAID_BUFF_MATRIX_OPTIONS } from '../lib/sim-options-catalog';
import { consumeSimAgainState, consumeSimReturnNotice, type SimReturnNotice as SimReturnNoticeType } from '../lib/sim-return';

const PLOT_STATS = [
  { value: 'haste_rating', label: 'Haste' },
  { value: 'crit_rating', label: 'Critical Strike' },
  { value: 'mastery_rating', label: 'Mastery' },
  { value: 'versatility_rating', label: 'Versatility' },
  { value: 'intellect', label: 'Intellect' },
  { value: 'agility', label: 'Agility' },
  { value: 'strength', label: 'Strength' },
];

const STAT_WEIGHTS_SIM_AGAIN_KEY = 'stat-weights';
export type StatWeightsMode = 'stat_weights' | 'stat_plot' | 'consumable_matrix' | 'tier_heatmap';

interface StatWeightsSimAgainState {
  mode?: StatWeightsMode;
  plotStats?: string[];
  plotRange?: number;
  plotStep?: number;
  plotIterations?: number;
  matrixFlasks?: string[];
  matrixFoods?: string[];
  matrixPotions?: string[];
  matrixAugments?: string[];
  matrixTempEnchants?: string[];
  matrixRaidBuffs?: string[];
}

function toggleListValue(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

function uniqueTokens(options: OptionEntry[]): string[] {
  return Array.from(new Set(options.map((o) => o.token || '').filter(Boolean)));
}

function optionLabel(opt: OptionEntry) {
  return (opt.label || '').replace(/\s*\(Quality\s*[1-3]\)\s*$/i, '').replace(/\s+[1-3]\s*$/i, '');
}

function optionQualityFamily(opt: OptionEntry) {
  const token = (opt.token || opt.key || '').replace(/^main_hand:/, '');
  return token.replace(/_[1-3]$/i, '');
}

function remapQuality(quality: number | undefined, familyMax: number | undefined) {
  if (!quality || quality < 1 || quality > 3) return undefined;
  if (familyMax === 2) {
    if (quality === 1) return 2;
    if (quality === 2) return 3;
  }
  return quality;
}

interface StatWeightsPageContentProps {
  forcedMode?: StatWeightsMode;
}

export function StatWeightsPageContent({ forcedMode }: StatWeightsPageContentProps = {}) {
  const { simcInput, setLockSingleConsumableOptions } = useSimContext();
  const { flasks, foods, potions, augments, tempEnchants } = useConsumableOptions(11);

  const [mode, setMode] = useState<StatWeightsMode>(forcedMode ?? 'stat_weights');

  const [plotStats, setPlotStats] = useState<string[]>([
    'haste_rating',
    'crit_rating',
    'mastery_rating',
  ]);
  const [plotRange, setPlotRange] = useState(1000);
  const [plotStep, setPlotStep] = useState(100);
  const [plotIterations, setPlotIterations] = useState(2000);

  const [matrixFlasks, setMatrixFlasks] = useState<string[]>(uniqueTokens(flasks));
  const [matrixFoods, setMatrixFoods] = useState<string[]>(uniqueTokens(foods));
  const [matrixPotions, setMatrixPotions] = useState<string[]>(uniqueTokens(potions));
  const [matrixAugments, setMatrixAugments] = useState<string[]>(uniqueTokens(augments));
  const [matrixTempEnchants, setMatrixTempEnchants] = useState<string[]>(
    uniqueTokens(tempEnchants)
  );
  const [matrixRaidBuffs, setMatrixRaidBuffs] = useState<string[]>(
    RAID_BUFF_MATRIX_OPTIONS.map((o) => o.key)
  );
  const [returnNotice, setReturnNotice] = useState<SimReturnNoticeType | null>(null);

  useEffect(() => {
    if (forcedMode) {
      setMode(forcedMode);
      return;
    }
    const restored = consumeSimAgainState<StatWeightsSimAgainState>(STAT_WEIGHTS_SIM_AGAIN_KEY);
    const notice = consumeSimReturnNotice(STAT_WEIGHTS_SIM_AGAIN_KEY);
    if (notice) setReturnNotice(notice);
    if (!restored) return;
    if (
      restored.mode === 'stat_weights' ||
      restored.mode === 'stat_plot' ||
      restored.mode === 'consumable_matrix' ||
      restored.mode === 'tier_heatmap'
    ) {
      setMode(restored.mode);
    }
    if (Array.isArray(restored.plotStats)) {
      setPlotStats(restored.plotStats.filter((v) => typeof v === 'string'));
    }
    if (typeof restored.plotRange === 'number' && Number.isFinite(restored.plotRange)) {
      setPlotRange(Math.max(100, Math.floor(restored.plotRange)));
    }
    if (typeof restored.plotStep === 'number' && Number.isFinite(restored.plotStep)) {
      setPlotStep(Math.max(10, Math.floor(restored.plotStep)));
    }
    if (typeof restored.plotIterations === 'number' && Number.isFinite(restored.plotIterations)) {
      setPlotIterations(Math.max(100, Math.floor(restored.plotIterations)));
    }
    if (Array.isArray(restored.matrixFlasks))
      setMatrixFlasks(restored.matrixFlasks.filter((v) => typeof v === 'string'));
    if (Array.isArray(restored.matrixFoods))
      setMatrixFoods(restored.matrixFoods.filter((v) => typeof v === 'string'));
    if (Array.isArray(restored.matrixPotions))
      setMatrixPotions(restored.matrixPotions.filter((v) => typeof v === 'string'));
    if (Array.isArray(restored.matrixAugments))
      setMatrixAugments(restored.matrixAugments.filter((v) => typeof v === 'string'));
    if (Array.isArray(restored.matrixTempEnchants))
      setMatrixTempEnchants(restored.matrixTempEnchants.filter((v) => typeof v === 'string'));
    if (Array.isArray(restored.matrixRaidBuffs))
      setMatrixRaidBuffs(restored.matrixRaidBuffs.filter((v) => typeof v === 'string'));
  }, [forcedMode]);

  const consumableCount =
    matrixFlasks.length +
    matrixFoods.length +
    matrixPotions.length +
    matrixAugments.length +
    matrixTempEnchants.length +
    matrixRaidBuffs.length;

  const icons = useSpellIcons(
    RAID_BUFF_MATRIX_OPTIONS.map((b) => b.spellId || 0).filter((v) => v > 0)
  );
  const allItemIds = useMemo(() => {
    const all = [...flasks, ...foods, ...potions, ...augments, ...tempEnchants];
    return all.map((o) => o.itemId).filter((id): id is number => !!id);
  }, [flasks, foods, potions, augments, tempEnchants]);
  const itemIcons = useItemIcons(allItemIds);

  useWowheadTooltips([
    mode,
    icons,
    itemIcons,
    consumableCount,
    flasks.length,
    foods.length,
    potions.length,
    augments.length,
    tempEnchants.length,
  ]);

  useEffect(() => {
    const all = uniqueTokens(flasks);
    setMatrixFlasks((prev) =>
      prev.length === 0 || prev.some((v) => !all.includes(v)) ? all : prev
    );
  }, [flasks]);
  useEffect(() => {
    const all = uniqueTokens(foods);
    setMatrixFoods((prev) =>
      prev.length === 0 || prev.some((v) => !all.includes(v)) ? all : prev
    );
  }, [foods]);
  useEffect(() => {
    const all = uniqueTokens(potions);
    setMatrixPotions((prev) =>
      prev.length === 0 || prev.some((v) => !all.includes(v)) ? all : prev
    );
  }, [potions]);
  useEffect(() => {
    const all = uniqueTokens(augments);
    setMatrixAugments((prev) =>
      prev.length === 0 || prev.some((v) => !all.includes(v)) ? all : prev
    );
  }, [augments]);
  useEffect(() => {
    const all = uniqueTokens(tempEnchants);
    setMatrixTempEnchants((prev) =>
      prev.length === 0 || prev.some((v) => !all.includes(v)) ? all : prev
    );
  }, [tempEnchants]);

  useEffect(() => {
    const lock = mode === 'consumable_matrix';
    setLockSingleConsumableOptions(lock);
    return () => {
      setLockSingleConsumableOptions(false);
    };
  }, [mode, setLockSingleConsumableOptions]);

  const plotPoints = useMemo(() => {
    const safeStep = Math.max(1, Math.floor(plotStep));
    return Math.max(1, Math.floor(Math.max(safeStep, plotRange) / safeStep));
  }, [plotRange, plotStep]);

  const buildPayload = useCallback(
    () => ({
      simc_input: simcInput,
      sim_type: mode,
      ...(mode === 'stat_plot'
        ? {
            dps_plot_stat: plotStats.join(','),
            dps_plot_points: plotPoints,
            dps_plot_step: Math.max(1, Math.floor(plotStep)),
            dps_plot_iterations: Math.max(100, Math.floor(plotIterations)),
          }
        : mode === 'tier_heatmap'
          ? {
              sim_type: 'trinket_tier_heatmap',
              include_trinket_matrix: false,
              include_tier_matrix: true,
            }
          : mode === 'consumable_matrix'
            ? {
                consumable_matrix_flasks: matrixFlasks,
                consumable_matrix_foods: matrixFoods,
                consumable_matrix_potions: matrixPotions,
                consumable_matrix_augmentations: matrixAugments,
                consumable_matrix_temporary_enchants: matrixTempEnchants,
                consumable_matrix_raid_buffs: matrixRaidBuffs,
              }
            : {}),
    }),
    [
      simcInput,
      mode,
      plotStats,
      plotPoints,
      plotStep,
      plotIterations,
      matrixFlasks,
      matrixFoods,
      matrixPotions,
      matrixAugments,
      matrixTempEnchants,
      matrixRaidBuffs,
    ]
  );

  const validate = useCallback(() => {
    if (simcInput.trim().length < 10) {
      return 'SimC input is too short. Paste your full addon export.';
    }
    if (mode === 'stat_plot') {
      if (plotStats.length === 0) return 'Choose at least one stat to plot.';
      if (plotRange < plotStep) return 'Plot range should be greater than or equal to step size.';
    }
    if (mode === 'consumable_matrix' && consumableCount === 0) {
      return 'Select at least one consumable or raid buff to compare.';
    }
    return null;
  }, [simcInput, mode, plotStats, plotRange, plotStep, consumableCount]);

  const { submit, submitting, error, buttonLabel } = useSimSubmit({
    endpoint: '/api/sim',
    buildPayload,
    validate,
    simAgain: {
      pageKey: STAT_WEIGHTS_SIM_AGAIN_KEY,
      captureState: () => ({
        mode,
        plotStats,
        plotRange,
        plotStep,
        plotIterations,
        matrixFlasks,
        matrixFoods,
        matrixPotions,
        matrixAugments,
        matrixTempEnchants,
        matrixRaidBuffs,
      }),
    },
  });

  const handleSubmit = useCallback(() => {
    submit();
  }, [submit]);

  return (
    <div className="flex flex-col gap-6">
      {returnNotice ? (
        <SimReturnNotice
          title={returnNotice.title}
          message={returnNotice.message}
          onDismiss={() => setReturnNotice(null)}
        />
      ) : null}
      <div className="space-y-1">
        <h2 className="text-xl font-bold tracking-tight text-zinc-100">Stat Weights</h2>
        <p className="text-sm text-zinc-400">
          Run quick weights, plots, or consumable matrix sims.
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit();
        }}
        className="space-y-6"
      >
        <ErrorAlert message={error} />

        {!forcedMode && (
          <div className="grid gap-4 md:grid-cols-4">
            {[
              ['stat_weights', 'Quick Weights', 'Fast single-point stat values.'],
              ['stat_plot', 'Stat Plot', 'Curve DPS across a stat range.'],
              [
                'consumable_matrix',
                'Consumable Matrix',
                'Find best flask/food/potion/rune/raid buffs.',
              ],
              ['tier_heatmap', 'Tier Slot Matrix', 'Sim tier-slot impact matrix only.'],
            ].map(([key, title, desc]) => (
              <button
                key={key}
                type="button"
                onClick={() => setMode(key as StatWeightsMode)}
                className={`rounded-md border px-4 py-3 text-left transition-colors ${
                  mode === key
                    ? 'border-gold/40 bg-gold/[0.08] text-zinc-100'
                    : 'border-border bg-surface-2 text-zinc-300 hover:border-zinc-600'
                }`}
              >
                <div className="text-sm font-semibold">{title}</div>
                <div className="mt-1 text-xs text-zinc-400">{desc}</div>
              </button>
            ))}
          </div>
        )}

        {mode === 'stat_plot' && (
          <div className="grid gap-4 rounded-lg border border-border bg-surface-2 p-4 md:grid-cols-2">
            <div className="space-y-2 text-xs text-zinc-400 md:col-span-2">
              <span className="block">Stats to Compare</span>
              <div className="flex flex-wrap gap-2">
                {PLOT_STATS.map((stat) => {
                  const selected = plotStats.includes(stat.value);
                  return (
                    <button
                      key={stat.value}
                      type="button"
                      onClick={() =>
                        setPlotStats((prev) =>
                          prev.includes(stat.value)
                            ? prev.filter((v) => v !== stat.value)
                            : [...prev, stat.value]
                        )
                      }
                      className={`rounded-md border px-2.5 py-1.5 text-xs transition-colors ${
                        selected
                          ? 'border-gold/40 bg-gold/[0.10] text-zinc-100'
                          : 'border-border bg-surface text-zinc-400 hover:border-zinc-600'
                      }`}
                    >
                      {stat.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <label className="space-y-1.5 text-xs text-zinc-400">
              <span className="block">Range (+/- rating)</span>
              <input
                type="number"
                min={100}
                step={50}
                value={plotRange}
                onChange={(e) => setPlotRange(Number(e.target.value) || 1000)}
                className="w-full rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-zinc-200 focus:border-gold focus:outline-none"
              />
            </label>
            <label className="space-y-1.5 text-xs text-zinc-400">
              <span className="block">Step</span>
              <input
                type="number"
                min={10}
                step={10}
                value={plotStep}
                onChange={(e) => setPlotStep(Number(e.target.value) || 100)}
                className="w-full rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-zinc-200 focus:border-gold focus:outline-none"
              />
            </label>
            <label className="space-y-1.5 text-xs text-zinc-400">
              <span className="block">Plot Iterations</span>
              <input
                type="number"
                min={100}
                step={100}
                value={plotIterations}
                onChange={(e) => setPlotIterations(Number(e.target.value) || 2000)}
                className="w-full rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-zinc-200 focus:border-gold focus:outline-none"
              />
            </label>
            <div className="text-xs text-zinc-500 md:col-span-2">
              Generated points: {plotPoints * 2 + 1}
            </div>
          </div>
        )}

        {mode === 'consumable_matrix' && (
          <div className="space-y-3 rounded-lg border border-border bg-surface-2 p-4 text-xs text-zinc-400">
            <p>Compare selected consumables and raid buffs.</p>
            <div className="grid gap-3 lg:grid-cols-2">
              {[
                ['Flasks', flasks, matrixFlasks, setMatrixFlasks],
                ['Food', foods, matrixFoods, setMatrixFoods],
                ['Potions', potions, matrixPotions, setMatrixPotions],
                ['Augmentation Runes', augments, matrixAugments, setMatrixAugments],
                ['Temporary Enchants', tempEnchants, matrixTempEnchants, setMatrixTempEnchants],
                ['Raid Buffs', RAID_BUFF_MATRIX_OPTIONS, matrixRaidBuffs, setMatrixRaidBuffs],
              ].map(([title, options, selected, setSelected]) => (
                <div
                  key={title as string}
                  className="space-y-2 rounded-md border border-border bg-surface p-3"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                      {title as string}
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const all = (options as OptionEntry[]).map((o) => o.token || o.key);
                          (setSelected as (v: string[]) => void)(all);
                        }}
                        className="text-[11px] text-zinc-500 hover:text-zinc-300"
                        title="Select All"
                      >
                        All
                      </button>
                      <button
                        type="button"
                        onClick={() => (setSelected as (v: string[]) => void)([])}
                        className="text-[11px] text-zinc-500 hover:text-zinc-300"
                        title="Clear"
                      >
                        Clear
                      </button>
                      {title !== 'Raid Buffs' && (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              const tokens = uniqueTokens(
                                (options as OptionEntry[]).filter((opt) => {
                                  const max = Math.max(
                                    ...(options as OptionEntry[])
                                      .filter(
                                        (o) => optionQualityFamily(o) === optionQualityFamily(opt)
                                      )
                                      .map((o) => o.craftingQuality || 0)
                                  );
                                  return remapQuality(opt.craftingQuality, max) === 3;
                                })
                              );
                              (setSelected as (v: string[]) => void)(tokens);
                            }}
                            className="text-[11px] text-amber-500 hover:text-amber-300"
                            title="Select All Gold"
                          >
                            Gold
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const tokens = uniqueTokens(
                                (options as OptionEntry[]).filter((opt) => {
                                  const max = Math.max(
                                    ...(options as OptionEntry[])
                                      .filter(
                                        (o) => optionQualityFamily(o) === optionQualityFamily(opt)
                                      )
                                      .map((o) => o.craftingQuality || 0)
                                  );
                                  return remapQuality(opt.craftingQuality, max) === 2;
                                })
                              );
                              (setSelected as (v: string[]) => void)(tokens);
                            }}
                            className="text-[11px] text-zinc-300 hover:text-white"
                            title="Select All Silver"
                          >
                            Silver
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const tokens = uniqueTokens(
                                (options as OptionEntry[]).filter((opt) => {
                                  const max = Math.max(
                                    ...(options as OptionEntry[])
                                      .filter(
                                        (o) => optionQualityFamily(o) === optionQualityFamily(opt)
                                      )
                                      .map((o) => o.craftingQuality || 0)
                                  );
                                  return remapQuality(opt.craftingQuality, max) === 1;
                                })
                              );
                              (setSelected as (v: string[]) => void)(tokens);
                            }}
                            className="text-[11px] text-orange-400 hover:text-orange-300"
                            title="Select All Bronze"
                          >
                            Bronze
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="grid gap-1">
                    {(() => {
                      const groups = new Map<
                        string,
                        {
                          label: string;
                          icon: string;
                          itemId?: number;
                          spellId?: number;
                          items: OptionEntry[];
                          familyMax: number;
                        }
                      >();
                      for (const opt of options as OptionEntry[]) {
                        const familyKey = optionQualityFamily(opt);
                        if (!groups.has(familyKey)) {
                          const icon = (opt.itemId && itemIcons.get(opt.itemId)) || opt.icon || '';
                          groups.set(familyKey, {
                            label: optionLabel(opt),
                            icon,
                            itemId: opt.itemId,
                            spellId: opt.spellId,
                            items: [],
                            familyMax: 0,
                          });
                        }
                        const group = groups.get(familyKey)!;
                        group.items.push(opt);
                        group.familyMax = Math.max(group.familyMax, opt.craftingQuality || 0);
                      }

                      return Array.from(groups.values()).map((group) => {
                        const sortedItems = [...group.items].sort(
                          (a, b) => (a.craftingQuality || 0) - (b.craftingQuality || 0)
                        );
                        const hasQuality = group.familyMax > 0;
                        const isSingleNoQuality = sortedItems.length === 1 && !hasQuality;
                        const isSelected =
                          isSingleNoQuality &&
                          (selected as string[]).includes(
                            sortedItems[0].token || sortedItems[0].key
                          );

                        return (
                          <div
                            key={group.label}
                            onClick={() => {
                              if (isSingleNoQuality) {
                                (setSelected as (v: string[]) => void)(
                                  toggleListValue(
                                    selected as string[],
                                    sortedItems[0].token || sortedItems[0].key
                                  )
                                );
                              }
                            }}
                            className={`flex items-center justify-between gap-3 rounded border px-2.5 py-1.5 transition-colors ${
                              isSingleNoQuality ? 'cursor-pointer' : ''
                            } ${
                              isSelected
                                ? 'border-gold/40 bg-gold/[0.08]'
                                : 'border-border bg-surface-2 hover:border-zinc-700'
                            }`}
                          >
                            <div className="flex min-w-0 flex-1 items-center gap-2">
                              {group.itemId || group.spellId ? (
                                <a
                                  href={
                                    group.itemId
                                      ? `https://www.wowhead.com/item=${group.itemId}`
                                      : `https://www.wowhead.com/spell=${group.spellId}`
                                  }
                                  target="_blank"
                                  rel="noreferrer"
                                  data-wowhead={
                                    group.itemId ? `item=${group.itemId}` : `spell=${group.spellId}`
                                  }
                                  className={`flex min-w-0 items-center gap-2 hover:text-zinc-100 ${
                                    isSelected ? 'text-white' : 'text-zinc-300'
                                  }`}
                                  onClick={(e) => {
                                    if (!isSingleNoQuality) {
                                      e.preventDefault();
                                      e.stopPropagation();
                                    }
                                  }}
                                >
                                  <img
                                    src={`https://wow.zamimg.com/images/wow/icons/small/${icons.get(group.spellId || 0) || group.icon}.jpg`}
                                    alt=""
                                    className="h-4 w-4 shrink-0 rounded-[3px]"
                                  />
                                  <span className="truncate text-[12px]">{group.label}</span>
                                </a>
                              ) : (
                                <span
                                  className={`flex min-w-0 items-center gap-2 ${
                                    isSelected ? 'text-white' : 'text-zinc-300'
                                  }`}
                                >
                                  <img
                                    src={`https://wow.zamimg.com/images/wow/icons/small/${group.icon}.jpg`}
                                    alt=""
                                    className="h-4 w-4 shrink-0 rounded-[3px]"
                                  />
                                  <span className="truncate text-[12px]">{group.label}</span>
                                </span>
                              )}
                            </div>

                            {hasQuality ? (
                              <div className="flex shrink-0 items-center gap-1.5">
                                {sortedItems.map((opt) => {
                                  const q = remapQuality(opt.craftingQuality, group.familyMax);
                                  const isOptSelected = (selected as string[]).includes(
                                    opt.token || opt.key
                                  );
                                  const style =
                                    q === 3
                                      ? isOptSelected
                                        ? 'border-amber-300/60 bg-amber-500 text-black shadow-[0_0_8px_rgba(251,191,36,0.3)]'
                                        : 'border-amber-300/30 bg-amber-500/10 text-amber-300/60 hover:border-amber-300/60 hover:bg-amber-500/20'
                                      : q === 2
                                        ? isOptSelected
                                          ? 'border-zinc-300/60 bg-zinc-400 text-black shadow-[0_0_8px_rgba(161,161,170,0.3)]'
                                          : 'border-zinc-300/30 bg-zinc-400/10 text-zinc-400/60 hover:border-zinc-300/60 hover:bg-zinc-400/20'
                                        : isOptSelected
                                          ? 'border-orange-400/60 bg-orange-600 text-black shadow-[0_0_8px_rgba(234,88,12,0.3)]'
                                          : 'border-orange-400/30 bg-orange-600/10 text-orange-400/60 hover:border-orange-400/60 hover:bg-orange-600/20';

                                  return (
                                    <button
                                      key={opt.key}
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        (setSelected as (v: string[]) => void)(
                                          toggleListValue(
                                            selected as string[],
                                            opt.token || opt.key
                                          )
                                        );
                                      }}
                                      title={`Quality ${q}`}
                                      className={`flex h-4 w-4 items-center justify-center rounded-[3px] border transition-all ${style}`}
                                    >
                                      <span className="sr-only">{q}</span>
                                    </button>
                                  );
                                })}
                              </div>
                            ) : (
                              <div
                                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] border transition-all ${
                                  isSelected
                                    ? 'border-gold bg-gold shadow-[0_0_8px_rgba(212,175,55,0.3)]'
                                    : 'border-zinc-700 bg-surface hover:border-zinc-500'
                                }`}
                              >
                                {isSelected && (
                                  <svg
                                    className="h-2.5 w-2.5 text-black"
                                    viewBox="0 0 12 12"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="3"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  >
                                    <polyline points="2 6.5 4.5 9 10 3" />
                                  </svg>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      });
                    })()}
                  </div>
                </div>
              ))}
              {/* Raid Buffs section removed for Consumable Matrix mode as requested */}
            </div>
          </div>
        )}

        <button
          type="submit"
          disabled={submitting || simcInput.trim().length < 10}
          className="btn-primary w-full py-3 text-sm"
        >
          {submitting
            ? 'Running...'
            : buttonLabel(
                mode === 'stat_plot'
                  ? 'Run Stat Plot Simulation'
                  : mode === 'tier_heatmap'
                    ? 'Run Tier Slot Matrix'
                    : mode === 'consumable_matrix'
                      ? 'Run Consumable Matrix'
                      : 'Run Stat Weights Simulation'
              )}
        </button>
      </form>
    </div>
  );
}
