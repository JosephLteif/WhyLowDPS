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

interface UpgradeOptionApi {
  bonus_id?: number;
  level?: number;
  max?: number;
  max_level?: number;
  name?: string;
  fullName?: string;
  itemLevel?: number;
  ilevel?: number;
}

interface TopGearStateProps {
  resolved: ResolveGearResponse;
  selectedUids: Record<string, Set<string>>;
  onSelectionChange: (selected: Record<string, Set<string>>) => void;
  onResolvedChange: (resolved: ResolveGearResponse) => void;
  onItemAdded: (slot: string, simcString: string, origin: string) => void;
}

function makeIdentity(item: ResolvedItem): string {
  const sorted = [...item.bonus_ids].sort((a, b) => a - b);
  return `${item.item_id}:${sorted.join(':')}:${item.origin}:i${item.ilevel || 0}:e${item.enchant_id || 0}:g${item.gem_id || 0}`;
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

  const normalizeUpgradeOption = useCallback((opt: UpgradeOptionApi): UpgradeOption | null => {
    const bonusId = Number(opt.bonus_id ?? 0);
    if (!Number.isFinite(bonusId) || bonusId <= 0) return null;

    const level = Number(opt.level ?? 0);
    const max = Number(opt.max ?? opt.max_level ?? 0);
    const itemLevel = Number(opt.itemLevel ?? opt.ilevel ?? 0);
    const fullName = String(opt.fullName || opt.name || '').trim();

    return {
      bonus_id: bonusId,
      level: Number.isFinite(level) ? level : 0,
      max: Number.isFinite(max) ? max : 0,
      name: String(opt.name || fullName || '').trim(),
      fullName,
      itemLevel: Number.isFinite(itemLevel) ? itemLevel : 0,
    };
  }, []);

  const loadUpgradeOptions = useCallback(
    async (item: ResolvedItem) => {
      setLoadingUpgrades(true);
      try {
        const res = await fetch(
          `${API_URL}/api/upgrade-options?bonus_ids=${item.bonus_ids.join(',')}`,
          { credentials: 'include' }
        );
        const data = await res.json();
        const rawOptions: UpgradeOptionApi[] = Array.isArray(data?.options) ? data.options : [];
        const normalizedOptions = rawOptions
          .map(normalizeUpgradeOption)
          .filter((opt): opt is UpgradeOption => opt !== null);
        setUpgradeOptions(normalizedOptions);
      } catch {
        setUpgradeOptions([]);
      }
      setLoadingUpgrades(false);
    },
    [normalizeUpgradeOption]
  );

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
      await loadUpgradeOptions(item);
    },
    [loadUpgradeOptions, upgradeMenuFor]
  );

  const deselectAll = useCallback(() => onSelectionChange({}), [onSelectionChange]);

  const selectAll = useCallback(() => {
    const updated: Record<string, Set<string>> = {};
    for (const [slot, slotRes] of Object.entries(resolved.slots)) {
      updated[slot] = new Set();
      if (slotRes.equipped) {
        updated[slot].add(slotRes.equipped.uid);
      }
      for (const alt of slotRes.alternatives) {
        updated[slot].add(alt.uid);
      }
    }
    onSelectionChange(updated);
  }, [resolved.slots, onSelectionChange]);

  const toggleSlotAll = useCallback(
    (slots: string[]) => {
      const allSelected = slots.every((slot) => {
        const slotRes = resolved.slots[slot];
        if (!slotRes) return true;
        const total = (slotRes.equipped ? 1 : 0) + slotRes.alternatives.length;
        if (total === 0) return true;
        return selectedUids[slot]?.size === total;
      });

      const updated = {
        ...Object.fromEntries(Object.entries(selectedUids).map(([k, v]) => [k, new Set(v)])),
      };

      for (const slot of slots) {
        const slotRes = resolved.slots[slot];
        if (!slotRes) continue;
        if (allSelected) {
          updated[slot] = new Set();
        } else {
          updated[slot] = new Set();
          if (slotRes.equipped) updated[slot].add(slotRes.equipped.uid);
          for (const alt of slotRes.alternatives) {
            updated[slot].add(alt.uid);
          }
        }
      }
      onSelectionChange(updated);
    },
    [resolved.slots, selectedUids, onSelectionChange]
  );

  const toggleGroup = useCallback(
    (items: { uid: string; slot: string }[]) => {
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

  const toggleItem = useCallback(
    (item: ResolvedItem, slots: string[]) => {
      const updated = {
        ...Object.fromEntries(Object.entries(selectedUids).map(([k, v]) => [k, new Set(v)])),
      };

      const identity = makeIdentity(item);

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
        const isSelected = slots.some((s) => {
          const slotRes = resolved.slots[s];
          if (!slotRes) return false;
          return Array.from(selectedUids[s] || []).some((uid) => {
            const match = slotRes.alternatives.find((a) => a.uid === uid);
            return match && makeIdentity(match) === identity;
          });
        });

        for (const slot of slots) {
          const slotRes = resolved.slots[slot];
          if (!slotRes) continue;
          const matching = slotRes.alternatives.find((a) => makeIdentity(a) === identity);
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
    loadUpgradeOptions,
    deselectAll,
    selectAll,
    toggleSlotAll,
    toggleGroup,
    toggleItem,
  };
}
