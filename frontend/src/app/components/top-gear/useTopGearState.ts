import { useCallback, useState, useMemo } from 'react';
import { API_URL } from '../../lib/api';
import type { ResolveGearResponse, ResolvedItem } from '../../lib/types';

interface UpgradeOption {
  bonus_id: number;
  level: number;
  max: number;
  name: string;
  fullName: string;
  itemLevel: number;
}

interface TopGearStateProps {
  resolved: ResolveGearResponse;
  selectedUids: Record<string, Set<string>>;
  onSelectionChange: (selected: Record<string, Set<string>>) => void;
  onResolvedChange: (resolved: ResolveGearResponse) => void;
  onItemAdded: (slot: string, simcString: string, origin: string) => void;
}

export function useTopGearState({
  resolved,
  selectedUids,
  onSelectionChange,
  onResolvedChange,
  onItemAdded,
}: TopGearStateProps) {
  const [upgradeMenuFor, setUpgradeMenuFor] = useState<string | null>(null);
  const [upgradeOptions, setUpgradeOptions] = useState<UpgradeOption[]>([]);
  const [loadingUpgrades, setLoadingUpgrades] = useState(false);
  const [isAddItemOpen, setAddItemOpen] = useState(false);
  const [addItemSlot, setAddItemSlot] = useState<string | null>(null);
  const [isOptimizeOpen, setOptimizeOpen] = useState(false);
  const [optimizeItem, setOptimizeItem] = useState<ResolvedItem | null>(null);

  const openAddItem = useCallback((slot?: string) => {
    setAddItemSlot(slot || null);
    setAddItemOpen(true);
  }, []);

  const openOptimize = useCallback((item: ResolvedItem) => {
    setOptimizeItem(item);
    setOptimizeOpen(true);
  }, []);

  const openUpgradeMenu = useCallback(
    async (item: ResolvedItem) => {
      if (upgradeMenuFor === item.uid) {
        setUpgradeMenuFor(null);
        return;
      }
      setUpgradeMenuFor(item.uid);
      setLoadingUpgrades(true);
      try {
        const res = await fetch(`${API_URL}/api/upgrade-options?bonus_ids=${item.bonus_ids.join(',')}`);
        const data = await res.json();
        setUpgradeOptions(data.options || []);
      } catch {
        setUpgradeOptions([]);
      }
      setLoadingUpgrades(false);
    },
    [upgradeMenuFor]
  );

  const deselectAll = useCallback(() => onSelectionChange({}), [onSelectionChange]);

  const toggleGroup = useCallback((items: { uid: string; slot: string }[]) => {
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
    },
    [selectedUids, onSelectionChange]
  );

  const toggleItem = useCallback((item: ResolvedItem, slots: string[]) => {
      const updated = { ...Object.fromEntries(Object.entries(selectedUids).map(([k, v]) => [k, new Set(v)])) };
      
      if (slots.length === 1) {
        const slot = item.slot;
        if (!updated[slot]) updated[slot] = new Set();
        if (updated[slot].has(item.uid)) {
          updated[slot].delete(item.uid);
        } else {
          updated[slot].add(item.uid);
        }
      } else {
        // Paired slots
        const isSelected = slots.some(s => {
            const slotRes = resolved.slots[s];
            if (!slotRes) return false;
            const matching = slotRes.alternatives.find(a => a.uid === item.uid);
            return matching ? selectedUids[s]?.has(matching.uid) : false;
        });

        for (const slot of slots) {
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
    },
    [selectedUids, resolved.slots, onSelectionChange]
  );

  return {
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
  };
}
