'use client';

import { useMemo } from 'react';
import type {
  EmbellishmentOption,
  EnchantInfo,
  GemInfo,
  ItemInfo,
  ItemQuery,
} from '../lib/useItemInfo';
import {
  enchantAvailabilityKey,
  enchantAvailabilityItemKey,
  getIconUrl,
  getWowheadData,
  getWowheadUrl,
  QUALITY_COLORS,
  useEmbellishmentOptions,
  useEnchantAvailability,
  useEnchantInfo,
  useGemInfo,
  useItemInfo,
} from '../lib/useItemInfo';
import { useWowheadTooltips } from '../lib/useWowheadTooltips';
import GearItemRow from './GearItemRow';
import {
  ASCENDANT_VOIDCORE_BADGE_CLASS,
  EMBELLISHMENT_BADGE_CLASS,
} from './shared/itemBadgeClasses';

export interface GearItem {
  slot: string;
  item_id: number;
  ilevel: number;
  name: string;
  bonus_ids?: number[];
  enchant_id?: number;
  gem_id?: number;
  gem_ids?: number[];
  is_kept?: boolean;
  upgrade_levels?: number;
  origin?: string;
  source_type?: string;
  encounter?: string;
  instance_name?: string;
  embellishment_item_id?: number;
  embellishment_name?: string;
  embellishment_icon?: string;
  embellishment_bonus_ids?: number[];
}

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
const GEAR_ORDER_STACKED = [...GEAR_ORDER_LEFT, ...GEAR_ORDER_RIGHT, 'main_hand', 'off_hand'];

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
  characterClassName?: string | null;
  equippedGear?: Record<string, GearItem>;
  dropBaselineIlevelByKey?: Record<string, number>;
  upgradeSlots?: Set<string>;
  downgradeSlots?: Set<string>;
  currencies?: Record<string, { id: number; name: string; icon: string }>;
  framed?: boolean;
  comparisonMode?: 'result' | 'provenance';
}

