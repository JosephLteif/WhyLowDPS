'use client';

import ConsumableSelect, { buildQualityMaxByFamily } from './ConsumableSelect';
import type { OptionEntry } from '../../lib/sim-options-catalog';
import { useEffect, useMemo, useState } from 'react';

const ITEM_ICON_CACHE = new Map<number, string>();

function useItemIcons(itemIds: number[]) {
  const [icons, setIcons] = useState<Map<number, string>>(new Map());
  const depKey = itemIds.join(',');
  useEffect(() => {
    const missing = itemIds.filter((id) => id > 0 && !ITEM_ICON_CACHE.has(id));
    if (missing.length === 0) {
      setIcons(new Map(ITEM_ICON_CACHE));
      return;
    }
    let canceled = false;
    Promise.all(
      missing.map(async (id) => {
        try {
          const res = await fetch(`https://nether.wowhead.com/tooltip/item/${id}?dataEnv=1&locale=0`);
          if (!res.ok) return;
          const data = await res.json();
          if (data?.icon) ITEM_ICON_CACHE.set(id, data.icon);
        } catch {}
      })
    ).then(() => {
      if (!canceled) setIcons(new Map(ITEM_ICON_CACHE));
    });
    return () => {
      canceled = true;
    };
  }, [depKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return icons;
}

function familyKey(token: string) {
  return token.replace(/^main_hand:/, '').replace(/_[1-3]$/i, '');
}

function baseLabel(label: string) {
  return (label || '')
    .replace(/\s*\((Gold|Silver|Bronze|Tier \d+)\)\s*$/i, '')
    .replace(/\s+[1-3]\s*$/i, '');
}

function tierStyle(q: number, active: boolean) {
  if (q === 3) return active ? 'border-amber-300/70 bg-amber-500' : 'border-amber-300/40 bg-amber-500/20';
  if (q === 2) return active ? 'border-zinc-300/70 bg-zinc-300' : 'border-zinc-300/40 bg-zinc-300/20';
  return active ? 'border-orange-400/70 bg-orange-500' : 'border-orange-400/40 bg-orange-500/20';
}

type Props = {
  title: string;
  label: string;
  mode: 'single' | 'multi';
  singleValue: string;
  onSingleChange: (v: string) => void;
  multiValues: string[];
  onMultiChange: (vals: string[]) => void;
  options: OptionEntry[];
  disabled?: boolean;
};

export default function ConsumablePicker(props: Props) {
  const qualityMaxByFamily = buildQualityMaxByFamily([props.options]);
  const itemIds = useMemo(
    () => props.options.map((o) => o.itemId).filter((id): id is number => !!id),
    [props.options]
  );
  const itemIcons = useItemIcons(itemIds);
  const grouped = (() => {
    const map = new Map<string, { label: string; icon?: string; items: OptionEntry[] }>();
    for (const opt of props.options) {
      const token = opt.token || '';
      if (!token) continue;
      const key = familyKey(token);
      const icon = (opt.itemId && itemIcons.get(opt.itemId)) || opt.icon;
      if (!map.has(key)) map.set(key, { label: baseLabel(opt.label || ''), icon, items: [] });
      map.get(key)!.items.push(opt);
    }
    return Array.from(map.values()).map((g) => ({
      ...g,
      items: g.items.sort((a, b) => (a.craftingQuality || 0) - (b.craftingQuality || 0)),
    }));
  })();

  return (
    <div className="space-y-2 rounded-md border border-border/70 bg-surface p-2.5">
      <p className="text-[13px] font-semibold uppercase tracking-wider text-zinc-300">{props.title}</p>
      {props.mode === 'single' ? (
        <ConsumableSelect
          label={props.label}
          value={props.singleValue}
          onChange={props.onSingleChange}
          options={props.options}
          qualityMaxByFamily={qualityMaxByFamily}
          disabled={props.disabled}
        />
      ) : (
        <div className="space-y-2">
          {grouped.map((group) => (
            <div key={group.label} className="flex items-center justify-between gap-2 rounded bg-surface-2 px-2 py-1.5">
              <div className="flex min-w-0 items-center gap-2">
                {group.icon ? (
                  <img src={`https://wow.zamimg.com/images/wow/icons/small/${group.icon}.jpg`} alt="" className="h-4 w-4 rounded-[3px]" />
                ) : null}
                <span className="truncate text-xs text-zinc-200">{group.label}</span>
              </div>
              <div className="flex items-center gap-1.5">
                {group.items.map((opt) => {
                  const token = opt.token || '';
                  const q = (() => {
                    const max = qualityMaxByFamily.get(familyKey(token)) || 0;
                    const raw = opt.craftingQuality || 0;
                    if (max === 2 && raw === 1) return 2;
                    if (max === 2 && raw === 2) return 3;
                    return raw;
                  })();
                  const active = token !== '' && props.multiValues.includes(token);
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => {
                        if (!token) return;
                        const next = active
                          ? props.multiValues.filter((v) => v !== token)
                          : [...props.multiValues, token];
                        props.onMultiChange(next);
                      }}
                      className={`h-4 w-4 rounded-[2px] border ${tierStyle(q, active)}`}
                      title={opt.label}
                      aria-label={opt.label}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
