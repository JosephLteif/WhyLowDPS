import { useMemo } from 'react';
import { specDisplayName } from '../../lib/types';
import type { ResultItem, TopGearResult } from '../../lib/types';
import type { EnchantInfo, GemInfo, ItemInfo } from '../../lib/useItemInfo';
import { getIconUrl } from '../../lib/useItemInfo';
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
  currencies?: Record<string, { id: number; name: string; icon: string }>;
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
  currencies,
}: ResultRowProps) {
  const barWidth = maxDps > 0 ? (result.dps / maxDps) * 100 : 0;
  const isEquipped = result.items.length === 0 || result.name.startsWith('Currently Equipped');
  const hasTalentBuild = !!result.talent_build;

  const talentBadge = hasTalentBuild ? (
    <span className="inline-flex shrink-0 items-center gap-1 rounded bg-purple-500/10 px-2 py-0.5 text-[12px] font-medium">
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

  const costsDisplay = useMemo(() => {
    // Try to find pre-aggregated costs first
    let costs = result.items.find((it) => it.__kind === 'total_upgrade_costs')?.costs;

    // If not found, manually aggregate from individual items
    if (!costs) {
      const manual: Record<string, number> = {};
      let foundAny = false;
      for (const it of result.items) {
        if (!it.is_kept && it.upgrade_costs) {
          for (const [cid, amt] of Object.entries(it.upgrade_costs)) {
            manual[cid] = (manual[cid] || 0) + amt;
            foundAny = true;
          }
        }
      }
      if (foundAny) costs = manual;
    }

    if (!costs || !currencies) return null;

    const entries = Object.entries(costs).sort((a, b) => Number(a[0]) - Number(b[0]));
    if (entries.length === 0) return null;

    return (
      <div className="flex items-center gap-2">
        {entries.map(([cid, amount]) => {
          const meta = currencies[cid];
          if (!meta) return null;
          return (
            <a
              key={cid}
              href={`https://www.wowhead.com/currency=${cid}`}
              className="flex items-center gap-1 text-[11px] text-gold/70 no-underline"
              title={meta.name}
              data-wowhead={`currency=${cid}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.preventDefault()}
            >
              <img src={getIconUrl(meta.icon)} alt="" className="h-3 w-3 rounded-sm opacity-80" />
              <span className="font-mono">{amount}</span>
            </a>
          );
        })}
      </div>
    );
  }, [result.items, currencies]);

  return (
    <div
      onClick={onSelect}
      className={`relative cursor-pointer overflow-hidden rounded-xl transition-colors hover:bg-white/[0.04] ${
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
        className="absolute inset-y-0 left-0 bg-white/[0.03]"
        style={{ width: `${barWidth}%` }}
      />
      <div className="relative flex items-center justify-between gap-4 px-4 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          {rank != null && (
            <span className="w-6 shrink-0 text-right font-mono text-[14px] tabular-nums text-zinc-300">
              {rank}
            </span>
          )}

          {(() => {
            const hasChangedItems = changedItems.length > 0;

            if (isEquipped) {
              return (
                <div className="flex items-center gap-2">
                  <span className="text-[16px] font-semibold text-zinc-100">Currently Equipped</span>
                  {talentBadge}
                </div>
              );
            }

            if (!hasChangedItems && hasTalentBuild) {
              return talentBadge;
            }

            return (
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                {displayItems.map((it, i) => (
                  <ItemTag
                    key={i}
                    item={it}
                    info={it.item_id > 0 ? itemInfoMap[it.item_id] : undefined}
                    enchant={it.enchant_id ? enchantInfoMap[it.enchant_id] : undefined}
                    gem={it.gem_id ? gemInfoMap[it.gem_id] : undefined}
                  />
                ))}
                {costsDisplay}
                {talentBadge}
              </div>
            );
          })()}

          {isBest && (
            <span className="shrink-0 rounded bg-gold/10 px-2 py-0.5 text-[12px] font-bold uppercase tracking-wider text-gold">
              Best
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span
            className={`flex w-32 items-center justify-end gap-1.5 font-mono text-[15px] tabular-nums ${
              !isEquipped && result.delta > 0
                ? 'text-emerald-400'
                : !isEquipped && result.delta < 0
                  ? 'text-red-400'
                  : 'text-zinc-400'
            }`}
          >
            <span>
              {!isEquipped && result.delta !== 0
                ? (result.delta > 0 ? '+' : '') + Math.round(result.delta).toLocaleString()
                : '-'}
            </span>
            {!isEquipped && result.delta !== 0 && baseDps > 0 && (
              <span className="text-[12px] opacity-85">
                ({result.delta > 0 ? '+' : ''}
                {((result.delta / baseDps) * 100).toFixed(1)}%)
              </span>
            )}
          </span>
          <span className="w-20 text-right font-mono text-[15px] tabular-nums text-zinc-200">
            {Math.round(result.dps).toLocaleString()}
          </span>
          <div className="flex w-28 flex-col items-end gap-0.5">
            <span className="text-[14px] tabular-nums text-zinc-200">
              {(baseAvgIlevel + ilvlGain).toFixed(2)}
              {ilvlGain !== 0 && (
                <span
                  className={`ml-1 text-[12px] font-bold ${
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
