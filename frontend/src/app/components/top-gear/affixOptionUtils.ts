export const MIN_VISIBLE_OPTION_QUALITY = 3;

export type GemStatKey = 'crit' | 'haste' | 'mast' | 'vers';

export interface RawEnchantOption {
  id?: number;
  enchant_id?: number;
  name?: string;
  displayName?: string;
  baseDisplayName?: string;
  itemId?: number;
  itemName?: string;
  itemIcon?: string;
  spellIcon?: string;
  quality?: number;
  expansion?: number;
  craftingQuality?: number;
  slot?: string;
  effectKey?: string | null;
  effectAmounts?: number[] | null;
}

export interface RawGemOption {
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
  label?: string;
  category?: string;
  primaryStat?: GemStatKey | null;
  primaryAmount?: number | null;
  secondaryStat?: GemStatKey | null;
  secondaryAmount?: number | null;
  isPvp?: boolean;
}

export interface EnchantDisplayOption {
  enchantId: number;
  name: string;
  icon: string;
  quality: number;
  itemId: number;
  baseKey: string;
  effectKey: string | null;
  effectAmounts: number[];
  craftingQuality: number;
}

export interface GemDisplayOption {
  gemItemId: number;
  enchantId: number;
  name: string;
  label: string;
  icon: string;
  quality: number;
  expansion: number;
  category: string;
  primaryStat: GemStatKey | null;
  primaryAmount: number | null;
  secondaryStat: GemStatKey | null;
  secondaryAmount: number | null;
  isPvp: boolean;
}

function inferGemFallback(gem: RawGemOption): Partial<GemDisplayOption> {
  const rawName = gem.itemName || gem.displayName || gem.name || '';
  const name = rawName.toLowerCase();

  if (name.includes('heliotrope')) {
    return {
      category: 'special',
      label: rawName || 'Unknown',
      isPvp: true,
    };
  }

  const primaryMap: Array<[string, GemStatKey, string]> = [
    ['peridot', 'haste', 'Haste'],
    ['garnet', 'crit', 'Crit'],
    ['amethyst', 'mast', 'Mast'],
    ['lapis', 'vers', 'Vers'],
  ];
  const secondaryMap: Array<[string, GemStatKey, string]> = [
    ['deadly', 'crit', 'Crit'],
    ['quick', 'haste', 'Haste'],
    ['masterful', 'mast', 'Mast'],
    ['versatile', 'vers', 'Vers'],
  ];

  const primary = primaryMap.find(([token]) => name.includes(token));
  const secondary = secondaryMap.find(([token]) => name.includes(token));

  if (!primary) {
    return {
      category: 'special',
      label: rawName || 'Unknown',
      isPvp: false,
    };
  }

  const isHybrid = Boolean(secondary);
  const primaryAmount = isHybrid ? 16 : 17;
  const secondaryAmount = isHybrid ? 7 : null;

  return {
    category: primary[1],
    primaryStat: primary[1],
    primaryAmount,
    secondaryStat: secondary?.[1] ?? null,
    secondaryAmount,
    label: secondary
      ? `${primaryAmount} ${primary[2]} & ${secondaryAmount} ${secondary[2]}`
      : `${primaryAmount} ${primary[2]}`,
    isPvp: false,
  };
}

function normalizeEnchantBaseKey(name: string): string {
  return name
    .replace(/^Empowered\s+/i, '')
    .replace(/^Whisper of Armored\s+/i, '')
    .replace(/^Chant of Armored\s+/i, '')
    .trim();
}

