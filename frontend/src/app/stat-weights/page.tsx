'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ErrorAlert from '../components/ErrorAlert';
import { useSimContext } from '../components/SimContext';
import { useSimSubmit } from '../lib/useSimSubmit';
import { useWowheadTooltips } from '../lib/useWowheadTooltips';
import { useConsumableOptions } from '../lib/useConsumableOptions';
import { OptionEntry, RAID_BUFF_MATRIX_OPTIONS } from '../lib/sim-options-catalog';

const PLOT_STATS = [
  { value: 'haste_rating', label: 'Haste' },
  { value: 'crit_rating', label: 'Critical Strike' },
  { value: 'mastery_rating', label: 'Mastery' },
  { value: 'versatility_rating', label: 'Versatility' },
  { value: 'intellect', label: 'Intellect' },
  { value: 'agility', label: 'Agility' },
  { value: 'strength', label: 'Strength' },
];

const spellIconCache = new Map<number, string>();

function useSpellIcons(spellIds: number[]) {
  const [icons, setIcons] = useState<Map<number, string>>(new Map());
  const depKey = spellIds.join(',');

  useEffect(() => {
    const missing = spellIds.filter((id) => id > 0 && !spellIconCache.has(id));
    if (missing.length === 0) {
      setIcons(new Map(spellIconCache));
      return;
    }
    let cancelled = false;
    Promise.all(
      missing.map(async (id) => {
        try {
          const res = await fetch(
            `https://nether.wowhead.com/tooltip/spell/${id}?dataEnv=1&locale=0`
          );
          if (!res.ok) return;
          const data = await res.json();
          if (data?.icon) spellIconCache.set(id, data.icon);
        } catch {}
      })
    ).then(() => {
      if (!cancelled) setIcons(new Map(spellIconCache));
    });
    return () => {
      cancelled = true;
    };
  }, [depKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return icons;
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
  const token = (opt.token || '').replace(/^main_hand:/, '');
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

function QualityBadge({ quality }: { quality?: number }) {
  if (!quality || quality < 1 || quality > 3) return null;
  const style =
    quality === 3
      ? 'border-amber-300/60 bg-gradient-to-b from-amber-200 to-amber-500'
      : quality === 2
        ? 'border-zinc-300/60 bg-gradient-to-b from-zinc-100 to-zinc-400'
        : 'border-orange-400/60 bg-gradient-to-b from-orange-200 to-orange-500';
  return (
    <span
      className={`ml-auto inline-block h-3.5 w-3.5 rotate-45 rounded-[2px] border ${style}`}
      title={`Quality ${quality}`}
      aria-label={`Quality ${quality}`}
    >
      <span className="sr-only">{quality}</span>
    </span>
  );
}

export default function StatWeightsPage() {
  const { simcInput, setLockSingleConsumableOptions } = useSimContext();
  const { flasks, foods, potions, augments, tempEnchants } = useConsumableOptions(10);

  const [mode, setMode] = useState<
    'stat_weights' | 'stat_plot' | 'consumable_matrix' | 'tier_heatmap'
  >('stat_weights');

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
  useWowheadTooltips([
    mode,
    icons,
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
  }, [
    simcInput,
    mode,
    plotStats,
    plotRange,
    plotStep,
    consumableCount,
  ]);

  const { submit, submitting, error, buttonLabel } = useSimSubmit({
    endpoint: '/api/sim',
    buildPayload,
    validate,
  });

  const handleSubmit = useCallback(() => {
    submit();
  }, [
    submit,
  ]);

  return (
    <div className="flex flex-col gap-6">
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
              onClick={() => setMode(key as typeof mode)}
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
              ].map(([title, options, selected, setSelected]) => (
                <div
                  key={title as string}
                  className="space-y-2 rounded-md border border-border bg-surface p-3"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                      {title as string}
                    </p>
                    <button
                      type="button"
                      onClick={() =>
                        (setSelected as (v: string[]) => void)(
                          uniqueTokens(options as OptionEntry[])
                        )
                      }
                      className="text-[11px] text-zinc-500 hover:text-zinc-300"
                    >
                      All
                    </button>
                  </div>
                  <div className="grid gap-1.5">
                    {(options as OptionEntry[]).map((opt) => (
                      <label
                        key={opt.key}
                        className="flex items-center justify-between gap-2 rounded border border-border bg-surface-2 px-2 py-1.5"
                      >
                        {opt.itemId ? (
                          <a
                            href={`https://www.wowhead.com/item=${opt.itemId}`}
                            target="_blank"
                            rel="noreferrer"
                            data-wowhead={`item=${opt.itemId}`}
                            className="flex min-w-0 items-center gap-2 text-zinc-300 hover:text-zinc-100"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                            }}
                          >
                            <span
                              className="h-4 w-4 shrink-0 rounded-[3px] bg-cover bg-center"
                              style={{
                                backgroundImage: `url(https://wow.zamimg.com/images/wow/icons/small/${opt.icon}.jpg)`,
                              }}
                            />
                            <span className="truncate text-xs">{optionLabel(opt)}</span>
                            <QualityBadge
                              quality={remapQuality(
                                opt.craftingQuality,
                                Math.max(
                                  ...(options as OptionEntry[])
                                    .filter(
                                      (o) => optionQualityFamily(o) === optionQualityFamily(opt)
                                    )
                                    .map((o) => o.craftingQuality || 0)
                                )
                              )}
                            />
                          </a>
                        ) : (
                          <span className="flex min-w-0 items-center gap-2 text-zinc-300">
                            <span
                              className="h-4 w-4 shrink-0 rounded-[3px] bg-cover bg-center"
                              style={{
                                backgroundImage: `url(https://wow.zamimg.com/images/wow/icons/small/${opt.icon}.jpg)`,
                              }}
                            />
                            <span className="truncate text-xs">{optionLabel(opt)}</span>
                            <QualityBadge
                              quality={remapQuality(
                                opt.craftingQuality,
                                Math.max(
                                  ...(options as OptionEntry[])
                                    .filter(
                                      (o) => optionQualityFamily(o) === optionQualityFamily(opt)
                                    )
                                    .map((o) => o.craftingQuality || 0)
                                )
                              )}
                            />
                          </span>
                        )}
                        <input
                          type="checkbox"
                          checked={(selected as string[]).includes(opt.token || '')}
                          onChange={() =>
                            (setSelected as (v: string[]) => void)(
                              toggleListValue(selected as string[], opt.token || '')
                            )
                          }
                          className="h-4 w-4 accent-gold"
                        />
                      </label>
                    ))}
                  </div>
                </div>
              ))}
              <div className="space-y-2 rounded-md border border-border bg-surface p-3 lg:col-span-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                    Raid Buffs
                  </p>
                  <button
                    type="button"
                    onClick={() => setMatrixRaidBuffs(RAID_BUFF_MATRIX_OPTIONS.map((o) => o.key))}
                    className="text-[11px] text-zinc-500 hover:text-zinc-300"
                  >
                    All
                  </button>
                </div>
                <p className="text-[11px] text-zinc-500">
                  If your character provides one of these buffs, SimC may still include it.
                </p>
                <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                  {RAID_BUFF_MATRIX_OPTIONS.map((opt) => {
                    const icon = icons.get(opt.spellId || 0);
                    return (
                      <label
                        key={opt.key}
                        className="flex items-center justify-between gap-2 rounded border border-border bg-surface-2 px-2 py-1.5"
                      >
                        <a
                          href={`https://www.wowhead.com/spell=${opt.spellId}`}
                          target="_blank"
                          rel="noreferrer"
                          data-wowhead={`spell=${opt.spellId}`}
                          className="flex min-w-0 items-center gap-2 text-zinc-300"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <span
                            className="h-4 w-4 shrink-0 rounded-[3px] bg-cover bg-center"
                            style={{
                              backgroundImage: `url(https://wow.zamimg.com/images/wow/icons/small/${icon || opt.icon}.jpg)`,
                            }}
                          />
                          <span className="truncate text-xs">{opt.label}</span>
                        </a>
                        <input
                          type="checkbox"
                          checked={matrixRaidBuffs.includes(opt.key)}
                          onChange={() =>
                            setMatrixRaidBuffs((prev) => toggleListValue(prev, opt.key))
                          }
                          className="h-4 w-4 accent-gold"
                        />
                      </label>
                    );
                  })}
                </div>
              </div>
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
