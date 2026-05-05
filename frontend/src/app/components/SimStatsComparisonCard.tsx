import type { SnapshotFlatStat, SnapshotPrimaryStat, SnapshotSecondaryStat, StatSnapshot } from '../lib/stat-snapshot';

function formatInteger(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '-';
  return Math.round(value).toLocaleString();
}

function formatPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '-';
  return `${value.toFixed(2)}%`;
}

function formatFlat(value: SnapshotFlatStat | null | undefined): string {
  return value ? formatInteger(value.value) : '-';
}

function formatSecondary(value: SnapshotSecondaryStat | null | undefined): string {
  if (!value) return '-';
  if (value.rating != null && value.percent != null) {
    return `${formatInteger(value.rating)} (${formatPercent(value.percent)})`;
  }
  if (value.rating != null) return formatInteger(value.rating);
  if (value.percent != null) return formatPercent(value.percent);
  return '-';
}

function renderDeltaNumber(delta: number | null): string {
  if (delta == null || !Number.isFinite(delta) || delta === 0) return '-';
  const prefix = delta > 0 ? '+' : '';
  return `${prefix}${Math.round(delta).toLocaleString()}`;
}

function renderDeltaPercent(delta: number | null): string {
  if (delta == null || !Number.isFinite(delta) || delta === 0) return '-';
  const prefix = delta > 0 ? '+' : '';
  return `${prefix}${delta.toFixed(2)}%`;
}

function deltaTone(delta: number | null): string {
  if (delta == null || !Number.isFinite(delta) || delta === 0) return 'text-zinc-500';
  return delta > 0 ? 'text-emerald-300' : 'text-red-300';
}

function SecondaryDelta({
  current,
  simulated,
}: {
  current: SnapshotSecondaryStat | null | undefined;
  simulated: SnapshotSecondaryStat | null | undefined;
}) {
  const ratingDelta =
    current?.rating != null && simulated?.rating != null
      ? simulated.rating - current.rating
      : null;
  const percentDelta =
    current?.percent != null && simulated?.percent != null
      ? simulated.percent - current.percent
      : null;

  if (ratingDelta == null && percentDelta == null) {
    return <span className="text-zinc-500">-</span>;
  }

  return (
    <div className="flex flex-col items-end leading-tight">
      <span className={`text-[14px] font-mono tabular-nums ${deltaTone(ratingDelta)}`}>
        {renderDeltaNumber(ratingDelta)}
      </span>
      {percentDelta != null ? (
        <span
          className={`font-mono tabular-nums text-[13px] font-medium opacity-95 ${deltaTone(percentDelta)}`}
        >
          {renderDeltaPercent(percentDelta)}
        </span>
      ) : null}
    </div>
  );
}

function FlatDelta({
  current,
  simulated,
}: {
  current: SnapshotFlatStat | SnapshotPrimaryStat | null | undefined;
  simulated: SnapshotFlatStat | SnapshotPrimaryStat | null | undefined;
}) {
  const currentValue = current?.value ?? null;
  const simulatedValue = simulated?.value ?? null;
  const delta =
    currentValue != null && simulatedValue != null ? simulatedValue - currentValue : null;

  return (
    <span className={`text-[14px] font-mono tabular-nums ${deltaTone(delta)}`}>
      {renderDeltaNumber(delta)}
    </span>
  );
}