export function normalizedSpecName(raw?: string | null): string {
  return (raw || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function isHealerSpec(spec?: string | null): boolean {
  return ['restoration', 'holy', 'discipline', 'mistweaver', 'preservation'].includes(
    normalizedSpecName(spec)
  );
}

function isTankSpec(spec?: string | null): boolean {
  return ['blood', 'protection', 'guardian', 'vengeance', 'brewmaster'].includes(
    normalizedSpecName(spec)
  );
}

export function normalizeEnchantOptions(raw: RawEnchantOption[]): EnchantDisplayOption[] {
  return raw
    .filter((enchant) => enchant.slot !== 'socket')
    .map((enchant) => ({
      enchantId: enchant.enchant_id ?? enchant.id ?? 0,
      name: enchant.itemName || enchant.displayName || enchant.name || 'Unknown',
      icon: enchant.itemIcon || enchant.spellIcon || 'inv_misc_questionmark',
      quality: enchant.quality ?? 3,
      itemId: enchant.itemId ?? 0,
      baseKey:
        normalizeEnchantBaseKey(
          enchant.baseDisplayName ||
        enchant.itemName ||
        enchant.displayName ||
        enchant.name ||
        `enchant-${enchant.enchant_id ?? enchant.id ?? 0}`
        ),
      effectKey: enchant.effectKey?.trim() || null,
      effectAmounts: Array.isArray(enchant.effectAmounts)
        ? enchant.effectAmounts.filter((value) => Number.isFinite(value))
        : [],
      craftingQuality: enchant.craftingQuality ?? 0,
    }))
    .filter(
      (enchant) =>
        enchant.enchantId > 0 && (enchant.quality ?? 0) >= MIN_VISIBLE_OPTION_QUALITY
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}

function compareEnchantStrength(
  current: EnchantDisplayOption,
  existing: EnchantDisplayOption
): number {
  const maxLength = Math.max(current.effectAmounts.length, existing.effectAmounts.length);
  for (let index = 0; index < maxLength; index += 1) {
    const currentAmount = current.effectAmounts[index] ?? -1;
    const existingAmount = existing.effectAmounts[index] ?? -1;
    if (currentAmount !== existingAmount) {
      return currentAmount - existingAmount;
    }
  }

  if (current.craftingQuality !== existing.craftingQuality) {
    return current.craftingQuality - existing.craftingQuality;
  }

  if (current.quality !== existing.quality) {
    return current.quality - existing.quality;
  }

  return 0;
}

export function deduplicateEnchants(
  options: EnchantDisplayOption[],
  showAll: boolean
): EnchantDisplayOption[] {
  if (showAll) {
    return [...options].sort((a, b) => a.name.localeCompare(b.name));
  }

  const byEffect = new Map<string, EnchantDisplayOption>();
  for (const option of options) {
    const effectKey = option.effectKey || `base:${option.baseKey}`;
    const existing = byEffect.get(effectKey);
    if (!existing || compareEnchantStrength(option, existing) > 0) {
      byEffect.set(effectKey, option);
    }
  }

  return Array.from(byEffect.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function toGemDisplay(gem: RawGemOption): GemDisplayOption {
  const fallback = inferGemFallback(gem);
  return {
    gemItemId: gem.item_id ?? gem.itemId ?? gem.id ?? 0,
    enchantId: gem.id ?? 0,
    name: gem.itemName || gem.displayName || gem.name || 'Unknown',
    label:
      gem.label ||
      fallback.label ||
      gem.itemName ||
      gem.displayName ||
      gem.name ||
      'Unknown',
    icon: gem.itemIcon || gem.icon || 'inv_misc_questionmark',
    quality: gem.quality ?? 3,
    expansion: gem.expansion ?? 0,
    category: gem.category || fallback.category || 'special',
    primaryStat:
      (gem.primaryStat as GemStatKey | null | undefined) ??
      (fallback.primaryStat as GemStatKey | null | undefined) ??
      null,
    primaryAmount: gem.primaryAmount ?? fallback.primaryAmount ?? null,
    secondaryStat:
      (gem.secondaryStat as GemStatKey | null | undefined) ??
      (fallback.secondaryStat as GemStatKey | null | undefined) ??
      null,
    secondaryAmount: gem.secondaryAmount ?? fallback.secondaryAmount ?? null,
    isPvp: gem.isPvp ?? fallback.isPvp ?? false,
  };
}

function gemStrength(gem: RawGemOption): [number, number, number] {
  return [gem.primaryAmount ?? 0, gem.secondaryAmount ?? 0, gem.craftingQuality ?? 0];
}

function compareGemStrength(current: RawGemOption, existing: RawGemOption): number {
  const [currentPrimary, currentSecondary, currentQuality] = gemStrength(current);
  const [existingPrimary, existingSecondary, existingQuality] = gemStrength(existing);

  if (currentPrimary !== existingPrimary) {
    return currentPrimary - existingPrimary;
  }
  if (currentSecondary !== existingSecondary) {
    return currentSecondary - existingSecondary;
  }
  return currentQuality - existingQuality;
}

function gemEffectKey(gem: RawGemOption): string {
  const fallback = inferGemFallback(gem);
  const category = gem.category || fallback.category || 'special';
  const primaryStat = gem.primaryStat || fallback.primaryStat || 'none';
  const secondaryStat = gem.secondaryStat || fallback.secondaryStat || 'none';

  if (category === 'special') {
    return `special:${gem.itemName || gem.displayName || gem.name || gem.item_id || gem.id || 0}`;
  }

  return `${category}:${primaryStat}:${secondaryStat}`;
}

export function deduplicateGems(raw: RawGemOption[], showAll: boolean): GemDisplayOption[] {
  const visibleRaw = raw.filter((gem) => (gem.quality ?? 0) >= MIN_VISIBLE_OPTION_QUALITY);
  if (showAll) {
    return visibleRaw.map(toGemDisplay).filter((gem) => gem.gemItemId > 0);
  }

  const byEffect = new Map<string, RawGemOption>();
  for (const gem of visibleRaw) {
    const effectKey = gemEffectKey(gem);
    const existing = byEffect.get(effectKey);
    if (!existing || compareGemStrength(gem, existing) > 0) {
      byEffect.set(effectKey, gem);
    }
  }

  return Array.from(byEffect.values())
    .map(toGemDisplay)
    .filter((gem) => gem.gemItemId > 0);
}

export function gemFitsSpec(gem: GemDisplayOption, specName?: string | null): boolean {
  if (gem.category !== 'special') return true;

  const label = gem.label.toLowerCase();
  if (label.includes('armor')) {
    return isTankSpec(specName);
  }
  if (label.includes('maximum mana')) {
    return isHealerSpec(specName);
  }
  return true;
}

export function enchantFitsSpec(
  enchant: EnchantDisplayOption,
  className?: string | null,
  specName?: string | null
): boolean {
  const spec = normalizedSpecName(specName);
  const effectKey = (enchant.effectKey || '').toLowerCase();
  const name = enchant.name.toLowerCase();

  const isHealer = ['restoration', 'holy', 'discipline', 'mistweaver', 'preservation'].includes(spec);
  const isTank = ['blood', 'protection', 'guardian', 'vengeance', 'brewmaster'].includes(spec);
  const usesStrength = [
    'arms',
    'fury',
    'protection',
    'retribution',
    'blood',
    'frost_death_knight',
    'unholy',
  ].includes(spec);
  const usesAgility = [
    'feral',
    'guardian',
    'beast_mastery',
    'marksmanship',
    'survival',
    'assassination',
    'outlaw',
    'subtlety',
    'enhancement',
    'windwalker',
    'havoc',
    'vengeance',
  ].includes(spec);
  const usesIntellect =
    (!!className && ['mage', 'priest', 'warlock', 'evoker'].includes(className.toLowerCase())) ||
    [
      'arcane',
      'fire',
      'frost',
      'discipline',
      'holy',
      'shadow',
      'affliction',
      'demonology',
      'destruction',
      'devastation',
      'preservation',
      'augmentation',
    ].includes(spec);
  const usesAgiOrStr = usesAgility || usesStrength;

  if (name.includes("farstrider's hawkeye") || name.includes("smuggler's lynxeye")) {
    return false;
  }
  if (name.includes('nalorakk')) {
    return usesStrength;
  }
  if (name.includes('worldsoul cradle')) {
    return isHealer;
  }
  if (name.includes('worldsoul aegis')) {
    return isTank;
  }
  if (effectKey.includes('agility or strength')) {
    return usesAgiOrStr;
  }
  if (effectKey.includes('primary stat')) {
    return true;
  }
  if (effectKey.includes('strength')) {
    return usesStrength;
  }
  if (effectKey.includes('agility')) {
    return usesAgility;
  }
  if (effectKey.includes('intellect')) {
    return usesIntellect;
  }
  if (effectKey.includes('mana')) {
    return isHealer;
  }
  if (effectKey.includes('armor')) {
    return isTank;
  }

  return true;
}

export function sortGemOptions(a: GemDisplayOption, b: GemDisplayOption): number {
  const categoryOrder: Record<string, number> = {
    special: 0,
    haste: 1,
    crit: 2,
    mast: 3,
    vers: 4,
  };
  const categoryDelta =
    (categoryOrder[a.category] ?? 99) - (categoryOrder[b.category] ?? 99);
  if (categoryDelta !== 0) return categoryDelta;
  const primaryDelta = (b.primaryAmount ?? 0) - (a.primaryAmount ?? 0);
  if (primaryDelta !== 0) return primaryDelta;
  const secondaryDelta = (b.secondaryAmount ?? 0) - (a.secondaryAmount ?? 0);
  if (secondaryDelta !== 0) return secondaryDelta;
  return a.label.localeCompare(b.label);
}
