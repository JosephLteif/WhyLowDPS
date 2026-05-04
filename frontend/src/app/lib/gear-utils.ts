import { ResolvedItem } from './types';

export type GearIdentityInput = {
  item_id: number;
  bonus_ids: number[];
  origin: string;
  slot?: string;
  ilevel?: number;
  enchant_id?: number;
  gem_id?: number;
  crafted_stats?: string[];
  embellishment_item_id?: number;
  modifier_item_ids?: number[];
  includeIlevel?: boolean;
};

export function buildGearItemIdentity(item: GearIdentityInput): string {
  const sortedBonuses = [...(item.bonus_ids || [])].sort((a, b) => a - b);
  const crafted =
    item.crafted_stats && item.crafted_stats.length > 0
      ? `:${[...item.crafted_stats].sort().join('/')}`
      : '';
  const embellishment = item.embellishment_item_id ? `:b${item.embellishment_item_id}` : '';
  const mods =
    item.modifier_item_ids && item.modifier_item_ids.length > 0
      ? `:m${[...item.modifier_item_ids].sort((a, b) => a - b).join('/')}`
      : '';

  const ilevelSegment = item.includeIlevel === false ? '' : `:i${item.ilevel || 0}`;
  return `${item.item_id}:${sortedBonuses.join(':')}:${item.origin}${ilevelSegment}:e${item.enchant_id || 0}:g${item.gem_id || 0}${crafted}${embellishment}${mods}`;
}

export function buildGearItemUid(item: GearIdentityInput & { slot: string }): string {
  return `${buildGearItemIdentity(item)}:${item.slot}`;
}

export function buildResolvedItemIdentity(item: ResolvedItem): string {
  return buildGearItemIdentity(item);
}

export function normalizeSlotFilter(slot: string | null | undefined): string | null {
  if (!slot) return null;
  const lower = slot.toLowerCase();
  if (lower === 'ring') return 'finger1';
  if (lower === 'trinket') return 'trinket1';
  return lower;
}

export function slotLabelToSimSlot(slot: string): string | null {
  const normalized = slot.trim().toLowerCase().replace(/[\s-]+/g, '_');
  switch (normalized) {
    case 'head':
    case 'neck':
    case 'shoulder':
    case 'back':
    case 'chest':
    case 'wrist':
    case 'hands':
    case 'waist':
    case 'legs':
    case 'feet':
    case 'finger1':
    case 'finger2':
    case 'trinket1':
    case 'trinket2':
    case 'main_hand':
    case 'off_hand':
      return normalized;
    default:
      return null;
  }
}

export function slotFromInventoryType(inventoryType?: number): string | null {
  switch (inventoryType) {
    case 1:
      return 'head';
    case 2:
      return 'neck';
    case 3:
      return 'shoulder';
    case 5:
    case 20:
      return 'chest';
    case 6:
      return 'waist';
    case 7:
      return 'legs';
    case 8:
      return 'feet';
    case 9:
      return 'wrist';
    case 10:
      return 'hands';
    case 11:
      return 'finger1';
    case 12:
      return 'trinket1';
    case 13:
    case 17:
    case 21:
      return 'main_hand';
    case 14:
    case 22:
    case 23:
      return 'off_hand';
    case 16:
      return 'back';
    default:
      return null;
  }
}

export const INVENTORY_TYPE_TO_SLOT: Record<number, string> = {
  1: 'head',
  2: 'neck',
  3: 'shoulder',
  5: 'chest',
  6: 'waist',
  7: 'legs',
  8: 'feet',
  9: 'wrist',
  10: 'hands',
  11: 'finger1',
  12: 'trinket1',
  13: 'main_hand',
  14: 'off_hand',
  16: 'back',
  17: 'main_hand',
  20: 'chest',
  21: 'main_hand',
  22: 'off_hand',
  23: 'off_hand',
};

export function slotCandidatesFromWishlistSlot(fallbackSlot: string): string[] {
  const fallback = fallbackSlot.toLowerCase();
  if (fallback.includes('head')) return ['head'];
  if (fallback.includes('neck')) return ['neck'];
  if (fallback.includes('shoulder')) return ['shoulder'];
  if (fallback.includes('back')) return ['back'];
  if (fallback.includes('chest')) return ['chest'];
  if (fallback.includes('wrist')) return ['wrist'];
  if (fallback.includes('main')) return ['main_hand'];
  if (fallback.includes('off')) return ['off_hand'];
  if (fallback.includes('hand')) return ['hands'];
  if (fallback.includes('waist')) return ['waist'];
  if (fallback.includes('leg')) return ['legs'];
  if (fallback.includes('feet')) return ['feet'];
  if (fallback.includes('finger') || fallback.includes('ring')) return ['finger1', 'finger2'];
  if (fallback.includes('trinket')) return ['trinket1', 'trinket2'];
  return [];
}
