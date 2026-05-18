import { buildGearItemIdentity, buildGearItemUid } from '../../lib/gear-utils';
import { ResolvedItem } from '../../lib/types';

export type BadgeVariant = 'neutral' | 'gem' | 'enchant' | 'embellishment' | 'mod' | 'source';

export interface BadgeDescriptor {
  text: string;
  badgeVariant?: BadgeVariant;
  kind?: 'text' | 'gemIcon' | 'plain' | 'iconText';
  icon?: string;
  href?: string;
  wowheadData?: string;
  tooltip?: string;
  color?: string;
}

const SOURCE_TAG_OVERRIDES: Record<string, string> = {
  wishlist: '!text-rose-100 !border-rose-300/80',
  vault: '!text-violet-100 !border-violet-300/80',
  search: '!text-sky-100 !border-sky-300/80',
  crafter: '!text-cyan-100 !border-cyan-300/80',
  crafted: '!text-cyan-100 !border-cyan-300/80',
  catalyst: '!text-purple-100 !border-purple-300/80',
  'mythic+': '!text-orange-100 !border-orange-300/80',
  'mythic': '!text-orange-100 !border-orange-300/80',
  heroic: '!text-teal-100 !border-teal-300/80',
  champion: '!text-emerald-100 !border-emerald-300/80',
  veteran: '!text-sky-100 !border-sky-300/80',
  adventurer: '!text-lime-100 !border-lime-300/80',
};

const KNOWN_SOURCE_TAGS = new Set([
  'wishlist',
  'vault',
  'search',
  'crafter',
  'crafted',
  'catalyst',
  'ascendant',
  'mythic+',
  'mythic',
  'heroic',
  'veteran',
  'champion',
  'adventurer',
]);

export function toTitleCase(input: string): string {
  return input
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function resolveSourceTags(item: ResolvedItem): BadgeDescriptor[] {
  const tags: BadgeDescriptor[] = [];

  const pushTag = (rawText: string) => {
    const text = toTitleCase(rawText || '');
    if (!text) return;
    const key = text.toLowerCase();
    if (key === 'bags' || key === 'equipped') return;
    if (tags.some((t) => t.text.toLowerCase() === key)) return;
    if (!KNOWN_SOURCE_TAGS.has(key)) {
      tags.push({ text, badgeVariant: 'source' });
      return;
    }
    tags.push({
      text,
      badgeVariant: 'source',
      color: SOURCE_TAG_OVERRIDES[key] || '',
    });
  };

  if (item.origin === 'vault') pushTag('Vault');
  if (item.tag && String(item.tag).toLowerCase() !== 'ascendant') pushTag(item.tag);

  const sourceType = String((item as { source_type?: string }).source_type || '').toLowerCase();
  if (sourceType.includes('wishlist')) pushTag('Wishlist');
  if (sourceType.includes('vault')) pushTag('Vault');
  if (sourceType.includes('craft')) pushTag('Crafter');

  if (tags.length === 0 && item.origin && item.origin !== 'bags' && item.origin !== 'equipped') {
    pushTag(item.origin);
  }
  return tags;
}

export function getWowheadUrl(itemId: number): string {
  return `https://www.wowhead.com/item=${itemId}`;
}

export function getWowheadData(item: ResolvedItem): string {
  const parts: string[] = [];
  if (item.bonus_ids.length > 0) parts.push(`bonus=${item.bonus_ids.join(':')}`);
  if (item.ilevel > 0) parts.push(`ilvl=${item.ilevel}`);
  if (item.enchant_id > 0) parts.push(`ench=${item.enchant_id}`);
  const gemIds =
    item.gem_ids && item.gem_ids.length > 0
      ? item.gem_ids.filter((id) => id > 0)
      : item.gem_id > 0
        ? [item.gem_id]
        : [];
  if (gemIds.length > 0) parts.push(`gems=${gemIds.join(':')}`);
  return parts.join('&');
}

export function isCraftedSource(item: {
  source_type?: string;
  encounter?: string;
  instance_name?: string;
}): boolean {
  const sourceType = String(item.source_type || '').toLowerCase();
  const encounter = String(item.encounter || '').toLowerCase();
  const instance = String(item.instance_name || '').toLowerCase();
  return (
    sourceType.includes('profession') ||
    sourceType.includes('craft') ||
    encounter.includes('crafted') ||
    instance.includes('crafted') ||
    encounter.includes('jewelcrafting') ||
    encounter.includes('blacksmithing') ||
    encounter.includes('tailoring') ||
    encounter.includes('inscription') ||
    encounter.includes('engineering') ||
    encounter.includes('alchemy') ||
    encounter.includes('enchanting')
  );
}

export function parseModifierItemIds(sourceType?: string): number[] {
  const src = String(sourceType || '');
  const out = new Set<number>();
  const re = /(?:^|\s)mod:(\d+)(?=\s|$)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(src))) {
    const id = Number(match[1]);
    if (Number.isFinite(id) && id > 0) out.add(id);
  }
  return Array.from(out).sort((a, b) => a - b);
}

