'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useItemInfo, getIconUrl, getWowheadData, getWowheadUrl } from '../lib/useItemInfo';
import { useSpellIcons } from '../lib/useWowheadIcons';
import { useWowheadTooltips } from '../lib/useWowheadTooltips';

interface TimelinePoint {
  t: number;
  v: number;
}

interface TimelineEvent {
  t: number;
  spell_name: string;
  spell_id?: number;
  target?: string;
  queue_failed?: boolean;
}

interface BuffUptime {
  name: string;
  uptime_pct: number;
  spell_id?: number;
  is_cooldown?: boolean;
}

interface TopAction {
  name: string;
  count: number;
  share_pct: number;
  spell_id?: number;
}

interface AplAnalysis {
  total_actions?: number;
  unique_actions?: number;
  queue_failures?: number;
  top_actions?: TopAction[];
  gcd_spacing?: { avg: number; min: number; max: number };
}

interface TimelinePayload {
  events?: TimelineEvent[];
  cooldown_events?: TimelineEvent[];
  dps_series?: TimelinePoint[];
  resource_series?: TimelinePoint[];
  resource_series_map?: Record<string, TimelinePoint[]>;
  resource_type?: string;
  buff_uptimes?: BuffUptime[];
  event_count?: number;
  events_truncated?: boolean;
}

interface SimTimelineAnalyzerProps {
  timeline: TimelinePayload;
  aplAnalysis?: AplAnalysis;
  equippedGear?: Record<
    string,
    {
      item_id: number;
      name?: string;
      ilevel?: number;
      bonus_ids?: number[];
      enchant_id?: number;
      gem_id?: number;
    }
  >;
}

function SpellIcon({ icon }: { icon: string }) {
  return (
    <img
      src={`https://wow.zamimg.com/images/wow/icons/small/${icon}.jpg`}
      alt=""
      className="h-5 w-5 shrink-0 rounded-[3px]"
    />
  );
}

function normalizeToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/^use_item_/, '')
    .replace(/['`]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function titleCaseUnderscore(value: string): string {
  return value
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return '0.00';
  return seconds.toFixed(2);
}

function formatResource(resourceType?: string): string {
  if (!resourceType) return 'Resource';
  return resourceType
    .split('_')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}

function resourceColor(resourceType: string): string {
  const key = resourceType.toLowerCase();
  if (key.includes('mana')) return '#7DD3FC';
  if (key.includes('soul')) return '#A78BFA';
  if (key.includes('rage')) return '#F87171';
  if (key.includes('energy')) return '#34D399';
  if (key.includes('focus')) return '#FBBF24';
  if (key.includes('runic')) return '#93C5FD';
  if (key.includes('insanity')) return '#C084FC';
  if (key.includes('holy')) return '#FDE68A';
  if (key.includes('combo')) return '#FCA5A5';
  if (key.includes('maelstrom')) return '#60A5FA';
  if (key.includes('fury')) return '#FB7185';
  if (key.includes('astral')) return '#818CF8';
  if (key.includes('chi')) return '#22D3EE';
  return '#7DD3FC';
}

function resourceConfig(resourceType: string): { discrete: boolean; max?: number } {
  const key = resourceType.toLowerCase();
  if (key === 'soul_shard' || key === 'soul_shards') return { discrete: true, max: 5 };
  if (key === 'holy_power') return { discrete: true, max: 5 };
  if (key === 'chi') return { discrete: true, max: 6 };
  if (key === 'combo_points') return { discrete: true, max: 7 };
  if (key === 'arcane_charges') return { discrete: true, max: 4 };
  if (key === 'runes') return { discrete: true, max: 6 };
  return { discrete: false };
}

function hashColor(name: string): string {
  const palette = [
    '#f43f5e',
    '#fb7185',
    '#f59e0b',
    '#facc15',
    '#22c55e',
    '#14b8a6',
    '#38bdf8',
    '#818cf8',
    '#a78bfa',
    '#d946ef',
  ];
  let h = 0;
  for (let i = 0; i < name.length; i += 1) {
    h = (h * 31 + name.charCodeAt(i)) >>> 0;
  }
  return palette[h % palette.length];
}

function laneTickStep(duration: number): number {
  if (duration <= 20) return 1;
  if (duration <= 45) return 2;
  if (duration <= 90) return 5;
  if (duration <= 180) return 10;
  return 15;
}

export default function SimTimelineAnalyzer({
  timeline,
  aplAnalysis,
  equippedGear,
}: SimTimelineAnalyzerProps) {
  const [showAllEvents, setShowAllEvents] = useState(false);
  const [sequenceView, setSequenceView] = useState<'lanes' | 'table'>('lanes');
  const [sequenceZoom, setSequenceZoom] = useState<1 | 2 | 4>(2);
  const events = useMemo(() => timeline.events || [], [timeline.events]);
  const cooldownEvents = useMemo(() => timeline.cooldown_events || [], [timeline.cooldown_events]);
  const dpsSeries = useMemo(() => timeline.dps_series || [], [timeline.dps_series]);
  const resourceSeries = useMemo(() => timeline.resource_series || [], [timeline.resource_series]);
  const resourceSeriesMap = useMemo(() => {
    const map = timeline.resource_series_map || {};
    const keys = Object.keys(map);
    if (keys.length > 0) return map;
    if (timeline.resource_type && resourceSeries.length > 0) {
      return { [timeline.resource_type]: resourceSeries };
    }
    return {};
  }, [timeline.resource_series_map, timeline.resource_type, resourceSeries]);
  const resourceKeys = useMemo(() => Object.keys(resourceSeriesMap), [resourceSeriesMap]);
  const buffUptimes = useMemo(() => timeline.buff_uptimes || [], [timeline.buff_uptimes]);
  const topActions = useMemo(() => aplAnalysis?.top_actions || [], [aplAnalysis?.top_actions]);
  const equippedItems = useMemo(
    () =>
      Object.values(equippedGear || {}).filter(
        (item): item is NonNullable<typeof item> => !!item && item.item_id > 0
      ),
    [equippedGear]
  );
  const equippedItemQueries = useMemo(
    () =>
      equippedItems.map((item) => ({
        item_id: item.item_id,
        bonus_ids: item.bonus_ids,
      })),
    [equippedItems]
  );
  const equippedItemInfo = useItemInfo(equippedItemQueries);
  const itemByToken = useMemo(() => {
    const map = new Map<
      string,
      {
        item_id: number;
        name: string;
        icon?: string;
        ilevel?: number;
        bonus_ids?: number[];
        enchant_id?: number;
        gem_id?: number;
      }
    >();
    for (const item of equippedItems) {
      const info = equippedItemInfo[item.item_id];
      const displayName = info?.name || item.name || `Item ${item.item_id}`;
      const token = normalizeToken(displayName);
      if (!token) continue;
      map.set(token, {
        item_id: item.item_id,
        name: displayName,
        icon: info?.icon,
        ilevel: item.ilevel,
        bonus_ids: item.bonus_ids,
        enchant_id: item.enchant_id,
        gem_id: item.gem_id,
      });
    }
    return map;
  }, [equippedItems, equippedItemInfo]);

  const resolveTimelineAction = useMemo(
    () => (actionName: string, spellId?: number) => {
      const token = normalizeToken(actionName);
      const item = token ? itemByToken.get(token) : undefined;
      if (item) {
        return {
          label: item.name,
          kind: 'item' as const,
          item,
          spellId,
        };
      }
      if (actionName.toLowerCase().startsWith('use_item_')) {
        return {
          label: titleCaseUnderscore(token || actionName),
          kind: 'spell' as const,
          spellId,
        };
      }
      return {
        label: actionName,
        kind: 'spell' as const,
        spellId,
      };
    },
    [itemByToken]
  );

  const maxEventRows = showAllEvents ? events.length : 40;
  const visibleEvents = events.slice(0, maxEventRows);
  const maxLaneEvents = showAllEvents ? events.length : 220;
  const laneEvents = events.slice(0, maxLaneEvents);

  const laneGroups = useMemo(() => {
    const bySpell = new Map<
      string,
      { spellName: string; spellId?: number; events: TimelineEvent[]; color: string }
    >();
    for (const event of laneEvents) {
      const spell = event.spell_name || 'Unknown';
      const existing = bySpell.get(spell);
      if (existing) {
        existing.events.push(event);
      } else {
        bySpell.set(spell, {
          spellName: spell,
          spellId: event.spell_id,
          events: [event],
          color: hashColor(spell),
        });
      }
    }
    const grouped = [...bySpell.values()]
      .map((group) => ({
        ...group,
        events: [...group.events].sort((a, b) => a.t - b.t),
        resolved: resolveTimelineAction(group.spellName, group.spellId),
      }))
      .sort((a, b) => {
        const aFirst = a.events[0]?.t ?? 0;
        const bFirst = b.events[0]?.t ?? 0;
        if (aFirst !== bFirst) return aFirst - bFirst;
        return b.events.length - a.events.length;
      });
    return showAllEvents ? grouped : grouped.slice(0, 26);
  }, [laneEvents, showAllEvents, resolveTimelineAction]);

  const laneTimeBounds = useMemo(() => {
    const source = laneEvents.length > 0 ? laneEvents : events;
    if (source.length === 0) return { min: 0, max: 1, duration: 1 };
    const min = source[0].t;
    const max = source[source.length - 1].t;
    return { min, max, duration: Math.max(0.1, max - min) };
  }, [laneEvents, events]);

  const laneTicks = useMemo(() => {
    const step = laneTickStep(laneTimeBounds.duration);
    const start = Math.floor(laneTimeBounds.min / step) * step;
    const end = Math.ceil(laneTimeBounds.max / step) * step;
    const ticks: number[] = [];
    for (let t = start; t <= end; t += step) ticks.push(t);
    return ticks;
  }, [laneTimeBounds]);

  const laneTimelineWidth = useMemo(() => {
    const pxPerSecond = 34;
    return Math.max(1200, laneTimeBounds.duration * pxPerSecond * sequenceZoom);
  }, [laneTimeBounds.duration, sequenceZoom]);

  const dpsLookup = useMemo(() => {
    const out: Record<number, number> = {};
    for (const point of dpsSeries) {
      out[Math.round(point.t)] = point.v;
    }
    return out;
  }, [dpsSeries]);

  const cooldownMarkers = useMemo(
    () =>
      cooldownEvents.slice(0, 80).map((event, idx) => ({
        t: event.t,
        markerY: dpsLookup[Math.round(event.t)] || dpsSeries[dpsSeries.length - 1]?.v || 0,
        spell_name: event.spell_name,
        spell_id: event.spell_id,
        key: `${event.spell_name}_${event.t}_${idx}`,
      })),
    [cooldownEvents, dpsLookup, dpsSeries]
  );

  const spellIds = useMemo(() => {
    const ids = new Set<number>();
    for (const event of laneEvents) {
      if (event.spell_id) ids.add(event.spell_id);
    }
    for (const action of topActions) {
      if (action.spell_id) ids.add(action.spell_id);
    }
    for (const buff of buffUptimes) {
      if (buff.spell_id) ids.add(buff.spell_id);
    }
    return [...ids];
  }, [laneEvents, topActions, buffUptimes]);
  const icons = useSpellIcons(spellIds);
  useWowheadTooltips([
    events,
    laneGroups,
    topActions,
    buffUptimes,
    sequenceView,
    showAllEvents,
    sequenceZoom,
    equippedItemInfo,
  ]);

  return (
    <div className="space-y-4">
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-border/70 bg-surface-2/70 px-3 py-2">
          <p className="text-[11px] uppercase tracking-wide text-zinc-500">Actions</p>
          <p className="mt-1 font-mono text-sm text-zinc-100">{aplAnalysis?.total_actions ?? 0}</p>
        </div>
        <div className="rounded-lg border border-border/70 bg-surface-2/70 px-3 py-2">
          <p className="text-[11px] uppercase tracking-wide text-zinc-500">Unique Actions</p>
          <p className="mt-1 font-mono text-sm text-zinc-100">{aplAnalysis?.unique_actions ?? 0}</p>
        </div>
        <div className="rounded-lg border border-border/70 bg-surface-2/70 px-3 py-2">
          <p className="text-[11px] uppercase tracking-wide text-zinc-500">Queue Failures</p>
          <p className="mt-1 font-mono text-sm text-zinc-100">{aplAnalysis?.queue_failures ?? 0}</p>
        </div>
        <div className="rounded-lg border border-border/70 bg-surface-2/70 px-3 py-2">
          <p className="text-[11px] uppercase tracking-wide text-zinc-500">Avg Action Gap</p>
          <p className="mt-1 font-mono text-sm text-zinc-100">
            {aplAnalysis?.gcd_spacing?.avg != null
              ? `${aplAnalysis.gcd_spacing.avg.toFixed(3)}s`
              : '-'}
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-border/70 bg-surface-2/70 p-4">
        <h4 className="mb-3 text-xs font-medium uppercase tracking-widest text-muted">
          DPS Timeline
        </h4>
        {dpsSeries.length > 0 ? (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={dpsSeries} margin={{ top: 10, right: 14, left: -8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                <XAxis
                  dataKey="t"
                  tick={{ fill: '#8f8f9a', fontSize: 11 }}
                  tickFormatter={(v) => `${Math.round(Number(v))}s`}
                  minTickGap={20}
                />
                <YAxis tick={{ fill: '#8f8f9a', fontSize: 11 }} width={64} />
                <Tooltip
                  cursor={{ stroke: 'rgba(212,168,67,0.4)' }}
                  contentStyle={{
                    background: '#141416',
                    border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: 8,
                    color: '#f4f4f5',
                    fontSize: 12,
                  }}
                  formatter={(value) => [
                    `${Math.round(Number(value ?? 0)).toLocaleString()} DPS`,
                    'DPS',
                  ]}
                  labelFormatter={(label) => `Time ${formatTime(Number(label))}s`}
                />
                <Line
                  type="monotone"
                  dataKey="v"
                  stroke="#D4A843"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
                {cooldownMarkers.length > 0 && (
                  <Scatter
                    data={cooldownMarkers}
                    dataKey="markerY"
                    fill="#8B5CF6"
                    shape="circle"
                    isAnimationActive={false}
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-sm text-zinc-500">No DPS timeline data available in this result.</p>
        )}
      </div>

      {resourceKeys.length > 0 && (
        <div className="rounded-lg border border-border/70 bg-surface-2/70 p-4">
          <h4 className="mb-3 text-xs font-medium uppercase tracking-widest text-muted">
            Resource Timelines
          </h4>
          <div className="space-y-4">
            {resourceKeys.map((resourceKey) => {
              const baseSeries = resourceSeriesMap[resourceKey] || [];
              const cfg = resourceConfig(resourceKey);
              const series = cfg.discrete
                ? baseSeries.map((p) => ({ ...p, v: Math.round(p.v) }))
                : baseSeries;
              if (series.length === 0) return null;
              const observedMax = series.reduce((max, p) => Math.max(max, p.v), 0);
              const yMax = cfg.max ?? Math.ceil(observedMax);
              const yTicks =
                cfg.discrete && yMax > 0
                  ? Array.from({ length: yMax + 1 }, (_, i) => i)
                  : undefined;
              return (
                <div key={resourceKey}>
                  <p className="mb-1.5 text-[12px] font-medium text-zinc-300">
                    {formatResource(resourceKey)}
                  </p>
                  <div className="h-40">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart
                        data={series}
                        margin={{ top: 10, right: 14, left: -8, bottom: 0 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                        <XAxis
                          dataKey="t"
                          tick={{ fill: '#8f8f9a', fontSize: 11 }}
                          tickFormatter={(v) => `${Math.round(Number(v))}s`}
                          minTickGap={20}
                        />
                        <YAxis
                          tick={{ fill: '#8f8f9a', fontSize: 11 }}
                          width={64}
                          domain={cfg.discrete ? [0, yMax] : ['auto', 'auto']}
                          ticks={yTicks}
                          allowDecimals={!cfg.discrete}
                        />
                        <Tooltip
                          cursor={{ stroke: 'rgba(125,211,252,0.35)' }}
                          contentStyle={{
                            background: '#141416',
                            border: '1px solid rgba(255,255,255,0.12)',
                            borderRadius: 8,
                            color: '#f4f4f5',
                            fontSize: 12,
                          }}
                          formatter={(value) => [
                            cfg.discrete
                              ? String(Math.round(Number(value ?? 0)))
                              : Number(value ?? 0).toFixed(1),
                            formatResource(resourceKey),
                          ]}
                          labelFormatter={(label) => `Time ${formatTime(Number(label))}s`}
                        />
                        <Line
                          type={cfg.discrete ? 'stepAfter' : 'monotone'}
                          dataKey="v"
                          stroke={resourceColor(resourceKey)}
                          strokeWidth={2}
                          dot={false}
                          isAnimationActive={false}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border/70 bg-surface-2/70 p-4">
          <h4 className="mb-3 text-xs font-medium uppercase tracking-widest text-muted">
            Top APL Actions
          </h4>
          {topActions.length === 0 ? (
            <p className="text-sm text-zinc-500">No action data available.</p>
          ) : (
            <div className="space-y-1.5">
              {topActions.map((action) => (
                <div
                  key={action.name}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-white/[0.02]"
                >
                  {(() => {
                    const resolved = resolveTimelineAction(action.name, action.spell_id);
                    if (resolved.kind === 'item' && resolved.item?.item_id) {
                      return (
                        <a
                          href={getWowheadUrl(resolved.item.item_id)}
                          data-wowhead={`item=${resolved.item.item_id}${(() => {
                            const extra = getWowheadData(
                              resolved.item.bonus_ids,
                              resolved.item.ilevel,
                              resolved.item.enchant_id,
                              resolved.item.gem_id
                            );
                            return extra ? `&${extra}` : '';
                          })()}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.preventDefault()}
                        >
                          {resolved.item.icon ? (
                            <img
                              src={getIconUrl(resolved.item.icon)}
                              alt=""
                              className="h-5 w-5 shrink-0 rounded-[3px]"
                            />
                          ) : (
                            <span className="h-5 w-5 shrink-0 rounded-[3px] bg-surface" />
                          )}
                        </a>
                      );
                    }
                    if (action.spell_id && icons.get(action.spell_id)) {
                      return (
                        <a
                          href={`https://www.wowhead.com/spell=${action.spell_id}`}
                          data-wowhead={`spell=${action.spell_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.preventDefault()}
                        >
                          <SpellIcon icon={icons.get(action.spell_id)!} />
                        </a>
                      );
                    }
                    return <span className="h-5 w-5 shrink-0 rounded-[3px] bg-surface" />;
                  })()}
                  <span className="min-w-0 flex-1 truncate text-sm text-zinc-200">
                    {resolveTimelineAction(action.name, action.spell_id).label}
                  </span>
                  <span className="w-12 text-right font-mono text-xs text-zinc-400">
                    {action.count}
                  </span>
                  <span className="w-14 text-right font-mono text-xs text-zinc-500">
                    {action.share_pct.toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-lg border border-border/70 bg-surface-2/70 p-4">
          <h4 className="mb-3 text-xs font-medium uppercase tracking-widest text-muted">
            Buff Uptimes
          </h4>
          {buffUptimes.length === 0 ? (
            <p className="text-sm text-zinc-500">No buff uptime data available.</p>
          ) : (
            <div className="space-y-2">
              {buffUptimes.slice(0, 14).map((buff, idx) => (
                <div key={`${buff.name || 'buff'}:${buff.spell_id || 0}:${idx}`}>
                  <div className="mb-1 flex items-center gap-2">
                    {buff.spell_id && icons.get(buff.spell_id) ? (
                      <a
                        href={`https://www.wowhead.com/spell=${buff.spell_id}`}
                        data-wowhead={`spell=${buff.spell_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.preventDefault()}
                      >
                        <SpellIcon icon={icons.get(buff.spell_id)!} />
                      </a>
                    ) : (
                      <span className="h-5 w-5 shrink-0 rounded-[3px] bg-surface" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-sm text-zinc-200">
                      {buff.name}
                    </span>
                    <span className="w-14 text-right font-mono text-xs text-zinc-400">
                      {buff.uptime_pct.toFixed(2)}%
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-white/[0.06]">
                    <div
                      className={`h-full rounded-full ${buff.is_cooldown ? 'bg-violet-400/80' : 'bg-emerald-400/80'}`}
                      style={{ width: `${Math.max(0, Math.min(100, buff.uptime_pct))}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-border/70 bg-surface-2/70 p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h4 className="text-xs font-medium uppercase tracking-widest text-muted">
            Action Sequence
          </h4>
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-md border border-border bg-surface p-0.5 text-[12px]">
              <button
                type="button"
                onClick={() => setSequenceView('lanes')}
                className={`rounded px-2 py-1 transition-colors ${
                  sequenceView === 'lanes'
                    ? 'bg-gold/15 text-gold'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Timeline Lanes
              </button>
              <button
                type="button"
                onClick={() => setSequenceView('table')}
                className={`rounded px-2 py-1 transition-colors ${
                  sequenceView === 'table'
                    ? 'bg-gold/15 text-gold'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Table
              </button>
            </div>
            {sequenceView === 'lanes' && (
              <div className="inline-flex rounded-md border border-border bg-surface p-0.5 text-[12px]">
                {[1, 2, 4].map((z) => (
                  <button
                    key={z}
                    type="button"
                    onClick={() => setSequenceZoom(z as 1 | 2 | 4)}
                    className={`rounded px-2 py-1 transition-colors ${
                      sequenceZoom === z
                        ? 'bg-gold/15 text-gold'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {z}x
                  </button>
                ))}
              </div>
            )}
            {events.length > 40 && (
              <button
                type="button"
                onClick={() => setShowAllEvents((v) => !v)}
                className="rounded-md border border-border px-2 py-1 text-[12px] text-zinc-300 transition-colors hover:border-zinc-500 hover:text-zinc-100"
              >
                {showAllEvents ? 'Show Less' : `Show All (${events.length})`}
              </button>
            )}
          </div>
        </div>
        {events.length === 0 ? (
          <p className="text-sm text-zinc-500">No action sequence data available.</p>
        ) : sequenceView === 'lanes' ? (
          <div className="max-h-[32rem] overflow-auto rounded-md border border-border/60">
            <div style={{ width: `${220 + laneTimelineWidth}px` }}>
              <div className="sticky top-0 z-10 flex border-b border-border/60 bg-[#101013]">
                <div className="sticky left-0 z-30 w-[220px] shrink-0 border-r border-border/60 bg-[#101013] px-2 py-2 text-[11px] uppercase tracking-wide text-zinc-500">
                  Ability
                </div>
                <div className="relative h-8 shrink-0" style={{ width: `${laneTimelineWidth}px` }}>
                  {laneTicks.map((tick) => {
                    const pct = ((tick - laneTimeBounds.min) / laneTimeBounds.duration) * 100;
                    return (
                      <div key={tick} className="absolute inset-y-0" style={{ left: `${pct}%` }}>
                        <div className="h-full border-l border-white/15" />
                        <span className="absolute -top-0.5 left-1 text-[11px] text-zinc-400">
                          {Math.max(0, Math.round(tick))}s
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
              {laneGroups.map((lane) => (
                <div key={lane.spellName} className="flex border-b border-border/40">
                  <div className="sticky left-0 z-20 flex w-[220px] shrink-0 items-center gap-2 border-r border-border/40 bg-[#101013] px-2 py-2">
                    {lane.resolved.kind === 'item' && lane.resolved.item?.item_id ? (
                      <a
                        href={getWowheadUrl(lane.resolved.item.item_id)}
                        data-wowhead={`item=${lane.resolved.item.item_id}${(() => {
                          const extra = getWowheadData(
                            lane.resolved.item.bonus_ids,
                            lane.resolved.item.ilevel,
                            lane.resolved.item.enchant_id,
                            lane.resolved.item.gem_id
                          );
                          return extra ? `&${extra}` : '';
                        })()}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.preventDefault()}
                      >
                        {lane.resolved.item.icon ? (
                          <img
                            src={getIconUrl(lane.resolved.item.icon)}
                            alt=""
                            className="h-5 w-5 shrink-0 rounded-[3px]"
                          />
                        ) : (
                          <span className="h-5 w-5 shrink-0 rounded-[3px] bg-surface" />
                        )}
                      </a>
                    ) : lane.spellId && icons.get(lane.spellId) ? (
                      <a
                        href={`https://www.wowhead.com/spell=${lane.spellId}`}
                        data-wowhead={`spell=${lane.spellId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.preventDefault()}
                      >
                        <SpellIcon icon={icons.get(lane.spellId)!} />
                      </a>
                    ) : (
                      <span className="h-5 w-5 shrink-0 rounded-[3px] bg-surface" />
                    )}
                    <span className="truncate text-sm text-zinc-200">{lane.resolved.label}</span>
                  </div>
                  <div
                    className="relative h-10 shrink-0"
                    style={{ width: `${laneTimelineWidth}px` }}
                  >
                    {lane.events.map((event, idx) => {
                      const leftPct =
                        ((event.t - laneTimeBounds.min) / laneTimeBounds.duration) * 100;
                      const nextT = lane.events[idx + 1]?.t;
                      const widthPct =
                        nextT != null
                          ? Math.max(0.35, ((nextT - event.t) / laneTimeBounds.duration) * 100)
                          : 0.55;
                      return (
                        <div key={`${lane.spellName}_${event.t}_${idx}`}>
                          <div
                            className="absolute top-1/2 h-5 -translate-y-1/2 rounded-[3px] opacity-55"
                            style={{
                              left: `${leftPct}%`,
                              width: `${Math.min(widthPct, 100 - leftPct)}%`,
                              backgroundColor: lane.color,
                            }}
                            title={`${lane.spellName} @ ${formatTime(event.t)}s`}
                          />
                          {(() => {
                            const resolved = resolveTimelineAction(
                              event.spell_name,
                              event.spell_id
                            );
                            if (resolved.kind === 'item' && resolved.item?.item_id) {
                              return (
                                <a
                                  href={getWowheadUrl(resolved.item.item_id)}
                                  data-wowhead={`item=${resolved.item.item_id}${(() => {
                                    const extra = getWowheadData(
                                      resolved.item.bonus_ids,
                                      resolved.item.ilevel,
                                      resolved.item.enchant_id,
                                      resolved.item.gem_id
                                    );
                                    return extra ? `&${extra}` : '';
                                  })()}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.preventDefault()}
                                  className={`absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[3px] border ${
                                    event.queue_failed ? 'border-red-400' : 'border-black/50'
                                  }`}
                                  style={{ left: `${leftPct}%` }}
                                  title={`${resolved.label} @ ${formatTime(event.t)}s`}
                                >
                                  {resolved.item.icon ? (
                                    <img
                                      src={getIconUrl(resolved.item.icon)}
                                      alt=""
                                      className="h-full w-full"
                                    />
                                  ) : (
                                    <span className="block h-full w-full bg-surface" />
                                  )}
                                </a>
                              );
                            }
                            if (event.spell_id && icons.get(event.spell_id)) {
                              return (
                                <a
                                  href={`https://www.wowhead.com/spell=${event.spell_id}`}
                                  data-wowhead={`spell=${event.spell_id}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.preventDefault()}
                                  className={`absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[3px] border ${
                                    event.queue_failed ? 'border-red-400' : 'border-black/50'
                                  }`}
                                  style={{ left: `${leftPct}%` }}
                                  title={`${resolved.label} @ ${formatTime(event.t)}s`}
                                >
                                  <img
                                    src={`https://wow.zamimg.com/images/wow/icons/small/${icons.get(event.spell_id)!}.jpg`}
                                    alt=""
                                    className="h-full w-full"
                                  />
                                </a>
                              );
                            }
                            return (
                              <div
                                className={`absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-[3px] border ${
                                  event.queue_failed ? 'border-red-400' : 'border-black/40'
                                }`}
                                style={{ left: `${leftPct}%`, backgroundColor: lane.color }}
                                title={`${resolved.label} @ ${formatTime(event.t)}s`}
                              />
                            );
                          })()}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="max-h-[26rem] overflow-auto">
            <table className="w-full table-fixed border-collapse text-left text-[13px]">
              <thead className="sticky top-0 bg-[#101013] text-[11px] uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="w-20 px-2 py-2 font-medium">Time</th>
                  <th className="px-2 py-2 font-medium">Ability</th>
                  <th className="w-40 px-2 py-2 font-medium">Target</th>
                  <th className="w-28 px-2 py-2 text-right font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {visibleEvents.map((event, idx) => (
                  <tr
                    key={`${event.t}_${event.spell_name}_${idx}`}
                    className="border-t border-border/40"
                  >
                    <td className="px-2 py-1.5 font-mono text-zinc-400">{formatTime(event.t)}s</td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-2">
                        {(() => {
                          const resolved = resolveTimelineAction(event.spell_name, event.spell_id);
                          if (resolved.kind === 'item' && resolved.item?.item_id) {
                            return (
                              <a
                                href={getWowheadUrl(resolved.item.item_id)}
                                data-wowhead={`item=${resolved.item.item_id}${(() => {
                                  const extra = getWowheadData(
                                    resolved.item.bonus_ids,
                                    resolved.item.ilevel,
                                    resolved.item.enchant_id,
                                    resolved.item.gem_id
                                  );
                                  return extra ? `&${extra}` : '';
                                })()}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.preventDefault()}
                              >
                                {resolved.item.icon ? (
                                  <img
                                    src={getIconUrl(resolved.item.icon)}
                                    alt=""
                                    className="h-5 w-5 shrink-0 rounded-[3px]"
                                  />
                                ) : (
                                  <span className="h-5 w-5 shrink-0 rounded-[3px] bg-surface" />
                                )}
                              </a>
                            );
                          }
                          if (event.spell_id && icons.get(event.spell_id)) {
                            return (
                              <a
                                href={`https://www.wowhead.com/spell=${event.spell_id}`}
                                data-wowhead={`spell=${event.spell_id}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.preventDefault()}
                              >
                                <SpellIcon icon={icons.get(event.spell_id)!} />
                              </a>
                            );
                          }
                          return <span className="h-5 w-5 shrink-0 rounded-[3px] bg-surface" />;
                        })()}
                        <span className="truncate text-zinc-200">
                          {resolveTimelineAction(event.spell_name, event.spell_id).label}
                        </span>
                      </div>
                    </td>
                    <td className="truncate px-2 py-1.5 text-zinc-500">{event.target || '-'}</td>
                    <td className="px-2 py-1.5 text-right">
                      {event.queue_failed ? (
                        <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-[11px] text-red-300">
                          Queue Fail
                        </span>
                      ) : (
                        <span className="bg-emerald-500/12 rounded px-1.5 py-0.5 text-[11px] text-emerald-300">
                          Cast
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {timeline.events_truncated && (
          <p className="mt-2 text-[12px] text-zinc-500">
            Timeline payload was capped for response size. Run with fewer iterations if you need the
            full sequence.
          </p>
        )}
      </div>
    </div>
  );
}
