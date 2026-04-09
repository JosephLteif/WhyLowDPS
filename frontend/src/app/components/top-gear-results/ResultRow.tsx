import { useMemo } from 'react';
import { specDisplayName } from '../../lib/types';
import type { ResultItem, TopGearResult } from '../../lib/types';
import type { EnchantInfo, GemInfo, ItemInfo } from '../../lib/useItemInfo';
import { calculateAverageIlevel } from '../../lib/ilevel';
import ItemTag from './ItemTag';

interface ResultRowProps {
  result: TopGearResult;
  rank?: number;
  maxDps: number;
  baseDps: number;
  equippedGear?: Record<string, ResultItem>;
  baseAvgIlevel: number;
  isBest: boolean;
  isSelected?: boolean;
  onSelect?: () => void;
  itemInfoMap: Record<number, ItemInfo>;
  enchantInfoMap: Record<number, EnchantInfo>;
  gemInfoMap: Record<number, GemInfo>;
}

export default function ResultRow({
  result,
  rank,
  maxDps,
  baseDps,
  equippedGear,
  baseAvgIlevel,
  isBest,
  isSelected,
  onSelect,
  itemInfoMap,
  enchantInfoMap,
  gemInfoMap,
}: ResultRowProps) {
  const barWidth = maxDps > 0 ? (result.dps / maxDps) * 100 : 0;
  const isEquipped = result.items.length === 0 || result.name.startsWith('Currently Equipped');
  const hasTalentBuild = !!result.talent_build;

  const talentBadge = hasTalentBuild ? (
    <span className="inline-flex shrink-0 items-center gap-1 rounded bg-purple-500/10 px-1.5 py-px text-[11px] font-medium">
      {result.talent_spec && (
        <span className="text-purple-300">{specDisplayName(result.talent_spec)}</span>
      )}
      <span className="text-purple-400/70">{result.talent_build}</span>
    </span>
  ) : null;

  const changedItems = result.items.filter((it) => !it.is_kept && it.item_id > 0);
  const changedSlots = new Set(changedItems.map((it) => it.slot));

  const showBothRings = changedSlots.has('finger1') || changedSlots.has('finger2');
  const showBothTrinkets = changedSlots.has('trinket1') || changedSlots.has('trinket2');

  const displayItems = result.items.filter((it) => {
    if (!it.is_kept) return it.item_id > 0;
    if (showBothRings && (it.slot === 'finger1' || it.slot === 'finger2')) return true;
    if (showBothTrinkets && (it.slot === 'trinket1' || it.slot === 'trinket2')) return true;
    return false;
  });

  const ilvlGain = useMemo(() => {
    if (!equippedGear || !baseAvgIlevel) return 0;
    const gearSet = { ...equippedGear };
    for (const it of result.items) {
      if (!it.is_kept && it.item_id === 0 && it.slot === 'off_hand') {
        delete gearSet.off_hand;
      } else if (!it.is_kept && it.item_id > 0) {
        gearSet[it.slot] = it;
      }
    }
    const newIlevel = calculateAverageIlevel(gearSet as any);
    return newIlevel - baseAvgIlevel;
  }, [equippedGear, baseAvgIlevel, result.items]);

  return (
    <div
      onClick={onSelect}
      className={`relative cursor-pointer overflow-hidden rounded-lg transition-colors hover:bg-white/[0.04] ${
        isSelected && !isBest
          ? 'bg-emerald-500/[0.04] ring-1 ring-emerald-500/50'
          : isBest
            ? `ring-1 ring-gold/30 ${isSelected ? 'bg-gold/[0.05]' : 'bg-transparent'}`
            : isEquipped
              ? 'ring-1 ring-white/5'
              : ''
      }`}
    >
      <div
        className="absolute inset-y-0 left-0 bg-white/[0.02]"
        style={{ width: `${barWidth}%` }}
      />
      <div className="relative flex items-center justify-between gap-3 px-3 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {rank != null && (
            <span className="w-5 shrink-0 text-right font-mono text-[12px] tabular-nums text-gray-600">
              {rank}
            </span>
          )}

          {(() => {
            const hasChangedItems = changedItems.length > 0;

            if (isEquipped) {
              return (
                <div className="flex items-center gap-2">
                  <span className="text-[14px] text-muted">Currently Equipped</span>
                  {talentBadge}
                </div>
              );
            }

            if (!hasChangedItems && hasTalentBuild) {
              return talentBadge;
            }

            return (
              <div className="flex min-w-0 flex-wrap items-center gap-1">
                {displayItems.map((it, i) => (
                  <ItemTag
                    key={i}
                    item={it}
                    info={it.item_id > 0 ? itemInfoMap[it.item_id] : undefined}
                    enchant={it.enchant_id ? enchantInfoMap[it.enchant_id] : undefined}
                    gem={it.gem_id ? gemInfoMap[it.gem_id] : undefined}
                  />
                ))}
                {talentBadge}
              </div>
            );
          })()}

          {isBest && (
            <span className="shrink-0 rounded bg-gold/10 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-gold">
              Best
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span
            className={`flex w-28 items-center justify-end gap-1.5 font-mono text-[15px] tabular-nums ${
              !isEquipped && result.delta > 0
                ? 'text-emerald-400'
                : !isEquipped && result.delta < 0
                  ? 'text-red-400'
                  : 'text-muted'
            }`}
          >
            <span>
              {!isEquipped && result.delta !== 0
                ? (result.delta > 0 ? '+' : '') + Math.round(result.delta).toLocaleString()
                : '—'}
            </span>
            {!isEquipped && result.delta !== 0 && baseDps > 0 && (
              <span className="text-xs opacity-70">
                ({result.delta > 0 ? '+' : ''}
                {((result.delta / baseDps) * 100).toFixed(1)}%)
              </span>
            )}
          </span>
          <span className="w-16 text-right font-mono text-sm tabular-nums text-gray-300">
            {Math.round(result.dps).toLocaleString()}
          </span>
          <div className="flex w-24 flex-col items-end gap-0.5">
            <span className="text-[13px] tabular-nums text-gray-300">
              {(baseAvgIlevel + ilvlGain).toFixed(2)}
              {ilvlGain !== 0 && (
                <span
                  className={`ml-1 text-[11px] font-bold ${
                    ilvlGain > 0 ? 'text-emerald-400/80' : 'text-red-400/80'
                  }`}
                >
                  ({ilvlGain > 0 ? '+' : ''}
                  {ilvlGain.toFixed(2)})
                </span>
              )}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
