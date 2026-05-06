'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

interface StatPlotPoint {
  delta: number;
  dps: number;
}

interface StatPlotChartProps {
  statPlots: Record<string, StatPlotPoint[]>;
}

const STAT_DISPLAY_NAMES: Record<string, string> = {
  intellect: 'Intellect',
  strength: 'Strength',
  agility: 'Agility',
  stamina: 'Stamina',
  crit: 'Critical Strike',
  crit_rating: 'Critical Strike',
  haste: 'Haste',
  haste_rating: 'Haste',
  mastery: 'Mastery',
  mastery_rating: 'Mastery',
  versatility: 'Versatility',
  versatility_rating: 'Versatility',
  weapon_dps: 'Weapon DPS',
  weapon_offhand_dps: 'Off-hand Weapon DPS',
};

const PLOT_COLORS = ['#eab308', '#60a5fa', '#22c55e', '#f97316', '#ec4899', '#a78bfa'];

function statLabel(stat: string): string {
  return STAT_DISPLAY_NAMES[stat] || stat.replace(/_/g, ' ');
}

function keyForDelta(v: number): string {
  return Number(v).toFixed(4);
}

export default function StatPlotChart({ statPlots }: StatPlotChartProps) {
  const statKeys = useMemo(() => Object.keys(statPlots), [statPlots]);
  const [visibleStats, setVisibleStats] = useState<string[]>(statKeys);

  useEffect(() => {
    setVisibleStats((prev) => {
      const kept = prev.filter((s) => statKeys.includes(s));
      return kept.length > 0 ? kept : statKeys;
    });
  }, [statKeys]);

  const data = useMemo(() => {
    const deltaMap = new Map<string, { delta: number; values: Record<string, number | null> }>();
    for (const stat of statKeys) {
      const points = statPlots[stat] || [];
      for (const p of points) {
        const k = keyForDelta(p.delta);
        if (!deltaMap.has(k)) {
          deltaMap.set(k, { delta: p.delta, values: {} });
        }
        deltaMap.get(k)!.values[stat] = p.dps;
      }
    }
    return Array.from(deltaMap.values())
      .sort((a, b) => a.delta - b.delta)
      .map((entry) => ({
        delta: entry.delta,
        ...Object.fromEntries(statKeys.map((k) => [k, entry.values[k] ?? null])),
      }));
  }, [statKeys, statPlots]);

  if (statKeys.length === 0) {
    return null;
  }

  return (
    <div className="card p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-xs font-medium uppercase tracking-widest text-muted">Stat Plot</h3>
        <div className="flex flex-wrap gap-2">
          {statKeys.map((stat, i) => {
            const active = visibleStats.includes(stat);
            return (
              <button
                key={stat}
                type="button"
                onClick={() =>
                  setVisibleStats((prev) =>
                    prev.includes(stat) ? prev.filter((s) => s !== stat) : [...prev, stat]
                  )
                }
                className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                  active
                    ? 'border-zinc-500 bg-zinc-800 text-zinc-100'
                    : 'border-border bg-surface-2 text-zinc-500'
                }`}
                style={active ? { borderColor: PLOT_COLORS[i % PLOT_COLORS.length] } : undefined}
              >
                {statLabel(stat)}
              </button>
            );
          })}
        </div>
      </div>

      <div className="h-[340px] min-h-[340px] w-full min-w-0">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <LineChart data={data} margin={{ top: 12, right: 12, left: 0, bottom: 8 }}>
            <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
            <XAxis
              dataKey="delta"
              type="number"
              domain={['dataMin', 'dataMax']}
              tick={{ fill: '#a1a1aa', fontSize: 12 }}
              tickFormatter={(v) => `${v > 0 ? '+' : ''}${Math.round(v)}`}
              label={{
                value: 'Stat Delta',
                position: 'insideBottom',
                offset: -2,
                fill: '#71717a',
                fontSize: 12,
              }}
            />
            <YAxis
              tick={{ fill: '#a1a1aa', fontSize: 12 }}
              tickFormatter={(v) => Number(v).toLocaleString()}
              width={84}
              label={{
                value: 'DPS',
                angle: -90,
                position: 'insideLeft',
                fill: '#71717a',
                fontSize: 12,
              }}
            />
            <Tooltip
              contentStyle={{
                background: '#111115',
                border: '1px solid #27272a',
                borderRadius: 6,
                fontSize: 12,
              }}
              labelFormatter={(v) => `Delta ${Number(v) > 0 ? '+' : ''}${Math.round(Number(v))}`}
            />

            {statKeys.map((stat, i) =>
              visibleStats.includes(stat) ? (
                <Line
                  key={stat}
                  type="monotone"
                  dataKey={stat}
                  name={statLabel(stat)}
                  stroke={PLOT_COLORS[i % PLOT_COLORS.length]}
                  strokeWidth={2.5}
                  connectNulls
                  dot={{ r: 2.5, strokeWidth: 0 }}
                  activeDot={{ r: 4 }}
                />
              ) : null
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
