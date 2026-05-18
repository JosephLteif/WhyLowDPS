'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { API_URL, fetchJsonCached } from '../lib/api';
import type { ResolvedItem, ResolveGearResponse } from '../lib/types';
import { enchantAvailabilityItemKey, type ItemQuery, useItemInfo } from '../lib/useItemInfo';
import { useWowheadTooltips } from '../lib/useWowheadTooltips';
import AddItemModal from './AddItemModal';
import OptimizeItemModal from './OptimizeItemModal';
import { ASCENDANT_VOIDCORE_BADGE_CLASS, EMBELLISHMENT_BADGE_CLASS } from './shared/itemBadgeClasses';
import { useSimContext } from './SimContext';
import { getItemExtraEffects, useItemExtraEffects } from '../lib/itemExtraEffect';
import TopGearItemContextMenu from './top-gear/TopGearItemContextMenu';
import TopGearQuickSelect from './top-gear/TopGearQuickSelect';
import TopGearSlotGroup from './top-gear/TopGearSlotGroup';
import TopGearVariantStudio, { type SavedVariantStudioState } from './top-gear/TopGearVariantStudio';
import type { BadgeDescriptor } from './top-gear/topGearItemUtils';
import {
  applyAscendantToSimc,
  getAscendantModifierIlevelConfig,
  getWowheadData,
  getWowheadUrl,
  isAscendantApplied,
  isAscendantEligible,
  isCraftedSource,
  itemHasEmbellishment,
  makeIdentity,
  makeUid,
  parseFirstIdFromSimc,
  parseGemIdsFromSimc,
  sameStringSet,
} from './top-gear/topGearItemUtils';
import { useTopGearLimitWarnings } from './top-gear/useTopGearLimitWarnings';
import { useTopGearState } from './top-gear/useTopGearState';
import StickyPageHeader from './StickyPageHeader';

interface TopGearItemSelectorProps {
  resolved: ResolveGearResponse;
  selectedUids: Record<string, Set<string>>;
  onSelectionChange: (selected: Record<string, Set<string>>) => void;
  onResolvedChange: (resolved: ResolveGearResponse) => void;
  onItemAdded: (slot: string, simcString: string, origin: string) => void;
  onVariantCopiesChange: (variantsBySlot: Record<string, ResolvedItem[]>) => void;
  onVariantRuleStateChange?: (state: SavedVariantStudioState | null) => void;
  savedVariantCopiesBySlot?: Record<string, ResolvedItem[]>;
  savedVariantRuleState?: SavedVariantStudioState | null;
  savedVariantCount?: number;
  globalAffixesEnabled?: boolean;
  comboCount: number;
  copyEnchants?: boolean;
  specName?: string | null;
  maxUpgrade?: boolean;
  comboError?: string;
}

interface DisplayGroup {
  label: string;
  slots: string[];
}

interface GemInfo {
  gem_id: number;
  name: string;
  icon: string;
  quality: number;
}

interface EnchantInfo {
  enchant_id: number;
  name: string;
  icon: string;
  item_id: number;
  quality: number;
}

interface EmbellishmentOption {
  id: number;
  item_id: number;
  name: string;
  icon: string;
  quality: number;
  bonus_ids: number[];
}

interface VariantRequest {
  item: ResolvedItem;
  enchantId: number;
  gemIds: number[];
  embellishment: EmbellishmentOption | null;
  forceClearEnchant?: boolean;
  bundleId?: string;
}

interface ItemActionAvailability {
  canAddEnchant: boolean;
  canAddGem: boolean;
}

interface UpgradeOption {
  bonus_id: number;
  level: number;
  max: number;
  name: string;
  fullName: string;
  itemLevel: number;
}

const DISPLAY_GROUPS: DisplayGroup[] = [
  { label: 'Head', slots: ['head'] },
  { label: 'Neck', slots: ['neck'] },
  { label: 'Shoulder', slots: ['shoulder'] },
  { label: 'Back', slots: ['back'] },
  { label: 'Chest', slots: ['chest'] },
  { label: 'Wrist', slots: ['wrist'] },
  { label: 'Hands', slots: ['hands'] },
  { label: 'Waist', slots: ['waist'] },
  { label: 'Legs', slots: ['legs'] },
  { label: 'Feet', slots: ['feet'] },
  { label: 'Rings', slots: ['finger1', 'finger2'] },
  { label: 'Trinkets', slots: ['trinket1', 'trinket2'] },
  { label: 'Main Hand', slots: ['main_hand'] },
  { label: 'Off Hand', slots: ['off_hand'] },
];

