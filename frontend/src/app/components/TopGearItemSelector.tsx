'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { API_URL, fetchJsonCached } from '../lib/api';
import type { ResolveGearResponse, ResolvedItem } from '../lib/types';
import { useWowheadTooltips } from '../lib/useWowheadTooltips';
import AddItemModal from './AddItemModal';
import OptimizeItemModal from './OptimizeItemModal';
import { useSimContext } from './SimContext';
import TopGearItemContextMenu from './top-gear/TopGearItemContextMenu';
import TopGearQuickSelect from './top-gear/TopGearQuickSelect';
import TopGearSlotGroup from './top-gear/TopGearSlotGroup';
import { useTopGearState } from './top-gear/useTopGearState';

interface TopGearItemSelectorProps {
  resolved: ResolveGearResponse;
  selectedUids: Record<string, Set<string>>;
  onSelectionChange: (selected: Record<string, Set<string>>) => void;
  onResolvedChange: (resolved: ResolveGearResponse) => void;
  onItemAdded: (slot: string, simcString: string, origin: string) => void;
  comboCount: number;
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
const SOURCE_TAG_STYLES: Record<string, string> = {
  wishlist: 'text-rose-300 bg-rose-500/15 border-rose-400/40',
  vault: 'text-amber-300 bg-amber-500/15 border-amber-400/40',
  crafter: 'text-cyan-300 bg-cyan-500/15 border-cyan-400/40',
  crafted: 'text-cyan-300 bg-cyan-500/15 border-cyan-400/40',
  catalyst: 'text-purple-300 bg-purple-500/15 border-purple-400/40',
  bags: 'text-zinc-200 bg-white/[0.06] border-white/15',
};

function toTitleCase(input: string): string {
  return input
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function resolveSourceTags(item: ResolvedItem): Array<{ text: string; color: string }> {
  const tags: Array<{ text: string; color: string }> = [];

  const pushTag = (rawText: string) => {
    const text = toTitleCase(rawText || '');
    if (!text) return;
    if (tags.some((t) => t.text.toLowerCase() === text.toLowerCase())) return;
    const key = text.toLowerCase();
    tags.push({
      text,
      color: SOURCE_TAG_STYLES[key] || 'text-zinc-200 bg-white/[0.06] border-white/15',
    });
  };

  if (item.origin === 'vault') pushTag('Vault');
  if (item.tag) pushTag(item.tag);

  const sourceType = String((item as any).source_type || '').toLowerCase();
  if (sourceType.includes('wishlist')) pushTag('Wishlist');
  if (sourceType.includes('vault')) pushTag('Vault');
  if (sourceType.includes('craft')) pushTag('Crafter');

  if (tags.length === 0 && item.origin) pushTag(item.origin);
  return tags;
}

function getWowheadUrl(itemId: number): string {
  return `https://www.wowhead.com/item=${itemId}`;
}

function getWowheadData(item: ResolvedItem): string {
  const parts: string[] = [];
  if (item.bonus_ids.length > 0) parts.push(`bonus=${item.bonus_ids.join(':')}`);
  if (item.ilevel > 0) parts.push(`ilvl=${item.ilevel}`);
  if (item.enchant_id > 0) parts.push(`ench=${item.enchant_id}`);
  if (item.gem_id > 0) parts.push(`gems=${item.gem_id}`);
  return parts.join('&');
}

function makeUid(item: {
  item_id: number;
  bonus_ids: number[];
  origin: string;
  slot: string;
  ilevel?: number;
  enchant_id?: number;
  gem_id?: number;
}): string {
  const sorted = [...item.bonus_ids].sort((a, b) => a - b);
  return `${item.item_id}:${sorted.join(':')}:${item.origin}:i${item.ilevel || 0}:e${item.enchant_id || 0}:g${item.gem_id || 0}:${item.slot}`;
}

function makeIdentity(item: {
  item_id: number;
  bonus_ids: number[];
  origin: string;
  ilevel?: number;
  enchant_id?: number;
  gem_id?: number;
}): string {
  const sorted = [...item.bonus_ids].sort((a, b) => a - b);
  return `${item.item_id}:${sorted.join(':')}:${item.origin}:i${item.ilevel || 0}:e${item.enchant_id || 0}:g${item.gem_id || 0}`;
}

function parseFirstIdFromSimc(simc: string, key: 'gem_id' | 'enchant_id'): number {
  const match = simc.match(new RegExp(`(?:^|,)${key}=([0-9/:]+)`));
  if (!match) return 0;
  const rawValue = match[1].split('/')[0];
  return Number.parseInt(rawValue, 10) || 0;
}

export default function TopGearItemSelector({
  resolved,
  selectedUids,
  onSelectionChange,
  onResolvedChange,
  onItemAdded,
  comboCount,
}: TopGearItemSelectorProps) {
  const { maxCombinations } = useSimContext();
  const effectiveMaxCombinations = maxCombinations ?? 500;
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerVisible, setHeaderVisible] = useState(true);
  const [gemInfoById, setGemInfoById] = useState<Record<number, GemInfo>>({});
  const [enchantInfoById, setEnchantInfoById] = useState<Record<number, EnchantInfo>>({});
  const [enchantAvailabilityBySlot, setEnchantAvailabilityBySlot] = useState<Record<string, boolean>>(
    {}
  );
  const [otherTierOptions, setOtherTierOptions] = useState<UpgradeOption[]>([]);
  const [loadingOtherTierOptions, setLoadingOtherTierOptions] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    item: ResolvedItem;
    x: number;
    y: number;
    availability: ItemActionAvailability;
  } | null>(null);

