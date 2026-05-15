'use client';

import { useMemo } from 'react';
import { Check } from 'lucide-react';
import { useItemIcons } from '../../lib/useWowheadIcons';
import type { OptionEntry } from '../../lib/sim-options-catalog';

function optionLabel(opt: OptionEntry) {
  return (opt.label || '').replace(/\s*\(Quality\s*[1-3]\)\s*$/i, '').replace(/\s+[1-3]\s*$/i, '');
}

function optionQualityFamily(opt: OptionEntry) {
  const token = (opt.token || opt.key || '').replace(/^main_hand:/, '');
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

function uniqueTokens(options: OptionEntry[]): string[] {
  return Array.from(new Set(options.map((o) => o.token || '').filter(Boolean)));
}

function toggleListValue(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

interface Props {
  title: string;
  options: OptionEntry[];
  selected: string[];
  onChange: (next: string[]) => void;
}

export default function ConsumableMatrixSelector({ title, options, selected, onChange }: Props) {
  const allItemIds = useMemo(
    () => options.map((o) => o.itemId).filter((id): id is number => !!id),
    [options]
  );
  const itemIcons = useItemIcons(allItemIds);
  const hasTiers = useMemo(() => options.some((o) => (o.craftingQuality || 0) > 0), [options]);
  const availableTiers = useMemo(() => {
    const set = new Set<number>();
    for (const opt of options) {
      const max = Math.max(
        ...options
          .filter((o) => optionQualityFamily(o) === optionQualityFamily(opt))
          .map((o) => o.craftingQuality || 0)
      );
      const mapped = remapQuality(opt.craftingQuality, max);
      if (mapped) set.add(mapped);
    }
    return set;
  }, [options]);

  const selectByTier = (tier: 1 | 2 | 3) => {
    const tokens = uniqueTokens(
      options.filter((opt) => {
        const max = Math.max(
          ...options
            .filter((o) => optionQualityFamily(o) === optionQualityFamily(opt))
            .map((o) => o.craftingQuality || 0)
        );
        return remapQuality(opt.craftingQuality, max) === tier;
      })
    );
    onChange(tokens);
  };

  const tierTokens = useMemo(() => {
    const byTier: Record<1 | 2 | 3, string[]> = { 1: [], 2: [], 3: [] };
    for (const opt of options) {
      const max = Math.max(
        ...options
          .filter((o) => optionQualityFamily(o) === optionQualityFamily(opt))
          .map((o) => o.craftingQuality || 0)
      );
      const mapped = remapQuality(opt.craftingQuality, max);
      const token = opt.token || opt.key;
      if (mapped && token) byTier[mapped as 1 | 2 | 3].push(token);
    }
    return byTier;
  }, [options]);

  const tierFullySelected = (tier: 1 | 2 | 3) => {
    const tokens = Array.from(new Set(tierTokens[tier]));
    if (tokens.length === 0) return false;
    return tokens.every((t) => selected.includes(t));
  };

  return (
    <div className="space-y-2 rounded-md border border-border bg-surface p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">{title}</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              const all = options.map((o) => o.token || o.key);
              onChange(all);
            }}
            className="h-7 rounded-md border border-amber-300/40 bg-amber-500/14 px-2.5 text-[11px] font-semibold text-amber-300 transition-colors hover:bg-amber-500/24 hover:text-amber-200"
            title="Select All"
          >
            All
          </button>
          <button
            type="button"
            onClick={() => onChange([])}
            className="h-7 rounded-md border border-zinc-600/80 bg-zinc-800/55 px-2.5 text-[11px] font-semibold text-zinc-200 transition-colors hover:border-zinc-500 hover:bg-zinc-700/65"
            title="Clear"
          >
            Clear
          </button>
          {hasTiers ? (
            <>
              {availableTiers.has(1) ? (
                <button
                  type="button"
                  onClick={() => selectByTier(1)}
                  className={`h-4 w-4 rounded-[3px] border ${
                    tierFullySelected(1)
                      ? 'border-orange-400/70 bg-orange-600'
                      : 'border-orange-400/60 bg-orange-600/20 hover:bg-orange-600/35'
                  }`}
                  title="Select All Bronze"
                >
                  <span className="sr-only">Bronze</span>
                </button>
              ) : null}
              {availableTiers.has(2) ? (
                <button
                  type="button"
                  onClick={() => selectByTier(2)}
                  className={`h-4 w-4 rounded-[3px] border ${
                    tierFullySelected(2)
                      ? 'border-zinc-300/70 bg-zinc-400'
                      : 'border-zinc-300/60 bg-zinc-400/20 hover:bg-zinc-400/35'
                  }`}
                  title="Select All Silver"
                >
                  <span className="sr-only">Silver</span>
                </button>
              ) : null}
              {availableTiers.has(3) ? (
                <button
                  type="button"
                  onClick={() => selectByTier(3)}
                  className={`h-4 w-4 rounded-[3px] border ${
                    tierFullySelected(3)
                      ? 'border-amber-300/70 bg-amber-500'
                      : 'border-amber-300/60 bg-amber-500/20 hover:bg-amber-500/35'
                  }`}
                  title="Select All Gold"
                >
                  <span className="sr-only">Gold</span>
                </button>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
      <div className="grid gap-1">
        {(() => {
          const groups = new Map<
            string,
            {
              label: string;
              icon: string;
              itemId?: number;
              items: OptionEntry[];
              familyMax: number;
            }
          >();
          for (const opt of options) {
            const familyKey = optionQualityFamily(opt);
            if (!groups.has(familyKey)) {
              const icon = (opt.itemId && itemIcons.get(opt.itemId)) || opt.icon || '';
              groups.set(familyKey, {
                label: optionLabel(opt),
                icon,
                itemId: opt.itemId,
                items: [],
                familyMax: 0,
              });
            }
            const group = groups.get(familyKey)!;
            group.items.push(opt);
            group.familyMax = Math.max(group.familyMax, opt.craftingQuality || 0);
          }

          return Array.from(groups.values()).map((group) => {
            const sortedItems = [...group.items].sort(
              (a, b) => (a.craftingQuality || 0) - (b.craftingQuality || 0)
            );
            const hasQuality = group.familyMax > 0;
            const isSingleNoQuality = sortedItems.length === 1 && !hasQuality;
            const isSelected =
              isSingleNoQuality &&
              selected.includes(sortedItems[0].token || sortedItems[0].key);

            return (
              <div
                key={group.label}
                onClick={() => {
                  if (isSingleNoQuality) {
                    onChange(toggleListValue(selected, sortedItems[0].token || sortedItems[0].key));
                  }
                }}
                className={`flex items-center justify-between gap-3 rounded border px-2.5 py-2 transition-colors ${
                  isSingleNoQuality ? 'cursor-pointer' : ''
                } ${
                  isSelected && !isSingleNoQuality
                    ? 'border-gold/40 bg-gold/[0.08]'
                    : 'border-border bg-surface-2 hover:border-zinc-700'
                }`}
              >
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  {group.itemId ? (
                    <a
                      href={`https://www.wowhead.com/item=${group.itemId}`}
                      target="_blank"
                      rel="noreferrer"
                      data-wowhead={`item=${group.itemId}`}
                      className={`flex min-w-0 items-center gap-2 hover:text-zinc-100 ${
                        isSelected ? 'text-white' : 'text-zinc-300'
                      }`}
                      onClick={(e) => {
                        if (!isSingleNoQuality) {
                          e.preventDefault();
                          e.stopPropagation();
                        }
                      }}
                    >
                      <img
                        src={`https://wow.zamimg.com/images/wow/icons/small/${group.icon}.jpg`}
                        alt=""
                        className="h-[22px] w-[22px] shrink-0 rounded-[4px]"
                      />
                      <span className="truncate text-[12px]">{group.label}</span>
                    </a>
                  ) : (
                    <span
                      className={`flex min-w-0 items-center gap-2 ${
                        isSelected ? 'text-white' : 'text-zinc-300'
                      }`}
                    >
                      <img
                        src={`https://wow.zamimg.com/images/wow/icons/small/${group.icon}.jpg`}
                        alt=""
                        className="h-[22px] w-[22px] shrink-0 rounded-[4px]"
                      />
                      <span className="truncate text-[12px]">{group.label}</span>
                    </span>
                  )}
                </div>

                {hasQuality ? (
                  <div className="flex shrink-0 items-center gap-1.5">
                    {sortedItems.map((opt) => {
                      const q = remapQuality(opt.craftingQuality, group.familyMax);
                      const isOptSelected = selected.includes(opt.token || opt.key);
                      const style =
                        q === 3
                          ? isOptSelected
                            ? 'border-amber-300/60 bg-amber-500 text-black shadow-[0_0_8px_rgba(251,191,36,0.3)]'
                            : 'border-amber-300/30 bg-amber-500/10 text-amber-300/60 hover:border-amber-300/60 hover:bg-amber-500/20'
                          : q === 2
                            ? isOptSelected
                              ? 'border-zinc-300/60 bg-zinc-400 text-black shadow-[0_0_8px_rgba(161,161,170,0.3)]'
                              : 'border-zinc-300/30 bg-zinc-400/10 text-zinc-400/60 hover:border-zinc-300/60 hover:bg-zinc-400/20'
                            : isOptSelected
                              ? 'border-orange-400/60 bg-orange-600 text-black shadow-[0_0_8px_rgba(234,88,12,0.3)]'
                              : 'border-orange-400/30 bg-orange-600/10 text-orange-400/60 hover:border-orange-400/60 hover:bg-orange-600/20';

                      return (
                        <button
                          key={opt.key}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onChange(toggleListValue(selected, opt.token || opt.key));
                          }}
                          title={`Quality ${q}`}
                          className={`flex h-4 w-4 items-center justify-center rounded-[3px] border transition-all ${style}`}
                        >
                          <span className="sr-only">{q}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] border transition-all ${
                      isSelected
                        ? 'border-gold bg-gold shadow-[0_0_8px_rgba(212,175,55,0.3)]'
                        : 'border-zinc-700 bg-surface hover:border-zinc-500'
                    }`}
                  >
                    {isSelected ? <Check className="h-2.5 w-2.5 text-black" strokeWidth={3} /> : null}
                  </div>
                )}
              </div>
            );
          });
        })()}
      </div>
    </div>
  );
}
