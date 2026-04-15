'use client';

import { getIconUrl, getWowheadData, getWowheadUrl, useItemInfo } from '../lib/useItemInfo';
import { useWowheadTooltips } from '../lib/useWowheadTooltips';

type HeatmapResult = {
  name: string;
  dps: number;
  delta: number;
  items: Array<Record<string, unknown>>;
};

type TrinketPairItem = {
  label: string;
  itemId: number;
  name: string;
  ilevel: number;
  bonusIds: number[];
};

const TIER_SLOTS = ['head', 'shoulder', 'chest', 'hands', 'legs'] as const;
const TIER_SLOT_LABELS: Record<string, string> = {
  head: 'Head',
  shoulder: 'Shoulder',
  chest: 'Chest',
  hands: 'Hands',
  legs: 'Legs',
};

function deltaToBg(delta: number, maxAbs: number): string {
  if (maxAbs <= 0) return 'rgba(63,63,70,0.35)';
  const normalized = Math.min(1, Math.abs(delta) / maxAbs);
  if (delta >= 0) {
    return `rgba(52, 211, 153, ${0.18 + normalized * 0.42})`;
  }
  return `rgba(248, 113, 113, ${0.18 + normalized * 0.42})`;
}

function itemLabel(item: Record<string, unknown>): string {
  const name = typeof item.name === 'string' ? item.name : 'Unknown';
  const ilvl = typeof item.ilevel === 'number' ? item.ilevel : 0;
  return `${name} (${ilvl})`;
}

function parseTrinketPairItem(item: Record<string, unknown>): TrinketPairItem {
  const itemId = typeof item.item_id === 'number' ? item.item_id : 0;
  const name = typeof item.name === 'string' ? item.name : 'Unknown';
  const ilevel = typeof item.ilevel === 'number' ? item.ilevel : 0;
  const bonusIds = Array.isArray(item.bonus_ids)
    ? item.bonus_ids.filter((v): v is number => typeof v === 'number')
    : [];
  return {
    label: `${name} (${ilevel})`,
    itemId,
    name,
    ilevel,
    bonusIds,
  };
}