export function hasModifierItemId(sourceType: string | undefined, itemId: number): boolean {
  return parseModifierItemIds(sourceType).includes(itemId);
}

export function isWeaponOrTrinket(item: { slot?: string }): boolean {
  const slot = String(item.slot || '');
  return slot === 'main_hand' || slot === 'off_hand' || slot === 'trinket1' || slot === 'trinket2';
}

interface SeasonalItemModifierRule {
  maxIlevelDelta: number;
  maxIlevelCap: number;
  isEligible: (item: ResolvedItem) => boolean;
}

const SEASONAL_ITEM_MODIFIERS = {
  ascendantVoidcore: {
    maxIlevelDelta: 9,
    maxIlevelCap: 298,
    isEligible: (item: ResolvedItem): boolean => {
      if (!isWeaponOrTrinket(item) || !item.upgrade) return false;
      const low = item.upgrade.toLowerCase();
      const match = low.match(/(\d+)\s*\/\s*(\d+)/);
      const isAtMaxUpgrade = !!match && Number(match[1]) >= Number(match[2]);
      const isHeroOrMythTrack = low.includes('hero') || low.includes('myth');
      return isAtMaxUpgrade && isHeroOrMythTrack;
    },
  },
} satisfies Record<string, SeasonalItemModifierRule>;

export function getAscendantModifierIlevelConfig(): Pick<SeasonalItemModifierRule, 'maxIlevelDelta' | 'maxIlevelCap'> {
  const rule = SEASONAL_ITEM_MODIFIERS.ascendantVoidcore;
  return {
    maxIlevelDelta: rule.maxIlevelDelta,
    maxIlevelCap: rule.maxIlevelCap,
  };
}

export function isAscendantEligible(item: ResolvedItem): boolean {
  return SEASONAL_ITEM_MODIFIERS.ascendantVoidcore.isEligible(item);
}

export function applyAscendantToSimc(simc: string, ilvl: number): string {
  if (/(?:^|,)ilevel=\d+/.test(simc)) return simc.replace(/((?:^|,)ilevel=)\d+/, `$1${ilvl}`);
  return `${simc},ilevel=${ilvl}`;
}

export function makeUid(item: {
  item_id: number;
  bonus_ids: number[];
  origin: string;
  slot: string;
  ilevel?: number;
  enchant_id?: number;
  gem_id?: number;
  gem_ids?: number[];
  crafted_stats?: string[];
  embellishment_item_id?: number;
  modifier_item_ids?: number[];
}): string {
  return buildGearItemUid(item);
}

export function makeIdentity(item: {
  item_id: number;
  bonus_ids: number[];
  origin: string;
  ilevel?: number;
  enchant_id?: number;
  gem_id?: number;
  gem_ids?: number[];
  crafted_stats?: string[];
  embellishment_item_id?: number;
  modifier_item_ids?: number[];
}): string {
  return buildGearItemIdentity(item);
}

export function parseFirstIdFromSimc(simc: string, key: 'gem_id' | 'enchant_id'): number {
  const match = simc.match(new RegExp(`(?:^|,)${key}=([0-9/:]+)`));
  if (!match) return 0;
  const rawValue = match[1].split('/')[0];
  return Number.parseInt(rawValue, 10) || 0;
}

export function parseGemIdsFromSimc(simc: string): number[] {
  const match = simc.match(/(?:^|,)gem_id=([0-9/:]+)/);
  if (!match) return [];
  return match[1]
    .split(/[/:]/)
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isFinite(value) && value > 0);
}

export function itemConsumesLimitedCraftedModifier(item: ResolvedItem): boolean {
  return Object.values(item.item_limit_categories || {}).some((limit) => Number(limit) === 2);
}

export function itemHasEmbellishment(
  item: ResolvedItem,
  optionsByItem: Record<number, Array<{ bonus_ids?: number[] }>>,
): boolean {
  if (itemConsumesLimitedCraftedModifier(item)) {
    return true;
  }
  if (
    (item.embellishment_item_id || 0) > 0 ||
    Boolean(item.embellishment_name) ||
    (item.embellishment_bonus_ids?.length || 0) > 0
  ) {
    return true;
  }
  const options = optionsByItem[item.item_id] || [];
  return options.some(
    (opt) =>
      Array.isArray(opt.bonus_ids) &&
      opt.bonus_ids.length > 0 &&
      opt.bonus_ids.every((bid) => item.bonus_ids.includes(bid))
  );
}

export function sameStringSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}
