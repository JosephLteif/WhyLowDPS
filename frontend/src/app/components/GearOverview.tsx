'use client';

import { useMemo } from 'react';
import type { EnchantInfo, GemInfo, ItemInfo, ItemQuery } from '../lib/useItemInfo';
import {
  getIconUrl,
  getWowheadData,
  getWowheadUrl,
  QUALITY_COLORS,
  useEnchantInfo,
  useGemInfo,
  useItemInfo,
} from '../lib/useItemInfo';
import { SLOT_LABELS } from '../lib/types';
import { useWowheadTooltips } from '../lib/useWowheadTooltips';
import GearAffixIndicators from './GearAffixIndicators';
import GearItemCore from './GearItemCore';

export interface GearItem {
  slot: string;
  item_id: number;
  ilevel: number;
  name: string;
  bonus_ids?: number[];
  enchant_id?: number;
  gem_id?: number;
  is_kept?: boolean;
  upgrade_levels?: number;
  origin?: string;
  source_type?: string;
  encounter?: string;
  instance_name?: string;
}

// WoW character sheet order
const GEAR_ORDER_LEFT = ['head', 'neck', 'shoulder', 'back', 'chest', 'wrist'];
const GEAR_ORDER_RIGHT = [
  'hands',
  'waist',
  'legs',
  'feet',
  'finger1',
  'finger2',
  'trinket1',
  'trinket2',
];

const ENCHANTABLE_SLOTS = new Set([
  'head',
  'neck',
  'back',
  'chest',
  'wrist',
  'legs',
  'feet',
  'finger1',
  'finger2',
  'main_hand',
  'off_hand',
]);

function dropBaselineKey(item: GearItem): string {
  const slot = String(item.slot || '').toLowerCase();
  const itemId = Number(item.item_id || 0);
  const sourceType = String(item.source_type || '').toLowerCase().trim();
  const instance = String(item.instance_name || '').toLowerCase().trim();
  const encounter = String(item.encounter || '').toLowerCase().trim();
  return `${slot}:${itemId}:${sourceType}:${instance}:${encounter}`;
}

interface GearOverviewProps {
  gear: Record<string, GearItem>;
  title?: string;
  characterRenderUrl?: string | null;
  equippedGear?: Record<string, GearItem>;
  dropBaselineIlevelByKey?: Record<string, number>;
  /** Slots to highlight as upgrades */
  upgradeSlots?: Set<string>;
  /** Slots to highlight as downgrades */
  downgradeSlots?: Set<string>;
  currencies?: Record<string, { id: number; name: string; icon: string }>;
}