export default function GearOverview({
  gear,
  title = 'Equipped Gear',
  characterRenderUrl,
  characterClassName,
  equippedGear,
  dropBaselineIlevelByKey = {},
  upgradeSlots,
  downgradeSlots,
  currencies,
  framed = true,
  comparisonMode = 'provenance',
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
  const enchantAvailabilityBySlot = useEnchantAvailability(
    Object.values(gear)
      .filter((it) => it.item_id > 0)
      .map((it) => ({
        slot: it.slot,
        className: characterClassName,
        itemId: it.item_id,
        bonusIds: it.bonus_ids,
        seasonId: undefined,
      }))
  );

  const allGemIds = useMemo(() => {
    const ids = new Set<number>();
    for (const it of Object.values(gear)) {
      for (const gemId of it.gem_ids || []) {
        if (gemId > 0) ids.add(gemId);
      }
      if (it.gem_id && it.gem_id > 0) ids.add(it.gem_id);
    }
    return [...ids];
  }, [gear]);

  const gemInfoMap = useGemInfo(allGemIds);
  const embellishmentOptionsByItemId = useEmbellishmentOptions(
    Object.values(gear)
      .map((it) => Number(it.item_id || 0))
      .filter((id) => id > 0)
  );
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
    <div
      className={`${framed ? 'card mx-auto max-w-6xl p-4 sm:p-5' : ''} relative w-full overflow-hidden`}
    >
      {characterRenderUrl && (
        <img
          src={characterRenderUrl}
          alt=""
          className="pointer-events-none absolute inset-0 mx-auto hidden h-[120%] w-auto -translate-y-[8%] object-contain opacity-26 md:block"
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

        <div className="space-y-2 md:hidden">
          {GEAR_ORDER_STACKED.map((slot) => (
            <GearSlotRow
              key={slot}
              slot={slot}
              item={gear[slot]}
              equippedItem={equippedGear?.[slot]}
              dropBaselineIlevelByKey={dropBaselineIlevelByKey}
              isUpgrade={upgradeSlots?.has(slot)}
              isDowngrade={downgradeSlots?.has(slot)}
              comparisonMode={comparisonMode}
              itemInfoMap={itemInfoMap}
              enchantInfoMap={enchantInfoMap}
              gemInfoMap={gemInfoMap}
              characterClassName={characterClassName}
              enchantAvailabilityBySlot={enchantAvailabilityBySlot}
              embellishmentOptionsByItemId={embellishmentOptionsByItemId}
            />
          ))}
        </div>

        <div className={`hidden md:grid ${characterRenderUrl ? 'md:grid-cols-[1fr_200px_1fr] lg:grid-cols-[1fr_230px_1fr] xl:grid-cols-[1fr_260px_1fr]' : 'md:grid-cols-2'} md:gap-x-4 lg:gap-x-6`}>
          <div className="space-y-2">
            {GEAR_ORDER_LEFT.map((slot) => (
              <GearSlotRow
                key={slot}
                slot={slot}
                item={gear[slot]}
                equippedItem={equippedGear?.[slot]}
                dropBaselineIlevelByKey={dropBaselineIlevelByKey}
                isUpgrade={upgradeSlots?.has(slot)}
                isDowngrade={downgradeSlots?.has(slot)}
                comparisonMode={comparisonMode}
                itemInfoMap={itemInfoMap}
                enchantInfoMap={enchantInfoMap}
                gemInfoMap={gemInfoMap}
                characterClassName={characterClassName}
                enchantAvailabilityBySlot={enchantAvailabilityBySlot}
                embellishmentOptionsByItemId={embellishmentOptionsByItemId}
              />
            ))}
          </div>
          {characterRenderUrl && <div className="hidden md:block" />}
          <div className="space-y-2">
            {GEAR_ORDER_RIGHT.map((slot) => (
              <GearSlotRow
                key={slot}
                slot={slot}
                item={gear[slot]}
                equippedItem={equippedGear?.[slot]}
                dropBaselineIlevelByKey={dropBaselineIlevelByKey}
                isUpgrade={upgradeSlots?.has(slot)}
                isDowngrade={downgradeSlots?.has(slot)}
                comparisonMode={comparisonMode}
                itemInfoMap={itemInfoMap}
                enchantInfoMap={enchantInfoMap}
                gemInfoMap={gemInfoMap}
                characterClassName={characterClassName}
                enchantAvailabilityBySlot={enchantAvailabilityBySlot}
                embellishmentOptionsByItemId={embellishmentOptionsByItemId}
                reverse
              />
            ))}
          </div>
        </div>

        <div className="hidden md:flex md:justify-center">
          <div className="grid w-full max-w-4xl grid-cols-2 gap-6 pt-4">
            <div className="justify-self-end w-full max-w-md">
              <GearSlotRow
                slot="main_hand"
                item={gear.main_hand}
                equippedItem={equippedGear?.main_hand}
                dropBaselineIlevelByKey={dropBaselineIlevelByKey}
                isUpgrade={upgradeSlots?.has('main_hand')}
                isDowngrade={downgradeSlots?.has('main_hand')}
                comparisonMode={comparisonMode}
                itemInfoMap={itemInfoMap}
                enchantInfoMap={enchantInfoMap}
                gemInfoMap={gemInfoMap}
                characterClassName={characterClassName}
                enchantAvailabilityBySlot={enchantAvailabilityBySlot}
                embellishmentOptionsByItemId={embellishmentOptionsByItemId}
                reverse
              />
            </div>
            <div className="justify-self-start w-full max-w-md">
              <GearSlotRow
                slot="off_hand"
                item={gear.off_hand}
                equippedItem={equippedGear?.off_hand}
                dropBaselineIlevelByKey={dropBaselineIlevelByKey}
                isUpgrade={upgradeSlots?.has('off_hand')}
                isDowngrade={downgradeSlots?.has('off_hand')}
                comparisonMode={comparisonMode}
                itemInfoMap={itemInfoMap}
                enchantInfoMap={enchantInfoMap}
                gemInfoMap={gemInfoMap}
                characterClassName={characterClassName}
                enchantAvailabilityBySlot={enchantAvailabilityBySlot}
                embellishmentOptionsByItemId={embellishmentOptionsByItemId}
              />
            </div>
          </div>
        </div>
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
  comparisonMode = 'provenance',
  itemInfoMap,
  enchantInfoMap,
  gemInfoMap,
  characterClassName,
  enchantAvailabilityBySlot,
  embellishmentOptionsByItemId,
  reverse = false,
}: {
  slot: string;
  item?: GearItem;
  equippedItem?: GearItem;
  dropBaselineIlevelByKey?: Record<string, number>;
  isUpgrade?: boolean;
  isDowngrade?: boolean;
  comparisonMode?: 'result' | 'provenance';
  itemInfoMap: Record<number, ItemInfo>;
  enchantInfoMap: Record<number, EnchantInfo>;
  gemInfoMap: Record<number, GemInfo>;
  characterClassName?: string | null;
  enchantAvailabilityBySlot: Record<string, boolean>;
  embellishmentOptionsByItemId: Record<number, EmbellishmentOption[]>;
  reverse?: boolean;
}) {
  if (!item || item.item_id <= 0) {
    return (
      <div className="rounded-lg">
        <GearItemRow
          icon="inv_misc_questionmark"
          name="Empty"
          nameColor="#d4d4d8"
          showCheckbox={false}
          dimmed
          reverse={reverse}
        />
      </div>
    );
  }

  const info = itemInfoMap[item.item_id];
  const enchant = item.enchant_id ? enchantInfoMap[item.enchant_id] : undefined;
  const gemIds = [...new Set((item.gem_ids || []).filter((id) => id > 0))];
  if (gemIds.length === 0 && item.gem_id && item.gem_id > 0) {
    gemIds.push(item.gem_id);
  }
  const gems = gemIds.map((id) => gemInfoMap[id]).filter(Boolean);
  const qc = info ? QUALITY_COLORS[info.quality] || '#fff' : '#fff';
  const name = info?.name || item.name || `Item ${item.item_id}`;
  const icon = info?.icon || 'inv_misc_questionmark';
  const whData =
    item.item_id > 0
      ? getWowheadData(item.bonus_ids, item.ilevel, item.enchant_id, gemIds)
      : undefined;

  const baselineDropIlevel = Number(dropBaselineIlevelByKey[dropBaselineKey(item)] || 0);
  const needsUpgrade =
    Number(item.upgrade_levels || 0) > 0 ||
    (baselineDropIlevel > 0 && Number(item.ilevel || 0) > baselineDropIlevel);
  const levelChanged =
    Number(equippedItem?.ilevel || 0) > 0 &&
    Number(equippedItem?.ilevel || 0) !== Number(item.ilevel || 0);
  const comparisonState: 'upgrade' | 'downgrade' | null = isDowngrade
    ? 'downgrade'
    : isUpgrade
      ? 'upgrade'
      : levelChanged
        ? Number(item.ilevel || 0) > Number(equippedItem?.ilevel || 0)
          ? 'upgrade'
          : 'downgrade'
        : null;
  const provenanceState: 'upgrade' | 'downgrade' | null = needsUpgrade
    ? 'upgrade'
    : levelChanged
      ? Number(item.ilevel || 0) > Number(equippedItem?.ilevel || 0)
        ? 'upgrade'
        : 'downgrade'
      : null;
  const upgradeState = comparisonMode === 'result' ? comparisonState : provenanceState;

  const socketCount = Number((info as any)?.sockets || 0);
  const gemEligible = socketCount > 0 || gemIds.length > 0;
  const enchantEligible =
    enchantAvailabilityBySlot[
      enchantAvailabilityItemKey(slot, characterClassName, item.item_id, item.bonus_ids)
    ] || false;
  const embellishmentOptions = embellishmentOptionsByItemId[item.item_id] || [];
  const inferredEmbellishment =
    embellishmentOptions.find((opt) => opt.item_id === item.embellishment_item_id) ||
    embellishmentOptions.find(
      (opt) =>
        Array.isArray(opt.bonus_ids) &&
        opt.bonus_ids.length > 0 &&
        opt.bonus_ids.every((bid) => (item.bonus_ids || []).includes(bid))
    );
  const embellishmentName = item.embellishment_name || inferredEmbellishment?.name || '';
  const embellishmentIcon = item.embellishment_icon || inferredEmbellishment?.icon || '';
  const embellishmentItemId = item.embellishment_item_id || inferredEmbellishment?.item_id || 0;

  const details: Array<{
    text: string;
    kind?: 'text' | 'gemIcon' | 'plain' | 'iconText';
    badgeVariant?: 'neutral' | 'gem' | 'enchant' | 'embellishment' | 'mod' | 'source';
    color?: string;
    tooltip?: string;
    icon?: string;
    href?: string;
    wowheadData?: string;
  }> = [
  ];
  const sourceLabel = (() => {
    if (item.encounter && item.instance_name) return `${item.instance_name}: ${item.encounter}`;
    if (item.instance_name) return item.instance_name;
    if (item.encounter) return item.encounter;
    if (item.source_type) return item.source_type;
    if (item.origin === 'vault') return 'Great Vault';
    return '';
  })();
  for (const gem of gems) {
    details.push({
      text: gem.name,
      kind: 'iconText',
      badgeVariant: 'gem',
      icon: gem.icon || 'inv_misc_gem_variety_01',
      href: gem.gem_id ? getWowheadUrl(gem.gem_id) : undefined,
      wowheadData: gem.gem_id ? `item=${gem.gem_id}` : undefined,
      color: 'text-sky-200 border-sky-400/45 bg-sky-500/10',
    });
  }
  const emptySocketCount = Math.max(0, socketCount - gemIds.length);
  if (gems.length === 0 && gemEligible) {
    details.push({
      text: emptySocketCount > 1 ? `${emptySocketCount} Empty Sockets` : 'Empty Socket',
      kind: 'iconText',
      badgeVariant: 'gem',
      icon: 'inv_misc_gem_variety_01',
      color: 'text-zinc-200 border-dashed border-zinc-500/60 bg-zinc-500/8',
    });
  } else if (emptySocketCount > 0) {
    details.push({
      text: emptySocketCount > 1 ? `${emptySocketCount} Empty Sockets` : 'Empty Socket',
      kind: 'iconText',
      badgeVariant: 'gem',
      icon: 'inv_misc_gem_variety_01',
      color: 'text-zinc-200 border-dashed border-zinc-500/60 bg-zinc-500/8',
    });
  }
  if (enchant?.name) {
    details.push({
      text: enchant.name,
      kind: 'iconText',
      badgeVariant: 'enchant',
      icon: enchant.icon || 'inv_enchant_shardprismaticsmall',
      href: enchant.item_id
        ? getWowheadUrl(enchant.item_id)
        : enchant.enchant_id
          ? `https://www.wowhead.com/spell=${enchant.enchant_id}`
          : undefined,
      wowheadData: enchant.item_id
        ? `item=${enchant.item_id}`
        : enchant.enchant_id
          ? `spell=${enchant.enchant_id}`
          : undefined,
      color: 'text-emerald-200 border-emerald-400/45 bg-emerald-500/10',
    });
  } else if (enchantEligible) {
    details.push({
      text: 'No Enchant',
      kind: 'iconText',
      badgeVariant: 'enchant',
      icon: 'inv_enchant_shardprismaticsmall',
      color: 'text-zinc-200 border-dashed border-zinc-500/60 bg-zinc-500/8',
    });
  }
  if (embellishmentName) {
    details.push({
      text: embellishmentName,
      kind: embellishmentIcon ? 'iconText' : 'plain',
      badgeVariant: 'embellishment',
      icon: embellishmentIcon || undefined,
      href: embellishmentItemId > 0 ? getWowheadUrl(embellishmentItemId) : undefined,
      wowheadData: embellishmentItemId > 0 ? `item=${embellishmentItemId}` : undefined,
      tooltip: embellishmentName,
      color: EMBELLISHMENT_BADGE_CLASS,
    });
  }
  const hasAscendantVoidcore =
    /(?:^|\s)mod:268552(?:\s|$)/i.test(String(item.source_type || '')) ||
    String(item.source_type || '').toLowerCase().includes('ascendant_voidcore') ||
    String(item.name || '').toLowerCase().includes('ascendant');
  if (hasAscendantVoidcore) {
    details.push({
      text: 'Ascendant Voidcore',
      kind: 'iconText' as const,
      badgeVariant: 'mod',
      icon: 'inv_1205_voidforge_sovereignvoidcores_cosmicvoid',
      href: 'https://www.wowhead.com/item=268552/ascendant-voidcore',
      wowheadData: 'item=268552',
      color: ASCENDANT_VOIDCORE_BADGE_CLASS,
    });
  }

  return (
    <div
      className={`rounded-lg ${
        upgradeState === 'upgrade'
          ? 'bg-emerald-500/[0.08] ring-2 ring-inset ring-emerald-400/45'
          : upgradeState === 'downgrade'
            ? 'bg-red-500/[0.08] ring-1 ring-inset ring-red-500/25'
            : ''
      }`}
    >
      <GearItemRow
        icon={icon}
        overline={
          <>
            {upgradeState === 'upgrade' && sourceLabel ? (
              <span className="rounded border border-amber-400/45 bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold leading-none text-amber-200">
                {sourceLabel}
              </span>
            ) : null}
            <span
              className={`rounded border px-2 py-0.5 text-[11px] font-semibold leading-none ${
                upgradeState === 'upgrade'
                  ? 'text-emerald-200 border-emerald-400/45 bg-emerald-500/12'
                  : upgradeState === 'downgrade'
                    ? 'text-red-200 border-red-400/45 bg-red-500/12'
                    : 'text-zinc-200 border-zinc-500/40 bg-zinc-500/10'
              }`}
              title={levelChanged ? `${slot}: ${Number(equippedItem?.ilevel || 0)} -> ${item.ilevel}` : undefined}
            >
              iLvl {item.ilevel || 0}
            </span>
          </>
        }
        name={name}
        nameColor={qc}
        details={details}
        selectable={false}
        showCheckbox={false}
        reverse={reverse}
        vault={item.origin === 'vault'}
        href={item.item_id > 0 ? getWowheadUrl(item.item_id) : undefined}
        wowheadData={whData}
      />
    </div>
  );
}
