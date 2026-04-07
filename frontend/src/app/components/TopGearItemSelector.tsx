'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { API_URL } from '../lib/api';
import type { ResolveGearResponse, ResolvedItem } from '../lib/types';
import { useWowheadTooltips } from '../lib/useWowheadTooltips';
import AddItemModal from './AddItemModal';
import GearItemRow from './GearItemRow';
import OptimizeItemModal from './OptimizeItemModal';
import { useSimContext } from './SimContext';

interface UpgradeOption {
  bonus_id: number;
  level: number;
  max: number;
  name: string;
  fullName: string;
  itemLevel: number;
}

interface TopGearItemSelectorProps {
  resolved: ResolveGearResponse;
  selectedUids: Record<string, Set<string>>;
  onSelectionChange: (selected: Record<string, Set<string>>) => void;
  onResolvedChange: (resolved: ResolveGearResponse) => void;
  onItemAdded: (slot: string, simcString: string, origin: string) => void;
  maxUpgrade?: boolean;
  comboCount: number;
  comboError: string;
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

function getIconUrl(iconName: string): string {
  return `https://render.worldofwarcraft.com/icons/56/${iconName}.jpg`;
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
  enchant_id?: number;
  gem_id?: number;
}): string {
  const sorted = [...item.bonus_ids].sort((a, b) => a - b);
  const bonusKey = sorted.join(':');
  return `${item.item_id}:${bonusKey}:${item.origin}:e${item.enchant_id || 0}:g${item.gem_id || 0}:${item.slot}`;
}