const UPGRADE_TRACK_MAX_LEVEL = 6;
const KNOWN_ENCHANTABLE_SLOTS = new Set([
  'head',
  'neck',
  'shoulder',
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

function affixGroupKeyFromSlots(slots: string[]): string | null {
  if (slots.includes('finger1') || slots.includes('finger2')) return 'rings';
  if (slots.includes('trinket1') || slots.includes('trinket2')) return 'trinkets';
  return slots[0] || null;
}

function normalizeEnchantQuerySlot(slot: string): string {
  if (slot === 'finger1' || slot === 'finger2') return 'finger';
  if (slot === 'trinket1' || slot === 'trinket2') return 'trinket';
  return slot;
}

function getResolvedGemIds(item: ResolvedItem): number[] {
  if (item.gem_ids && item.gem_ids.length > 0) {
    return item.gem_ids.filter((id) => Number.isFinite(id) && id > 0);
  }
  if (item.gem_id > 0) {
    return [item.gem_id];
  }
  return parseGemIdsFromSimc(item.simc_string);
}

function normalizeEmbellishmentName(value?: string | null): string {
  return String(value || '')
    .toLowerCase()
    .replace(/\s*\((quality|rank|q)\s*\d+\)\s*$/i, '')
    .replace(/\s*\(\d+\)\s*$/i, '')
    .replace(/[^a-z0-9]/g, '');
}

function upgradeTierTagColor(label: string): string {
  const targetTier = label.split('->').pop()?.trim().toLowerCase() || label.toLowerCase();
  if (targetTier.includes('myth')) return '!border-orange-300/80 !text-orange-100';
  if (targetTier.includes('hero')) return '!border-teal-300/80 !text-teal-100';
  if (targetTier.includes('champion')) return '!border-emerald-300/80 !text-emerald-100';
  if (targetTier.includes('veteran')) return '!border-sky-300/80 !text-sky-100';
  if (targetTier.includes('adventurer')) return '!border-lime-300/80 !text-lime-100';
  if (targetTier.includes('explorer')) return '!border-zinc-300/80 !text-zinc-100';
  return '!border-teal-300/80 !text-teal-100';
}

function parseUpgradeLabel(value: string): {
  segments: string[];
  hasAscendant: boolean;
} {
  const raw = String(value || '').trim();
  if (!raw) return { segments: [], hasAscendant: false };

  const hasAscendant = /\+\s*ascendant\b/i.test(raw);

  const base = raw
    .replace(/\s*\+\s*ascendant\b/gi, '')
    .trim();

  const segments = base
    // supports both "->" and "→"
    .split(/\s*(?:->|→)\s*/g)
    .map((segment) =>
      segment
        .trim()
        // "ilvl 298 Myth 6/6" -> "Myth 6/6"
        .replace(/^ilvl\s+\d+\s+/i, '')
        .trim()
    )
    .filter(Boolean);

  return { segments, hasAscendant };
}

function clampUpgradeArrowChain(label: string): string {
  const { segments } = parseUpgradeLabel(label);

  if (segments.length === 0) return '';

  const last = segments[segments.length - 1];
  const previous = segments.length >= 2 ? segments[segments.length - 2] : '';

  return previous && previous !== last ? `${previous} -> ${last}` : last;
}

function formatCanonicalUpgradeLabel(
  selectedUpgradeRaw: string,
  equippedUpgradeRaw: string,
  _includeAscendant: boolean
): string {
  const selectedSegments = parseUpgradeLabel(selectedUpgradeRaw).segments;
  const equippedSegments = parseUpgradeLabel(equippedUpgradeRaw).segments;
  const selected = selectedSegments.length > 0 ? selectedSegments[selectedSegments.length - 1] : '';
  if (!selected) return '';
  const equipped = equippedSegments.length > 0 ? equippedSegments[0] : '';
  return equipped && equipped !== selected ? `${equipped} -> ${selected}` : selected;
}

export default function TopGearItemSelector({
  resolved,
  selectedUids,
  onSelectionChange,
  onResolvedChange,
  onItemAdded,
  onVariantCopiesChange,
  onVariantRuleStateChange,
  savedVariantCopiesBySlot = {},
  savedVariantRuleState = null,
  savedVariantCount = 0,
  globalAffixesEnabled = false,
  comboCount,
  copyEnchants = false,
  specName = null,
  comboError,
}: TopGearItemSelectorProps) {
  const { maxCombinations } = useSimContext();
  const effectiveMaxCombinations = maxCombinations ?? 500;
  const [gemInfoById, setGemInfoById] = useState<Record<number, GemInfo>>({});
  const [enchantInfoById, setEnchantInfoById] = useState<Record<number, EnchantInfo>>({});
  const [enchantAvailabilityBySlot, setEnchantAvailabilityBySlot] = useState<Record<string, boolean>>(
    {}
  );
  const [embellishmentOptionsByItem, setEmbellishmentOptionsByItem] = useState<
    Record<number, EmbellishmentOption[]>
  >({});
  const {
    limitWarningOrder,
    knownEmbellishedUids,
    immediateLimitWarningUids,
    confirmedLimitWarningUids,
    setLimitWarningOrder,
    setKnownEmbellishedUids,
    setImmediateLimitWarningUids,
    setConfirmedLimitWarningUids,
    rememberLimitWarningCandidate,
    forgetLimitWarningCandidate,
  } = useTopGearLimitWarnings();
  const selectedUidSignatureRef = useRef('');
  const [otherTierOptions, setOtherTierOptions] = useState<UpgradeOption[]>([]);
  const [loadingOtherTierOptions, setLoadingOtherTierOptions] = useState(false);
  const [isVariantStudioOpen, setVariantStudioOpen] = useState(false);
  const [showAllLowLevelByGroup, setShowAllLowLevelByGroup] = useState<Record<string, boolean>>({});
  const [contextMenu, setContextMenu] = useState<{
    item: ResolvedItem;
    x: number;
    y: number;
    availability: ItemActionAvailability;
  } | null>(null);

  const {
    setUpgradeMenuFor,
    upgradeOptions,
    loadingUpgrades,
    isAddItemOpen,
    setAddItemOpen,
    addItemSlot,
    isOptimizeOpen,
    setOptimizeOpen,
    optimizeItem,
    openAddItem,
    openOptimize,
    loadUpgradeOptions,
    deselectAll,
    selectAll,
    toggleSlotAll,
    toggleGroup,
    toggleItem,
  } = useTopGearState({ resolved, selectedUids, onSelectionChange, onResolvedChange, onItemAdded });

  const allItemQueries = useMemo(() => {
    const seen = new Set<string>();
    const queries: ItemQuery[] = [];
    for (const slotRes of Object.values(resolved.slots)) {
      const items = [
        ...(slotRes.equipped ? [slotRes.equipped] : []),
        ...slotRes.alternatives,
      ];
      for (const item of items) {
        if (!item || item.item_id <= 0) continue;
        const key = `${item.item_id}:${(item.bonus_ids || []).slice().sort((a, b) => a - b).join(':')}`;
        if (seen.has(key)) continue;
        seen.add(key);
        queries.push({ item_id: item.item_id, bonus_ids: item.bonus_ids });
      }
    }
    return queries;
  }, [resolved.slots]);

  const itemInfoMap = useItemInfo(allItemQueries);
  const extraEffectsByKey = useItemExtraEffects(allItemQueries);

  useWowheadTooltips([resolved, gemInfoById, enchantInfoById, embellishmentOptionsByItem]);

  const convertToCatalyst = useCallback(
    async (item: ResolvedItem) => {
      setContextMenu(null);
      setUpgradeMenuFor(null);
      try {
        const res = await fetch(`${API_URL}/api/gear/catalyst-convert`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            class_name: resolved.character.class_name,
            slot: item.slot,
            item,
          }),
        });
        if (!res.ok) return;
        const catalystItem: ResolvedItem = await res.json();
        const nextResolved = { ...resolved, slots: { ...resolved.slots } };
        const slotRes = nextResolved.slots[item.slot];
        if (slotRes) {
          slotRes.alternatives = [...slotRes.alternatives, catalystItem];
        }
        onResolvedChange(nextResolved);
        const nextSelected = {
          ...Object.fromEntries(Object.entries(selectedUids).map(([k, v]) => [k, new Set(v)])),
        };
        if (!nextSelected[item.slot]) nextSelected[item.slot] = new Set();
        nextSelected[item.slot].add(catalystItem.uid);
        onSelectionChange(nextSelected);
        rememberLimitWarningCandidate(
          catalystItem.uid,
          itemHasEmbellishment(catalystItem, embellishmentOptionsByItem)
        );
        onItemAdded(item.slot, catalystItem.simc_string, catalystItem.origin);
      } catch {}
    },
    [
      resolved,
      onResolvedChange,
      selectedUids,
      onSelectionChange,
      setUpgradeMenuFor,
      onItemAdded,
      rememberLimitWarningCandidate,
      embellishmentOptionsByItem,
    ]
  );

  const updateAlternativesByIdentity = useCallback(
    (
      source: ResolvedItem,
      mutate: (item: ResolvedItem) => ResolvedItem
    ): { updated: boolean; uidMap: Map<string, string> } => {
      const targetIdentity = makeIdentity(source);
      const uidMap = new Map<string, string>();
      let updated = false;
      const nextResolved = { ...resolved, slots: { ...resolved.slots } };

      for (const [slot, slotRes] of Object.entries(nextResolved.slots)) {
        slotRes.alternatives = slotRes.alternatives.map((alt) => {
          if (makeIdentity(alt) !== targetIdentity) return alt;
          const nextItem = mutate(alt);
          const nextUid = makeUid({
            item_id: nextItem.item_id,
            bonus_ids: nextItem.bonus_ids,
            origin: nextItem.origin,
            slot: nextItem.slot || slot,
            ilevel: nextItem.ilevel,
            enchant_id: nextItem.enchant_id,
            gem_id: nextItem.gem_id,
            gem_ids: nextItem.gem_ids,
            crafted_stats: nextItem.crafted_stats,
            embellishment_item_id: nextItem.embellishment_item_id,
          });
          if (nextUid !== alt.uid) {
            uidMap.set(alt.uid, nextUid);
          }
          updated = true;
          return { ...nextItem, uid: nextUid, slot: nextItem.slot || slot };
        });
      }

      if (updated) {
        onResolvedChange(nextResolved);
      }

      return { updated, uidMap };
    },
    [resolved, onResolvedChange]
  );

  const remapSelections = useCallback(
    (uidMap: Map<string, string>) => {
      if (uidMap.size === 0) return;
      const nextSelected = {
        ...Object.fromEntries(Object.entries(selectedUids).map(([k, v]) => [k, new Set(v)])),
      };
      for (const set of Object.values(nextSelected)) {
        for (const [oldUid, newUid] of uidMap.entries()) {
          if (!set.has(oldUid)) continue;
          set.delete(oldUid);
          set.add(newUid);
        }
      }
      onSelectionChange(nextSelected);
    },
    [selectedUids, onSelectionChange]
  );

  const setItemOrigin = useCallback(
    (item: ResolvedItem, origin: 'bags' | 'vault') => {
      const { updated, uidMap } = updateAlternativesByIdentity(item, (alt) => ({ ...alt, origin }));
      if (!updated) return;
      remapSelections(uidMap);
      setContextMenu(null);
    },
    [updateAlternativesByIdentity, remapSelections]
  );

  const setItemWishlist = useCallback(
    (item: ResolvedItem, enabled: boolean) => {
      const { updated } = updateAlternativesByIdentity(item, (alt) => {
        const nextTag = enabled
          ? alt.tag && alt.tag.toLowerCase() !== 'vault'
            ? alt.tag
            : 'Wishlist'
          : alt.tag.toLowerCase() === 'wishlist'
            ? ''
            : alt.tag;
        return {
          ...alt,
          tag: nextTag,
          source_type: enabled ? 'wishlist' : '',
        };
      });
      if (!updated) return;
      setContextMenu(null);
    },
    [updateAlternativesByIdentity]
  );

  const openItemContextMenu = useCallback(
    (item: ResolvedItem, event: React.MouseEvent) => {
      const getGemAvailability = (target: ResolvedItem): boolean =>
        target.sockets > 0 || getResolvedGemIds(target).length > 0;

      const getEnchantAvailability = async (target: ResolvedItem): Promise<boolean> => {
        const className = resolved.character.class_name || '';
        const cacheKey = enchantAvailabilityItemKey(
          target.slot,
          className,
          target.item_id,
          target.bonus_ids,
          target.season_id,
          specName
        );
        if (Object.prototype.hasOwnProperty.call(enchantAvailabilityBySlot, cacheKey)) {
          return enchantAvailabilityBySlot[cacheKey];
        }
        try {
          const params = new URLSearchParams();
          params.set('slot', normalizeEnchantQuerySlot(target.slot));
          if (className) params.set('class_name', className);
          if (specName) params.set('spec', specName);
          if (target.item_id > 0) params.set('item_id', String(target.item_id));
          if (Array.isArray(target.bonus_ids) && target.bonus_ids.length > 0) {
            params.set('bonus_ids', target.bonus_ids.join(','));
          }
          if (Number.isFinite(target.season_id) && Number(target.season_id) > 0) {
            params.set('season_id', String(Number(target.season_id)));
          }
          const res = await fetch(
            `${API_URL}/api/gear/enchant-options?${params.toString()}`,
            { credentials: 'include' }
          );
          if (!res.ok) return false;
          const data = await res.json();
          const available = Array.isArray(data) && data.length > 0;
          setEnchantAvailabilityBySlot((prev) => ({ ...prev, [cacheKey]: available }));
          return available;
        } catch {
          return false;
        }
      };

      const openAsync = async () => {
        const canAddGem = globalAffixesEnabled ? false : getGemAvailability(item);
        const canAddEnchant = globalAffixesEnabled ? false : await getEnchantAvailability(item);
        setContextMenu({
          item,
          x: event.clientX,
          y: event.clientY,
          availability: {
            canAddEnchant,
            canAddGem,
          },
        });
      };

      event.preventDefault();
      event.stopPropagation();
      void openAsync();
    },
    [resolved.character.class_name, enchantAvailabilityBySlot, globalAffixesEnabled, specName]
  );

  const addUpgradedCopy = useCallback(
    (item: ResolvedItem, option: any) => {
      const currentUpgradeBonusId = upgradeOptions.find((o) =>
        item.bonus_ids.includes(o.bonus_id)
      )?.bonus_id;
      if (!currentUpgradeBonusId) return;

      const newBonusIds = item.bonus_ids.map((b) =>
        b === currentUpgradeBonusId ? option.bonus_id : b
      );
      const newSimcString = item.simc_string.replace(
        /bonus_id=[0-9/:]+/,
        `bonus_id=${newBonusIds.join('/')}`
      );
      const copyOrigin = item.origin === 'equipped' ? 'bags' : item.origin;
      const targetSlots =
        item.slot === 'finger1'
          ? ['finger1', 'finger2']
          : item.slot === 'finger2'
            ? ['finger1', 'finger2']
            : item.slot === 'trinket1'
              ? ['trinket1', 'trinket2']
              : item.slot === 'trinket2'
                ? ['trinket1', 'trinket2']
                : [item.slot];

      const nextResolved = { ...resolved, slots: { ...resolved.slots } };
      for (const slot of targetSlots) {
        const uid = makeUid({
          item_id: item.item_id,
          bonus_ids: newBonusIds,
          origin: copyOrigin,
          slot,
          ilevel: option.itemLevel,
          enchant_id: item.enchant_id,
          gem_id: item.gem_id,
          gem_ids: item.gem_ids,
          crafted_stats: item.crafted_stats,
          embellishment_item_id: item.embellishment_item_id,
        });
        const slotRes = nextResolved.slots[slot];
        if (!slotRes || slotRes.alternatives.some((a) => a.uid === uid)) continue;
        const upgradeLabel = formatCanonicalUpgradeLabel(
          option.fullName,
          String(slotRes.equipped?.upgrade || item.upgrade || ''),
          false
        );
        const copy: ResolvedItem = {
          ...item,
          slot,
          origin: copyOrigin as any,
          uid,
          bonus_ids: newBonusIds,
          simc_string: newSimcString,
          ilevel: option.itemLevel,
          upgrade: upgradeLabel,
        };
        slotRes.alternatives = [...slotRes.alternatives, copy];
      }
      onResolvedChange(nextResolved);
      onItemAdded(item.slot, newSimcString, copyOrigin);
      const nextSelected = {
        ...Object.fromEntries(Object.entries(selectedUids).map(([k, v]) => [k, new Set(v)])),
      };
      for (const slot of targetSlots) {
        const uid = makeUid({
          item_id: item.item_id,
          bonus_ids: newBonusIds,
          origin: copyOrigin,
          slot,
          ilevel: option.itemLevel,
          enchant_id: item.enchant_id,
          gem_id: item.gem_id,
          gem_ids: item.gem_ids,
          crafted_stats: item.crafted_stats,
          embellishment_item_id: item.embellishment_item_id,
        });
        if (!nextSelected[slot]) nextSelected[slot] = new Set();
        nextSelected[slot].add(uid);
        rememberLimitWarningCandidate(uid, itemHasEmbellishment(item, embellishmentOptionsByItem));
      }
      onSelectionChange(nextSelected);
      setUpgradeMenuFor(null);
    },
    [
      resolved,
      upgradeOptions,
      onResolvedChange,
      onItemAdded,
      selectedUids,
      onSelectionChange,
      setUpgradeMenuFor,
      rememberLimitWarningCandidate,
      embellishmentOptionsByItem,
    ]
  );

  const applyTierCopy = useCallback(
    (item: ResolvedItem, option: UpgradeOption) => {
      const currentUpgradeBonusId = upgradeOptions.find((o) =>
        item.bonus_ids.includes(o.bonus_id)
      )?.bonus_id;
      if (!currentUpgradeBonusId) return;

      const newBonusIds = item.bonus_ids.map((b) =>
        b === currentUpgradeBonusId ? option.bonus_id : b
      );
      const newSimcString = item.simc_string.replace(
        /bonus_id=[0-9/:]+/,
        `bonus_id=${newBonusIds.join('/')}`
      );
      const copyOrigin = item.origin === 'equipped' ? 'bags' : item.origin;
      const targetSlots =
        item.slot === 'finger1'
          ? ['finger1', 'finger2']
          : item.slot === 'finger2'
            ? ['finger1', 'finger2']
            : item.slot === 'trinket1'
              ? ['trinket1', 'trinket2']
              : item.slot === 'trinket2'
                ? ['trinket1', 'trinket2']
                : [item.slot];

      const nextResolved = { ...resolved, slots: { ...resolved.slots } };
      for (const slot of targetSlots) {
        const uid = makeUid({
          item_id: item.item_id,
          bonus_ids: newBonusIds,
          origin: copyOrigin,
          slot,
          ilevel: option.itemLevel,
          enchant_id: item.enchant_id,
          gem_id: item.gem_id,
          gem_ids: item.gem_ids,
          crafted_stats: item.crafted_stats,
          embellishment_item_id: item.embellishment_item_id,
        });
        const slotRes = nextResolved.slots[slot];
        if (!slotRes || slotRes.alternatives.some((a) => a.uid === uid)) continue;
        const upgradeLabel = formatCanonicalUpgradeLabel(
          option.fullName,
          String(slotRes.equipped?.upgrade || item.upgrade || ''),
          false
        );
        const copy: ResolvedItem = {
          ...item,
          slot,
          origin: copyOrigin as any,
          uid,
          bonus_ids: newBonusIds,
          simc_string: newSimcString,
          ilevel: option.itemLevel,
          upgrade: upgradeLabel,
        };
        slotRes.alternatives = [...slotRes.alternatives, copy];
      }
      onResolvedChange(nextResolved);
      onItemAdded(item.slot, newSimcString, copyOrigin);
      const nextSelected = {
        ...Object.fromEntries(Object.entries(selectedUids).map(([k, v]) => [k, new Set(v)])),
      };
      for (const slot of targetSlots) {
        const uid = makeUid({
          item_id: item.item_id,
          bonus_ids: newBonusIds,
          origin: copyOrigin,
          slot,
          ilevel: option.itemLevel,
          enchant_id: item.enchant_id,
          gem_id: item.gem_id,
          gem_ids: item.gem_ids,
          crafted_stats: item.crafted_stats,
          embellishment_item_id: item.embellishment_item_id,
        });
        if (!nextSelected[slot]) nextSelected[slot] = new Set();
        nextSelected[slot].add(uid);
        rememberLimitWarningCandidate(uid, itemHasEmbellishment(item, embellishmentOptionsByItem));
      }
      onSelectionChange(nextSelected);
      setContextMenu(null);
    },
    [
      resolved,
      upgradeOptions,
      onResolvedChange,
      onItemAdded,
      selectedUids,
      onSelectionChange,
      rememberLimitWarningCandidate,
      embellishmentOptionsByItem,
    ]
  );

  const loadOtherTierOptions = useCallback(async () => {
    if (otherTierOptions.length > 0 || loadingOtherTierOptions) return;
    setLoadingOtherTierOptions(true);
    try {
      const res = await fetch(`${API_URL}/api/upgrade-tracks`, { credentials: 'include' });
      if (!res.ok) {
        setOtherTierOptions([]);
        setLoadingOtherTierOptions(false);
        return;
      }
      const data = await res.json();
      const normalized: UpgradeOption[] = (Array.isArray(data) ? data : [])
        .map((opt: any) => {
          const bonusId = Number(opt?.bonus_id ?? 0);
          const level = Number(opt?.level ?? 0);
          const max = Number(opt?.max ?? opt?.max_level ?? 0);
          const itemLevel = Number(opt?.itemLevel ?? opt?.ilevel ?? 0);
          const trackName = String(opt?.name || '').trim();
          if (!bonusId || !trackName) return null;
          return {
            bonus_id: bonusId,
            level,
            max,
            name: trackName,
            fullName: `${trackName} ${level}/${max}`,
            itemLevel,
          };
        })
        .filter((o: UpgradeOption | null): o is UpgradeOption => o !== null)
        .sort((a, b) => a.itemLevel - b.itemLevel);
      setOtherTierOptions(normalized);
    } catch {
      setOtherTierOptions([]);
    }
    setLoadingOtherTierOptions(false);
  }, [otherTierOptions.length, loadingOtherTierOptions]);

  const buildOptimizedCopy = useCallback(
    ({ item, enchantId, gemIds, embellishment, forceClearEnchant, bundleId }: VariantRequest) => {
      const normalizedGemIds = gemIds.filter((id) => id > 0);
      const firstGemId = normalizedGemIds[0] || 0;
      const inferredCurrentEmbellishment =
        (embellishmentOptionsByItem[item.item_id] || []).find(
          (opt) =>
            Array.isArray(opt.bonus_ids) &&
            opt.bonus_ids.length > 0 &&
            opt.bonus_ids.every((bid) => item.bonus_ids.includes(bid))
        ) || null;
      const currentEmbellishmentBonusIds =
        item.embellishment_bonus_ids && item.embellishment_bonus_ids.length > 0
          ? item.embellishment_bonus_ids
          : inferredCurrentEmbellishment?.bonus_ids || [];
      let nextBonusIds = item.bonus_ids.filter(
        (bid) => !currentEmbellishmentBonusIds.includes(bid)
      );
      if (embellishment && embellishment.bonus_ids.length > 0) {
        nextBonusIds = Array.from(new Set([...nextBonusIds, ...embellishment.bonus_ids]));
      }
      nextBonusIds = [...nextBonusIds].sort((a, b) => a - b);
      let nextSimc = item.simc_string;
      if (enchantId > 0) {
        if (nextSimc.includes('enchant_id='))
          nextSimc = nextSimc.replace(/enchant_id=[0-9]+/, `enchant_id=${enchantId}`);
        else nextSimc += `,enchant_id=${enchantId}`;
      } else nextSimc = nextSimc.replace(/,enchant_id=[0-9]+/, '');

      if (normalizedGemIds.length > 0) {
        if (nextSimc.includes('gem_id='))
          nextSimc = nextSimc.replace(/gem_id=[0-9/:]+/, `gem_id=${normalizedGemIds.join('/')}`);
        else nextSimc += `,gem_id=${normalizedGemIds.join('/')}`;
      } else nextSimc = nextSimc.replace(/,gem_id=[0-9/:]+/, '');

      if (nextBonusIds.length > 0) {
        if (nextSimc.includes('bonus_id=')) {
          nextSimc = nextSimc.replace(/bonus_id=[0-9/:]+/, `bonus_id=${nextBonusIds.join('/')}`);
        } else {
          nextSimc += `,bonus_id=${nextBonusIds.join('/')}`;
        }
      } else {
        nextSimc = nextSimc.replace(/,bonus_id=[0-9/:]+/, '');
      }

      const baseUid = makeUid({
        item_id: item.item_id,
        bonus_ids: nextBonusIds,
        origin: 'bags',
        slot: item.slot,
        ilevel: item.ilevel,
        enchant_id: enchantId,
        gem_id: firstGemId,
        gem_ids: normalizedGemIds,
        crafted_stats: item.crafted_stats,
        embellishment_item_id: embellishment?.item_id,
      });
      const uid = bundleId ? `${baseUid}:ga${bundleId}` : baseUid;
      const copy: ResolvedItem = {
        ...item,
        origin: 'bags',
        uid,
        bonus_ids: nextBonusIds,
        enchant_id: enchantId,
        gem_id: firstGemId,
        gem_ids: normalizedGemIds,
        enchant_name: enchantId > 0 ? enchantInfoById[enchantId]?.name || '' : '',
        gem_name: firstGemId > 0 ? gemInfoById[firstGemId]?.name || '' : '',
        gem_icon: firstGemId > 0 ? gemInfoById[firstGemId]?.icon || '' : '',
        prevent_copy_enchant: enchantId === 0,
        prevent_copy_gem: normalizedGemIds.length === 0,
        exact_selection_only: true,
        global_affix_bundle_id: bundleId,
        force_clear_enchant: Boolean(forceClearEnchant && enchantId === 0),
        embellishment_item_id: embellishment?.item_id,
        embellishment_name: embellishment?.name,
        embellishment_icon: embellishment?.icon,
        embellishment_bonus_ids: embellishment?.bonus_ids,
        simc_string: nextSimc,
      };

      return {
        item,
        uid,
        nextSimc,
        copy,
        hasEmbellishment: Boolean(embellishment),
      };
    },
    [
      enchantInfoById,
      gemInfoById,
      embellishmentOptionsByItem,
    ]
  );

  const saveOptimizedVariants = useCallback(
    (requests: VariantRequest[]) => {
      if (requests.length === 0) {
        onVariantCopiesChange({});
        return 0;
      }

      const nextVariantsBySlot: Record<string, ResolvedItem[]> = {};
      const seenBySlot = new Map<string, Set<string>>();

      for (const request of requests) {
        const built = buildOptimizedCopy(request);
        const slot = built.item.slot;
        if (!nextVariantsBySlot[slot]) nextVariantsBySlot[slot] = [];
        if (!seenBySlot.has(slot)) seenBySlot.set(slot, new Set());
        const seen = seenBySlot.get(slot)!;
        if (seen.has(built.uid)) continue;
        seen.add(built.uid);
        nextVariantsBySlot[slot].push(built.copy);
      }

      onVariantCopiesChange(nextVariantsBySlot);
      return Object.values(nextVariantsBySlot).reduce((sum, list) => sum + list.length, 0);
    },
    [
      buildOptimizedCopy,
      onVariantCopiesChange,
    ]
  );

  const applyOptimizedVariants = useCallback(
    (requests: VariantRequest[]) => {
      if (requests.length === 0) return 0;

      const nextResolved = { ...resolved, slots: { ...resolved.slots } };
      const nextSelected = {
        ...Object.fromEntries(Object.entries(selectedUids).map(([k, v]) => [k, new Set(v)])),
      };
      const created: { uid: string; slot: string; simc: string; hasEmbellishment: boolean }[] = [];

      for (const request of requests) {
        const built = buildOptimizedCopy(request);
        const slotRes = nextResolved.slots[built.item.slot];
        if (!slotRes) continue;
        if (slotRes.alternatives.some((alt) => alt.uid === built.uid)) continue;

        slotRes.alternatives = [...slotRes.alternatives, built.copy];
        if (!nextSelected[built.item.slot]) nextSelected[built.item.slot] = new Set();
        nextSelected[built.item.slot].add(built.uid);
        created.push({
          uid: built.uid,
          slot: built.item.slot,
          simc: built.nextSimc,
          hasEmbellishment: built.hasEmbellishment,
        });
      }

      if (created.length === 0) return 0;

      onResolvedChange(nextResolved);
      onSelectionChange(nextSelected);
      for (const entry of created) {
        onItemAdded(entry.slot, entry.simc, 'bags');
        rememberLimitWarningCandidate(entry.uid, entry.hasEmbellishment);
      }

      return created.length;
    },
    [
      buildOptimizedCopy,
      resolved,
      selectedUids,
      onResolvedChange,
      onSelectionChange,
      onItemAdded,
      rememberLimitWarningCandidate,
    ]
  );

  const handleOptimize = useCallback(
    (
      enchantId: number,
      gemIds: number[],
      embellishment: EmbellishmentOption | null
    ) => {
      if (!optimizeItem) return;
      applyOptimizedVariants([{ item: optimizeItem, enchantId, gemIds, embellishment }]);
      setOptimizeOpen(false);
    },
    [
      optimizeItem,
      applyOptimizedVariants,
      setOptimizeOpen,
    ]
  );

  const handleAddItem = useCallback(
    async (item: any, difficulty: string, overrides?: any) => {
      // Determine slot (simplified)
      const type = item.inventory_type;
      let slots = ['head'];
      if (type === 1) slots = ['head'];
      else if (type === 2) slots = ['neck'];
      else if (type === 3) slots = ['shoulder'];
      else if (type === 16) slots = ['back'];
      else if (type === 5 || type === 20) slots = ['chest'];
      else if (type === 9) slots = ['wrist'];
      else if (type === 10) slots = ['hands'];
      else if (type === 6) slots = ['waist'];
      else if (type === 7) slots = ['legs'];
      else if (type === 8) slots = ['feet'];
      else if (type === 11) slots = ['finger1', 'finger2'];
      else if (type === 12) slots = ['trinket1', 'trinket2'];
      else if (type === 13 || type === 17 || type === 21) slots = ['main_hand'];
      else if (type === 14 || type === 22 || type === 23) slots = ['off_hand'];

      const difficultyInfo =
        item.difficulty_info?.[difficulty] || item.dungeon_info?.[difficulty] || null;
      const slot = slots[0];
      let bonusIds = overrides
        ? [...overrides.bonus_ids]
        : difficultyInfo?.bonus_id
          ? [difficultyInfo.bonus_id]
          : [];
      const craftedSource = isCraftedSource(item);
      if (craftedSource && overrides) {
        const matching: ResolvedItem[] = [];
        for (const slotRes of Object.values(resolved.slots)) {
          if (slotRes.equipped && slotRes.equipped.item_id === item.item_id) {
            matching.push(slotRes.equipped);
          }
          for (const alt of slotRes.alternatives) {
            if (alt.item_id === item.item_id) matching.push(alt);
          }
        }
        const template = matching.sort((a, b) => b.bonus_ids.length - a.bonus_ids.length)[0];
        const pool: number[] = Array.isArray(overrides.crafted_variable_bonus_pool)
          ? overrides.crafted_variable_bonus_pool
          : [];
        const selected: number[] = Array.isArray(overrides.crafted_selected_bonus_ids)
          ? overrides.crafted_selected_bonus_ids
          : [];
        if (template && template.bonus_ids.length > 0) {
          const stable = template.bonus_ids.filter((bid) => !pool.includes(bid));
          bonusIds = Array.from(new Set([...stable, ...selected]));
        }
      }
      let ilvl = overrides ? overrides.ilvl : difficultyInfo?.ilvl || item.ilevel;
      let upgradeStr = overrides
        ? overrides.track_name
          ? `${overrides.track_name} ${overrides.level}${overrides.max_level ? `/${overrides.max_level}` : ''}`
          : ''
        : difficultyInfo?.track
          ? `${difficultyInfo.track} ${difficultyInfo.level}/${UPGRADE_TRACK_MAX_LEVEL}`
          : '';
      if (isCraftedSource(item)) {
        upgradeStr = item.instance_name || item.encounter || 'Radiance Crafted';
      }
      if (overrides?.track_name && /crafted/i.test(overrides.track_name)) {
        upgradeStr = overrides.track_name;
      }
      const embellishment = overrides?.embellishment;
      const selectedGem = overrides?.gem;
      const selectedGemId = selectedGem?.gem_id || 0;
      const selectedGemIds = selectedGemId > 0 ? [selectedGemId] : [];

      let effectiveQuality = overrides?.quality ?? difficultyInfo?.quality ?? item.quality;
      if (isCraftedSource(item) && effectiveQuality >= 5) {
        effectiveQuality = 4;
      }

      const uid = makeUid({
        item_id: item.item_id,
        bonus_ids: bonusIds,
        origin: 'bags',
        slot,
        ilevel: ilvl,
        gem_id: selectedGemId,
        gem_ids: selectedGemIds,
        crafted_stats: overrides?.crafted_stats,
        embellishment_item_id: embellishment?.item_id,
      });

      let simcStats = '';
      if (overrides?.crafted_stats && overrides.crafted_stats.length > 0) {
        simcStats = `,crafted_stats=${overrides.crafted_stats.join('/')}`;
      }
      const simcGem = selectedGemIds.length > 0 ? `,gem_id=${selectedGemIds.join('/')}` : '';

      const newItem: ResolvedItem = {
        uid,
        slot,
        item_id: item.item_id,
        ilevel: ilvl,
        simc_string: `,id=${item.item_id}${ilvl > 0 ? `,ilevel=${ilvl}` : ''}${bonusIds.length > 0 ? `,bonus_id=${bonusIds.join('/')}` : ''}${simcGem}${simcStats},name=${item.name.replace(/ /g, '_')}`,
        origin: 'bags',
        bonus_ids: bonusIds,
        enchant_id: 0,
        gem_id: selectedGemId,
        gem_ids: selectedGemIds,
        crafted_stats: overrides?.crafted_stats,
        embellishment_item_id: embellishment?.item_id,
        embellishment_name: embellishment?.name,
        embellishment_icon: embellishment?.icon,
        embellishment_bonus_ids: embellishment?.bonus_ids,
        name: item.name,
        icon: item.icon,
        quality: effectiveQuality,
        quality_color:
          effectiveQuality === 5
            ? '#ff8000'
            : effectiveQuality === 4
              ? '#a335ee'
              : effectiveQuality === 3
                ? '#0070dd'
                : '#1eff00',
        tag: isCraftedSource(item)
          ? (item.instance_name || item.encounter || 'Crafted')
          : 'Search',
        upgrade: upgradeStr,
        sockets: Number(item.sockets || item.socket_count || (item.hasSockets ? 1 : 0)),
        enchant_name: '',
        gem_name: selectedGem?.name || '',
        gem_icon: selectedGem?.icon || '',
        encounter: item.encounter || '',
        encounter_id: Number.isFinite(item.encounter_id) ? item.encounter_id : undefined,
        instance_name: item.instance_name || '',
        instance_id: Number.isFinite(item.instance_id) ? item.instance_id : undefined,
        source_type: item.source_type || '',
        is_catalyst: !!item.is_catalyst,
        can_catalyst: !!item.can_catalyst,
        off_spec: !!item.off_spec,
        inventory_type: Number.isFinite(item.inventory_type) ? item.inventory_type : undefined,
        season_id: Number.isFinite(item.season_id) ? item.season_id : undefined,
      };

      const nextResolved = { ...resolved, slots: { ...resolved.slots } };
      slots.forEach((s) => {
        const targetSlot = nextResolved.slots[s];
        if (targetSlot && !targetSlot.alternatives.find((a) => a.uid === uid)) {
          const slotUid = makeUid({
            item_id: item.item_id,
            bonus_ids: bonusIds,
            origin: 'bags',
            slot: s,
            ilevel: ilvl,
            gem_id: selectedGemId,
            gem_ids: selectedGemIds,
            crafted_stats: overrides?.crafted_stats,
            embellishment_item_id: embellishment?.item_id,
          });
          targetSlot.alternatives = [
            ...targetSlot.alternatives,
            { ...newItem, uid: slotUid, slot: s },
          ];
        }
      });

      onResolvedChange(nextResolved);
      const nextSelected = { ...selectedUids };
      let lastAddedUid: string | null = null;
      slots.forEach((s) => {
        const slotUid = makeUid({
          item_id: item.item_id,
          bonus_ids: bonusIds,
          origin: 'bags',
          slot: s,
          ilevel: ilvl,
          gem_id: selectedGemId,
          gem_ids: selectedGemIds,
          crafted_stats: overrides?.crafted_stats,
          embellishment_item_id: embellishment?.item_id,
        });
        if (!nextSelected[s]) nextSelected[s] = new Set();
        nextSelected[s].add(slotUid);
        lastAddedUid = slotUid;
      });
      onSelectionChange(nextSelected);
      rememberLimitWarningCandidate(lastAddedUid, Boolean(embellishment));
      onItemAdded(slot, newItem.simc_string, 'bags');
      setAddItemOpen(false);
    },
    [
      resolved,
      selectedUids,
      onResolvedChange,
      onSelectionChange,
      onItemAdded,
      setAddItemOpen,
      rememberLimitWarningCandidate,
    ]
  );

  const visibleGroups = useMemo(() => {
    return DISPLAY_GROUPS.map((group) => {
      const equipped: ResolvedItem[] = [];
      const alternatives: ResolvedItem[] = [];
      const seenEquippedIdentities = new Set<string>();
      const seenAltIdentities = new Set<string>();

      group.slots.forEach((slot) => {
        const slotRes = resolved.slots[slot];
        if (!slotRes) return;
        if (slotRes.equipped) {
          const identity = makeIdentity(slotRes.equipped);
          if (!seenEquippedIdentities.has(identity)) {
            seenEquippedIdentities.add(identity);
            equipped.push(slotRes.equipped);
          }
        }
      });

      group.slots.forEach((slot) => {
        const slotRes = resolved.slots[slot];
        if (!slotRes) return;
        slotRes.alternatives.forEach((alt) => {
          const identity = makeIdentity(alt);
          // If already in equipped for this group, skip
          if (seenEquippedIdentities.has(identity)) return;

          if (!seenAltIdentities.has(identity)) {
            seenAltIdentities.add(identity);
            alternatives.push(alt);
          }
        });
      });
      const maxGroupIlevel = Math.max(
        0,
        ...equipped.map((item) => Number(item.ilevel || 0)),
        ...alternatives.map((item) => Number(item.ilevel || 0))
      );
      const hasSeasonalItems = [...equipped, ...alternatives].some(
        (item) => Number(item.season_id || 0) > 0
      );
      const shouldHideAlternative = (item: ResolvedItem) => {
        const selected = selectedUids[item.slot]?.has(item.uid) || false;
        if (selected) return false;
        const itemSeason = Number(item.season_id || 0);
        const itemIlevel = Number(item.ilevel || 0);
        return hasSeasonalItems && itemSeason <= 0 && itemIlevel <= maxGroupIlevel - 50;
      };
      const hiddenAlternatives = alternatives.filter(shouldHideAlternative);
      const visibleAlternatives =
        showAllLowLevelByGroup[group.label]
          ? alternatives
          : alternatives.filter((item) => !shouldHideAlternative(item));
      return {
        group,
        equipped,
        alternatives: visibleAlternatives,
        hiddenAlternativeCount: hiddenAlternatives.length,
        showingAllAlternatives: Boolean(showAllLowLevelByGroup[group.label]),
      };
    }).filter((g) => g.equipped.length > 0 || g.alternatives.length > 0 || g.hiddenAlternativeCount > 0);
  }, [resolved, selectedUids, showAllLowLevelByGroup]);

  const { vaultUids, catalystUids } = useMemo(() => {
    const vault: { uid: string; slot: string }[] = [];
    const catalyst: { uid: string; slot: string }[] = [];
    Object.values(resolved.slots).forEach((slotRes) => {
      slotRes.alternatives.forEach((alt) => {
        if (alt.origin === 'vault') vault.push({ uid: alt.uid, slot: alt.slot });
        if (alt.is_catalyst) catalyst.push({ uid: alt.uid, slot: alt.slot });
      });
    });
    return { vaultUids: vault, catalystUids: catalyst };
  }, [resolved]);

  const { gemIds, enchantIds } = useMemo(() => {
    const gems = new Set<number>();
    const enchants = new Set<number>();

    Object.values(resolved.slots).forEach((slotRes) => {
      const items: ResolvedItem[] = [];
      if (slotRes.equipped) items.push(slotRes.equipped);
      items.push(...slotRes.alternatives);

      items.forEach((item) => {
        const itemGemIds = getResolvedGemIds(item);
        const enchantId =
          item.enchant_id > 0
            ? item.enchant_id
            : parseFirstIdFromSimc(item.simc_string, 'enchant_id');
        itemGemIds.forEach((gemId) => {
          if (gemId > 0) gems.add(gemId);
        });
        if (enchantId > 0) enchants.add(enchantId);
      });
    });

    if (savedVariantRuleState) {
      for (const gemId of savedVariantRuleState.globalGemIds || []) {
        if (Number.isFinite(gemId) && gemId > 0) gems.add(gemId);
      }
      for (const selection of Object.values(savedVariantRuleState.groupSelections || {})) {
        for (const enchantId of selection.enchantIds || []) {
          if (Number.isFinite(enchantId) && enchantId > 0) enchants.add(enchantId);
        }
      }
    }

    return { gemIds: Array.from(gems), enchantIds: Array.from(enchants) };
  }, [resolved, savedVariantRuleState]);

  const getGlobalSelectionSummary = useCallback(
    (slots: string[], items: ResolvedItem[]) => {
      if (!globalAffixesEnabled) return null;

      const groupKey = affixGroupKeyFromSlots(slots);
      if (!groupKey) return null;

      const selectedEnchantIds = Array.from(
        new Set(
          (savedVariantRuleState?.groupSelections?.[groupKey]?.enchantIds || []).filter(
            (id) => Number.isFinite(id) && id > 0
          )
        )
      );
      const hasSocketableItem = items.some(
        (item) => Math.max(Number(item.sockets || 0), getResolvedGemIds(item).length) > 0
      );
      const selectedGemIds = hasSocketableItem
        ? Array.from(
            new Set(
              (savedVariantRuleState?.globalGemIds || []).filter(
                (id) => Number.isFinite(id) && id > 0
              )
            )
          )
        : [];

      if (selectedEnchantIds.length === 0 && selectedGemIds.length === 0) return null;

      const textParts: string[] = [];
      if (selectedEnchantIds.length > 0) {
        textParts.push(`${selectedEnchantIds.length} enchant(s)`);
      }
      if (selectedGemIds.length > 0) {
        textParts.push(`${selectedGemIds.length} gem(s)`);
      }

      const tooltipLines = ['Selected global rules'];
      if (selectedEnchantIds.length > 0) {
        tooltipLines.push(
          `Enchants: ${selectedEnchantIds.map((id) => enchantInfoById[id]?.name || `Enchant #${id}`).join(', ')}`
        );
      }
      if (selectedGemIds.length > 0) {
        tooltipLines.push(
          `Gems: ${selectedGemIds.map((id) => gemInfoById[id]?.name || `Gem #${id}`).join(', ')}`
        );
      }

      return {
        text: `${textParts.join(' and ')} are selected`,
        tooltip: tooltipLines.join('\n'),
      };
    },
    [enchantInfoById, gemInfoById, globalAffixesEnabled, savedVariantRuleState]
  );

  useEffect(() => {
    const missingGemIds = gemIds.filter((id) => !gemInfoById[id]);
    if (missingGemIds.length === 0) return;

    let cancelled = false;
    (async () => {
      const fetched = await Promise.all(
        missingGemIds.map(async (id) => {
          try {
            const info = await fetchJsonCached<GemInfo>(`${API_URL}/api/gem-info/${id}`, {
              ttl: 60 * 60 * 1000,
            });
            return [id, info] as const;
          } catch {
            return null;
          }
        })
      );

      if (cancelled) return;
      setGemInfoById((prev) => {
        const next = { ...prev };
        fetched.forEach((entry) => {
          if (!entry) return;
          const [id, info] = entry;
          next[id] = info;
        });
        return next;
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [gemIds, gemInfoById]);

  useEffect(() => {
    const missingEnchantIds = enchantIds.filter((id) => !enchantInfoById[id]);
    if (missingEnchantIds.length === 0) return;

    let cancelled = false;
    (async () => {
      const fetched = await Promise.all(
        missingEnchantIds.map(async (id) => {
          try {
            const info = await fetchJsonCached<EnchantInfo>(`${API_URL}/api/enchant-info/${id}`, {
              ttl: 60 * 60 * 1000,
            });
            return [id, info] as const;
          } catch {
            return null;
          }
        })
      );

      if (cancelled) return;
      setEnchantInfoById((prev) => {
        const next = { ...prev };
        fetched.forEach((entry) => {
          if (!entry) return;
          const [id, info] = entry;
          next[id] = info;
        });
        return next;
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [enchantIds, enchantInfoById]);

  useEffect(() => {
    const className = resolved.character.class_name || '';
    const items = Object.values(resolved.slots)
      .flatMap((slotRes) => [
        ...(slotRes.equipped ? [slotRes.equipped] : []),
        ...slotRes.alternatives,
      ])
      .filter((item) => item.item_id > 0);
    const unique = new Map<string, ResolvedItem>();
    for (const item of items) {
      const key = enchantAvailabilityItemKey(
        item.slot,
        className,
        item.item_id,
        item.bonus_ids,
        item.season_id,
        specName
      );
      if (!unique.has(key)) unique.set(key, item);
    }
    const missing = [...unique.entries()].filter(([key]) => {
      return !Object.prototype.hasOwnProperty.call(enchantAvailabilityBySlot, key);
    });
    if (missing.length === 0) return;

    let cancelled = false;
    (async () => {
      const fetched = await Promise.all(
        missing.map(async ([key, item]) => {
          try {
            const params = new URLSearchParams();
            params.set('slot', normalizeEnchantQuerySlot(item.slot));
            if (className) params.set('class_name', className);
            if (specName) params.set('spec', specName);
            if (item.item_id > 0) params.set('item_id', String(item.item_id));
            if (Array.isArray(item.bonus_ids) && item.bonus_ids.length > 0) {
              params.set('bonus_ids', item.bonus_ids.join(','));
            }
            if (Number.isFinite(item.season_id) && Number(item.season_id) > 0) {
              params.set('season_id', String(Number(item.season_id)));
            }
            const res = await fetch(
              `${API_URL}/api/gear/enchant-options?${params.toString()}`,
              { credentials: 'include' }
            );
            if (!res.ok) return [key, false] as const;
            const data = await res.json();
            return [key, Array.isArray(data) && data.length > 0] as const;
          } catch {
            return [key, false] as const;
          }
        })
      );

      if (cancelled) return;
      setEnchantAvailabilityBySlot((prev) => {
        const next = { ...prev };
        for (const [key, available] of fetched) {
          next[key] = available;
        }
        return next;
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [resolved, enchantAvailabilityBySlot, specName]);

  useEffect(() => {
    const itemIds = new Set<number>();
    for (const slotRes of Object.values(resolved.slots)) {
      if (slotRes.equipped?.item_id) itemIds.add(slotRes.equipped.item_id);
      for (const alt of slotRes.alternatives) {
        if (alt.item_id > 0) itemIds.add(alt.item_id);
      }
    }

    const idsToFetch = Array.from(itemIds);
    if (idsToFetch.length === 0) return;

    let cancelled = false;
    (async () => {
      const fetched = await Promise.all(
        idsToFetch.map(async (itemId) => {
          try {
            const res = await fetch(
              `${API_URL}/api/gear/embellishment-options?item_id=${encodeURIComponent(String(itemId))}`,
              { credentials: 'include' }
            );
            if (!res.ok) return [itemId, [] as EmbellishmentOption[]] as const;
            const data = await res.json();
            return [itemId, Array.isArray(data) ? (data as EmbellishmentOption[]) : []] as const;
          } catch {
            return [itemId, [] as EmbellishmentOption[]] as const;
          }
        })
      );

      if (cancelled) return;
      setEmbellishmentOptionsByItem((prev) => {
        const next = { ...prev };
        for (const [itemId, options] of fetched) {
          next[itemId] = options;
        }
        return next;
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [resolved]);

  const hasBackendEmbellishmentLimitWarning =
    /embellished|limited-effect crafted modifiers/i.test(comboError || '');

  const selectedUidSet = useMemo(() => {
    const next = new Set<string>();
    for (const uids of Object.values(selectedUids)) {
      for (const uid of uids) next.add(uid);
    }
    return next;
  }, [selectedUids]);
  const selectedUidSignature = useMemo(
    () => [...selectedUidSet].sort().join('|'),
    [selectedUidSet]
  );

  const getEmbellishmentLimitWarnings = useCallback(
    (
      selection: Record<string, Set<string>>,
      knownUids: Set<string>,
      order: string[]
    ): Set<string> => {
    const orderIndex = new Map(order.map((uid, index) => [uid, index]));
    const candidates: { item: ResolvedItem; selected: boolean; sort: number; stable: number }[] = [];
    let stable = 0;

    for (const [slot, slotRes] of Object.entries(resolved.slots)) {
      const selected = selection[slot] || new Set<string>();
      const selectedItems = [
        ...(slotRes.equipped && selected.has(slotRes.equipped.uid) ? [slotRes.equipped] : []),
        ...slotRes.alternatives.filter((alt) => selected.has(alt.uid)),
      ];
      const visibleItems =
        selectedItems.length > 0
          ? selectedItems
          : slotRes.equipped
            ? [slotRes.equipped]
            : [];

      for (const item of visibleItems) {
        if (
          !knownUids.has(item.uid) &&
          !itemHasEmbellishment(item, embellishmentOptionsByItem)
        ) {
          continue;
        }
        const isSelected = selected.has(item.uid);
        const trackedIndex = orderIndex.get(item.uid);
        candidates.push({
          item,
          selected: isSelected,
          sort: isSelected ? trackedIndex ?? 100000 + stable : -100000 + stable,
          stable,
        });
        stable += 1;
      }
    }

      const overflow = new Set<string>();
      candidates
        .sort((a, b) => a.sort - b.sort || a.stable - b.stable)
        .slice(2)
        .forEach(({ item, selected }) => {
          if (selected) overflow.add(item.uid);
        });
      return overflow;
    },
    [resolved.slots, embellishmentOptionsByItem]
  );

  const localLimitWarningUids = useMemo(() => {
    return getEmbellishmentLimitWarnings(selectedUids, knownEmbellishedUids, limitWarningOrder);
  }, [getEmbellishmentLimitWarnings, selectedUids, knownEmbellishedUids, limitWarningOrder]);

  const itemByUid = useMemo(() => {
    const next = new Map<string, ResolvedItem>();
    for (const slotRes of Object.values(resolved.slots)) {
      if (slotRes.equipped) next.set(slotRes.equipped.uid, slotRes.equipped);
      for (const alt of slotRes.alternatives) next.set(alt.uid, alt);
    }
    return next;
  }, [resolved.slots]);

  const backendFallbackLimitWarningUid = useMemo(() => {
    if (!hasBackendEmbellishmentLimitWarning) return null;
    return (
      [...limitWarningOrder]
        .reverse()
        .find((uid) => {
          if (!selectedUidSet.has(uid)) return false;
          const item = itemByUid.get(uid);
          return (
            knownEmbellishedUids.has(uid) ||
            (item ? itemHasEmbellishment(item, embellishmentOptionsByItem) : false)
          );
        }) || null
    );
  }, [
    hasBackendEmbellishmentLimitWarning,
    limitWarningOrder,
    selectedUidSet,
    itemByUid,
    knownEmbellishedUids,
    embellishmentOptionsByItem,
  ]);

  useEffect(() => {
    setLimitWarningOrder((prev) => prev.filter((uid) => selectedUidSet.has(uid)));
    setImmediateLimitWarningUids((prev) => {
      const next = new Set<string>();
      for (const uid of prev) {
        if (selectedUidSet.has(uid)) next.add(uid);
      }
      return sameStringSet(prev, next) ? prev : next;
    });
    setKnownEmbellishedUids((prev) => {
      const next = new Set<string>();
      for (const uid of prev) {
        if (selectedUidSet.has(uid)) next.add(uid);
      }
      return sameStringSet(prev, next) ? prev : next;
    });
  }, [selectedUidSet]);

  useEffect(() => {
    const selectionChanged = selectedUidSignatureRef.current !== selectedUidSignature;
    selectedUidSignatureRef.current = selectedUidSignature;

    setConfirmedLimitWarningUids((prev) => {
      const next = new Set<string>();
      for (const uid of prev) {
        if (selectedUidSet.has(uid)) next.add(uid);
      }
      if (backendFallbackLimitWarningUid) next.add(backendFallbackLimitWarningUid);
      if (
        selectionChanged &&
        !hasBackendEmbellishmentLimitWarning &&
        localLimitWarningUids.size === 0
      ) {
        next.clear();
      }
      return sameStringSet(prev, next) ? prev : next;
    });
  }, [
    backendFallbackLimitWarningUid,
    hasBackendEmbellishmentLimitWarning,
    localLimitWarningUids,
    selectedUidSignature,
    selectedUidSet,
  ]);

  const activeLimitWarningUids = useMemo(() => {
    const next = new Set<string>();
    for (const uid of immediateLimitWarningUids) {
      if (selectedUidSet.has(uid)) next.add(uid);
    }
    for (const uid of localLimitWarningUids) next.add(uid);
    for (const uid of confirmedLimitWarningUids) {
      if (selectedUidSet.has(uid)) next.add(uid);
    }
    return next;
  }, [immediateLimitWarningUids, localLimitWarningUids, confirmedLimitWarningUids, selectedUidSet]);

  const hasEmbellishmentLimitWarning = useCallback(
    (item: ResolvedItem): boolean => activeLimitWarningUids.has(item.uid),
    [activeLimitWarningUids]
  );

  const handleToggleItem = useCallback(
    (item: ResolvedItem, slots: string[]) => {
      const isSelected = slots.some((slot) => selectedUids[slot]?.has(item.uid));
      const nextSelected = {
        ...Object.fromEntries(Object.entries(selectedUids).map(([k, v]) => [k, new Set(v)])),
      };
      const nextKnown = new Set(knownEmbellishedUids);
      const nextOrder = limitWarningOrder.filter((uid) => uid !== item.uid);
      const identity = makeIdentity(item);

      if (slots.length === 1) {
        const slot = item.slot;
        if (!nextSelected[slot]) nextSelected[slot] = new Set();
        if (isSelected) {
          nextSelected[slot].delete(item.uid);
          nextKnown.delete(item.uid);
        } else {
          nextSelected[slot].add(item.uid);
          nextOrder.push(item.uid);
          if (itemHasEmbellishment(item, embellishmentOptionsByItem)) {
            nextKnown.add(item.uid);
          }
        }
      } else {
        for (const slot of slots) {
          const slotRes = resolved.slots[slot];
          if (!slotRes) continue;
          const matching = slotRes.alternatives.find((alt) => makeIdentity(alt) === identity);
          if (!matching) continue;
          if (!nextSelected[slot]) nextSelected[slot] = new Set();
          if (isSelected) {
            nextSelected[slot].delete(matching.uid);
            nextKnown.delete(matching.uid);
          } else {
            nextSelected[slot].add(matching.uid);
            nextOrder.push(matching.uid);
            if (itemHasEmbellishment(matching, embellishmentOptionsByItem)) {
              nextKnown.add(matching.uid);
            }
          }
        }
      }

      setImmediateLimitWarningUids(
        getEmbellishmentLimitWarnings(nextSelected, nextKnown, nextOrder)
      );
      toggleItem(item, slots);
      if (isSelected) {
        forgetLimitWarningCandidate(item.uid);
      } else {
        rememberLimitWarningCandidate(
          item.uid,
          itemHasEmbellishment(item, embellishmentOptionsByItem)
        );
      }
    },
    [
      selectedUids,
      resolved.slots,
      toggleItem,
      forgetLimitWarningCandidate,
      rememberLimitWarningCandidate,
      embellishmentOptionsByItem,
      knownEmbellishedUids,
      limitWarningOrder,
      getEmbellishmentLimitWarnings,
    ]
  );

  const itemDetails = (item: ResolvedItem) => {
    const gemIconFallback = 'inv_misc_questionmark';
    const effectiveGemIds = getResolvedGemIds(item);
    const effectiveEnchantId =
      item.enchant_id > 0 ? item.enchant_id : parseFirstIdFromSimc(item.simc_string, 'enchant_id');

    const gemInfos = effectiveGemIds.map((id) => gemInfoById[id]);
    const enchantInfo = effectiveEnchantId > 0 ? enchantInfoById[effectiveEnchantId] : undefined;
    const embellishmentOptions = embellishmentOptionsByItem[item.item_id] || [];
    const normalizedEmbellishmentName = normalizeEmbellishmentName(item.embellishment_name);
    const inferredEmbellishment =
      embellishmentOptions.find((opt) => opt.item_id === item.embellishment_item_id) ||
      embellishmentOptions.find(
        (opt) =>
          Array.isArray(opt.bonus_ids) &&
          opt.bonus_ids.length > 0 &&
          opt.bonus_ids.every((bid) => item.bonus_ids.includes(bid))
      ) ||
      (normalizedEmbellishmentName
        ? embellishmentOptions.find(
            (opt) => normalizeEmbellishmentName(opt.name) === normalizedEmbellishmentName
          )
        : undefined);
    const embellishmentName = item.embellishment_name || inferredEmbellishment?.name || '';
    const embellishmentIcon = item.embellishment_icon || inferredEmbellishment?.icon || '';
    const embellishmentItemId = item.embellishment_item_id || inferredEmbellishment?.item_id || 0;
    const hasGem = effectiveGemIds.length > 0 || Boolean(item.gem_name);
    const parts: BadgeDescriptor[] = [];

    if (item.is_catalyst)
      parts.push({
        text: 'Catalyst',
        badgeVariant: 'source',
        color: 'text-purple-300 bg-purple-500/15 border-purple-400/40',
      });
    const extraEffects = getItemExtraEffects(item, extraEffectsByKey);
    for (const effect of extraEffects) {
      parts.push({
        text: effect,
        badgeVariant: 'mod',
        color: 'text-cyan-200 border-cyan-300/40 bg-cyan-500/10',
      });
    }
    if (hasGem) {
      for (const [index, gemInfo] of gemInfos.entries()) {
        const gemName = gemInfo?.name || (index === 0 ? item.gem_name : '') || 'Gem';
        parts.push({
          text: gemName,
          kind: 'iconText',
          badgeVariant: 'gem',
          icon: gemInfo?.icon || (index === 0 ? item.gem_icon : '') || gemIconFallback,
          href: effectiveGemIds[index] > 0 ? `https://www.wowhead.com/item=${effectiveGemIds[index]}` : undefined,
          wowheadData: effectiveGemIds[index] > 0 ? `item=${effectiveGemIds[index]}` : undefined,
          tooltip: gemName,
          color: 'border-sky-400/40 bg-sky-500/10',
        });
      }
      if (effectiveGemIds.length === 0 && item.gem_name) {
        const gemName = item.gem_name || 'Gem';
        parts.push({
          text: gemName,
          kind: 'iconText',
          badgeVariant: 'gem',
          icon: item.gem_icon || gemIconFallback,
          tooltip: gemName,
          color: 'border-sky-400/40 bg-sky-500/10',
        });
      }
      const emptySocketCount = Math.max(0, Number(item.sockets || 0) - effectiveGemIds.length);
      if (emptySocketCount > 0) {
        parts.push({
          text: emptySocketCount > 1 ? `${emptySocketCount} Empty Sockets` : 'Empty Socket',
          kind: 'iconText',
          badgeVariant: 'gem',
          icon: 'inv_misc_gem_variety_01',
          color: 'text-zinc-200 border-dashed border-zinc-500/60 bg-zinc-500/8',
        });
      }
    } else if (item.sockets > 0)
      parts.push({
        text: Number(item.sockets) > 1 ? `${item.sockets} Empty Sockets` : 'Empty Socket',
        kind: 'iconText',
        badgeVariant: 'gem',
        icon: 'inv_misc_gem_variety_01',
        color: 'text-zinc-200 border-dashed border-zinc-500/60 bg-zinc-500/8',
      });

    const enchantName = enchantInfo?.name || item.enchant_name;
    if (enchantName) {
      const enchantItemId = enchantInfo?.item_id ?? 0;
      parts.push({
        text: enchantName,
        kind: enchantInfo?.icon ? 'iconText' : 'plain',
        icon: enchantInfo?.icon,
        badgeVariant: 'enchant',
        href:
          enchantItemId > 0
            ? `https://www.wowhead.com/item=${enchantItemId}`
            : effectiveEnchantId > 0
              ? `https://www.wowhead.com/spell=${effectiveEnchantId}`
              : undefined,
        wowheadData:
          enchantItemId > 0
            ? `item=${enchantItemId}`
            : effectiveEnchantId > 0
              ? `spell=${effectiveEnchantId}`
              : undefined,
        tooltip: enchantName,
        color: 'text-emerald-400/80',
      });
    } else if (effectiveEnchantId > 0) {
      parts.push({
        text: 'Enchant',
        kind: 'iconText',
        icon: 'inv_misc_questionmark',
        badgeVariant: 'enchant',
        href: `https://www.wowhead.com/spell=${effectiveEnchantId}`,
        wowheadData: `spell=${effectiveEnchantId}`,
        tooltip: 'Enchant',
        color: 'text-emerald-400/80',
      });
    }
    if (embellishmentName) {
      parts.push({
        text: embellishmentName,
        kind: 'iconText',
        icon: embellishmentIcon || 'inv_misc_questionmark',
        badgeVariant: 'embellishment',
        href:
          embellishmentItemId > 0
            ? `https://www.wowhead.com/item=${embellishmentItemId}`
            : undefined,
        wowheadData: embellishmentItemId > 0 ? `item=${embellishmentItemId}` : undefined,
        tooltip: embellishmentName,
        color: EMBELLISHMENT_BADGE_CLASS,
      });
    }
    if (isAscendantApplied(item)) {
      parts.push({
        text: 'Ascendant Voidcore',
        kind: 'iconText',
        badgeVariant: 'mod',
        icon: 'inv_1205_voidforge_sovereignvoidcores_cosmicvoid',
        href: 'https://www.wowhead.com/item=268552/ascendant-voidcore',
        wowheadData: 'item=268552',
        tooltip: 'Ascendant Voidcore',
        color: ASCENDANT_VOIDCORE_BADGE_CLASS,
      });
    }
    return parts.filter((part) => {
      const text = String(part.text || '').trim().toLowerCase();
      if (/^mod:\d+$/.test(text)) return false;
      if (/^i?l?v?l[:\s]*\d+$/.test(text)) return false;
      if (text === 'ascendant_voidcore') return false;
      return true;
    });
  };

  const canManageAffixesForItem = useCallback(
    (item: ResolvedItem): boolean => {
      const className = resolved.character.class_name || '';
      const cacheKey = enchantAvailabilityItemKey(
        item.slot,
        className,
        item.item_id,
        item.bonus_ids,
        item.season_id,
        specName
      );
      const hasEnchantOptions = enchantAvailabilityBySlot[cacheKey];
      const hasGemOptions = item.sockets > 0 || getResolvedGemIds(item).length > 0;
      const hasEmbellishmentOptions =
        (embellishmentOptionsByItem[item.item_id]?.length || 0) > 0;
      const craftedSource = isCraftedSource(item);
      const hasEmbellishmentByBonus =
        (embellishmentOptionsByItem[item.item_id] || []).some(
          (opt) =>
            Array.isArray(opt.bonus_ids) &&
            opt.bonus_ids.length > 0 &&
            opt.bonus_ids.every((bid) => item.bonus_ids.includes(bid))
        );
      const hasExistingEnhancements =
        item.enchant_id > 0 ||
        getResolvedGemIds(item).length > 0 ||
        (item.embellishment_item_id || 0) > 0 ||
        hasEmbellishmentByBonus ||
        /(?:^|,)enchant_id=/.test(item.simc_string);
  const getDisplayIlevel = useCallback((item: ResolvedItem): number => {
    if (!isAscendantApplied(item)) return Number(item.ilevel || 0);
    const { maxIlevelDelta } = getAscendantModifierIlevelConfig();
    return Math.max(1, Number(item.ilevel || 0) - maxIlevelDelta);
  }, []);

  const itemOverline = useCallback(
    (item: ResolvedItem): React.ReactNode => {
      const displayedIlevel = getDisplayIlevel(item);
      const trackLabel = parseUpgradeLabel(item.upgrade || '').segments.at(-1) || '';
      return (
        <>
          {displayedIlevel > 0 ? (
            <span className="rounded border border-zinc-400/40 bg-zinc-500/10 px-2 py-0.5 text-[11px] font-semibold leading-none text-zinc-200/90">
              iLvl {displayedIlevel}
            </span>
          ) : null}
          {trackLabel ? (
            <span
              className={`rounded border px-2 py-0.5 text-[11px] font-semibold leading-none ${upgradeTierTagColor(
                trackLabel
              )}`}
            >
              {trackLabel}
            </span>
          ) : null}
        </>
      );
    },
    [resolved.character.class_name, enchantAvailabilityBySlot, embellishmentOptionsByItem, specName]
  );

  const isEnchantAvailabilityPending = useCallback(
    (item: ResolvedItem): boolean => {
      const className = resolved.character.class_name || '';
      const cacheKey = enchantAvailabilityItemKey(
        item.slot,
        className,
        item.item_id,
        item.bonus_ids,
        item.season_id,
        specName
      );
      const hasKnownAvailability = Object.prototype.hasOwnProperty.call(
        enchantAvailabilityBySlot,
        cacheKey
      );
      if (hasKnownAvailability) return false;
      return (
        KNOWN_ENCHANTABLE_SLOTS.has(item.slot) ||
        item.enchant_id > 0 ||
        /(?:^|,)enchant_id=/.test(item.simc_string)
      );
    },
    [enchantAvailabilityBySlot, resolved.character.class_name, specName]
  );

  const canOptimizeItem = useCallback(
    (item: ResolvedItem): boolean => {
      const hasEmbellishmentOptions =
        (embellishmentOptionsByItem[item.item_id]?.length || 0) > 0;
      const craftedSource = isCraftedSource(item);
      const hasEmbellishmentByBonus =
        (embellishmentOptionsByItem[item.item_id] || []).some(
          (opt) =>
            Array.isArray(opt.bonus_ids) &&
            opt.bonus_ids.length > 0 &&
            opt.bonus_ids.every((bid) => item.bonus_ids.includes(bid))
        );

      if (globalAffixesEnabled) {
        return (
          hasEmbellishmentOptions ||
          craftedSource ||
          (item.embellishment_item_id || 0) > 0 ||
          hasEmbellishmentByBonus
        );
      }

      return canManageAffixesForItem(item);
    },
    [canManageAffixesForItem, embellishmentOptionsByItem, globalAffixesEnabled]
  );

  const shouldShowOptimizeButton = useCallback(
    (item: ResolvedItem): boolean => {
      if (canOptimizeItem(item)) return true;
      if (isEnchantAvailabilityPending(item)) return true;
      return globalAffixesEnabled && canManageAffixesForItem(item);
    },
    [canManageAffixesForItem, canOptimizeItem, globalAffixesEnabled, isEnchantAvailabilityPending]
  );

  const getOptimizeDisabledReason = useCallback(
    (item: ResolvedItem): string | undefined => {
      if (isEnchantAvailabilityPending(item)) {
        return 'Loading optimization options for this item.';
      }
      if (!globalAffixesEnabled || canOptimizeItem(item) || !canManageAffixesForItem(item)) {
        return undefined;
      }
      return 'Enchants and gems are controlled by Enchant & Gem Rules while Global Enchants & Gems is enabled.';
    },
    [canManageAffixesForItem, canOptimizeItem, globalAffixesEnabled, isEnchantAvailabilityPending]
  );

  const hasSelection = Object.values(selectedUids).some((s) => s.size > 0);
  const variantStudioItems = useMemo(() => {
    const byIdentity = new Map<string, ResolvedItem>();

    for (const [slot, slotRes] of Object.entries(resolved.slots)) {
      if (slotRes.equipped && canManageAffixesForItem(slotRes.equipped)) {
        const identity = makeIdentity(slotRes.equipped);
        if (!byIdentity.has(identity)) {
          byIdentity.set(identity, slotRes.equipped);
        }
      }

      const selectedForSlot = selectedUids[slot] || new Set<string>();
      for (const item of slotRes.alternatives) {
        if (!selectedForSlot.has(item.uid) || !canManageAffixesForItem(item)) continue;
        const identity = makeIdentity(item);
        if (!byIdentity.has(identity)) {
          byIdentity.set(identity, item);
        }
      }
    }

    return Array.from(byIdentity.values()).sort((a, b) => {
      const slotCompare = a.slot.localeCompare(b.slot);
      if (slotCompare !== 0) return slotCompare;
      return a.name.localeCompare(b.name);
    });
  }, [selectedUids, resolved.slots, canManageAffixesForItem]);
  const variantStudioEquippedItems = useMemo(
    () =>
      Object.values(resolved.slots)
        .map((slotRes) => slotRes.equipped)
        .filter((item): item is ResolvedItem => item != null)
        .filter((item) => canManageAffixesForItem(item)),
    [resolved.slots, canManageAffixesForItem]
  );
  const comboBreakdown =
    comboCount > 0
      ? `${Math.max(comboCount - 1, 0).toLocaleString()} normal combo(s) | +1 Currently Equipped`
      : null;
  const quickSelect = (
    <TopGearQuickSelect
      comboCount={comboCount}
      maxCombinations={effectiveMaxCombinations}
      comboBreakdown={comboBreakdown}
      hasSelection={hasSelection}
      vaultCount={vaultUids.length}
      allVaultSelected={
        vaultUids.length > 0 && vaultUids.every((c) => selectedUids[c.slot]?.has(c.uid))
      }
      catalystCount={catalystUids.length}
      allCatalystSelected={
        catalystUids.length > 0 && catalystUids.every((c) => selectedUids[c.slot]?.has(c.uid))
      }
      onToggleVault={() => toggleGroup(vaultUids)}
      onToggleCatalyst={() => toggleGroup(catalystUids)}
      onSelectAll={selectAll}
      onClear={deselectAll}
    />
  );

  return (
    <div className="space-y-4">
        <AddItemModal
          isOpen={isAddItemOpen}
          onClose={() => setAddItemOpen(false)}
          onAdd={handleAddItem}
          className={resolved.character.class_name}
          spec={resolved.character.spec}
          canUseOffhand={resolved.character.can_use_offhand}
          preferredSlot={addItemSlot}
        />
      <OptimizeItemModal
        key={optimizeItem ? `${optimizeItem.uid}:${optimizeItem.slot}:${optimizeItem.item_id}` : 'optimize-none'}
        isOpen={isOptimizeOpen}
        onClose={() => setOptimizeOpen(false)}
        item={optimizeItem}
        className={resolved.character.class_name}
        specName={specName}
        globalAffixesEnabled={globalAffixesEnabled}
        onApply={handleOptimize}
      />
      <TopGearVariantStudio
        isOpen={isVariantStudioOpen}
        onClose={() => setVariantStudioOpen(false)}
        items={variantStudioItems}
        equippedItems={variantStudioEquippedItems}
        savedVariantsBySlot={savedVariantCopiesBySlot}
        savedRuleState={savedVariantRuleState}
        globalAffixesEnabled={globalAffixesEnabled}
        className={resolved.character.class_name}
        specName={specName}
        copyEnchants={copyEnchants}
        onApplyBatch={saveOptimizedVariants}
        onStateChange={onVariantRuleStateChange}
      />
      <TopGearItemContextMenu
        item={contextMenu?.item || null}
        x={contextMenu?.x || 0}
        y={contextMenu?.y || 0}
        canAddEnchant={contextMenu?.availability.canAddEnchant || false}
        canAddGem={contextMenu?.availability.canAddGem || false}
        globalAffixesEnabled={globalAffixesEnabled}
        canSetAscendant={Boolean(contextMenu?.item && isAscendantEligible(contextMenu.item))}
        otherTierOptions={otherTierOptions}
        loadingOtherTierOptions={loadingOtherTierOptions}
        upgradeOptions={upgradeOptions}
        loadingUpgrades={loadingUpgrades}
        onClose={() => setContextMenu(null)}
        onLoadUpgradeOptions={loadUpgradeOptions}
        onLoadOtherTierOptions={loadOtherTierOptions}
        onUpgradeSelect={addUpgradedCopy}
        onApplyOtherTier={applyTierCopy}
        onCatalystConvert={convertToCatalyst}
        onOptimize={openOptimize}
        onSetOrigin={setItemOrigin}
        onSetWishlist={setItemWishlist}
        onSetAscendant={(item, enabled) => {
          if (!isAscendantEligible(item)) return;
          const { maxIlevelDelta, maxIlevelCap } = getAscendantModifierIlevelConfig();
          const currentApplied = isAscendantApplied(item);
          if (!enabled && !currentApplied) return;
          const nextIlevel = enabled
            ? Math.min(maxIlevelCap, item.ilevel + (currentApplied ? 0 : maxIlevelDelta))
            : Math.max(1, item.ilevel - (currentApplied ? maxIlevelDelta : 0));
          const nextSourceType = enabled
            ? `${String(item.source_type || '').replace(/\bascendant_voidcore\b/gi, '').replace(/\s+/g, ' ').trim()} mod:268552`.trim()
            : String(item.source_type || '')
                .replace(/\bmod:268552\b/gi, '')
                .replace(/\bascendant_voidcore\b/gi, '')
                .replace(/\s+/g, ' ')
                .trim();
          const nextTag = enabled ? 'Ascendant' : item.tag === 'Ascendant' ? 'Search' : item.tag;
          const nextUpgrade = clampUpgradeArrowChain(
            formatCanonicalUpgradeLabel(
            item.upgrade,
            String(resolved.slots[item.slot]?.equipped?.upgrade || ''),
            enabled
            )
          );
          const nextItem: ResolvedItem = {
            ...item,
            origin: 'bags',
            ilevel: nextIlevel,
            simc_string: applyAscendantToSimc(item.simc_string, nextIlevel),
            source_type: nextSourceType,
            tag: nextTag,
            upgrade: nextUpgrade,
          };
          const nextUid = makeUid({
            item_id: nextItem.item_id,
            bonus_ids: nextItem.bonus_ids,
            origin: nextItem.origin,
            slot: nextItem.slot,
            ilevel: nextItem.ilevel,
            enchant_id: nextItem.enchant_id,
            gem_id: nextItem.gem_id,
            gem_ids: nextItem.gem_ids,
            crafted_stats: nextItem.crafted_stats,
            embellishment_item_id: nextItem.embellishment_item_id,
          });
          const nextVariant: ResolvedItem = { ...nextItem, uid: nextUid };
          const nextResolved = { ...resolved, slots: { ...resolved.slots } };
          const persistedSlots = new Set<string>();
          for (const [slotKey, slotRes] of Object.entries(nextResolved.slots)) {
            const nextSlot = { ...slotRes };
            if (nextSlot.equipped?.uid === item.uid) {
              // Keep equipped intact; append ascended copy as alternative.
              if (!nextSlot.alternatives.find((alt) => alt.uid === nextUid)) {
                nextSlot.alternatives = [...nextSlot.alternatives, { ...nextVariant, slot: nextSlot.equipped.slot }];
                persistedSlots.add(nextSlot.equipped.slot);
              }
            } else if (nextSlot.alternatives.some((alt) => alt.uid === item.uid)) {
              if (!nextSlot.alternatives.find((alt) => alt.uid === nextUid)) {
                nextSlot.alternatives = [...nextSlot.alternatives, { ...nextVariant, slot: item.slot }];
                persistedSlots.add(item.slot);
              }
            }
            nextResolved.slots[slotKey] = nextSlot;
          }
          onResolvedChange(nextResolved);
          for (const slot of persistedSlots) {
            onItemAdded(slot, nextVariant.simc_string, nextVariant.origin);
          }
          const nextSelected: Record<string, Set<string>> = {
            ...Object.fromEntries(Object.entries(selectedUids).map(([k, v]) => [k, new Set(v)])),
          };
          if (!nextSelected[item.slot]) nextSelected[item.slot] = new Set();
          nextSelected[item.slot].add(nextUid);
          onSelectionChange(nextSelected);
        }}
      />

      <StickyPageHeader
        className="mb-4"
        left={
          <div className="flex items-center gap-4">
            <h2 className="text-[13px] font-semibold uppercase tracking-[0.18em] text-zinc-300">
              Select Items
            </h2>
            <button
              onClick={() => openAddItem()}
              className="flex items-center gap-1.5 rounded-md border border-gold/45 bg-gold/[0.12] px-2.5 py-1 text-[12px] font-semibold text-gold transition-colors hover:bg-gold/[0.2]"
            >
              Add Item
            </button>
            <button
              onClick={() => setVariantStudioOpen(true)}
              disabled={!globalAffixesEnabled || variantStudioItems.length === 0}
              title={
                !globalAffixesEnabled
                  ? 'Enable Global Enchants & Gems to use Enchant & Gem Rules.'
                  : variantStudioItems.length === 0
                    ? 'No compatible equipped or selected items are available for Enchant & Gem Rules.'
                    : 'Open Enchant & Gem Rules'
              }
              className="flex items-center gap-1.5 rounded-md border border-white/12 bg-white/[0.04] px-2.5 py-1 text-[12px] font-semibold text-zinc-200 transition-colors hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Enchant & Gem Rules
              {savedVariantCount > 0 ? (
                <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[11px]">
                  {savedVariantCount}
                </span>
              ) : null}
            </button>
          </div>
        }
        right={quickSelect}
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {visibleGroups.map(({ group, equipped, alternatives, hiddenAlternativeCount, showingAllAlternatives }) => (
          <TopGearSlotGroup
            key={group.label}
            label={group.label}
            slots={group.slots}
            equipped={equipped}
            alternatives={alternatives}
            itemInfoMap={itemInfoMap}
            onToggle={(item) => handleToggleItem(item, group.slots)}
            onAddClick={openAddItem}
            onUpgradeClick={openUpgradeMenu}
            onUpgradeSelect={addUpgradedCopy}
            onCatalystConvert={convertToCatalyst}
            onOptimize={openOptimize}
            canOptimizeItem={canOptimizeItem}
            shouldShowOptimizeButton={shouldShowOptimizeButton}
            optimizeDisabledReason={getOptimizeDisabledReason}
            optimizeTitle={globalAffixesEnabled ? 'Edit Embellishment' : 'Optimize Enchants and Sockets'}
            onItemContextMenu={openItemContextMenu}
            onToggleAll={() => toggleSlotAll(group.slots)}
            globalSelectionSummary={getGlobalSelectionSummary(group.slots, [...equipped, ...alternatives])}
            hiddenAlternativeCount={hiddenAlternativeCount}
            showingAllAlternatives={showingAllAlternatives}
            onToggleHiddenAlternatives={() =>
              setShowAllLowLevelByGroup((current) => ({
                ...current,
                [group.label]: !current[group.label],
              }))
            }
            itemDetails={itemDetails}
            itemOverline={itemOverline}
            getDisplayIlevel={getDisplayIlevel}
            hasLimitWarning={hasEmbellishmentLimitWarning}
            isItemSelected={(item) => {
              const identity = makeIdentity(item);
              return group.slots.some((s) => {
                const selected = selectedUids[s];
                if (!selected) return false;
                const slotRes = resolved.slots[s];
                if (!slotRes) return false;
                return Array.from(selected).some((uid) => {
                  const match = slotRes.alternatives.find((a) => a.uid === uid);
                  return match && makeIdentity(match) === identity;
                });
              });
            }}
            getWowheadUrl={getWowheadUrl}
            getWowheadData={getWowheadData}
          />
        ))}
      </div>
    </div>
  );
}
