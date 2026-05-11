'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { OptionEntry } from '../../lib/sim-options-catalog';
import { useWowheadTooltips } from '../../lib/useWowheadTooltips';

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

    let cancelled = false;
    Promise.all(
      missing.map(async (id) => {
        try {
          const res = await fetch(`https://nether.wowhead.com/tooltip/item/${id}?dataEnv=1&locale=0`);
          if (!res.ok) return;
          const data = await res.json();
          if (data?.icon) ITEM_ICON_CACHE.set(id, data.icon);
        } catch {
          // Ignore fetch failures
        }
      })
    ).then(() => {
      if (!cancelled) setIcons(new Map(ITEM_ICON_CACHE));
    });

    return () => {
      cancelled = true;
    };
  }, [depKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return icons;
}

export function optionQualityFamily(opt: OptionEntry | null) {
  const token = (opt?.token || opt?.key || '').replace(/^main_hand:/, '');
  return token.replace(/_[1-3]$/i, '');
}

export function buildQualityMaxByFamily(groups: OptionEntry[][]): Map<string, number> {
  const map = new Map<string, number>();
  for (const opts of groups) {
    for (const opt of opts) {
      const family = optionQualityFamily(opt);
      const q = opt.craftingQuality || 0;
      map.set(family, Math.max(map.get(family) || 0, q));
    }
  }
  return map;
}

function remapQuality(quality: number | undefined, familyMax: number | undefined) {
  if (!quality || quality < 1 || quality > 3) return undefined;
  if (familyMax === 2) {
    if (quality === 1) return 2;
    if (quality === 2) return 3;
  }
  return quality;
}

function optionSelectLabel(opt: OptionEntry) {
  return (opt.label || '')
    .replace(/\s*\(Quality\s*[1-3]\)\s*$/i, '')
    .replace(/\s+[1-3]\s*$/i, '')
    .replace(/\s*\((Gold|Silver|Bronze|Tier \d+)\)\s*$/i, '');
}

function QualityBadge({ quality }: { quality?: number }) {
  if (!quality || quality < 1 || quality > 3) return null;
  const tierName = quality === 3 ? 'Gold' : quality === 2 ? 'Silver' : 'Bronze';
  const style =
    quality === 3
      ? 'border-amber-300/60 bg-amber-500 shadow-[0_0_8px_rgba(251,191,36,0.3)]'
      : quality === 2
        ? 'border-zinc-300/60 bg-zinc-400 shadow-[0_0_8px_rgba(161,161,170,0.3)]'
        : 'border-orange-400/60 bg-orange-600 shadow-[0_0_8px_rgba(234,88,12,0.3)]';
  return (
    <span
      className={`h-3 w-3 shrink-0 rounded-[2px] border ${style}`}
      title={`Quality: ${tierName}`}
      aria-label={`Quality: ${tierName}`}
    />
  );
}

interface ConsumableSelectProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: OptionEntry[];
  qualityMaxByFamily: Map<string, number>;
  disabled?: boolean;
}

