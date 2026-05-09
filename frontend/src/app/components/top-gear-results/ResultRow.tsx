import { useEffect, useMemo, useRef, useState } from 'react';
import { specDisplayName } from '../../lib/types';
import type { ResultItem, TopGearResult } from '../../lib/types';
import type { EnchantInfo, GemInfo, ItemInfo } from '../../lib/useItemInfo';
import { getIconUrl } from '../../lib/useItemInfo';
import { calculateAverageIlevel } from '../../lib/ilevel';
import ItemTag from './ItemTag';
import {
  AUGMENT_RUNE_OPTIONS,
  FLASK_OPTIONS,
  FOOD_OPTIONS,
  POTION_OPTIONS,
  TEMP_ENCHANT_OPTIONS,
  type OptionEntry,
} from '../../lib/sim-options-catalog';

function normalizeTierToken(input?: string): string | null {
  const normalized = String(input || '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.startsWith('explorer')) return 'Exp';
  if (normalized.startsWith('adventurer')) return 'Adv';
  if (normalized.startsWith('veteran')) return 'Vet';
  if (normalized.startsWith('champion')) return 'Champ';
  if (normalized.startsWith('hero')) return 'Hero';
  if (normalized.startsWith('myth')) return 'Myth';
  return null;
}

function shortTierFromItem(item?: { upgrade?: string; tag?: string; source_type?: string }): string | null {
  if (!item) return null;
  const upgradeRaw = String(item.upgrade || '').trim();
  if (upgradeRaw) {
    const tokens = upgradeRaw.replace(/[_-]+/g, ' ').split(/\s+/);
    for (const token of tokens) {
      const mapped = normalizeTierToken(token);
      if (mapped) return mapped;
    }
    const rankMatch = upgradeRaw.match(/(\d+)\s*\/\s*(\d+)/);
    if (rankMatch) {
      const level = Number(rankMatch[1]);
      const max = Number(rankMatch[2]);
      if (max >= 6) {
        if (level <= 2) return 'Vet';
        if (level <= 4) return 'Champ';
        return 'Hero';
      }
    }
  }
  const tagTier = normalizeTierToken(item.tag);
  if (tagTier) return tagTier;
  const sourceType = String(item.source_type || '').toLowerCase();
  for (const tierKey of ['explorer', 'adventurer', 'veteran', 'champion', 'hero', 'myth']) {
    if (sourceType.includes(tierKey)) {
      return normalizeTierToken(tierKey);
    }
  }
  const tagRaw = String(item.tag || '').toLowerCase();
  if (tagRaw.includes('myth')) return 'Myth';
  if (tagRaw.includes('hero')) return 'Hero';
  if (tagRaw.includes('champ')) return 'Champ';
  if (tagRaw.includes('veteran')) return 'Vet';
  if (tagRaw.includes('adventurer')) return 'Adv';
  if (tagRaw.includes('explorer')) return 'Exp';
  return null;
}

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
  exactStatsButtonLabel?: string;
  exactStatsButtonDisabled?: boolean;
  exactStatsButtonVariant?: 'start' | 'goto';
  onAddToWishlist?: () => void;
  isWishlisted?: boolean;
  wishlistButtonDisabled?: boolean;
}

const CONSUMABLE_OPTION_BY_TOKEN: Record<string, OptionEntry> = Object.fromEntries(
  [...FLASK_OPTIONS, ...FOOD_OPTIONS, ...POTION_OPTIONS, ...AUGMENT_RUNE_OPTIONS, ...TEMP_ENCHANT_OPTIONS]
    .filter((opt) => opt.token)
    .map((opt) => [String(opt.token), opt])
);

function consumableTierSquareClass(label: string): string {
  const text = label.toLowerCase();
  if (text.includes('gold')) return 'border-amber-300/70 bg-amber-500';
  if (text.includes('silver')) return 'border-zinc-300/70 bg-zinc-300';
  if (text.includes('bronze')) return 'border-orange-400/70 bg-orange-500';
  return 'border-zinc-500/50 bg-zinc-500/40';
}

function consumableCheckClass(): string {
  return 'border-zinc-300/70 bg-zinc-300';
}

function consumableTierFromOption(token: string, opt?: OptionEntry): number {
  if (typeof opt?.craftingQuality === 'number' && opt.craftingQuality > 0) return opt.craftingQuality;
  const m = token.match(/_(\d)$/);
  if (!m) return 0;
  const q = Number(m[1]);
  return Number.isFinite(q) ? q : 0;
}