export default function SimStatsComparisonCard({
  current,
  simulated,
  title = 'Stats Comparison',
  description,
  framed = true,
  currentLabel = 'Live',
  simulatedLabel = 'Simulated',
}: {
  current?: StatSnapshot | null;
  simulated?: StatSnapshot | null;
  title?: string;
  description?: string;
  framed?: boolean;
  currentLabel?: string;
  simulatedLabel?: string;
}) {
  if (!current && !simulated) return null;

  const primaryLabel = simulated?.primary?.label || current?.primary?.label || 'Main Stat';
  const rowClass =
    'grid grid-cols-[minmax(0,1.15fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,0.7fr)] gap-x-3 px-4 py-3 text-[14px] sm:px-5';

  return (
    <div className={framed ? 'card overflow-hidden border-border/70 bg-surface/95' : ''}>
      <div className="border-b border-border/60 px-4 py-4 sm:px-5">
        <div className="space-y-1">
          <h3 className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-400">{title}</h3>
          {description ? <p className="max-w-xl text-[12px] leading-5 text-zinc-400">{description}</p> : null}
        </div>
      </div>

      <div className="divide-y divide-border/50">
        <div className="grid grid-cols-[minmax(0,1.15fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,0.7fr)] gap-x-3 px-4 py-3 text-[12px] font-semibold uppercase tracking-[0.14em] text-zinc-500 sm:px-5">
          <div>Stat</div>
          <div className="text-right">
            {currentLabel}
          </div>
          <div className="text-right">
            {simulatedLabel}
          </div>
          <div className="text-right">
            Delta
          </div>
        </div>

        <div className={`${rowClass} items-center`}>
          <div className="text-zinc-200">{primaryLabel}</div>
          <div className="text-right font-mono tabular-nums text-zinc-200">
            {current?.primary ? formatInteger(current.primary.value) : '-'}
          </div>
          <div className="text-right font-mono tabular-nums text-zinc-100">
            {simulated?.primary ? formatInteger(simulated.primary.value) : '-'}
          </div>
          <div className="text-right font-mono tabular-nums">
            <FlatDelta current={current?.primary} simulated={simulated?.primary} />
          </div>
        </div>

        <div className={`${rowClass} items-center`}>
          <div className="text-zinc-200">Stamina</div>
          <div className="text-right font-mono tabular-nums text-zinc-200">{formatFlat(current?.stamina)}</div>
          <div className="text-right font-mono tabular-nums text-zinc-100">{formatFlat(simulated?.stamina)}</div>
          <div className="text-right font-mono tabular-nums">
            <FlatDelta current={current?.stamina} simulated={simulated?.stamina} />
          </div>
        </div>

        <div className={`${rowClass} items-center`}>
          <div className="text-zinc-200">Crit</div>
          <div className="text-right font-mono tabular-nums text-zinc-200">{formatSecondary(current?.crit)}</div>
          <div className="text-right font-mono tabular-nums text-zinc-100">{formatSecondary(simulated?.crit)}</div>
          <div className="text-right font-mono tabular-nums">
            <SecondaryDelta current={current?.crit} simulated={simulated?.crit} />
          </div>
        </div>

        <div className={`${rowClass} items-center`}>
          <div className="text-zinc-200">Haste</div>
          <div className="text-right font-mono tabular-nums text-zinc-200">{formatSecondary(current?.haste)}</div>
          <div className="text-right font-mono tabular-nums text-zinc-100">{formatSecondary(simulated?.haste)}</div>
          <div className="text-right font-mono tabular-nums">
            <SecondaryDelta current={current?.haste} simulated={simulated?.haste} />
          </div>
        </div>

        <div className={`${rowClass} items-center`}>
          <div className="text-zinc-200">Mastery</div>
          <div className="text-right font-mono tabular-nums text-zinc-200">{formatSecondary(current?.mastery)}</div>
          <div className="text-right font-mono tabular-nums text-zinc-100">{formatSecondary(simulated?.mastery)}</div>
          <div className="text-right font-mono tabular-nums">
            <SecondaryDelta current={current?.mastery} simulated={simulated?.mastery} />
          </div>
        </div>

        <div className={`${rowClass} items-center`}>
          <div className="text-zinc-200">Versatility</div>
          <div className="text-right font-mono tabular-nums text-zinc-200">{formatSecondary(current?.versatility)}</div>
          <div className="text-right font-mono tabular-nums text-zinc-100">{formatSecondary(simulated?.versatility)}</div>
          <div className="text-right font-mono tabular-nums">
            <SecondaryDelta current={current?.versatility} simulated={simulated?.versatility} />
          </div>
        </div>
      </div>
    </div>
  );
}