export default function ConsumableSelect({
  label,
  value,
  onChange,
  options,
  qualityMaxByFamily,
  disabled = false,
}: ConsumableSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  useWowheadTooltips([open, value, options.length]);

  const itemIds = useMemo(() => {
    return options.map((o) => o.itemId).filter((id): id is number => !!id);
  }, [options]);
  const itemIcons = useItemIcons(itemIds);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [open]);

  const selected = options.find((opt) => (opt.token || '') === value) || null;
  const selectedQuality = remapQuality(
    selected?.craftingQuality,
    qualityMaxByFamily.get(optionQualityFamily(selected))
  );

  const groups = useMemo(() => {
    const map = new Map<
      string,
      { label: string; icon: string; itemId?: number; items: OptionEntry[]; familyMax: number }
    >();
    for (const opt of options) {
      const family = optionQualityFamily(opt);
      if (!map.has(family)) {
        const icon = (opt.itemId && itemIcons.get(opt.itemId)) || opt.icon || '';
        map.set(family, {
          label: optionSelectLabel(opt),
          icon,
          itemId: opt.itemId,
          items: [],
          familyMax: qualityMaxByFamily.get(family) || 0,
        });
      }
      map.get(family)!.items.push(opt);
    }
    return Array.from(map.values());
  }, [options, qualityMaxByFamily, itemIcons]);

  return (
    <div className="space-y-1.5 text-[13px] text-zinc-300">
      <span className="block">{label}</span>
      <div ref={rootRef} className="relative">
        <div
          role="button"
          tabIndex={0}
          onClick={() => !disabled && setOpen((v) => !v)}
          className={`flex w-full items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-2 text-left text-sm transition-colors ${
            disabled
              ? 'cursor-not-allowed text-zinc-500 opacity-70'
              : 'cursor-pointer text-zinc-200 hover:border-border-light'
          }`}
        >
          {selected?.icon || (selected?.itemId && itemIcons.get(selected.itemId)) ? (
            <a
              href="#"
              onClick={(e) => e.preventDefault()}
              data-wowhead={
                selected?.itemId
                  ? `item=${selected.itemId}`
                  : selected?.spellId
                    ? `spell=${selected.spellId}`
                    : undefined
              }
              className="flex shrink-0 items-center"
            >
              <img
                src={`https://wow.zamimg.com/images/wow/icons/small/${
                  (selected?.itemId && itemIcons.get(selected.itemId)) || selected?.icon
                }.jpg`}
                alt=""
                className="h-5 w-5 shrink-0 rounded-[4px]"
              />
            </a>
          ) : (
            <span className="h-5 w-5 shrink-0 rounded-[4px] border border-border bg-surface-2" />
          )}
          <a
            href="#"
            onClick={(e) => e.preventDefault()}
            className="flex min-w-0 items-center gap-1.5"
            data-wowhead={
              selected?.itemId
                ? `item=${selected.itemId}`
                : selected?.spellId
                  ? `spell=${selected.spellId}`
                  : undefined
            }
          >
            <span className="truncate">{selected ? optionSelectLabel(selected) : 'None'}</span>
            <QualityBadge quality={selectedQuality} />
          </a>
          <svg
            className={`ml-auto h-3.5 w-3.5 shrink-0 text-zinc-500 transition-transform ${open ? 'rotate-180' : ''}`}
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 6l4 4 4-4" />
          </svg>
        </div>
        <div
          className={`absolute z-30 mt-1 w-full origin-top overflow-hidden rounded-md border border-border bg-surface shadow-xl transition-[opacity,transform] duration-250 ease-out ${
            open
              ? 'pointer-events-auto translate-y-0 scale-[1] opacity-100'
              : 'pointer-events-none -translate-y-1 scale-[0.985] opacity-0'
          }`}
          aria-hidden={!open}
        >
          <div className="max-h-80 overflow-y-auto p-1">
            <button
              type="button"
              onClick={() => {
                onChange('');
                setOpen(false);
              }}
              className="flex w-full cursor-pointer items-center gap-2 rounded px-2.5 py-2 text-left text-sm text-zinc-300 hover:bg-white/[0.04]"
            >
              <span className="h-5 w-5 shrink-0 rounded-[4px] border border-border bg-surface-2" />
              <span className="truncate">None</span>
            </button>
            <div className="my-1 h-px bg-border/50" />
            {groups.map((group) => {
              const hasQuality = group.familyMax > 0;
              const isSelectedFamily =
                selected && optionQualityFamily(selected) === optionQualityFamily(group.items[0]);

              return (
                <div
                  key={group.label}
                  className={`flex items-center justify-between gap-2 rounded px-2.5 py-2 text-sm transition-[background-color,color,transform] duration-150 ease-out ${
                    !hasQuality ? 'cursor-pointer hover:bg-white/[0.04]' : ''
                  } ${isSelectedFamily && !hasQuality ? 'bg-gold/[0.08] text-white' : 'text-zinc-300'}`}
                  onClick={() => {
                    if (!hasQuality) {
                      onChange(group.items[0].token || '');
                      setOpen(false);
                    }
                  }}
                >
                  <a
                    href="#"
                    onClick={(e) => {
                      if (!hasQuality) {
                        e.preventDefault();
                      }
                    }}
                    data-wowhead={
                      group.itemId
                        ? `item=${group.itemId}`
                        : group.items[0]?.spellId
                          ? `spell=${group.items[0].spellId}`
                          : undefined
                    }
                    className="flex min-w-0 flex-1 items-center gap-2 no-underline hover:no-underline"
                  >
                    <img
                      src={`https://wow.zamimg.com/images/wow/icons/small/${group.icon}.jpg`}
                      alt=""
                      className="h-5 w-5 shrink-0 rounded-[4px]"
                    />
                    <span className="truncate">{group.label}</span>
                  </a>
                  {hasQuality && (
                    <div className="flex shrink-0 items-center gap-1.5">
                      {group.items
                        .sort((a, b) => (a.craftingQuality || 0) - (b.craftingQuality || 0))
                        .map((opt) => {
                          const q = remapQuality(opt.craftingQuality, group.familyMax);
                          const isOptSelected = value === opt.token;
                          const qStyle =
                            q === 3
                              ? isOptSelected
                                ? 'border-amber-300/60 bg-amber-500 shadow-[0_0_8px_rgba(251,191,36,0.3)]'
                                : 'border-amber-300/30 bg-amber-500/10 hover:border-amber-300/60 hover:bg-amber-500/20'
                              : q === 2
                                ? isOptSelected
                                  ? 'border-zinc-300/60 bg-zinc-400 shadow-[0_0_8px_rgba(161,161,170,0.3)]'
                                  : 'border-zinc-300/30 bg-zinc-400/10 hover:border-zinc-300/60 hover:bg-zinc-400/20'
                                : isOptSelected
                                  ? 'border-orange-400/60 bg-orange-600 shadow-[0_0_8px_rgba(234,88,12,0.3)]'
                                  : 'border-orange-400/30 bg-orange-600/10 hover:border-orange-400/60 hover:bg-orange-600/20';

                          const qName = q === 3 ? 'Gold' : q === 2 ? 'Silver' : 'Bronze';

                          return (
                            <a
                              key={opt.key}
                              href="#"
                              title={`Quality: ${qName}`}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                onChange(opt.token || '');
                                setOpen(false);
                              }}
                              data-wowhead={
                                opt.itemId
                                  ? `item=${opt.itemId}`
                                  : opt.spellId
                                    ? `spell=${opt.spellId}`
                                    : undefined
                              }
                              className={`block h-3.5 w-3.5 rounded-[2px] border transition-all ${qStyle}`}
                            />
                          );
                        })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
