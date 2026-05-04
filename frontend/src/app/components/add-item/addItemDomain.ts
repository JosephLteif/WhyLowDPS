import { ExternalItem } from './useAddItemState';

export const CRAFTED_ALL_ITEMS_ID = -100;
export const CRAFTED_PVP_ITEMS_ID = -115;
export const CRAFTED_PVP_FILTER = '__pvp__';

export const CRAFTED_SIDEBAR_FILTERS = [
  { id: CRAFTED_ALL_ITEMS_ID, name: 'All Items', filter: null as string | null },
  { id: CRAFTED_PVP_ITEMS_ID, name: 'PvP Items', filter: CRAFTED_PVP_FILTER },
  { id: -113, name: 'Main Hand', filter: 'main_hand' },
  { id: -114, name: 'Off Hand', filter: 'off_hand' },
  { id: -112, name: 'Trinkets', filter: 'trinket1' },
  { id: -102, name: 'Neck', filter: 'neck' },
  { id: -111, name: 'Rings', filter: 'finger1' },
  { id: -101, name: 'Head', filter: 'head' },
  { id: -105, name: 'Chest', filter: 'chest' },
  { id: -103, name: 'Shoulders', filter: 'shoulder' },
  { id: -107, name: 'Hands', filter: 'hands' },
  { id: -109, name: 'Legs', filter: 'legs' },
  { id: -108, name: 'Waist', filter: 'waist' },
  { id: -104, name: 'Back', filter: 'back' },
  { id: -106, name: 'Wrists', filter: 'wrist' },
  { id: -110, name: 'Feet', filter: 'feet' },
] as const;

export const SLOT_FILTER_OPTIONS = [
  { value: '', label: 'All Item Types' },
  { value: 'main_hand', label: 'Main Hand' },
  { value: 'off_hand', label: 'Off Hand' },
  { value: 'trinket1', label: 'Trinkets' },
  { value: 'neck', label: 'Neck' },
  { value: 'finger1', label: 'Rings' },
  { value: 'head', label: 'Head' },
  { value: 'chest', label: 'Chest' },
  { value: 'shoulder', label: 'Shoulders' },
  { value: 'hands', label: 'Hands' },
  { value: 'legs', label: 'Legs' },
  { value: 'waist', label: 'Waist' },
  { value: 'back', label: 'Back' },
  { value: 'wrist', label: 'Wrists' },
  { value: 'feet', label: 'Feet' },
] as const;

export const SLOT_FILTER_LABELS: Map<string, string> = new Map(
  SLOT_FILTER_OPTIONS.filter((option) => option.value).map((option) => [option.value, option.label])
);

const LOOT_BROWSER_SLOT_ORDER = [
  'main_hand',
  'off_hand',
  'trinket1',
  'neck',
  'finger1',
  'head',
  'chest',
  'shoulder',
  'hands',
  'legs',
  'waist',
  'back',
  'wrist',
  'feet',
] as const;

export const LOOT_BROWSER_SLOT_ORDER_INDEX: Map<string, number> = new Map(
  LOOT_BROWSER_SLOT_ORDER.map((slot, index) => [slot, index])
);

export function normalizeSlotFilter(slot: string | null | undefined): string | null {
  if (!slot) return null;
  const lower = slot.toLowerCase();
  if (lower === CRAFTED_PVP_FILTER) return CRAFTED_PVP_FILTER;
  if (lower.startsWith('finger') || lower.startsWith('ring')) return 'finger1';
  if (lower.startsWith('trinket')) return 'trinket1';
  return lower;
}

export function slotLabelToOrderKey(slotLabel: string): string {
  const normalized = slotLabel.trim().toLowerCase();
  switch (normalized) {
    case 'rings':
    case 'ring':
    case 'finger':
      return 'finger1';
    case 'trinkets':
    case 'trinket':
      return 'trinket1';
    case 'shoulders':
      return 'shoulder';
    case 'wrists':
      return 'wrist';
    default:
      return normalized.replace(/\s+/g, '_');
  }
}

export function isPvpCraftedItem(item: ExternalItem): boolean {
  const sourceType = String(item.source_type || '').toLowerCase();
  const name = String(item.name || '').toLowerCase();
  return sourceType.includes('pvp') || name.includes('competitor');
}

export function compareLootBrowserItems(a: ExternalItem, b: ExternalItem): number {
  const nameCompare = a.name.localeCompare(b.name);
  if (nameCompare !== 0) return nameCompare;

  const encounterCompare = (a.encounter || '').localeCompare(b.encounter || '');
  if (encounterCompare !== 0) return encounterCompare;

  if (a.ilevel !== b.ilevel) return b.ilevel - a.ilevel;
  return a.item_id - b.item_id;
}

export interface RawGem {
  id?: number;
  item_id?: number;
  name?: string;
  icon?: string;
  displayName?: string;
  itemId?: number;
  itemName?: string;
  itemIcon?: string;
  quality?: number;
  expansion?: number;
  craftingQuality?: number;
}

export interface GemDisplay {
  gem_id: number;
  name: string;
  icon: string;
  quality: number;
  expansion: number;
}

export function deduplicateGems(raw: RawGem[]): GemDisplay[] {
  const byBase = new Map<string, RawGem>();
  for (const gem of raw) {
    const baseName =
      gem.itemName || gem.displayName || gem.name || `gem-${gem.item_id ?? gem.itemId ?? gem.id ?? 0}`;
    const existing = byBase.get(baseName);
    if (!existing || (gem.craftingQuality ?? 0) > (existing.craftingQuality ?? 0)) {
      byBase.set(baseName, gem);
    }
  }

  return Array.from(byBase.values())
    .map((gem) => ({
      gem_id: gem.item_id ?? gem.itemId ?? gem.id ?? 0,
      name: gem.itemName || gem.displayName || gem.name || 'Unknown Gem',
      icon: gem.itemIcon || gem.icon || '',
      quality: Number(gem.craftingQuality ?? gem.quality ?? 1),
      expansion: Number(gem.expansion ?? 0),
    }))
    .filter((gem) => gem.gem_id > 0)
    .sort((a, b) => {
      if (b.expansion !== a.expansion) return b.expansion - a.expansion;
      if (b.quality !== a.quality) return b.quality - a.quality;
      return a.name.localeCompare(b.name);
    });
}