export default function TrinketTierHeatmap({
  baseDps,
  results,
}: {
  baseDps: number;
  results: HeatmapResult[];
}) {
  const trinketResults = results.filter((result) => {
    const items = Array.isArray(result.items) ? result.items : [];
    return items.some((i) => i.heatmap_kind === 'trinket');
  });

  const tierResults = results.filter((result) => {
    const items = Array.isArray(result.items) ? result.items : [];
    return items.some((i) => i.heatmap_kind === 'tier');
  });

  const trinketLabels = new Set<string>();
  const trinketCells = new Map<string, HeatmapResult>();
  let maxAbsTrinketDelta = 0;

  for (const result of trinketResults) {
    const trinkets = (result.items || []).filter((item) => {
      const slot = typeof item.slot === 'string' ? item.slot : '';
      return slot === 'trinket1' || slot === 'trinket2';
    });
    if (trinkets.length < 2) continue;
    const labelA = itemLabel(trinkets[0]);
    const labelB = itemLabel(trinkets[1]);
    trinketLabels.add(labelA);
    trinketLabels.add(labelB);
    const key = [labelA, labelB].sort().join('||');
    const existing = trinketCells.get(key);
    if (!existing || result.dps > existing.dps) {
      trinketCells.set(key, result);
    }
    maxAbsTrinketDelta = Math.max(maxAbsTrinketDelta, Math.abs(result.delta || 0));
  }

  const trinketAxes = [...trinketLabels].sort((a, b) => a.localeCompare(b));
  const totalTrinketPairs =
    trinketAxes.length >= 2 ? (trinketAxes.length * (trinketAxes.length - 1)) / 2 : 0;
  const simulatedTrinketPairs = trinketCells.size;
  const missingTrinketPairs = Math.max(0, totalTrinketPairs - simulatedTrinketPairs);
  const rankedTrinketPairs = [...trinketCells.entries()]
    .map(([key, result]) => {
      const trinkets = (result?.items || [])
        .filter((item) => {
          const slot = typeof item.slot === 'string' ? item.slot : '';
          return slot === 'trinket1' || slot === 'trinket2';
        })
        .map(parseTrinketPairItem)
        .sort((a, b) => a.label.localeCompare(b.label));
      const leftItem = trinkets[0] || {
        label: 'Unknown',
        itemId: 0,
        name: 'Unknown',
        ilevel: 0,
        bonusIds: [],
      };
      const rightItem = trinkets[1] || {
        label: 'Unknown',
        itemId: 0,
        name: 'Unknown',
        ilevel: 0,
        bonusIds: [],
      };
      const delta = result?.delta || 0;
      return {
        key,
        leftItem,
        rightItem,
        delta,
      };
    })
    .sort((a, b) => b.delta - a.delta);
  const positiveTrinketPairs = rankedTrinketPairs.filter((pair) => pair.delta > 0).slice(0, 12);
  const topPairItemQueries = positiveTrinketPairs.flatMap((pair) => [
    { item_id: pair.leftItem.itemId, bonus_ids: pair.leftItem.bonusIds },
    { item_id: pair.rightItem.itemId, bonus_ids: pair.rightItem.bonusIds },
  ]);
  const topPairItemInfo = useItemInfo(topPairItemQueries);
  useWowheadTooltips([positiveTrinketPairs, topPairItemInfo]);

  const tierRows = new Map<number, Record<string, { total: number; count: number }>>();
  let maxAbsTierDelta = 0;
  for (const result of tierResults) {
    const meta = (result.items || []).find((item) => item.heatmap_kind === 'tier') || {};
    const pieceCount =
      typeof meta.tier_pieces === 'number'
        ? meta.tier_pieces
        : (result.items || []).filter((item) => {
            const slot = typeof item.slot === 'string' ? item.slot : '';
            return TIER_SLOTS.includes(slot as (typeof TIER_SLOTS)[number]);
          }).length;
    if (!pieceCount) continue;
    if (!tierRows.has(pieceCount)) {
      tierRows.set(pieceCount, {});
    }
    const row = tierRows.get(pieceCount)!;
    for (const item of result.items || []) {
      const slot = typeof item.slot === 'string' ? item.slot : '';
      if (!TIER_SLOTS.includes(slot as (typeof TIER_SLOTS)[number])) continue;
      if (!row[slot]) row[slot] = { total: 0, count: 0 };
      row[slot].total += result.delta || 0;
      row[slot].count += 1;
      maxAbsTierDelta = Math.max(maxAbsTierDelta, Math.abs(result.delta || 0));
    }
  }

  const tierPieceCounts = [...tierRows.keys()].sort((a, b) => a - b);

  const tierSlotPriority = TIER_SLOTS.map((slot) => {
    let total = 0;
    let count = 0;
    for (const pieceCount of tierPieceCounts) {
      const row = tierRows.get(pieceCount) || {};
      const entry = row[slot];
      if (!entry || entry.count === 0) continue;
      total += entry.total;
      count += entry.count;
    }
    const score = count > 0 ? total / count : Number.NEGATIVE_INFINITY;
    return { slot, score };
  })
    .filter((entry) => Number.isFinite(entry.score))
    .sort((a, b) => b.score - a.score);

  return (
    <div className="space-y-6">
      <div className="card border-gold/10 bg-gold/[0.02] p-5">
        <h3 className="text-sm font-semibold text-zinc-100">
          Personalized Trinket / Tier Heatmaps
        </h3>
        <p className="mt-1 text-xs text-zinc-400">
          Baseline DPS: {Math.round(baseDps).toLocaleString()}.
        </p>
      </div>

      {trinketAxes.length > 0 && (
        <div className="card p-5">
          {positiveTrinketPairs.length > 0 && (
            <div className="mb-4 rounded-md border border-border bg-surface-2 p-3">
              <h5 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-zinc-400">
                Top Upgrade Pairs
              </h5>
              <div className="grid gap-2 md:grid-cols-2">
                {positiveTrinketPairs.map((pair, idx) => {
                  const leftInfo = topPairItemInfo[pair.leftItem.itemId];
                  const rightInfo = topPairItemInfo[pair.rightItem.itemId];
                  const leftIcon = getIconUrl(leftInfo?.icon || 'inv_misc_questionmark');
                  const rightIcon = getIconUrl(rightInfo?.icon || 'inv_misc_questionmark');
                  const leftWhData = pair.leftItem.itemId
                    ? `item=${pair.leftItem.itemId}${(() => {
                        const extra = getWowheadData(
                          pair.leftItem.bonusIds,
                          pair.leftItem.ilevel || leftInfo?.ilevel || 0
                        );
                        return extra ? `&${extra}` : '';
                      })()}`
                    : undefined;
                  const rightWhData = pair.rightItem.itemId
                    ? `item=${pair.rightItem.itemId}${(() => {
                        const extra = getWowheadData(
                          pair.rightItem.bonusIds,
                          pair.rightItem.ilevel || rightInfo?.ilevel || 0
                        );
                        return extra ? `&${extra}` : '';
                      })()}`
                    : undefined;

                  return (
                    <div
                      key={pair.key}
                      className="flex items-center justify-between gap-3 rounded border border-border/60 bg-black/10 px-2 py-1.5"
                    >
                      <span className="flex items-center gap-2 text-xs text-zinc-300">
                        <span>{idx + 1}.</span>
                        <a
                          href={pair.leftItem.itemId > 0 ? getWowheadUrl(pair.leftItem.itemId) : '#'}
                          target="_blank"
                          rel="noreferrer"
                          data-wowhead={leftWhData}
                          className="inline-flex items-center gap-1.5 hover:underline"
                        >
                          <img
                            src={leftIcon}
                            alt={pair.leftItem.name}
                            className="h-4 w-4 rounded-sm border border-white/10"
                          />
                          {pair.leftItem.label}
                        </a>
                        <span>+</span>
                        <a
                          href={
                            pair.rightItem.itemId > 0 ? getWowheadUrl(pair.rightItem.itemId) : '#'
                          }
                          target="_blank"
                          rel="noreferrer"
                          data-wowhead={rightWhData}
                          className="inline-flex items-center gap-1.5 hover:underline"
                        >
                          <img
                            src={rightIcon}
                            alt={pair.rightItem.name}
                            className="h-4 w-4 rounded-sm border border-white/10"
                          />
                          {pair.rightItem.label}
                        </a>
                      </span>
                      <span className="text-xs font-medium text-emerald-300">
                        +{Math.round(pair.delta).toLocaleString()}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <h4 className="text-xs font-medium uppercase tracking-widest text-muted">
            Trinket Pair Matrix
          </h4>
          <p className="mt-2 text-xs text-zinc-400">
            Simulated pairs: {simulatedTrinketPairs.toLocaleString()} /{' '}
            {totalTrinketPairs.toLocaleString()}
            {missingTrinketPairs > 0 ? (
              <span className="text-amber-300">
                {' '}
                ({missingTrinketPairs.toLocaleString()} missing from this run)
              </span>
            ) : null}
          </p>
          <div className="overflow-auto">
            <table className="min-w-full border-collapse text-xs">
              <thead>
                <tr>
                  <th className="sticky left-0 z-20 border border-border bg-surface-2 px-2 py-2 text-left text-zinc-300">
                    Trinket
                  </th>
                  {trinketAxes.map((label) => (
                    <th
                      key={label}
                      className="border border-border bg-surface-2 px-2 py-2 text-zinc-300"
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {trinketAxes.map((rowLabel) => (
                  <tr key={rowLabel}>
                    <th className="sticky left-0 z-10 border border-border bg-surface-2 px-2 py-2 text-left font-medium text-zinc-300">
                      {rowLabel}
                    </th>
                    {trinketAxes.map((colLabel) => {
                      if (rowLabel === colLabel) {
                        return (
                          <td
                            key={colLabel}
                            className="border border-border bg-black/20 px-2 py-2 text-center text-zinc-600"
                          >
                            -
                          </td>
                        );
                      }
                      const key = [rowLabel, colLabel].sort().join('||');
                      const match = trinketCells.get(key);
                      const delta = match?.delta || 0;
                      const missing = !match;
                      return (
                        <td
                          key={colLabel}
                          className={`border border-border px-2 py-2 text-center ${
                            missing ? 'text-zinc-500' : 'text-zinc-100'
                          }`}
                          style={{
                            backgroundColor: missing
                              ? 'rgba(63,63,70,0.35)'
                              : deltaToBg(delta, maxAbsTrinketDelta),
                          }}
                          title={missing ? 'Pair not simulated in this run.' : undefined}
                        >
                          {match
                            ? `${delta >= 0 ? '+' : ''}${Math.round(delta).toLocaleString()}`
                            : '-'}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card p-5">
        <h4 className="mb-3 text-xs font-medium uppercase tracking-widest text-muted">
          Tier Slot Impact Matrix
        </h4>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
          <div className="overflow-auto">
            <table className="min-w-[560px] border-collapse text-xs">
              <thead>
                <tr>
                  <th className="border border-border bg-surface-2 px-3 py-2 text-left text-zinc-300">
                    Tier Pieces
                  </th>
                  {TIER_SLOTS.map((slot) => (
                    <th
                      key={slot}
                      className="border border-border bg-surface-2 px-3 py-2 text-zinc-300"
                    >
                      {TIER_SLOT_LABELS[slot]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tierPieceCounts.map((count) => {
                  const row = tierRows.get(count) || {};
                  return (
                    <tr key={count}>
                      <th className="border border-border bg-surface-2 px-3 py-2 text-left font-medium text-zinc-300">
                        {count}p
                      </th>
                      {TIER_SLOTS.map((slot) => {
                        const entry = row[slot];
                        const avg = entry && entry.count > 0 ? entry.total / entry.count : 0;
                        return (
                          <td
                            key={slot}
                            className="border border-border px-3 py-2 text-center text-zinc-100"
                            style={{ backgroundColor: deltaToBg(avg, maxAbsTierDelta) }}
                          >
                            {entry
                              ? `${avg >= 0 ? '+' : ''}${Math.round(avg).toLocaleString()}`
                              : '-'}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="rounded-md border border-border bg-surface-2 p-3">
            <h5 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-zinc-400">
              Tier Priority
            </h5>
            {tierSlotPriority.length === 0 ? (
              <p className="text-xs text-zinc-500">Not enough tier data yet.</p>
            ) : (
              <ol className="space-y-1.5 text-xs text-zinc-200">
                {tierSlotPriority.map((entry, idx) => (
                  <li key={entry.slot} className="flex items-center justify-between gap-2">
                    <span className="text-zinc-300">
                      {idx + 1}. {TIER_SLOT_LABELS[entry.slot]}
                    </span>
                    <span className={entry.score >= 0 ? 'text-emerald-300' : 'text-red-300'}>
                      {entry.score >= 0 ? '+' : ''}
                      {Math.round(entry.score).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