export default function GearOverview({
  gear,
  title = 'Equipped Gear',
  characterRenderUrl,
  equippedGear,
  dropBaselineIlevelByKey = {},
  upgradeSlots,
  downgradeSlots,
  currencies,
}: GearOverviewProps) {
  const allItemQueries = useMemo(() => {
    const seen = new Set<string>();
    const queries: ItemQuery[] = [];
    for (const it of Object.values(gear)) {
      if (it.item_id <= 0) continue;
      const key = `${it.item_id}:${(it.bonus_ids || []).sort().join(':')}`;
      if (!seen.has(key)) {
        seen.add(key);
        queries.push({ item_id: it.item_id, bonus_ids: it.bonus_ids });
      }
    }
    return queries;
  }, [gear]);

  const itemInfoMap = useItemInfo(allItemQueries);

  const allEnchantIds = useMemo(() => {
    const ids = new Set<number>();
    for (const it of Object.values(gear)) {
      if (it.enchant_id && it.enchant_id > 0) ids.add(it.enchant_id);
    }
    return [...ids];
  }, [gear]);

  const enchantInfoMap = useEnchantInfo(allEnchantIds);

  const allGemIds = useMemo(() => {
    const ids = new Set<number>();
    for (const it of Object.values(gear)) {
      if (it.gem_id && it.gem_id > 0) ids.add(it.gem_id);
    }
    return [...ids];
  }, [gear]);

  const gemInfoMap = useGemInfo(allGemIds);
  useWowheadTooltips([itemInfoMap]);

  const totalCostsDisplay = useMemo(() => {
    if (!currencies) return null;

    const manual: Record<string, number> = {};
    let foundAny = false;
    for (const it of Object.values(gear)) {
      const upgradeCosts = (it as any).upgrade_costs || (it as any).costs;
      if (!it.is_kept && upgradeCosts) {
        for (const [cid, amt] of Object.entries(upgradeCosts)) {
          manual[cid] = (manual[cid] || 0) + (amt as number);
          foundAny = true;
        }
      }
    }

    if (!foundAny) return null;

    const entries = Object.entries(manual).sort((a, b) => Number(a[0]) - Number(b[0]));
    if (entries.length === 0) return null;

    return (
      <div className="mt-4 flex flex-wrap items-center gap-4 rounded-lg border border-border/50 bg-black/20 px-4 py-2">
        <span className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">
          Total Upgrade Cost
        </span>
        <div className="flex flex-wrap items-center gap-4">
          {entries.map(([cid, amount]) => {
            const meta = currencies[cid];
            if (!meta) return null;
            return (
              <a
                key={cid}
                href={`https://www.wowhead.com/currency=${cid}`}
                className="flex items-center gap-2 font-mono text-[14px] text-gold/90 no-underline"
                data-wowhead={`currency=${cid}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.preventDefault()}
              >
                <img
                  src={getIconUrl(meta.icon)}
                  alt={meta.name}
                  className="h-5 w-5 rounded-sm border border-gold/30 shadow-sm"
                />
                <span>{amount}</span>
              </a>
            );
          })}
        </div>
      </div>
    );
  }, [gear, currencies]);

  if (Object.keys(gear).length === 0) return null;

  return (
    <div className="card relative overflow-hidden p-5">
      {characterRenderUrl && (
        <img
          src={characterRenderUrl}
          alt=""
          className="pointer-events-none absolute inset-0 mx-auto h-[130%] w-auto -translate-y-[12%] object-contain opacity-30"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
      )}
      <div className="relative">
        <div className="mb-4 flex items-center justify-between gap-4">
          <p className="text-sm font-medium uppercase tracking-widest text-muted">{title}</p>
          {totalCostsDisplay && <div className="hidden md:block">{totalCostsDisplay}</div>}
        </div>
        {totalCostsDisplay && <div className="mb-4 md:hidden">{totalCostsDisplay}</div>}
        {(() => {
          const gridCols = characterRenderUrl ? 'grid-cols-[1fr_auto_1fr]' : 'grid-cols-2';
          return (
            <>
              <div className={`grid gap-x-4 ${gridCols}`}>
                <div className="space-y-1">
                  {GEAR_ORDER_LEFT.map((slot) => (
                    <GearSlotRow
                      key={slot}
                      slot={slot}
                      item={gear[slot]}
                      equippedItem={equippedGear?.[slot]}
                      dropBaselineIlevelByKey={dropBaselineIlevelByKey}
                      isUpgrade={upgradeSlots?.has(slot)}
                      isDowngrade={downgradeSlots?.has(slot)}
                      itemInfoMap={itemInfoMap}
                      enchantInfoMap={enchantInfoMap}
                      gemInfoMap={gemInfoMap}
                    />
                  ))}
                </div>
                {characterRenderUrl && <div />}
                <div className="space-y-1">
                  {GEAR_ORDER_RIGHT.map((slot) => (
                    <GearSlotRow
                      key={slot}
                      slot={slot}
                      item={gear[slot]}
                      equippedItem={equippedGear?.[slot]}
                      dropBaselineIlevelByKey={dropBaselineIlevelByKey}
                      isUpgrade={upgradeSlots?.has(slot)}
                      isDowngrade={downgradeSlots?.has(slot)}
                      itemInfoMap={itemInfoMap}
                      enchantInfoMap={enchantInfoMap}
                      gemInfoMap={gemInfoMap}
                      align="right"
                    />
                  ))}
                </div>
              </div>
              {characterRenderUrl ? (
                <div className="mt-2 flex items-center justify-center gap-4">
                  <div className="w-[360px] max-w-[44vw]">
                    <GearSlotRow
                      slot="main_hand"
                      item={gear.main_hand}
                      equippedItem={equippedGear?.main_hand}
                      dropBaselineIlevelByKey={dropBaselineIlevelByKey}
                      isUpgrade={upgradeSlots?.has('main_hand')}
                      isDowngrade={downgradeSlots?.has('main_hand')}
                      itemInfoMap={itemInfoMap}
                      enchantInfoMap={enchantInfoMap}
                      gemInfoMap={gemInfoMap}
                      align="right"
                      compact
                    />
                  </div>
                  <div className="w-[360px] max-w-[44vw]">
                    <GearSlotRow
                      slot="off_hand"
                      item={gear.off_hand}
                      equippedItem={equippedGear?.off_hand}
                      dropBaselineIlevelByKey={dropBaselineIlevelByKey}
                      isUpgrade={upgradeSlots?.has('off_hand')}
                      isDowngrade={downgradeSlots?.has('off_hand')}
                      itemInfoMap={itemInfoMap}
                      enchantInfoMap={enchantInfoMap}
                      gemInfoMap={gemInfoMap}
                      align="left"
                      compact
                    />
                  </div>
                </div>
              ) : (
                <div className="mt-1 grid grid-cols-2 gap-x-4">
                  <GearSlotRow
                    slot="main_hand"
                    item={gear.main_hand}
                    equippedItem={equippedGear?.main_hand}
                    dropBaselineIlevelByKey={dropBaselineIlevelByKey}
                    isUpgrade={upgradeSlots?.has('main_hand')}
                    isDowngrade={downgradeSlots?.has('main_hand')}
                    itemInfoMap={itemInfoMap}
                    enchantInfoMap={enchantInfoMap}
                    gemInfoMap={gemInfoMap}
                    align="right"
                    compact
                  />
                  <GearSlotRow
                    slot="off_hand"
                    item={gear.off_hand}
                    equippedItem={equippedGear?.off_hand}
                    dropBaselineIlevelByKey={dropBaselineIlevelByKey}
                    isUpgrade={upgradeSlots?.has('off_hand')}
                    isDowngrade={downgradeSlots?.has('off_hand')}
                    itemInfoMap={itemInfoMap}
                    enchantInfoMap={enchantInfoMap}
                    gemInfoMap={gemInfoMap}
                    align="left"
                    compact
                  />
                </div>
              )}
            </>
          );
        })()}
      </div>
    </div>
  );
}

export function GearSlotRow({
  slot,
  item,
  equippedItem,
  dropBaselineIlevelByKey = {},
  isUpgrade,
  isDowngrade,
  itemInfoMap,
  enchantInfoMap,
  gemInfoMap,
  align = 'left',
  compact = false,
}: {
  slot: string;
  item?: GearItem;
  equippedItem?: GearItem;
  dropBaselineIlevelByKey?: Record<string, number>;
  isUpgrade?: boolean;
  isDowngrade?: boolean;
  itemInfoMap: Record<number, ItemInfo>;
  enchantInfoMap: Record<number, EnchantInfo>;
  gemInfoMap: Record<number, GemInfo>;
  align?: 'left' | 'right';
  compact?: boolean;
}) {
  const rtl = align === 'right';

  if (!item || item.item_id <= 0) {
    return (
      <div
        className={`flex items-center gap-2 rounded-lg ${compact ? 'px-2 py-1.5' : 'px-2.5 py-2'} ${rtl ? 'flex-row-reverse' : ''}`}
      >
        <div
          className={`${compact ? 'h-10 w-10' : 'h-8 w-8'} shrink-0 rounded border border-border bg-white/[0.03]`}
        />
        <div className={rtl ? 'text-right' : ''}>
          <p className={`${compact ? 'text-[13px]' : 'text-sm'} text-zinc-200`}>
            {SLOT_LABELS[slot] || slot}
          </p>
          <p className={`${compact ? 'text-[13px]' : 'text-sm'} text-zinc-300`}>Empty</p>
        </div>
      </div>
    );
  }

  const info = itemInfoMap[item.item_id];
  const enchant = item.enchant_id ? enchantInfoMap[item.enchant_id] : undefined;
  const gem = item.gem_id ? gemInfoMap[item.gem_id] : undefined;
  const displayTag = info?.tag && info.tag.toLowerCase() !== 'socket' ? info.tag : '';
  const qc = info ? QUALITY_COLORS[info.quality] || '#fff' : '#fff';
  const name = info?.name || item.name || `Item ${item.item_id}`;
  const icon = info?.icon || 'inv_misc_questionmark';
  const whData =
    item.item_id > 0
      ? getWowheadData(item.bonus_ids, item.ilevel, item.enchant_id, item.gem_id)
      : undefined;
  const baselineDropIlevel = Number(dropBaselineIlevelByKey[dropBaselineKey(item)] || 0);
  const needsEquip = !equippedItem || equippedItem.item_id <= 0 || equippedItem.item_id !== item.item_id;
  const needsUpgrade =
    Number(item.upgrade_levels || 0) > 0 ||
    (baselineDropIlevel > 0 && Number(item.ilevel || 0) > baselineDropIlevel);
  const levelChanged = Number(equippedItem?.ilevel || 0) > 0 && Number(equippedItem?.ilevel || 0) !== Number(item.ilevel || 0);
  const needsGem = Number(item.gem_id || 0) > 0 && Number(equippedItem?.gem_id || 0) !== Number(item.gem_id || 0);
  const needsEnchant =
    Number(item.enchant_id || 0) > 0 &&
    Number(equippedItem?.enchant_id || 0) !== Number(item.enchant_id || 0);
  const gemEligible =
    Number((info as any)?.sockets || 0) > 0 ||
    Number(item.gem_id || 0) > 0 ||
    Number(equippedItem?.gem_id || 0) > 0;
  const enchantEligible =
    ENCHANTABLE_SLOTS.has(String(slot || '').toLowerCase()) ||
    Number(item.enchant_id || 0) > 0 ||
    Number(equippedItem?.enchant_id || 0) > 0;
  const upgradeState: 'upgrade' | 'downgrade' | null = isDowngrade
    ? 'downgrade'
    : needsUpgrade || isUpgrade
      ? 'upgrade'
      : levelChanged
        ? Number(item.ilevel || 0) > Number(equippedItem?.ilevel || 0)
          ? 'upgrade'
          : 'downgrade'
        : null;

  const fadeDir = rtl ? 'to left' : 'to right';

  return (
    <div
      className={`relative flex items-center gap-2 rounded-lg ${compact ? 'px-2 py-1.5' : 'px-2.5 py-2.5'} ${rtl ? 'flex-row-reverse' : ''}`}
    >
      {isUpgrade && (
        <div
          className="pointer-events-none absolute inset-0 rounded-lg bg-emerald-500/[0.15] ring-1 ring-emerald-500/30"
          style={{
            maskImage: `linear-gradient(${fadeDir}, black 20%, transparent 85%)`,
            WebkitMaskImage: `linear-gradient(${fadeDir}, black 20%, transparent 85%)`,
          }}
        />
      )}
      {isDowngrade && (
        <div
          className="pointer-events-none absolute inset-0 rounded-lg bg-red-500/[0.15] ring-1 ring-red-500/30"
          style={{
            maskImage: `linear-gradient(${fadeDir}, black 20%, transparent 85%)`,
            WebkitMaskImage: `linear-gradient(${fadeDir}, black 20%, transparent 85%)`,
          }}
        />
      )}
      <GearItemCore
        align={rtl ? 'right' : 'left'}
        itemHref={item.item_id > 0 ? getWowheadUrl(item.item_id) : undefined}
        itemWowheadData={whData}
        itemName={name}
        itemNameColor={qc}
        itemNameClassName={`${compact ? 'text-[1.08rem]' : 'text-sm'} ${compact ? 'max-w-none' : 'truncate'} font-semibold leading-tight no-underline`}
        iconSrc={getIconUrl(icon)}
        iconWidth={compact ? 40 : 32}
        iconHeight={compact ? 40 : 32}
        iconContainerClassName={`${compact ? 'h-10 w-10' : 'h-8 w-8'} shrink-0 overflow-hidden rounded border border-border`}
        indicators={
          <GearAffixIndicators
            gemEligible={gemEligible}
            enchantEligible={enchantEligible}
            align={rtl ? 'right' : 'left'}
            size={18}
            gem={
              gem
                ? {
                    icon: gem.icon,
                    name: gem.name,
                    href: gem.gem_id ? getWowheadUrl(gem.gem_id) : undefined,
                    wowheadData: gem.gem_id ? `item=${gem.gem_id}` : undefined,
                    changed: needsGem,
                  }
                : undefined
            }
            enchant={
              enchant
                ? {
                    icon: enchant.icon,
                    name: enchant.name,
                    href: enchant.item_id ? getWowheadUrl(enchant.item_id) : undefined,
                    wowheadData: enchant.item_id
                      ? `item=${enchant.item_id}`
                      : enchant.enchant_id
                        ? `spell=${enchant.enchant_id}`
                        : undefined,
                    changed: needsEnchant,
                  }
                : undefined
            }
          />
        }
        headerExtras={
          <>
            {upgradeState === 'upgrade' && (
              <span className="shrink-0 rounded bg-emerald-500/10 px-1.5 py-px text-[11px] font-bold uppercase tracking-wider text-emerald-300">
                Upgrade
              </span>
            )}
            {upgradeState === 'downgrade' && (
              <span className="shrink-0 rounded bg-red-500/10 px-1.5 py-px text-[11px] font-bold uppercase tracking-wider text-red-300">
                Downgrade
              </span>
            )}
            {item.origin === 'vault' && (
              <span className="shrink-0 rounded bg-amber-400/10 px-1.5 py-px text-[11px] font-bold uppercase tracking-wider text-amber-300">
                Vault
              </span>
            )}
          </>
        }
        detailsClassName={`${compact ? 'whitespace-normal break-words text-[1.08rem]' : 'truncate text-sm'} text-zinc-300`}
        details={
          <>
            {!compact && `${SLOT_LABELS[slot] || slot}`}
            {!compact && item.ilevel > 0 && (
              <span
                title={
                  levelChanged
                    ? `${slot}: ${Number(equippedItem?.ilevel || 0)} -> ${item.ilevel}`
                    : undefined
                }
                className={
                  upgradeState === 'upgrade'
                  ? 'text-emerald-300'
                  : upgradeState === 'downgrade'
                    ? 'text-red-300'
                    : ''
                }
              >
                {upgradeState === 'upgrade' ? ' - ↑ ' : ' - '}
                {item.ilevel}
              </span>
            )}
            {compact && item.ilevel > 0 && (
              <span
                title={
                  levelChanged
                    ? `${slot}: ${Number(equippedItem?.ilevel || 0)} -> ${item.ilevel}`
                    : undefined
                }
                className={
                  upgradeState === 'upgrade'
                  ? 'text-emerald-300'
                  : upgradeState === 'downgrade'
                    ? 'text-red-300'
                    : ''
                }
              >
                {upgradeState === 'upgrade' ? '↑ ' : ''}
                {item.ilevel}
              </span>
            )}
            {compact && displayTag && ` - ${displayTag}`}
            {!compact && displayTag && ` - ${displayTag}`}
          </>
        }
      />
    </div>
  );
}