function consumableLabelFromToken(token: string, fallbackCategory: string): string {
  const opt = CONSUMABLE_OPTION_BY_TOKEN[token];
  if (opt?.label?.trim()) return opt.label.trim();
  return `${fallbackCategory}: ${token}`;
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
  exactStatsButtonLabel,
  exactStatsButtonDisabled = false,
  exactStatsButtonVariant = 'start',
  onAddToWishlist,
  isWishlisted = false,
  wishlistButtonDisabled = false,
}: ResultRowProps) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
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
  const consumableSetLabel = useMemo(() => {
    const meta = result.items.find((it) => {
      const row = it as unknown as { consumable_set?: string; heatmap_kind?: string };
      return (row.consumable_set && row.consumable_set.trim().length > 0) || row.heatmap_kind === 'consumable';
    }) as (ResultItem & { consumable_set?: string; consumable_flask?: string }) | undefined;
    if (!meta) return '';
    if (meta.consumable_set && meta.consumable_set.trim().length > 0) return meta.consumable_set;
    if (meta.consumable_flask && meta.consumable_flask.trim().length > 0) {
      return `Flask: ${meta.consumable_flask}`;
    }
    return '';
  }, [result.items]);
  const consumableBadges = useMemo(() => {
    const meta = result.items.find((it) => {
      const row = it as unknown as {
        consumable_flask?: string;
        consumable_food?: string;
        consumable_potion?: string;
        consumable_augmentation?: string;
        consumable_temporary_enchant?: string;
      };
      return !!(
        row.consumable_flask
        || row.consumable_food
        || row.consumable_potion
        || row.consumable_augmentation
        || row.consumable_temporary_enchant
      );
    }) as (ResultItem & {
      consumable_flask?: string;
      consumable_food?: string;
      consumable_potion?: string;
      consumable_augmentation?: string;
      consumable_temporary_enchant?: string;
    }) | undefined;
    if (!meta) return [];
    const entries: Array<{ category: string; token: string }> = [
      { category: 'Flask', token: String(meta.consumable_flask || '').trim() },
      { category: 'Food', token: String(meta.consumable_food || '').trim() },
      { category: 'Potion', token: String(meta.consumable_potion || '').trim() },
      { category: 'Augmentation', token: String(meta.consumable_augmentation || '').trim() },
      { category: 'Temp Enchant', token: String(meta.consumable_temporary_enchant || '').trim() },
    ].filter((e) => e.token.length > 0);
    return entries;
  }, [result.items]);
  const changedSlots = new Set(changedItems.map((it) => it.slot));
  const hasConsumableOnlyEquippedRow =
    !isEquipped && changedItems.length === 0 && consumableBadges.length > 0;

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
      const nextTier = shortTierFromItem(it);
      const currentTier = shortTierFromItem(equipped) || nextTier;
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

      const ilevelText =
        nextIlevel > 0
          ? currentIlevel > 0
            ? `${currentTier || 'Tier'} ${currentIlevel} -> ${nextTier || 'Tier'} ${nextIlevel}`
            : `${nextTier || 'Tier'} ${nextIlevel}`
          : undefined;

      bySlot[it.slot] = {
        upgradeState,
        ilevelText,
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

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onMouseDown = (e: MouseEvent) => {
      if (contextMenuRef.current && e.target instanceof Node && contextMenuRef.current.contains(e.target)) {
        return;
      }
      close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [contextMenu]);

  return (
    <div
      onClick={onSelect}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({ x: e.clientX, y: e.clientY });
      }}
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

            if (isEquipped || hasConsumableOnlyEquippedRow) {
              return (
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="text-[16px] font-semibold text-zinc-100">Currently Equipped</span>
                  {talentBadge}
                  {consumableBadges.length > 0 ? (
                    <div className="basis-full pt-0.5">
                      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                        {consumableBadges.map(({ category, token }) => {
                          const opt = CONSUMABLE_OPTION_BY_TOKEN[token];
                          const label = consumableLabelFromToken(token, category);
                          const icon = opt?.icon
                            ? getIconUrl(opt.icon) || `https://wow.zamimg.com/images/wow/icons/small/${opt.icon}.jpg`
                            : '';
                          const itemId = Number(opt?.itemId || 0);
                          const tier = consumableTierFromOption(token, opt);
                          const showTierSquare = tier > 0;
                          const tierLabel = tier >= 3 ? 'Gold' : tier === 2 ? 'Silver' : tier === 1 ? 'Bronze' : '';
                          const tooltip = tierLabel ? `${label} (${tierLabel} quality)` : label;
                          return (
                            <span
                              key={`${category}:${token}`}
                              className="inline-flex items-center gap-1.5 rounded border border-gold/40 bg-gold/10 px-2 py-[2px] text-[11px] leading-tight text-gold"
                              title={tooltip}
                            >
                              {icon ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={icon} alt="" className="h-3.5 w-3.5 rounded-sm object-cover" />
                              ) : (
                                <span className="text-[10px] text-gold/80">{category.slice(0, 1)}</span>
                              )}
                              <span className="truncate max-w-[13rem]">{label}</span>
                              {showTierSquare ? (
                                <span
                                  className={`inline-block h-2.5 w-2.5 rounded-[2px] border ${consumableTierSquareClass(tierLabel)}`}
                                  aria-hidden="true"
                                />
                              ) : (
                                <span
                                  className={`inline-block h-2.5 w-2.5 rounded-[2px] border ${consumableCheckClass()}`}
                                  aria-hidden="true"
                                />
                              )}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
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
                {consumableBadges.length > 0 ? (
                  <div className="basis-full pt-0.5">
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                      {consumableBadges.map(({ category, token }) => {
                        const opt = CONSUMABLE_OPTION_BY_TOKEN[token];
                        const label = consumableLabelFromToken(token, category);
                        const icon = opt?.icon
                          ? getIconUrl(opt.icon) || `https://wow.zamimg.com/images/wow/icons/small/${opt.icon}.jpg`
                          : '';
                        const itemId = Number(opt?.itemId || 0);
                        const tier = consumableTierFromOption(token, opt);
                        const showTierSquare = tier > 0;
                        return (
                          <a
                            key={`${category}:${token}`}
                            className="inline-flex items-center gap-1.5 rounded border border-gold/25 bg-gold/[0.07] px-1.5 py-0.5 text-[11px] text-gold/90"
                            title={`${category}: ${label}`}
                            data-wowhead={itemId > 0 ? `item=${itemId}` : undefined}
                            href={itemId > 0 ? `https://www.wowhead.com/item=${itemId}` : undefined}
                            onClick={(e) => e.preventDefault()}
                          >
                            {icon ? <img src={icon} alt="" className="h-3.5 w-3.5 rounded-[2px]" /> : null}
                            <span className="text-gold/85">{label.replace(/\s*\((Gold|Silver|Bronze)\)\s*$/i, '')}</span>
                            {showTierSquare ? (
                              tier === 1 ? (
                                <span className={`inline-flex h-3 w-3 items-center justify-center rounded-[2px] border ${consumableCheckClass()}`}>
                                  <span className="h-1.5 w-1.5 rounded-[1px] bg-black/70" />
                                </span>
                              ) : (
                                <span className={`h-3 w-3 rounded-[2px] border ${consumableTierSquareClass(label)}`} />
                              )
                            ) : null}
                          </a>
                        );
                      })}
                    </div>
                  </div>
                ) : consumableSetLabel ? (
                  <div className="basis-full pt-0.5">
                    <span className="rounded bg-gold/10 px-2 py-0.5 text-[11px] text-gold">{consumableSetLabel}</span>
                  </div>
                ) : null}
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
          </div>
          <div className="col-span-3 flex items-center justify-end gap-2 lg:col-auto lg:w-52">
            {onAddToWishlist && !isEquipped && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onAddToWishlist();
                }}
                disabled={wishlistButtonDisabled}
                className="rounded border border-zinc-500/40 bg-zinc-500/10 px-2 py-1 text-[13px] font-medium text-zinc-200 transition-colors hover:bg-zinc-500/20 disabled:opacity-60"
              >
                {isWishlisted ? 'Remove from Wishlist' : 'Add to Wishlist'}
              </button>
            )}
            {onLoadExactStats && exactStatsStatus !== 'same_base' && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onLoadExactStats();
                }}
                disabled={exactStatsButtonDisabled}
                title={exactStatsLabel}
                className={`rounded border px-2 py-1 text-[13px] font-medium transition-colors disabled:cursor-wait disabled:opacity-60 ${
                  exactStatsButtonVariant === 'goto'
                    ? 'border-emerald-400/35 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
                    : 'border-amber-400/35 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20'
                }`}
              >
                {exactStatsButtonLabel || 'Stats Sim'}
              </button>
            )}
          </div>
        </div>
      </div>
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="fixed z-40 flex min-w-40 flex-col gap-1 rounded-lg border border-border bg-surface-2 p-1.5 shadow-xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {onAddToWishlist && !isEquipped && (
            <button
              type="button"
              onClick={() => {
                onAddToWishlist();
                setContextMenu(null);
              }}
              disabled={wishlistButtonDisabled}
              className="rounded px-2 py-1 text-left text-[13px] font-medium text-zinc-200 transition-colors hover:bg-zinc-500/20 disabled:opacity-60"
            >
              {isWishlisted ? 'Remove from Wishlist' : 'Add to Wishlist'}
            </button>
          )}
          {onLoadExactStats && exactStatsStatus !== 'same_base' && (
            <button
              type="button"
              onClick={() => {
                onLoadExactStats();
                setContextMenu(null);
              }}
              disabled={exactStatsButtonDisabled}
              className={`rounded px-2 py-1 text-left text-[13px] font-medium transition-colors disabled:cursor-wait disabled:opacity-60 ${
                exactStatsButtonVariant === 'goto'
                  ? 'text-emerald-300 hover:bg-emerald-500/20'
                  : 'text-amber-300 hover:bg-amber-500/20'
              }`}
            >
              {exactStatsButtonLabel || 'Stats Sim'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
