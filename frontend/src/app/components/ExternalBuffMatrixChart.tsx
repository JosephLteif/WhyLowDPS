'use client';

import { useEffect, useMemo, useState } from 'react';
import { useWowheadTooltips } from '../lib/useWowheadTooltips';

interface MatrixResult {
  name: string;
  dps: number;
  delta: number;
  items?: Array<Record<string, unknown>>;
}

const BUFF_META: Record<string, { spellId: number }> = {
  'Chaos Brand': { spellId: 255260 },
  'Mystic Touch': { spellId: 113746 },
  Skyfury: { spellId: 462854 },
  'Power Infusion': { spellId: 10060 },
  'Blessing of Bronze': { spellId: 381748 },
  'Augmentation Evoker Buffs': { spellId: 395152 },
};

const iconCache = new Map<number, string>();

function useSpellIcons(spellIds: number[]) {
  const [icons, setIcons] = useState<Map<number, string>>(new Map());
  const depKey = spellIds.join(',');

  useEffect(() => {
    const missing = spellIds.filter((id) => id > 0 && !iconCache.has(id));
    if (missing.length === 0) {
      setIcons(new Map(iconCache));
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
          if (data?.icon) iconCache.set(id, data.icon);
        } catch {
          // ignore icon fetch errors
        }
      })
    ).then(() => {
      if (!cancelled) setIcons(new Map(iconCache));
    });
    return () => {
      cancelled = true;
    };
  }, [depKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return icons;
}

export default function ExternalBuffMatrixChart({
  baseDps,
  results,
}: {
  baseDps: number;
  results: MatrixResult[];
}) {
  const rows = useMemo(
    () =>
      results
        .filter(
          (r) =>
            !String(r.name || '')
              .toLowerCase()
              .includes('currently equipped')
        )
        .map((r) => {
          const tagged = Array.isArray(r.items)
            ? r.items.find((i) => typeof i.external_buff === 'string')
            : null;
          const buffName =
            (tagged && typeof tagged.external_buff === 'string' ? tagged.external_buff : null) ||
            String(r.name || '')
              .split('|')
              .pop()
              ?.trim() ||
            String(r.name || 'Unknown');
          const meta = BUFF_META[buffName];
          return {
            buff: buffName,
            spellId: meta?.spellId,
            dps: Number(r.dps || 0),
            delta: Number(r.delta || 0),
          };
        })
        .sort((a, b) => b.delta - a.delta),
    [results]
  );

  const icons = useSpellIcons(rows.map((r) => r.spellId || 0).filter((id) => id > 0));
  useWowheadTooltips([rows, icons]);
  const maxGain = rows.length > 0 ? Math.max(...rows.map((r) => Math.max(0, r.delta))) : 0;

  return (
    <div className="card p-5">
      <h3 className="mb-2 text-sm font-semibold text-zinc-100">External Buff Matrix</h3>
      <p className="mb-4 text-xs text-zinc-400">
        Baseline DPS: {Math.round(baseDps).toLocaleString()}. Values below are gain/loss vs
        baseline.
      </p>

      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.buff} className="rounded-md border border-border bg-surface-2 p-3">
            <div className="mb-1.5 flex items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2 text-sm text-zinc-200">
                {row.spellId && icons.get(row.spellId) ? (
                  <a
                    href={`https://www.wowhead.com/spell=${row.spellId}`}
                    target="_blank"
                    rel="noreferrer"
                    data-wowhead={`spell=${row.spellId}`}
                    className="shrink-0"
                  >
                    <span
                      className="block h-5 w-5 rounded-[3px] bg-cover bg-center"
                      style={{
                        backgroundImage: `url(https://wow.zamimg.com/images/wow/icons/small/${icons.get(row.spellId)}.jpg)`,
                      }}
                    />
                  </a>
                ) : (
                  <span className="h-5 w-5 shrink-0 rounded-[3px] bg-surface" />
                )}
                <span className="truncate">{row.buff}</span>
              </span>
              <span className={row.delta >= 0 ? 'text-emerald-300' : 'text-red-300'}>
                {row.delta >= 0 ? '+' : ''}
                {Math.round(row.delta).toLocaleString()} DPS
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded bg-black/30">
              <div
                className={`h-full rounded ${row.delta >= 0 ? 'bg-emerald-400/80' : 'bg-red-400/80'}`}
                style={{
                  width:
                    maxGain > 0
                      ? `${Math.max(4, (Math.max(0, row.delta) / maxGain) * 100)}%`
                      : row.delta >= 0
                        ? '4%'
                        : '0%',
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
