import { useEffect, useState } from 'react';
import { API_URL, fetchJsonCached } from './api';

export interface ItemQuery {
  item_id: number;
  bonus_ids?: number[];
}

export interface ItemInfo {
  item_id: number;
  name: string;
  quality: number;
  quality_name: string;
  icon: string;
  ilevel: number;
  tag?: string;
  sockets?: number;
  upgrade?: string;
  armor_subclass?: number; // 0=Misc, 1=Cloth, 2=Leather, 3=Mail, 4=Plate
  inventory_type?: number; // 13=One-hand, 14=Shield, 17=Two-hand, 21=Main-hand, 22=Off-hand, 23=Held
  extra_effects?: string[];
}

// Module-level cache so it persists across renders/components
const cache: Record<string, ItemInfo> = {};

function cacheKey(item_id: number, bonus_ids?: number[]): string {
  if (!bonus_ids || bonus_ids.length === 0) return String(item_id);
  return `${item_id}:${[...bonus_ids].sort((a, b) => a - b).join(':')}`;
}

export const QUALITY_COLORS: Record<number, string> = {
  0: '#9d9d9d', // Poor
  1: '#ffffff', // Common
  2: '#1eff00', // Uncommon
  3: '#0070dd', // Rare
  4: '#a335ee', // Epic
  5: '#ff8000', // Legendary
  6: '#e6cc80', // Artifact
  7: '#00ccff', // Heirloom
};

