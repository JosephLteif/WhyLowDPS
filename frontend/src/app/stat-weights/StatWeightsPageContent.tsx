'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import ErrorAlert from '../components/ErrorAlert';
import { useSimContext } from '../components/SimContext';
import SimReturnNotice from '../components/shared/SimReturnNotice';
import ConsumableMatrixSelector from '../components/shared/ConsumableMatrixSelector';
import { useSimSubmit } from '../lib/useSimSubmit';
import { useWowheadTooltips } from '../lib/useWowheadTooltips';
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

function uniqueTokens(options: OptionEntry[]): string[] {
  return Array.from(new Set(options.map((o) => o.token || '').filter(Boolean)));
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

  useWowheadTooltips([
    mode,
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
              <ConsumableMatrixSelector
                title="Flasks"
                options={flasks}
                selected={matrixFlasks}
                onChange={setMatrixFlasks}
              />
              <ConsumableMatrixSelector
                title="Food"
                options={foods}
                selected={matrixFoods}
                onChange={setMatrixFoods}
              />
              <ConsumableMatrixSelector
                title="Potions"
                options={potions}
                selected={matrixPotions}
                onChange={setMatrixPotions}
              />
              <ConsumableMatrixSelector
                title="Augmentation Runes"
                options={augments}
                selected={matrixAugments}
                onChange={setMatrixAugments}
              />
              <ConsumableMatrixSelector
                title="Temporary Enchants"
                options={tempEnchants}
                selected={matrixTempEnchants}
                onChange={setMatrixTempEnchants}
              />
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
