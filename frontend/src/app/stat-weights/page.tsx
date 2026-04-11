'use client';

import { useCallback, useMemo, useState } from 'react';
import ErrorAlert from '../components/ErrorAlert';
import { useSimContext } from '../components/SimContext';
import { useSimSubmit } from '../lib/useSimSubmit';

const PLOT_STATS = [
  { value: 'haste_rating', label: 'Haste' },
  { value: 'crit_rating', label: 'Critical Strike' },
  { value: 'mastery_rating', label: 'Mastery' },
  { value: 'versatility_rating', label: 'Versatility' },
  { value: 'intellect', label: 'Intellect' },
  { value: 'agility', label: 'Agility' },
  { value: 'strength', label: 'Strength' },
];

export default function StatWeightsPage() {
  const { simcInput } = useSimContext();
  const [mode, setMode] = useState<'stat_weights' | 'stat_plot' | 'trinket_tier_heatmap'>(
    'stat_weights'
  );
  const [plotStats, setPlotStats] = useState<string[]>([
    'haste_rating',
    'crit_rating',
    'mastery_rating',
  ]);
  const [plotRange, setPlotRange] = useState(1000);
  const [plotStep, setPlotStep] = useState(100);
  const [plotIterations, setPlotIterations] = useState(2000);
  const [includeTrinketMatrix, setIncludeTrinketMatrix] = useState(false);
  const [includeTierMatrix, setIncludeTierMatrix] = useState(true);

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
        : mode === 'trinket_tier_heatmap'
          ? {
              include_trinket_matrix: includeTrinketMatrix,
              include_tier_matrix: includeTierMatrix,
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
      includeTrinketMatrix,
      includeTierMatrix,
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
    if (mode === 'trinket_tier_heatmap') {
      if (!includeTrinketMatrix && !includeTierMatrix) {
        return 'Enable at least one matrix option (Trinkets or Tier Sets).';
      }
    }
    return null;
  }, [simcInput, mode, plotStats, plotRange, plotStep, includeTrinketMatrix, includeTierMatrix]);

  const { submit, submitting, error, buttonLabel } = useSimSubmit({
    endpoint: '/api/sim',
    buildPayload,
    validate,
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-1">
        <h2 className="text-xl font-bold tracking-tight text-zinc-100">Stat Weights</h2>
        <p className="text-sm text-zinc-400">
          Run quick marginal stat weights, or run a full stat plot to visualize diminishing returns.
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="space-y-6"
      >
        <ErrorAlert message={error} />

        <div className="grid gap-4 md:grid-cols-3">
          <button
            type="button"
            onClick={() => setMode('stat_weights')}
            className={`rounded-md border px-4 py-3 text-left transition-colors ${
              mode === 'stat_weights'
                ? 'border-gold/40 bg-gold/[0.08] text-zinc-100'
                : 'border-border bg-surface-2 text-zinc-300 hover:border-zinc-600'
            }`}
          >
            <div className="text-sm font-semibold">Quick Weights</div>
            <div className="mt-1 text-xs text-zinc-400">Fast single-point stat values.</div>
          </button>
          <button
            type="button"
            onClick={() => setMode('stat_plot')}
            className={`rounded-md border px-4 py-3 text-left transition-colors ${
              mode === 'stat_plot'
                ? 'border-gold/40 bg-gold/[0.08] text-zinc-100'
                : 'border-border bg-surface-2 text-zinc-300 hover:border-zinc-600'
            }`}
          >
            <div className="text-sm font-semibold">Stat Plot</div>
            <div className="mt-1 text-xs text-zinc-400">Curve DPS across a stat range.</div>
          </button>
          <button
            type="button"
            onClick={() => setMode('trinket_tier_heatmap')}
            className={`rounded-md border px-4 py-3 text-left transition-colors ${
              mode === 'trinket_tier_heatmap'
                ? 'border-gold/40 bg-gold/[0.08] text-zinc-100'
                : 'border-border bg-surface-2 text-zinc-300 hover:border-zinc-600'
            }`}
          >
            <div className="text-sm font-semibold">Trinket / Tier Heatmaps</div>
            <div className="mt-1 text-xs text-zinc-400">
              Personalized trinket pair and tier-slot matrix sims.
            </div>
          </button>
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
              Generated points: {plotPoints * 2 + 1} (
              {-plotPoints * Math.max(1, Math.floor(plotStep))} to{' '}
              {plotPoints * Math.max(1, Math.floor(plotStep))})
            </div>
          </div>
        )}

        {mode === 'trinket_tier_heatmap' && (
          <div className="space-y-3 rounded-lg border border-border bg-surface-2 p-4 text-xs text-zinc-400">
            <p>
              Runs matrix simulations from your current profile and renders personalized heatmaps in
              the result page.
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="group flex cursor-pointer items-center justify-between rounded-md border border-border bg-surface px-3 py-2">
                <span className="text-zinc-300">Trinket Pair Matrix</span>
                <input
                  type="checkbox"
                  checked={includeTrinketMatrix}
                  onChange={(e) => setIncludeTrinketMatrix(e.target.checked)}
                  className="h-4 w-4 accent-gold"
                />
              </label>
              <label className="group flex cursor-pointer items-center justify-between rounded-md border border-border bg-surface px-3 py-2">
                <span className="text-zinc-300">Tier Slot Matrix</span>
                <input
                  type="checkbox"
                  checked={includeTierMatrix}
                  onChange={(e) => setIncludeTierMatrix(e.target.checked)}
                  className="h-4 w-4 accent-gold"
                />
              </label>
            </div>
            <p className="text-zinc-500">
              Current default: Trinkets off, Tier Sets on.
            </p>
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
                  : mode === 'trinket_tier_heatmap'
                    ? 'Run Trinket / Tier Heatmaps'
                    : 'Run Stat Weights Simulation'
              )}
        </button>
      </form>
    </div>
  );
}