export function useItemInfo(queries: ItemQuery[]): Record<number, ItemInfo> {
  const [items, setItems] = useState<Record<number, ItemInfo>>({});

  // Stable dependency key
  const depKey = queries
    .filter((q) => q.item_id > 0)
    .map((q) => cacheKey(q.item_id, q.bonus_ids))
    .join(',');

  useEffect(() => {
    const unique = new Map<string, ItemQuery>();
    for (const q of queries) {
      if (q.item_id <= 0) continue;
      const key = cacheKey(q.item_id, q.bonus_ids);
      if (!unique.has(key)) unique.set(key, q);
    }
    if (unique.size === 0) return;

    // Return cached immediately
    const cached: Record<number, ItemInfo> = {};
    const toFetch: ItemQuery[] = [];
    for (const [key, q] of unique) {
      if (cache[key]) {
        cached[q.item_id] = cache[key];
      } else {
        toFetch.push(q);
      }
    }

    if (Object.keys(cached).length > 0) {
      setItems((prev) => ({ ...prev, ...cached }));
    }

    if (toFetch.length === 0) return;

    let cancelled = false;

    // Fetch each item individually so results appear as they arrive
    for (const q of toFetch) {
      (async () => {
        try {
          const params = new URLSearchParams();
          if (q.bonus_ids && q.bonus_ids.length > 0) {
            params.set('bonus_ids', q.bonus_ids.join(','));
          }
          const url = `${API_URL}/api/item-info/${q.item_id}?${params}`;
          const info = await fetchJsonCached<ItemInfo>(url, {
            usePersistentCache: true,
            ttl: 86400000, // 24 hours
          });
          if (cancelled) return;

          const key = cacheKey(q.item_id, q.bonus_ids);
          cache[key] = info;
          setItems((prev) => ({ ...prev, [q.item_id]: info }));
        } catch {
          // Silently fail
        }
      })();
    }

    return () => {
      cancelled = true;
    };
  }, [depKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return items;
}

export interface EnchantInfo {
  enchant_id: number;
  name: string;
  icon?: string;
  item_id?: number;
  quality?: number;
}

export interface EmbellishmentOption {
  item_id: number;
  name: string;
  icon?: string;
  bonus_ids: number[];
}

const enchantCache: Record<number, EnchantInfo> = {};
const enchantAvailabilityCache: Record<string, boolean> = {};
const embellishmentOptionsCache: Record<number, EmbellishmentOption[]> = {};

function normalizeEnchantQuerySlot(slot: string): string {
  if (slot === 'finger1' || slot === 'finger2') return 'finger';
  if (slot === 'trinket1' || slot === 'trinket2') return 'trinket';
  return slot;
}

function normalizeClassName(className?: string | null): string {
  return String(className || '').trim().toLowerCase();
}

export function enchantAvailabilityKey(slot: string, className?: string | null): string {
  return `${String(slot || '').trim().toLowerCase()}|${normalizeClassName(className)}`;
}

export function enchantAvailabilityItemKey(
  slot: string,
  className?: string | null,
  itemId?: number,
  bonusIds?: number[],
  seasonId?: number,
  specName?: string | null
): string {
  const normalizedBonusIds = Array.isArray(bonusIds)
    ? [...bonusIds].filter((id) => id > 0).sort((a, b) => a - b).join(':')
    : '';
  const resolvedSeasonId = Number.isFinite(seasonId) ? Number(seasonId) : 0;
  const resolvedItemId = Number.isFinite(itemId) ? Number(itemId) : 0;
  const normalizedSpecName = String(specName || '').trim().toLowerCase();
  return `${enchantAvailabilityKey(slot, className)}|${resolvedItemId}|${normalizedBonusIds}|${resolvedSeasonId}|${normalizedSpecName}`;
}

export function useEnchantInfo(enchantIds: number[]): Record<number, EnchantInfo> {
  const [enchants, setEnchants] = useState<Record<number, EnchantInfo>>({});

  const depKey = enchantIds
    .filter((id) => id > 0)
    .sort()
    .join(',');

  useEffect(() => {
    const unique = new Set(enchantIds.filter((id) => id > 0));
    if (unique.size === 0) return;

    const cached: Record<number, EnchantInfo> = {};
    const toFetch: number[] = [];
    for (const id of unique) {
      if (enchantCache[id]) {
        cached[id] = enchantCache[id];
      } else {
        toFetch.push(id);
      }
    }

    if (Object.keys(cached).length > 0) {
      setEnchants((prev) => ({ ...prev, ...cached }));
    }

    if (toFetch.length === 0) return;

    let cancelled = false;

    for (const id of toFetch) {
      (async () => {
        try {
          const info = await fetchJsonCached<EnchantInfo>(`${API_URL}/api/enchant-info/${id}`, {
            usePersistentCache: true,
            ttl: 86400000,
          });
          if (cancelled || !info.name) return;
          enchantCache[id] = info;
          setEnchants((prev) => ({ ...prev, [id]: info }));
        } catch {
          // Silently fail
        }
      })();
    }

    return () => {
      cancelled = true;
    };
  }, [depKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return enchants;
}

export function useEnchantAvailability(
  queries: Array<{
    slot: string;
    className?: string | null;
    itemId?: number;
    bonusIds?: number[];
    seasonId?: number;
    specName?: string | null;
  }>
): Record<string, boolean> {
  const [availability, setAvailability] = useState<Record<string, boolean>>({});

  const depKey = queries
    .map(({ slot, className, itemId, bonusIds, seasonId, specName }) =>
      enchantAvailabilityItemKey(slot, className, itemId, bonusIds, seasonId, specName)
    )
    .filter((key) => key.split('|')[0].length > 0)
    .sort()
    .join(',');

  useEffect(() => {
    const unique = new Map<
      string,
      {
        slot: string;
        className?: string | null;
        itemId?: number;
        bonusIds?: number[];
        seasonId?: number;
        specName?: string | null;
      }
    >();
    for (const query of queries) {
      const slot = String(query.slot || '').trim().toLowerCase();
      if (!slot) continue;
      const key = enchantAvailabilityItemKey(
        slot,
        query.className,
        query.itemId,
        query.bonusIds,
        query.seasonId,
        query.specName
      );
      if (!unique.has(key))
        unique.set(key, {
          slot,
          className: query.className,
          itemId: query.itemId,
          bonusIds: query.bonusIds,
          seasonId: query.seasonId,
          specName: query.specName,
        });
    }
    if (unique.size === 0) return;

    const cached: Record<string, boolean> = {};
    const toFetch: Array<{
      key: string;
      slot: string;
      className?: string | null;
      itemId?: number;
      bonusIds?: number[];
      seasonId?: number;
      specName?: string | null;
    }> = [];
    for (const [key, query] of unique) {
      if (Object.prototype.hasOwnProperty.call(enchantAvailabilityCache, key)) {
        cached[key] = enchantAvailabilityCache[key];
      } else {
        toFetch.push({
          key,
          slot: query.slot,
          className: query.className,
          itemId: query.itemId,
          bonusIds: query.bonusIds,
          seasonId: query.seasonId,
          specName: query.specName,
        });
      }
    }

    if (Object.keys(cached).length > 0) {
      setAvailability((prev) => ({ ...prev, ...cached }));
    }

    if (toFetch.length === 0) return;

    let cancelled = false;

    for (const { key, slot, className, itemId, bonusIds, seasonId, specName } of toFetch) {
      (async () => {
        try {
          const params = new URLSearchParams();
          params.set('slot', normalizeEnchantQuerySlot(slot));
          const normalizedClass = normalizeClassName(className);
          if (normalizedClass) params.set('class_name', normalizedClass);
          if (specName) params.set('spec', specName);
          if (Number.isFinite(itemId) && Number(itemId) > 0) {
            params.set('item_id', String(Number(itemId)));
          }
          if (Array.isArray(bonusIds) && bonusIds.length > 0) {
            params.set(
              'bonus_ids',
              bonusIds
                .filter((id) => id > 0)
                .map((id) => String(id))
                .join(',')
            );
          }
          if (Number.isFinite(seasonId) && Number(seasonId) > 0) {
            params.set('season_id', String(Number(seasonId)));
          }
          const options = await fetchJsonCached<unknown[]>(
            `${API_URL}/api/gear/enchant-options?${params.toString()}`,
            {
              usePersistentCache: true,
              ttl: 86400000,
            }
          );
          if (cancelled) return;
          const hasOptions = Array.isArray(options) && options.length > 0;
          enchantAvailabilityCache[key] = hasOptions;
          setAvailability((prev) => ({ ...prev, [key]: hasOptions }));
        } catch {
          if (cancelled) return;
          enchantAvailabilityCache[key] = false;
          setAvailability((prev) => ({ ...prev, [key]: false }));
        }
      })();
    }

    return () => {
      cancelled = true;
    };
  }, [depKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return availability;
}

export interface GemInfo {
  gem_id: number;
  name: string;
  icon: string;
  quality: number;
}

const gemCache: Record<number, GemInfo> = {};

export function useGemInfo(gemIds: number[]): Record<number, GemInfo> {
  const [gems, setGems] = useState<Record<number, GemInfo>>({});

  const depKey = gemIds
    .filter((id) => id > 0)
    .sort()
    .join(',');

  useEffect(() => {
    const unique = new Set(gemIds.filter((id) => id > 0));
    if (unique.size === 0) return;

    const cached: Record<number, GemInfo> = {};
    const toFetch: number[] = [];
    for (const id of unique) {
      if (gemCache[id]) {
        cached[id] = gemCache[id];
      } else {
        toFetch.push(id);
      }
    }

    if (Object.keys(cached).length > 0) {
      setGems((prev) => ({ ...prev, ...cached }));
    }

    if (toFetch.length === 0) return;

    let cancelled = false;

    for (const id of toFetch) {
      (async () => {
        try {
          const info = await fetchJsonCached<GemInfo>(`${API_URL}/api/gem-info/${id}`, {
            usePersistentCache: true,
            ttl: 86400000,
          });
          if (cancelled || !info.name) return;
          gemCache[id] = info;
          setGems((prev) => ({ ...prev, [id]: info }));
        } catch {
          // Silently fail
        }
      })();
    }

    return () => {
      cancelled = true;
    };
  }, [depKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return gems;
}

export function useEmbellishmentOptions(
  itemIds: number[]
): Record<number, EmbellishmentOption[]> {
  const [optionsByItemId, setOptionsByItemId] = useState<Record<number, EmbellishmentOption[]>>(
    {}
  );

  const depKey = itemIds
    .filter((id) => id > 0)
    .sort((a, b) => a - b)
    .join(',');

  useEffect(() => {
    const unique = [...new Set(itemIds.filter((id) => id > 0))];
    if (unique.length === 0) return;

    const cached: Record<number, EmbellishmentOption[]> = {};
    const toFetch: number[] = [];
    for (const itemId of unique) {
      if (Object.prototype.hasOwnProperty.call(embellishmentOptionsCache, itemId)) {
        cached[itemId] = embellishmentOptionsCache[itemId];
      } else {
        toFetch.push(itemId);
      }
    }

    if (Object.keys(cached).length > 0) {
      setOptionsByItemId((prev) => ({ ...prev, ...cached }));
    }

    if (toFetch.length === 0) return;

    let cancelled = false;

    for (const itemId of toFetch) {
      (async () => {
        try {
          const options = await fetchJsonCached<EmbellishmentOption[]>(
            `${API_URL}/api/gear/embellishment-options?item_id=${encodeURIComponent(String(itemId))}`,
            {
              usePersistentCache: true,
              ttl: 86400000,
            }
          );
          if (cancelled) return;
          embellishmentOptionsCache[itemId] = Array.isArray(options) ? options : [];
          setOptionsByItemId((prev) => ({
            ...prev,
            [itemId]: embellishmentOptionsCache[itemId],
          }));
        } catch {
          if (cancelled) return;
          embellishmentOptionsCache[itemId] = [];
          setOptionsByItemId((prev) => ({ ...prev, [itemId]: [] }));
        }
      })();
    }

    return () => {
      cancelled = true;
    };
  }, [depKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return optionsByItemId;
}

export function getIconUrl(iconName: string): string {
  const raw = String(iconName || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  const noExt = raw.replace(/\.(jpg|jpeg|png|webp)$/i, '');
  const base = noExt.split('/').pop() || noExt;
  return `https://render.worldofwarcraft.com/icons/56/${base}.jpg`;
}

export function getWowheadUrl(itemId: number): string {
  return `https://www.wowhead.com/item=${itemId}`;
}

export function getWowheadData(
  bonusIds?: number[],
  ilevel?: number,
  enchantId?: number,
  gemId?: number | number[]
): string {
  const parts: string[] = [];
  if (bonusIds && bonusIds.length > 0) {
    parts.push(`bonus=${bonusIds.join(':')}`);
  }
  if (ilevel && ilevel > 0) {
    parts.push(`ilvl=${ilevel}`);
  }
  if (enchantId && enchantId > 0) {
    parts.push(`ench=${enchantId}`);
  }
  const gemIds = Array.isArray(gemId) ? gemId.filter((id) => id > 0) : gemId && gemId > 0 ? [gemId] : [];
  if (gemIds.length > 0) {
    parts.push(`gems=${gemIds.join(':')}`);
  }
  return parts.join('&');
}
