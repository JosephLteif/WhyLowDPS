import { useMemo } from 'react';
import { specDisplayName } from '../../lib/types';
import type { ResultItem, TopGearResult } from '../../lib/types';
import type { EnchantInfo, GemInfo, ItemInfo } from '../../lib/useItemInfo';
import { getIconUrl } from '../../lib/useItemInfo';
import { calculateAverageIlevel } from '../../lib/ilevel';
import ItemTag from './ItemTag';

function dropBaselineKey(item: ResultItem): string {
  const slot = String(item.slot || '').toLowerCase();
  const itemId = Number(item.item_id || 0);
  const sourceType = String(item.source_type || '').toLowerCase().trim();
  const instance = String(item.instance_name || '').toLowerCase().trim();
  const encounter = String(item.encounter || '').toLowerCase().trim();
  return `${slot}:${itemId}:${sourceType}:${instance}:${encounter}`;
}

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
  dropBaselineIlevelByKey?: Record<string, number>;
  exactStatsStatus?: 'idle' | 'loading' | 'ready' | 'error' | 'same_base';
  exactStatsLabel?: string;
  onLoadExactStats?: () => void;
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
  dropBaselineIlevelByKey = {},
  exactStatsStatus = 'idle',
  exactStatsLabel,
  onLoadExactStats,
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

  const itemReasonState = useMemo(() => {
    const bySlot: Record<
      string,
      {
        upgradeState: 'upgrade' | 'downgrade' | null;
        ilevelText?: string;
        ilevelTooltip?: string;
        ilevelHighlightClass?: string;
        gemChanged: boolean;
        enchantChanged: boolean;
      }
    > = {};
    for (const it of changedItems) {
      const equipped = equippedGear?.[it.slot];
      const currentIlevel = Number(equipped?.ilevel || 0);
      const nextIlevel = Number(it.ilevel || 0);
      const currentGem = Number(equipped?.gem_id || 0);
      const nextGem = Number(it.gem_id || 0);
      const currentEnchant = Number(equipped?.enchant_id || 0);
      const nextEnchant = Number(it.enchant_id || 0);
      const upgradeCosts = (it as any).upgrade_costs || (it as any).costs;
      const hasUpgradeCosts =
        !!upgradeCosts &&
        Object.values(upgradeCosts as Record<string, number>).some((v) => Number(v || 0) > 0);
      const itemKey = dropBaselineKey(it);
      const baselineDropIlevel = Number(dropBaselineIlevelByKey[itemKey] || 0);
      const inferredNeedsUpgrade = baselineDropIlevel > 0 && nextIlevel > baselineDropIlevel;
      const needsUpgradeAction =
        Number(it.upgrade_levels || 0) > 0 || hasUpgradeCosts || inferredNeedsUpgrade;

      const ilvlChanged = currentIlevel > 0 && nextIlevel !== currentIlevel;
      const upgradeState: 'upgrade' | 'downgrade' | null = needsUpgradeAction
        ? 'upgrade'
        : ilvlChanged
          ? nextIlevel > currentIlevel
            ? 'upgrade'
            : 'downgrade'
          : null;

      bySlot[it.slot] = {
        upgradeState,
        ilevelText: nextIlevel > 0 ? `iLvl ${nextIlevel}` : undefined,
        ilevelTooltip:
          ilvlChanged || needsUpgradeAction
            ? inferredNeedsUpgrade && baselineDropIlevel > 0
              ? `${it.slot}: drop iLvl ${baselineDropIlevel} -> ${nextIlevel}`
              : `${it.slot}: ${currentIlevel || 0} -> ${nextIlevel}`
            : undefined,
        ilevelHighlightClass:
          upgradeState === 'upgrade'
            ? 'bg-emerald-500/12 text-emerald-300'
            : upgradeState === 'downgrade'
              ? 'bg-red-500/12 text-red-300'
              : 'text-zinc-300',
        gemChanged: nextGem !== currentGem && nextGem > 0,
        enchantChanged: nextEnchant !== currentEnchant && nextEnchant > 0,
      };
    }
    return bySlot;
  }, [changedItems, equippedGear, dropBaselineIlevelByKey]);

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
      <div className="relative flex flex-col gap-2 px-4 py-3 lg:flex-row lg:items-center lg:justify-between lg:gap-4">
        <div className="flex min-w-0 flex-1 items-start gap-2.5 lg:items-center">
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
                  (() => {
                    const state = itemReasonState[it.slot];
                    return (
                      <ItemTag
                        key={i}
                        item={it}
                        info={it.item_id > 0 ? itemInfoMap[it.item_id] : undefined}
                        enchant={it.enchant_id ? enchantInfoMap[it.enchant_id] : undefined}
                        gem={it.gem_id ? gemInfoMap[it.gem_id] : undefined}
                        upgradeState={state?.upgradeState}
                        ilevelText={state?.ilevelText}
                        ilevelTooltip={state?.ilevelTooltip}
                        ilevelHighlightClass={state?.ilevelHighlightClass}
                        gemChanged={state?.gemChanged}
                        enchantChanged={state?.enchantChanged}
                      />
                    );
                  })()
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
        <div className="grid shrink-0 grid-cols-3 gap-3 lg:flex lg:items-center">
          <span
            className={`flex min-w-0 items-center justify-start gap-1.5 font-mono text-[14px] tabular-nums lg:w-32 lg:justify-end lg:text-[15px] ${
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
          <span className="text-left font-mono text-[14px] tabular-nums text-zinc-200 lg:w-20 lg:text-right lg:text-[15px]">
            {Math.round(result.dps).toLocaleString()}
          </span>
          <div className="flex min-w-0 flex-col items-start gap-0.5 lg:w-28 lg:items-end">
            <span className="text-[13px] tabular-nums text-zinc-200 lg:text-[14px]">
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
            <details
              className="text-[11px] text-zinc-400"
              onClick={(e) => e.stopPropagation()}
            >
              <summary className="cursor-pointer list-none rounded border border-border px-1.5 py-0.5 hover:border-zinc-600">
                Stats Sim
              </summary>
              <div className="mt-1 rounded border border-border bg-surface-2 p-2 text-left">
                <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">Status</div>
                <div className="text-[11px] text-zinc-300">
                  {exactStatsLabel ||
                    (exactStatsStatus === 'same_base'
                      ? 'Same as base stats'
                      : exactStatsStatus === 'ready'
                        ? 'Saved stats sim'
                        : exactStatsStatus === 'loading'
                          ? 'Loading stats sim...'
                          : exactStatsStatus === 'error'
                            ? 'Failed'
                            : 'Not loaded')}
                </div>
                {(exactStatsStatus === 'idle' || exactStatsStatus === 'error') &&
                  onLoadExactStats && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onLoadExactStats();
                    }}
                    className="mt-2 rounded border border-gold/35 bg-gold/10 px-2 py-1 text-[11px] text-gold disabled:opacity-60"
                  >
                    {exactStatsStatus === 'error' ? 'Retry Stats Sim' : 'Load Stats Sim'}
                  </button>
                )}
              </div>
            </details>
          </div>
        </div>
      </div>
    </div>
  );
}