  const {
    upgradeMenuFor,
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
    openUpgradeMenu,
    loadUpgradeOptions,
    deselectAll,
    selectAll,
    toggleSlotAll,
    toggleGroup,
    toggleItem,
  } = useTopGearState({ resolved, selectedUids, onSelectionChange, onResolvedChange, onItemAdded });

  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => setHeaderVisible(entry.isIntersecting), {
      threshold: 0,
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useWowheadTooltips([resolved, gemInfoById, enchantInfoById]);

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
      } catch {}
    },
    [resolved, onResolvedChange, selectedUids, onSelectionChange, setUpgradeMenuFor]
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
        const nextAlternatives = slotRes.alternatives.map((alt) => {
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
          });
          if (nextUid !== alt.uid) {
            uidMap.set(alt.uid, nextUid);
          }
          updated = true;
          return { ...nextItem, uid: nextUid, slot: nextItem.slot || slot };
        });
        slotRes.alternatives = nextAlternatives;
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
        target.sockets > 0 || target.gem_id > 0 || /(?:^|,)gem_id=/.test(target.simc_string);

      const getEnchantAvailability = async (target: ResolvedItem): Promise<boolean> => {
        const className = resolved.character.class_name || '';
        const cacheKey = `${target.slot}|${className}`;
        if (Object.prototype.hasOwnProperty.call(enchantAvailabilityBySlot, cacheKey)) {
          return !!enchantAvailabilityBySlot[cacheKey];
        }
        try {
          const res = await fetch(
            `${API_URL}/api/gear/enchant-options?slot=${target.slot}${
              className ? `&class_name=${encodeURIComponent(className)}` : ''
            }`,
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
        const canAddGem = getGemAvailability(item);
        const canAddEnchant = await getEnchantAvailability(item);
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
    [resolved.character.class_name, enchantAvailabilityBySlot]
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
        });
        const slotRes = nextResolved.slots[slot];
        if (!slotRes || slotRes.alternatives.some((a) => a.uid === uid)) continue;
        const copy: ResolvedItem = {
          ...item,
          slot,
          origin: copyOrigin as any,
          uid,
          bonus_ids: newBonusIds,
          simc_string: newSimcString,
          ilevel: option.itemLevel,
          upgrade: option.fullName,
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
        });
        if (!nextSelected[slot]) nextSelected[slot] = new Set();
        nextSelected[slot].add(uid);
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
        });
        const slotRes = nextResolved.slots[slot];
        if (!slotRes || slotRes.alternatives.some((a) => a.uid === uid)) continue;
        const copy: ResolvedItem = {
          ...item,
          slot,
          origin: copyOrigin as any,
          uid,
          bonus_ids: newBonusIds,
          simc_string: newSimcString,
          ilevel: option.itemLevel,
          upgrade: option.fullName,
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
        });
        if (!nextSelected[slot]) nextSelected[slot] = new Set();
        nextSelected[slot].add(uid);
      }
      onSelectionChange(nextSelected);
      setContextMenu(null);
    },
    [resolved, upgradeOptions, onResolvedChange, onItemAdded, selectedUids, onSelectionChange]
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

  const handleOptimize = useCallback(
    (enchantId: number, gemIds: number[]) => {
      if (!optimizeItem) return;
      const item = optimizeItem;
      const firstGemId = gemIds[0] || 0;
      let nextSimc = item.simc_string;
      if (enchantId > 0) {
        if (nextSimc.includes('enchant_id='))
          nextSimc = nextSimc.replace(/enchant_id=[0-9]+/, `enchant_id=${enchantId}`);
        else nextSimc += `,enchant_id=${enchantId}`;
      } else nextSimc = nextSimc.replace(/,enchant_id=[0-9]+/, '');

      if (firstGemId > 0) {
        if (nextSimc.includes('gem_id='))
          nextSimc = nextSimc.replace(/gem_id=[0-9/:]+/, `gem_id=${firstGemId}`);
        else nextSimc += `,gem_id=${firstGemId}`;
      } else nextSimc = nextSimc.replace(/,gem_id=[0-9/:]+/, '');

      const uid = makeUid({
        item_id: item.item_id,
        bonus_ids: item.bonus_ids,
        origin: 'bags',
        slot: item.slot,
        ilevel: item.ilevel,
        enchant_id: enchantId,
        gem_id: firstGemId,
      });
      const copy: ResolvedItem = {
        ...item,
        origin: 'bags',
        uid,
        enchant_id: enchantId,
        gem_id: firstGemId,
        enchant_name: enchantId > 0 ? enchantInfoById[enchantId]?.name || '' : '',
        gem_name: firstGemId > 0 ? gemInfoById[firstGemId]?.name || '' : '',
        gem_icon: firstGemId > 0 ? gemInfoById[firstGemId]?.icon || '' : '',
        simc_string: nextSimc,
      };

      const nextResolved = { ...resolved, slots: { ...resolved.slots } };
      const slotRes = nextResolved.slots[item.slot];
      if (slotRes && !slotRes.alternatives.find((a) => a.uid === uid)) {
        slotRes.alternatives = [...slotRes.alternatives, copy];
      }
      onResolvedChange(nextResolved);
      onItemAdded(item.slot, nextSimc, 'bags');
      const nextSelected = { ...selectedUids };
      if (!nextSelected[item.slot]) nextSelected[item.slot] = new Set();
      nextSelected[item.slot].add(uid);
      onSelectionChange(nextSelected);
      setOptimizeOpen(false);
    },
    [
      optimizeItem,
      resolved,
      onResolvedChange,
      onItemAdded,
      selectedUids,
      onSelectionChange,
      setOptimizeOpen,
      enchantInfoById,
      gemInfoById,
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
      let ilvl = overrides ? overrides.ilvl : difficultyInfo?.ilvl || item.ilevel;
      let upgradeStr = overrides
        ? `${overrides.track_name} ${overrides.level}`
        : difficultyInfo?.track
          ? `${difficultyInfo.track} ${difficultyInfo.level}/${UPGRADE_TRACK_MAX_LEVEL}`
          : '';

      const uid = makeUid({
        item_id: item.item_id,
        bonus_ids: bonusIds,
        origin: 'bags',
        slot,
        ilevel: ilvl,
      });
      const newItem: ResolvedItem = {
        uid,
        slot,
        item_id: item.item_id,
        ilevel: ilvl,
        simc_string: `,id=${item.item_id}${ilvl > 0 ? `,ilevel=${ilvl}` : ''}${bonusIds.length > 0 ? `,bonus_id=${bonusIds.join('/')}` : ''},name=${item.name.replace(/ /g, '_')}`,
        origin: 'bags',
        bonus_ids: bonusIds,
        enchant_id: 0,
        gem_id: 0,
        name: item.name,
        icon: item.icon,
        quality: item.quality,
        quality_color:
          item.quality === 5
            ? '#ff8000'
            : item.quality === 4
              ? '#a335ee'
              : item.quality === 3
                ? '#0070dd'
                : '#1eff00',
        tag: 'Bags',
        upgrade: upgradeStr,
        sockets: 0,
        enchant_name: '',
        gem_name: '',
        gem_icon: '',
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
          });
          targetSlot.alternatives = [
            ...targetSlot.alternatives,
            { ...newItem, uid: slotUid, slot: s },
          ];
        }
      });

      onResolvedChange(nextResolved);
      const nextSelected = { ...selectedUids };
      slots.forEach((s) => {
        const slotUid = makeUid({
          item_id: item.item_id,
          bonus_ids: bonusIds,
          origin: 'bags',
          slot: s,
          ilevel: ilvl,
        });
        if (!nextSelected[s]) nextSelected[s] = new Set();
        nextSelected[s].add(slotUid);
      });
      onSelectionChange(nextSelected);
      onItemAdded(slot, newItem.simc_string, 'bags');
      setAddItemOpen(false);
    },
    [resolved, selectedUids, onResolvedChange, onSelectionChange, onItemAdded, setAddItemOpen]
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
      return { group, equipped, alternatives };
    }).filter((g) => g.equipped.length > 0 || g.alternatives.length > 0);
  }, [resolved]);

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
        const gemId =
          item.gem_id > 0 ? item.gem_id : parseFirstIdFromSimc(item.simc_string, 'gem_id');
        const enchantId =
          item.enchant_id > 0
            ? item.enchant_id
            : parseFirstIdFromSimc(item.simc_string, 'enchant_id');
        if (gemId > 0) gems.add(gemId);
        if (enchantId > 0) enchants.add(enchantId);
      });
    });

    return { gemIds: Array.from(gems), enchantIds: Array.from(enchants) };
  }, [resolved]);

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

  const itemDetails = (item: ResolvedItem) => {
    const gemIconFallback = 'inv_misc_questionmark';
    const effectiveGemId =
      item.gem_id > 0 ? item.gem_id : parseFirstIdFromSimc(item.simc_string, 'gem_id');
    const effectiveEnchantId =
      item.enchant_id > 0 ? item.enchant_id : parseFirstIdFromSimc(item.simc_string, 'enchant_id');

    const gemInfo = effectiveGemId > 0 ? gemInfoById[effectiveGemId] : undefined;
    const enchantInfo = effectiveEnchantId > 0 ? enchantInfoById[effectiveEnchantId] : undefined;
    const hasGem = effectiveGemId > 0 || Boolean(item.gem_name);
    const parts: {
      text: string;
      color?: string;
      kind?: 'text' | 'gemIcon' | 'plain' | 'iconText';
      icon?: string;
      href?: string;
      wowheadData?: string;
      tooltip?: string;
    }[] = [];

    for (const sourceTag of resolveSourceTags(item)) {
      parts.push({
        text: sourceTag.text,
        color: sourceTag.color,
      });
    }
    if (item.is_catalyst)
      parts.push({
        text: 'Catalyst',
        color: SOURCE_TAG_STYLES.catalyst,
      });
    if (item.upgrade)
      parts.push({
        text: item.upgrade,
        color: 'text-zinc-200 bg-white/[0.06] border-white/15',
      });
    if (hasGem) {
      const gemName = gemInfo?.name || item.gem_name || 'Gem';
      parts.push({
        text: gemName,
        kind: 'gemIcon',
        icon: gemInfo?.icon || item.gem_icon || gemIconFallback,
        href: effectiveGemId > 0 ? `https://www.wowhead.com/item=${effectiveGemId}` : undefined,
        wowheadData: effectiveGemId > 0 ? `item=${effectiveGemId}` : undefined,
        tooltip: gemName,
        color: 'border-sky-400/40 bg-sky-500/10',
      });
    } else if (item.sockets > 0)
      parts.push({
        text: `${item.sockets} Socket${item.sockets > 1 ? 's' : ''}`,
        color: 'text-sky-300 bg-sky-500/15 border-sky-400/40',
      });

    const enchantName = enchantInfo?.name || item.enchant_name;
    if (enchantName) {
      const enchantItemId = enchantInfo?.item_id ?? 0;
      parts.push({
        text: enchantName,
        kind: enchantInfo?.icon ? 'iconText' : 'plain',
        icon: enchantInfo?.icon,
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
    }
    return parts;
  };

  const hasSelection = Object.values(selectedUids).some((s) => s.size > 0);
  const quickSelect = (
    <TopGearQuickSelect
      comboCount={comboCount}
      maxCombinations={effectiveMaxCombinations}
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
        preferredSlot={addItemSlot}
      />
      <OptimizeItemModal
        isOpen={isOptimizeOpen}
        onClose={() => setOptimizeOpen(false)}
        item={optimizeItem}
        className={resolved.character.class_name}
        onApply={handleOptimize}
      />
      <TopGearItemContextMenu
        item={contextMenu?.item || null}
        x={contextMenu?.x || 0}
        y={contextMenu?.y || 0}
        canAddEnchant={contextMenu?.availability.canAddEnchant || false}
        canAddGem={contextMenu?.availability.canAddGem || false}
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
      />

      {!headerVisible && (
        <div className="fixed left-0 right-0 top-12 z-50 flex items-center justify-between border-b border-border/50 bg-surface/90 px-4 py-2 shadow-lg backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted">Items</p>
            <button
              onClick={() => openAddItem()}
              className="flex items-center gap-1.5 rounded-md bg-gold/10 px-2 py-1 text-[10px] font-bold tracking-wider text-gold hover:bg-gold/20"
            >
              Add
            </button>
          </div>
          {quickSelect}
        </div>
      )}

      <div ref={headerRef} className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.18em] text-zinc-300">
            Select Items
          </h2>
          <button
            onClick={() => openAddItem()}
            className="flex items-center gap-1.5 rounded-md bg-gold/10 px-3 py-1.5 text-[11px] font-bold tracking-[0.08em] text-gold hover:bg-gold/20"
          >
            Add Item
          </button>
        </div>
        {quickSelect}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {visibleGroups.map(({ group, equipped, alternatives }) => (
          <TopGearSlotGroup
            key={group.label}
            label={group.label}
            slots={group.slots}
            equipped={equipped}
            alternatives={alternatives}
            selectedUids={selectedUids}
            upgradeMenuFor={upgradeMenuFor}
            upgradeOptions={upgradeOptions}
            loadingUpgrades={loadingUpgrades}
            onToggle={(item) => toggleItem(item, group.slots)}
            onAddClick={openAddItem}
            onUpgradeClick={openUpgradeMenu}
            onUpgradeSelect={addUpgradedCopy}
            onCatalystConvert={convertToCatalyst}
            onOptimize={openOptimize}
            onItemContextMenu={openItemContextMenu}
            onToggleAll={() => toggleSlotAll(group.slots)}
            itemDetails={itemDetails}
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
