'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { API_URL } from '../lib/api';
import type { ResolveGearResponse, ResolvedItem } from '../lib/types';
import { useWowheadTooltips } from '../lib/useWowheadTooltips';
import AddItemModal from './AddItemModal';
import OptimizeItemModal from './OptimizeItemModal';
import { useSimContext } from './SimContext';
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
  enchant_id?: number;
  gem_id?: number;
}): string {
  const sorted = [...item.bonus_ids].sort((a, b) => a - b);
  return `${item.item_id}:${sorted.join(':')}:${item.origin}:e${item.enchant_id || 0}:g${item.gem_id || 0}:${item.slot}`;
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
    deselectAll,
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

  useWowheadTooltips([resolved]);

  const convertToCatalyst = useCallback(
    async (item: ResolvedItem) => {
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
      const copyOrigin = 'bags';
      const copy: ResolvedItem = {
        ...item,
        origin: copyOrigin as any,
        uid: makeUid({
          item_id: item.item_id,
          bonus_ids: newBonusIds,
          origin: copyOrigin,
          slot: item.slot,
          enchant_id: item.enchant_id,
          gem_id: item.gem_id,
        }),
        bonus_ids: newBonusIds,
        simc_string: newSimcString,
        ilevel: option.itemLevel,
        upgrade: option.fullName,
      };

      const nextResolved = { ...resolved, slots: { ...resolved.slots } };
      const slotRes = nextResolved.slots[item.slot];
      if (slotRes) {
        slotRes.alternatives = [...slotRes.alternatives, copy];
      }
      onResolvedChange(nextResolved);
      onItemAdded(item.slot, newSimcString, item.origin);
      const nextSelected = {
        ...Object.fromEntries(Object.entries(selectedUids).map(([k, v]) => [k, new Set(v)])),
      };
      if (!nextSelected[item.slot]) nextSelected[item.slot] = new Set();
      nextSelected[item.slot].add(copy.uid);
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
        enchant_id: enchantId,
        gem_id: firstGemId,
      });
      const copy: ResolvedItem = {
        ...item,
        origin: 'bags',
        uid,
        enchant_id: enchantId,
        gem_id: firstGemId,
        simc_string: nextSimc,
        tag: 'Opt',
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

      const slot = slots[0];
      let bonusIds = overrides
        ? [...overrides.bonus_ids]
        : item.difficulty_info?.[difficulty]?.bonus_id
          ? [item.difficulty_info[difficulty].bonus_id]
          : [];
      let ilvl = overrides
        ? overrides.ilvl
        : item.difficulty_info?.[difficulty]?.ilvl || item.ilevel;
      let upgradeStr = overrides
        ? `${overrides.track_name} ${overrides.level}`
        : item.difficulty_info?.[difficulty]?.track
          ? `${item.difficulty_info[difficulty].track} ${item.difficulty_info[difficulty].level}/${item.difficulty_info[difficulty].max_level}`
          : '';

      const uid = makeUid({ item_id: item.item_id, bonus_ids: bonusIds, origin: 'bags', slot });
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
      const seenAltKeys = new Set<string>();
      group.slots.forEach((slot) => {
        const slotRes = resolved.slots[slot];
        if (!slotRes) return;
        if (slotRes.equipped) equipped.push(slotRes.equipped);
        slotRes.alternatives.forEach((alt) => {
          const key = makeUid(alt);
          if (!seenAltKeys.has(key)) {
            seenAltKeys.add(key);
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

  const itemDetails = (item: ResolvedItem) => {
    const parts: { text: string; color?: string }[] = [];
    if (item.origin === 'vault') parts.push({ text: 'Great Vault', color: 'text-amber-400/80' });
    if (item.is_catalyst) parts.push({ text: 'Catalyst', color: 'text-purple-400/80' });
    if (item.tag) parts.push({ text: item.tag });
    if (item.upgrade) parts.push({ text: item.upgrade });
    if (item.gem_name) parts.push({ text: item.gem_name, color: 'text-sky-400/70' });
    else if (item.sockets > 0)
      parts.push({
        text: `${item.sockets} Socket${item.sockets > 1 ? 's' : ''}`,
        color: 'text-sky-400/70',
      });
    if (item.enchant_name) parts.push({ text: item.enchant_name, color: 'text-emerald-400/70' });
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
        onApply={handleOptimize}
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
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted">
            Select Items
          </h2>
          <button
            onClick={() => openAddItem()}
            className="flex items-center gap-1.5 rounded-md bg-gold/10 px-2.5 py-1.5 text-[10px] font-bold tracking-wider text-gold hover:bg-gold/20"
          >
            Add Item
          </button>
        </div>
        {quickSelect}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
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
            itemDetails={itemDetails}
            isItemSelected={(item) =>
              group.slots.some((s) => {
                const slotRes = resolved.slots[s];
                if (!slotRes) return false;
                const match = slotRes.alternatives.find((a) => a.uid === item.uid);
                return match ? selectedUids[s]?.has(match.uid) : false;
              })
            }
            getWowheadUrl={getWowheadUrl}
            getWowheadData={getWowheadData}
          />
        ))}
      </div>
    </div>
  );
}
