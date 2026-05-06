import type { DropItem } from '../drop-finder/types';

export const WISHLIST_STORAGE_KEY = 'whylowdps_wishlist';
const GLOBAL_WISHLIST_OWNER_KEY = 'global';

export interface WishlistItem extends DropItem {
  wishlist_slot?: string;
  added_at?: number;
  wishlist_ilvl?: number;
  wishlist_bonus_id?: number;
  wishlist_upgrade_label?: string;
}

interface WishlistStorageV2 {
  version: 2;
  by_owner: Record<string, WishlistItem[]>;
}

interface WishlistOwnerInput {
  name?: string | null;
  realm?: string | null;
  region?: string | null;
  className?: string | null;
}

export interface WishlistOwnerSummary {
  key: string;
  count: number;
  name?: string;
  realm?: string;
  region?: string;
  className?: string;
  label: string;
}

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function normalizeItemList(items: unknown): WishlistItem[] {
  if (!Array.isArray(items)) return [];
  return items.filter((item) => item && typeof item.item_id === 'number');
}

function dedupeItemList(items: WishlistItem[]): WishlistItem[] {
  const seen = new Set<string>();
  const out: WishlistItem[] = [];
  for (const item of items) {
    const ilvl = Number(item.wishlist_ilvl ?? item.ilevel ?? 0);
    const key = `${item.item_id}:${ilvl}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function resolveOwnerKey(ownerKey?: string): string {
  const normalized = (ownerKey || '').trim().toLowerCase();
  return normalized || GLOBAL_WISHLIST_OWNER_KEY;
}

function canonicalOwnerKey(ownerKey?: string): string {
  const resolved = resolveOwnerKey(ownerKey);
  if (resolved === GLOBAL_WISHLIST_OWNER_KEY) return resolved;
  const parsed = parseWishlistOwnerKey(resolved);
  return buildWishlistOwnerKey({
    name: parsed.name,
    realm: parsed.realm,
    region: parsed.region,
  });
}

function emptyStorage(): WishlistStorageV2 {
  return {
    version: 2,
    by_owner: {},
  };
}

function readStorage(): WishlistStorageV2 {
  if (!canUseStorage()) return emptyStorage();

  try {
    const raw = localStorage.getItem(WISHLIST_STORAGE_KEY);
    if (!raw) return emptyStorage();
    const parsed = JSON.parse(raw);

    if (Array.isArray(parsed)) {
      return {
        version: 2,
        by_owner: {
          [GLOBAL_WISHLIST_OWNER_KEY]: normalizeItemList(parsed),
        },
      };
    }

    if (
      parsed &&
      typeof parsed === 'object' &&
      parsed.version === 2 &&
      parsed.by_owner &&
      typeof parsed.by_owner === 'object'
    ) {
      const byOwner: Record<string, WishlistItem[]> = {};
      for (const [key, value] of Object.entries(parsed.by_owner as Record<string, unknown>)) {
        const resolvedKey = resolveOwnerKey(key);
        const parsedOwner = parseWishlistOwnerKey(resolvedKey);
        const canonicalKey = buildWishlistOwnerKey({
          name: parsedOwner.name,
          realm: parsedOwner.realm,
          region: parsedOwner.region,
        });
        byOwner[canonicalKey] = dedupeItemList([
          ...(byOwner[canonicalKey] || []),
          ...normalizeItemList(value),
        ]);
      }
      return {
        version: 2,
        by_owner: byOwner,
      };
    }

    return emptyStorage();
  } catch {
    return emptyStorage();
  }
}

function writeStorage(storage: WishlistStorageV2): void {
  if (!canUseStorage()) return;
  localStorage.setItem(WISHLIST_STORAGE_KEY, JSON.stringify(storage));
}

export function buildWishlistOwnerKey(owner: WishlistOwnerInput): string {
  const name = (owner.name || '').trim().toLowerCase();
  const realm = (owner.realm || '').trim().toLowerCase();
  const region = (owner.region || '').trim().toLowerCase();

  // Canonical owner key: character identity only.
  // Excluding class avoids duplicate buckets when class labels drift.
  if (!name && !realm && !region) return GLOBAL_WISHLIST_OWNER_KEY;
  return `${region}:${realm}:${name}`;
}

export function parseWishlistOwnerKey(ownerKey: string): WishlistOwnerInput {
  const key = resolveOwnerKey(ownerKey);
  if (key === GLOBAL_WISHLIST_OWNER_KEY) return {};
  const parts = key.split(':');
  return {
    region: parts[0] || undefined,
    realm: parts[1] || undefined,
    name: parts[2] || undefined,
    className: parts.slice(3).join(':') || undefined,
  };
}

function ownerLabel(ownerKey: string): string {
  const parsed = parseWishlistOwnerKey(ownerKey);
  if (!parsed.name && !parsed.realm && !parsed.region && !parsed.className) {
    return 'Global Wishlist';
  }
  return parsed.name || 'Character Wishlist';
}

export function loadWishlist(ownerKey?: string): WishlistItem[] {
  const storage = readStorage();
  const key = canonicalOwnerKey(ownerKey);
  return normalizeItemList(storage.by_owner[key]);
}

export function saveWishlist(items: WishlistItem[], ownerKey?: string): void {
  const storage = readStorage();
  const key = canonicalOwnerKey(ownerKey);
  storage.by_owner[key] = normalizeItemList(items);
  writeStorage(storage);
}

export function clearWishlist(ownerKey?: string): void {
  const storage = readStorage();
  const key = canonicalOwnerKey(ownerKey);
  delete storage.by_owner[key];
  writeStorage(storage);
}

export function isWishlisted(itemId: number, ownerKey?: string, ilvl?: number): boolean {
  const targetIlvl = Number(ilvl ?? 0);
  return loadWishlist(ownerKey).some((item) => {
    const itemIlvl = Number(item.wishlist_ilvl ?? item.ilevel ?? 0);
    return item.item_id === itemId && itemIlvl === targetIlvl;
  });
}

export function removeFromWishlist(itemId: number, ownerKey?: string, ilvl?: number): WishlistItem[] {
  const targetIlvl = Number(ilvl ?? 0);
  const next = loadWishlist(ownerKey).filter((item) => {
    const itemIlvl = Number(item.wishlist_ilvl ?? item.ilevel ?? 0);
    return !(item.item_id === itemId && itemIlvl === targetIlvl);
  });
  saveWishlist(next, ownerKey);
  return next;
}

export function toggleWishlistItem(item: DropItem, slot?: string, ownerKey?: string): WishlistItem[] {
  const current = loadWishlist(ownerKey);
  const exists = current.some((entry) => entry.item_id === item.item_id);
  const next = exists
    ? current.filter((entry) => entry.item_id !== item.item_id)
    : [...current, { ...item, wishlist_slot: slot, added_at: Date.now() }];
  saveWishlist(next, ownerKey);
  return next;
}

export function addItemsToWishlist(
  entries: Array<{
    item: DropItem;
    slot?: string;
    meta?: { ilvl?: number; bonusId?: number; upgradeLabel?: string };
  }>,
  ownerKey?: string
): { items: WishlistItem[]; added: number; skipped: number } {
  const current = loadWishlist(ownerKey);
  const existingKeys = new Set(
    current.map((entry) => `${entry.item_id}:${Number(entry.wishlist_ilvl ?? entry.ilevel ?? 0)}`)
  );
  const next = [...current];
  let added = 0;
  let skipped = 0;

  for (const entry of entries) {
    if (!entry?.item || typeof entry.item.item_id !== 'number') continue;
    const key = `${entry.item.item_id}:${Number(entry.meta?.ilvl ?? entry.item.ilevel ?? 0)}`;
    if (existingKeys.has(key)) {
      skipped += 1;
      continue;
    }
    next.push({
      ...entry.item,
      wishlist_slot: entry.slot,
      added_at: Date.now(),
      wishlist_ilvl: entry.meta?.ilvl,
      wishlist_bonus_id: entry.meta?.bonusId,
      wishlist_upgrade_label: entry.meta?.upgradeLabel,
    });
    existingKeys.add(key);
    added += 1;
  }

  saveWishlist(next, ownerKey);
  return { items: next, added, skipped };
}

export function toggleWishlistEntry(
  entry: {
    item: DropItem;
    slot?: string;
    meta?: { ilvl?: number; bonusId?: number; upgradeLabel?: string };
  },
  ownerKey?: string
): WishlistItem[] {
  const current = loadWishlist(ownerKey);
  const exists = current.some((it) => it.item_id === entry.item.item_id);
  const next = exists
    ? current.filter((it) => it.item_id !== entry.item.item_id)
    : [
        ...current,
        {
          ...entry.item,
          wishlist_slot: entry.slot,
          added_at: Date.now(),
          wishlist_ilvl: entry.meta?.ilvl,
          wishlist_bonus_id: entry.meta?.bonusId,
          wishlist_upgrade_label: entry.meta?.upgradeLabel,
        },
      ];
  saveWishlist(next, ownerKey);
  return next;
}

export function listWishlistOwners(): WishlistOwnerSummary[] {
  const storage = readStorage();
  return Object.entries(storage.by_owner)
    .map(([key, items]) => {
      const resolvedKey = resolveOwnerKey(key);
      const parsed = parseWishlistOwnerKey(resolvedKey);
      return {
        key: resolvedKey,
        count: normalizeItemList(items).length,
        name: parsed.name || undefined,
        realm: parsed.realm || undefined,
        region: parsed.region || undefined,
        className: parsed.className || undefined,
        label: ownerLabel(resolvedKey),
      };
    })
    .sort((a, b) => {
      if (a.key === GLOBAL_WISHLIST_OWNER_KEY) return 1;
      if (b.key === GLOBAL_WISHLIST_OWNER_KEY) return -1;
      return a.label.localeCompare(b.label);
    });
}