export default function TopGearItemSelector({
  resolved,
  selectedUids,
  onSelectionChange,
  onResolvedChange,
  onItemAdded,
  maxUpgrade,
  comboCount,
  comboError,
}: TopGearItemSelectorProps) {
  const { maxCombinations } = useSimContext();
  const effectiveMaxCombinations = maxCombinations ?? 500;
  const [upgradeMenuFor, setUpgradeMenuFor] = useState<string | null>(null);
  const [upgradeOptions, setUpgradeOptions] = useState<UpgradeOption[]>([]);
  const [loadingUpgrades, setLoadingUpgrades] = useState(false);
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerVisible, setHeaderVisible] = useState(true);
  const [isAddItemOpen, setAddItemOpen] = useState(false);
  const [addItemSlot, setAddItemSlot] = useState<string | null>(null);
  const [isOptimizeOpen, setOptimizeOpen] = useState(false);
  const [optimizeItem, setOptimizeItem] = useState<ResolvedItem | null>(null);

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

  const openAddItem = useCallback((slot?: string) => {
    setAddItemSlot(slot || null);
    setAddItemOpen(true);
  }, []);

  const openOptimize = useCallback((item: ResolvedItem) => {
    setOptimizeItem(item);
    setOptimizeOpen(true);
  }, []);

  const openUpgradeMenu = useCallback(
    async (item: ResolvedItem, key: string) => {
      if (upgradeMenuFor === key) {
        setUpgradeMenuFor(null);
        return;
      }
      setUpgradeMenuFor(key);
      setLoadingUpgrades(true);
      try {
        const res = await fetch(
          `${API_URL}/api/upgrade-options?bonus_ids=${item.bonus_ids.join(',')}`
        );
        const data = await res.json();
        setUpgradeOptions(data.options || []);
      } catch {
        setUpgradeOptions([]);
      }
      setLoadingUpgrades(false);
    },
    [upgradeMenuFor]
  );

  const convertToCatalyst = useCallback(
    async (item: ResolvedItem) => {
      setUpgradeMenuFor(null);
      try {
        const res = await fetch(`${API_URL}/api/gear/catalyst-convert`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            class_name: resolved.character.class_name,
            slot: item.slot,
            item,
          }),
        });
        if (!res.ok) return;
        const catalystItem: ResolvedItem = await res.json();

        // Add to resolved data (for display only — the backend re-generates
        // catalyst items with is_catalyst: true during combo/sim resolve)
        const updatedSlots = { ...resolved.slots };
        const slotRes = updatedSlots[item.slot];
        if (slotRes) {
          updatedSlots[item.slot] = {
            ...slotRes,
            alternatives: [...slotRes.alternatives, catalystItem],
          };
        }
        onResolvedChange({ ...resolved, slots: updatedSlots });

        // Auto-select the catalyst item
        const updated: Record<string, Set<string>> = {};
        for (const [k, v] of Object.entries(selectedUids)) {
          updated[k] = new Set(v);
        }
        if (!updated[item.slot]) updated[item.slot] = new Set();
        updated[item.slot].add(catalystItem.uid);
        onSelectionChange(updated);
      } catch {
        // silently ignore
      }
    },
    [resolved, onResolvedChange, selectedUids, onSelectionChange]
  );

  const addUpgradedCopy = useCallback(
    (item: ResolvedItem, option: UpgradeOption) => {
      // Find the current upgrade bonus_id to replace
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

      // Upgraded copies are added as bag items (not equipped), so origin must be 'bags'
      // to match the UID the backend generates when parsing the appended simc line.
      const copyOrigin = 'bags';
      const copy: ResolvedItem = {
        ...item,
        origin: copyOrigin as ResolvedItem['origin'],
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

      // Add copy to the resolved data
      const updatedSlots = { ...resolved.slots };
      const slotRes = updatedSlots[item.slot];
      if (slotRes) {
        updatedSlots[item.slot] = {
          ...slotRes,
          alternatives: [...slotRes.alternatives, copy],
        };
      }
      onResolvedChange({ ...resolved, slots: updatedSlots });

      // Notify parent so the simc string gets appended on submit
      onItemAdded(item.slot, newSimcString, item.origin);

      // Auto-select the upgraded copy
      const updated: Record<string, Set<string>> = {};
      for (const [k, v] of Object.entries(selectedUids)) {
        updated[k] = new Set(v);
      }
      if (!updated[item.slot]) updated[item.slot] = new Set();
      updated[item.slot].add(copy.uid);
      onSelectionChange(updated);

      setUpgradeMenuFor(null);
    },
    [resolved, upgradeOptions, onResolvedChange, onItemAdded, selectedUids, onSelectionChange]
  );

  const handleOptimize = useCallback(
    (enchantId: number, gemIds: number[]) => {
      if (!optimizeItem) return;

      const item = optimizeItem;
      const firstGemId = gemIds[0] || 0;

      // 1. Build new SimC string
      let nextSimc = item.simc_string;
      // Replace or Add enchant_id
      if (enchantId > 0) {
        if (nextSimc.includes('enchant_id=')) {
          nextSimc = nextSimc.replace(/enchant_id=[0-9]+/, `enchant_id=${enchantId}`);
        } else {
          nextSimc += `,enchant_id=${enchantId}`;
        }
      } else {
        nextSimc = nextSimc.replace(/,enchant_id=[0-9]+/, '');
      }

      // Replace or Add gem_id
      if (firstGemId > 0) {
        if (nextSimc.includes('gem_id=')) {
          nextSimc = nextSimc.replace(/gem_id=[0-9/:]+/, `gem_id=${firstGemId}`);
        } else {
          nextSimc += `,gem_id=${firstGemId}`;
        }
      } else {
        nextSimc = nextSimc.replace(/,gem_id=[0-9/:]+/, '');
      }

      // 2. Build UID (ensure it matches backend make_uid)
      const uid = makeUid({
        item_id: item.item_id,
        bonus_ids: item.bonus_ids,
        origin: 'bags',
        slot: item.slot,
        enchant_id: enchantId,
        gem_id: firstGemId,
      });

      // 3. Enrich display names (ideally we would fetch from API, but we can do basic update)
      const copy: ResolvedItem = {
        ...item,
        origin: 'bags',
        uid,
        enchant_id: enchantId,
        gem_id: firstGemId,
        simc_string: nextSimc,
        tag: 'Opt',
      };

      // 4. Update resolved data
      const updatedSlots = { ...resolved.slots };
      const slotRes = updatedSlots[item.slot];
      if (slotRes) {
        // Prevent duplicate opts
        if (!slotRes.alternatives.find((a) => a.uid === uid)) {
          updatedSlots[item.slot] = {
            ...slotRes,
            alternatives: [...slotRes.alternatives, copy],
          };
        }
      }
      onResolvedChange({ ...resolved, slots: updatedSlots });

      // 5. Notify parent
      onItemAdded(item.slot, nextSimc, 'bags');

      // 6. Auto-select
      const nextSelected = { ...selectedUids };
      if (!nextSelected[item.slot]) nextSelected[item.slot] = new Set();
      nextSelected[item.slot].add(uid);
      onSelectionChange(nextSelected);

      setOptimizeOpen(false);
    },
    [optimizeItem, resolved, onResolvedChange, onItemAdded, selectedUids, onSelectionChange]
  );

  const handleAddItem = useCallback(
    async (
      item: any,
      difficulty: string,
      overrides?: { bonus_ids: number[]; ilvl: number; track_name: string; level: number }
    ) => {
      // 1. Determine slot
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

      // 2. Resolve bonuses/ilvl
      let bonusIds: number[] = [];
      let ilvl = item.ilevel;
      let quality = item.quality;
      let upgradeStr = '';

      if (overrides) {
        bonusIds = [...overrides.bonus_ids];
        ilvl = overrides.ilvl;
        upgradeStr = `${overrides.track_name} ${overrides.level}`;
      } else {
        const diffInfo = item.difficulty_info?.[difficulty] || item.dungeon_info?.[difficulty];
        bonusIds = diffInfo ? [diffInfo.bonus_id] : [];
        ilvl = diffInfo?.ilvl || item.ilevel;
        quality = diffInfo?.quality || item.quality;
        if (diffInfo?.track) {
          upgradeStr = `${diffInfo.track} ${diffInfo.level}/${diffInfo.max_level || 6}`;
        }
      }

      // Add expansion global bonus IDs (e.g. Midnight Season 1 scaling) if available and missing.
      // This ensures items have the correct stat curves for their item level in simulations.
      const equippedItem = Object.values(resolved.slots).find((s) => s.equipped)?.equipped;
      const globalBonusIds = equippedItem?.bonus_ids.filter((b) => b >= 7000 && b <= 11000) || [];

      // If we're adding a modern item (expansion 11 or 12), ensure it has expansion bonuses.
      if ((item.expansion === 11 || item.expansion === 12) && globalBonusIds.length > 0) {
        globalBonusIds.forEach((gb) => {
          if (!bonusIds.includes(gb)) bonusIds.push(gb);
        });
      } else if (item.expansion === 12 && !bonusIds.some((b) => b >= 8177 && b <= 8182)) {
        // Fallback for Midnight expansion if no global bonuses were found
        bonusIds.push(8177);
      }

      // 3. Construct UID
      const uid = makeUid({
        item_id: item.item_id,
        bonus_ids: bonusIds,
        origin: 'bags',
        slot,
      });

      // 4. Construct ResolvedItem
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
        quality: quality,
        quality_color:
          quality === 5
            ? '#ff8000'
            : quality === 4
              ? '#a335ee'
              : quality === 3
                ? '#0070dd'
                : '#1eff00',
        tag: 'Bags',
        upgrade: upgradeStr,
        sockets: 0,
        enchant_name: '',
        gem_name: '',
        gem_icon: '',
      };

      // 5. Update resolved state
      const nextResolved = { ...resolved };
      slots.forEach((s) => {
        const targetSlot = nextResolved.slots[s];
        if (targetSlot) {
          // Check if already exists (match by item_id and bonus_ids)
          const exists =
            targetSlot.equipped &&
            targetSlot.equipped.item_id === item.item_id &&
            JSON.stringify([...targetSlot.equipped.bonus_ids].sort()) ===
              JSON.stringify(bonusIds.sort());

          if (!exists && !targetSlot.alternatives.find((a) => a.uid === uid)) {
            // For secondary slots, we need a unique UID if we want it in both
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
        }
      });

      onResolvedChange(nextResolved);

      // 6. Select it for all applicable slots
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

      // 7. Persist to SimC
      onItemAdded(slot, newItem.simc_string, 'bags');

      setAddItemOpen(false);
    },
    [resolved, selectedUids, onResolvedChange, onSelectionChange, onItemAdded]
  );

  function toggleItem(item: ResolvedItem, group: DisplayGroup) {
    applyToggle(item, group, {
      ...Object.fromEntries(Object.entries(selectedUids).map(([k, v]) => [k, new Set(v)])),
    });
  }

  function applyToggle(
    item: ResolvedItem,
    group: DisplayGroup,
    updated: Record<string, Set<string>>
  ) {
    if (group.slots.length === 1) {
      const slot = item.slot;
      if (!updated[slot]) updated[slot] = new Set();
      if (updated[slot].has(item.uid)) {
        updated[slot].delete(item.uid);
      } else {
        updated[slot].add(item.uid);
      }
    } else {
      // Paired slots (rings/trinkets): toggle in all slots where this item appears
      const isSelected = isItemSelected(item, group);
      for (const slot of group.slots) {
        const slotRes = resolved.slots[slot];
        if (!slotRes) continue;
        const matching = slotRes.alternatives.find((a) => a.uid === item.uid);
        if (!matching) continue;
        if (!updated[slot]) updated[slot] = new Set();
        if (isSelected) {
          updated[slot].delete(matching.uid);
        } else {
          updated[slot].add(matching.uid);
        }
      }
    }
    onSelectionChange(updated);
  }

  function isItemSelected(item: ResolvedItem, group: DisplayGroup): boolean {
    if (group.slots.length === 1) {
      return selectedUids[item.slot]?.has(item.uid) ?? false;
    }
    return group.slots.some((slot) => {
      const slotRes = resolved.slots[slot];
      if (!slotRes) return false;
      const matching = slotRes.alternatives.find((a) => a.uid === item.uid);
      return matching ? (selectedUids[slot]?.has(matching.uid) ?? false) : false;
    });
  }

  // Build visible groups from resolved data
  const visibleGroups = useMemo(() => {
    const result: {
      group: DisplayGroup;
      equipped: ResolvedItem[];
      alternatives: ResolvedItem[];
    }[] = [];
    for (const group of DISPLAY_GROUPS) {
      const equipped: ResolvedItem[] = [];
      const alternatives: ResolvedItem[] = [];
      const seenAltKeys = new Set<string>();

      for (const slot of group.slots) {
        const slotRes = resolved.slots[slot];
        if (!slotRes) continue;
        if (slotRes.equipped) equipped.push(slotRes.equipped);
        for (const alt of slotRes.alternatives) {
          const key = makeUid(alt);
          if (seenAltKeys.has(key)) continue;
          seenAltKeys.add(key);
          alternatives.push(alt);
        }
      }

      if (equipped.length > 0 || alternatives.length > 0) {
        equipped.sort((a, b) => b.ilevel - a.ilevel);
        alternatives.sort((a, b) => b.ilevel - a.ilevel);
        result.push({ group, equipped, alternatives });
      }
    }
    return result;
  }, [resolved]);

  function itemDetails(item: ResolvedItem): { text: string; color?: string }[] {
    const parts: { text: string; color?: string }[] = [];
    if (item.origin === 'vault') parts.push({ text: 'Great Vault', color: 'text-amber-400/80' });
    if (item.is_catalyst) parts.push({ text: 'Catalyst', color: 'text-purple-400/80' });
    if (item.tag) parts.push({ text: item.tag });
    if (item.upgrade) parts.push({ text: item.upgrade });
    if (item.gem_name) {
      parts.push({ text: item.gem_name, color: 'text-sky-400/70' });
    } else if (item.sockets > 0) {
      parts.push({
        text: `${item.sockets > 1 ? item.sockets + ' ' : ''}Socket${item.sockets > 1 ? 's' : ''}`,
        color: 'text-sky-400/70',
      });
    }
    if (item.enchant_name) parts.push({ text: item.enchant_name, color: 'text-emerald-400/70' });
    return parts;
  }

  // Collect vault and catalyst UIDs for quick-select
  const { vaultUids, catalystUids } = useMemo(() => {
    const vault: { uid: string; slot: string }[] = [];
    const catalyst: { uid: string; slot: string }[] = [];
    for (const slotRes of Object.values(resolved.slots)) {
      for (const alt of slotRes.alternatives) {
        if (alt.origin === 'vault') vault.push({ uid: alt.uid, slot: alt.slot });
        if (alt.is_catalyst) catalyst.push({ uid: alt.uid, slot: alt.slot });
      }
    }
    return { vaultUids: vault, catalystUids: catalyst };
  }, [resolved]);

  if (visibleGroups.length === 0) {
    return (
      <div className="card p-8 text-center">
        <p className="text-sm text-muted">
          No alternative items found. Make sure your SimC addon exports bag items.
        </p>
      </div>
    );
  }

  function toggleGroup(items: { uid: string; slot: string }[]) {
    const allSelected = items.length > 0 && items.every((c) => selectedUids[c.slot]?.has(c.uid));
    const updated: Record<string, Set<string>> = {};
    for (const [k, v] of Object.entries(selectedUids)) {
      updated[k] = new Set(v);
    }
    for (const c of items) {
      if (!updated[c.slot]) updated[c.slot] = new Set();
      if (allSelected) {
        updated[c.slot].delete(c.uid);
      } else {
        updated[c.slot].add(c.uid);
      }
    }
    onSelectionChange(updated);
  }

  function deselectAll() {
    onSelectionChange({});
  }

  const comboLabel = `${comboCount.toLocaleString()} combo${comboCount !== 1 ? 's' : ''}`;
  const comboColorClass =
    comboCount > effectiveMaxCombinations
      ? 'bg-red-500/10 text-red-400'
      : comboCount > 0
        ? 'bg-surface-2 text-white'
        : 'bg-surface-2 text-muted';

  const hasSelection = Object.values(selectedUids).some((s) => s.size > 0);
  const allVaultSelected =
    vaultUids.length > 0 && vaultUids.every((c) => selectedUids[c.slot]?.has(c.uid));
  const allCatalystSelected =
    catalystUids.length > 0 && catalystUids.every((c) => selectedUids[c.slot]?.has(c.uid));

  const quickSelectBar = (
    <div className="flex items-center gap-1.5">
      {vaultUids.length > 0 && (
        <button
          type="button"
          onClick={() => toggleGroup(vaultUids)}
          className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
            allVaultSelected
              ? 'bg-amber-400/15 text-amber-300'
              : 'text-amber-400/60 hover:bg-amber-400/10 hover:text-amber-300'
          }`}
        >
          Vault
        </button>
      )}
      {catalystUids.length > 0 && (
        <button
          type="button"
          onClick={() => toggleGroup(catalystUids)}
          className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
            allCatalystSelected
              ? 'bg-purple-400/15 text-purple-300'
              : 'text-purple-400/60 hover:bg-purple-400/10 hover:text-purple-300'
          }`}
        >
          Catalyst
        </button>
      )}
      {hasSelection && (
        <button
          type="button"
          onClick={deselectAll}
          className="rounded-md px-2 py-1 text-[11px] font-medium text-gray-500 transition-colors hover:bg-white/[0.04] hover:text-gray-300"
        >
          Clear
        </button>
      )}
      <span className={`rounded-md px-2.5 py-1 font-mono text-xs ${comboColorClass}`}>
        {comboLabel}
      </span>
    </div>
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

      {/* Sticky Header */}
      {!headerVisible && (
        <div className="fixed left-0 right-0 top-12 z-50 flex items-center justify-between border-b border-border/50 bg-surface/90 px-4 py-2 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <p className="text-xs font-medium uppercase tracking-widest text-muted">Select Items</p>
            <button
              onClick={() => openAddItem()}
              className="flex items-center gap-1.5 rounded-md bg-gold/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-gold transition-all hover:bg-gold/20"
            >
              <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"
                  clipRule="evenodd"
                />
              </svg>
              Add Item
            </button>
          </div>
          {quickSelectBar}
        </div>
      )}

      {/* Main Header */}
      <div ref={headerRef} className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <p className="text-xs font-medium uppercase tracking-widest text-muted">Select Items</p>
          <button
            onClick={() => openAddItem()}
            className="flex items-center gap-1.5 rounded-md bg-gold/10 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-gold transition-all hover:bg-gold/20"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"
                clipRule="evenodd"
              />
            </svg>
            Add Item
          </button>
        </div>
        {quickSelectBar}
      </div>

      {/* Item Grid */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {visibleGroups.map(({ group, equipped, alternatives }) => (
          <div key={group.label} className="card space-y-1 p-3.5">
            <div className="flex items-center gap-2">
              <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted">
                {group.label}
              </h2>
              <button
                onClick={() => openAddItem(group.slots[0])}
                className="flex h-5 w-5 items-center justify-center rounded-full bg-white/5 text-muted transition-colors hover:bg-gold/10 hover:text-gold"
                title={`Add ${group.label.toLowerCase()}`}
              >
                <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                  <path
                    fillRule="evenodd"
                    d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            </div>

            {equipped.map((item, eqIdx) => (
              <GearItemRow
                key={`eq-${eqIdx}`}
                icon={item.icon}
                name={item.name}
                nameColor={item.quality_color}
                details={itemDetails(item)}
                ilevel={item.ilevel}
                equipped
                href={item.item_id > 0 ? getWowheadUrl(item.item_id) : undefined}
                wowheadData={item.item_id > 0 ? getWowheadData(item) : undefined}
                optimized={item.enchant_id > 0 || item.gem_id > 0}
              >
                <UpgradeButton
                  item={item}
                  upgradeMenuFor={upgradeMenuFor}
                  upgradeOptions={upgradeOptions}
                  loadingUpgrades={loadingUpgrades}
                  onUpgradeClick={() => openUpgradeMenu(item, item.uid)}
                  onUpgradeSelect={(opt) => addUpgradedCopy(item, opt)}
                  onCatalystConvert={item.can_catalyst ? () => convertToCatalyst(item) : undefined}
                  onOptimize={() => openOptimize(item)}
                />
              </GearItemRow>
            ))}

            {equipped.length > 0 && alternatives.length > 0 && (
              <div className="!my-1.5 border-t border-border/50" />
            )}

            {alternatives.map((item, altIdx) => (
              <GearItemRow
                key={`alt-${altIdx}`}
                icon={item.icon}
                name={item.name}
                nameColor={item.quality_color}
                details={itemDetails(item)}
                ilevel={item.ilevel}
                selectable
                checked={isItemSelected(item, group)}
                onToggle={() => toggleItem(item, group)}
                vault={item.origin === 'vault'}
                catalyst={item.is_catalyst}
                href={item.item_id > 0 ? getWowheadUrl(item.item_id) : undefined}
                wowheadData={item.item_id > 0 ? getWowheadData(item) : undefined}
                optimized={item.enchant_id > 0 || item.gem_id > 0}
              >
                <UpgradeButton
                  item={item}
                  upgradeMenuFor={upgradeMenuFor}
                  upgradeOptions={upgradeOptions}
                  loadingUpgrades={loadingUpgrades}
                  onUpgradeClick={() => openUpgradeMenu(item, item.uid)}
                  onUpgradeSelect={(opt) => addUpgradedCopy(item, opt)}
                  onCatalystConvert={item.can_catalyst ? () => convertToCatalyst(item) : undefined}
                />
              </GearItemRow>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function UpgradeButton({
  item,
  upgradeMenuFor,
  upgradeOptions,
  loadingUpgrades,
  onUpgradeClick,
  onUpgradeSelect,
  onCatalystConvert,
  onOptimize,
}: {
  item: ResolvedItem;
  upgradeMenuFor: string | null;
  upgradeOptions: UpgradeOption[];
  loadingUpgrades: boolean;
  onUpgradeClick: () => void;
  onUpgradeSelect: (opt: UpgradeOption) => void;
  onCatalystConvert?: () => void;
  onOptimize?: () => void;
}) {
  if (!item.upgrade && !onCatalystConvert) return null;
  const isMenuOpen = upgradeMenuFor === item.uid;

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          onUpgradeClick();
        }}
        className={`flex h-5 w-5 items-center justify-center rounded transition-colors ${
          isMenuOpen
            ? 'bg-gold/20 text-gold'
            : 'text-gray-600 hover:bg-white/[0.05] hover:text-gray-400'
        }`}
        title="Add copy at different upgrade level"
      >
        <svg
          className="h-3 w-3"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <path d="M8 12V4M5 7l3-3 3 3" />
        </svg>
      </button>

      {onOptimize && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onOptimize();
          }}
          className="flex h-5 w-5 items-center justify-center rounded text-gray-600 transition-colors hover:bg-white/[0.05] hover:text-gold"
          title="Optimize Gems/Enchants"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 1a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0v-1.5A.75.75 0 018 1zm3.536 2.22a.75.75 0 011.06 0l1.061 1.06a.75.75 0 01-1.06 1.061l-1.061-1.06a.75.75 0 010-1.06zM15 8a.75.75 0 01-.75.75h-1.5a.75.75 0 010-1.5h1.5A.75.75 0 0115 8zm-2.22 3.536a.75.75 0 010 1.06l-1.06 1.061a.75.75 0 11-1.061-1.06l1.06-1.061a.75.75 0 011.061 0zM8 15a.75.75 0 01-.75-.75v-1.5a.75.75 0 011.5 0v1.5A.75.75 0 018 15zm-3.536-2.22a.75.75 0 01-1.06 0l-1.061-1.06a.75.75 0 011.06-1.061l1.061 1.06a.75.75 0 010 1.06zM1 8a.75.75 0 01.75-.75h1.5a.75.75 0 010 1.5h-1.5A.75.75 0 011 8zm2.22-3.536a.75.75 0 010-1.06l1.06-1.061a.75.75 0 011.061 1.06l-1.06 1.061a.75.75 0 01-1.061 0z" />
          </svg>
        </button>
      )}

      {isMenuOpen && (
        <div className="absolute right-0 top-full z-50 mt-1 min-w-[180px] rounded-lg border border-border bg-surface py-1 shadow-xl">
          {onCatalystConvert && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onCatalystConvert();
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-purple-300 hover:bg-purple-500/10 hover:text-purple-200"
            >
              <svg className="h-3 w-3 shrink-0" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 1a1 1 0 011 1v2.07A5.001 5.001 0 0113 9a5 5 0 01-10 0 5.001 5.001 0 014-4.93V2a1 1 0 011-1zm0 5a3 3 0 100 6 3 3 0 000-6z" />
              </svg>
              Convert to Catalyst
            </button>
          )}
          {onCatalystConvert && item.upgrade && <div className="my-1 border-t border-border/50" />}
          {item.upgrade && (
            <>
              {loadingUpgrades ? (
                <div className="px-3 py-2 text-[13px] text-muted">Loading...</div>
              ) : upgradeOptions.length === 0 ? (
                <div className="px-3 py-2 text-[13px] text-muted">No options</div>
              ) : (
                upgradeOptions.map((opt) => {
                  const isCurrent = item.bonus_ids.includes(opt.bonus_id);
                  return (
                    <button
                      key={opt.bonus_id}
                      type="button"
                      disabled={isCurrent}
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        onUpgradeSelect(opt);
                      }}
                      className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-[13px] ${
                        isCurrent
                          ? 'cursor-default text-muted'
                          : 'text-gray-300 hover:bg-white/[0.05] hover:text-white'
                      }`}
                    >
                      <span>{opt.fullName}</span>
                      <span className="font-mono text-[12px] tabular-nums text-muted">
                        {opt.itemLevel}
                      </span>
                    </button>
                  );
                })
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
