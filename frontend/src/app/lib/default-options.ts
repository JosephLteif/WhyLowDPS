import { parseCharacterInfo } from '../../lib/simc-parser';

export type DefaultOptionValue = boolean | number | string;

export interface DefaultChoice {
  label: string;
  value: string;
}

export interface DefaultOptionDefinition<T extends DefaultOptionValue = DefaultOptionValue> {
  key: string;
  label: string;
  description: string;
  group: 'Top Gear' | 'Fight Setup' | 'Raid Buffs' | 'Consumables';
  type: 'boolean' | 'number' | 'string' | 'select';
  defaultValue: T;
  min?: number;
  max?: number;
  step?: number;
  options?: DefaultChoice[];
}

export const APP_DEFAULTS_STORAGE_KEY = 'whylowdps_default_options_v1';
const LAST_ACTIVE_CHARACTER_KEY_STORAGE = 'whylowdps_defaults_last_character_key';

function normalizeCharacterKeyPart(input?: string | null): string {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

const FIGHT_STYLE_CHOICES: DefaultChoice[] = [
  { value: 'Patchwerk', label: 'Patchwerk' },
  { value: 'CastingPatchwerk', label: 'Casting Patchwerk' },
  { value: 'HecticAddCleave', label: 'Hectic Add Cleave' },
  { value: 'CleaveAdd', label: 'Cleave Add' },
  { value: 'LightMovement', label: 'Light Movement' },
  { value: 'HeavyMovement', label: 'Heavy Movement' },
  { value: 'DungeonSlice', label: 'Dungeon Slice' },
  { value: 'DungeonRoute', label: 'Dungeon Route' },
  { value: 'HelterSkelter', label: 'Helter Skelter' },
];

export const APP_DEFAULTS_REGISTRY = {
  'topgear.copyEnchants': {
    key: 'topgear.copyEnchants',
    label: 'Copy Enchants/Gems',
    description: 'Apply equipped enchants and gems to Top Gear alternatives by default.',
    group: 'Top Gear',
    type: 'boolean',
    defaultValue: true,
  },
  'topgear.maxUpgrade': {
    key: 'topgear.maxUpgrade',
    label: 'Sim Highest Upgrade',
    description: 'Treat selected Top Gear items as maximum upgrade by default.',
    group: 'Top Gear',
    type: 'boolean',
    defaultValue: false,
  },
  'topgear.catalyst': {
    key: 'topgear.catalyst',
    label: 'Revival Catalyst',
    description: 'Enable catalyst conversions by default in Top Gear.',
    group: 'Top Gear',
    type: 'boolean',
    defaultValue: false,
  },
  'fight.fightStyle': {
    key: 'fight.fightStyle',
    label: 'Fight Style',
    description: 'Default fight style for new simulations.',
    group: 'Fight Setup',
    type: 'select',
    defaultValue: 'Patchwerk',
    options: FIGHT_STYLE_CHOICES,
  },
  'fight.fightLength': {
    key: 'fight.fightLength',
    label: 'Fight Length (seconds)',
    description: 'Default fight duration.',
    group: 'Fight Setup',
    type: 'number',
    defaultValue: 300,
    min: 30,
    max: 600,
    step: 30,
  },
  'fight.targetCount': {
    key: 'fight.targetCount',
    label: 'Number of Bosses',
    description: 'Default target count for supported fight styles.',
    group: 'Fight Setup',
    type: 'number',
    defaultValue: 1,
    min: 1,
    max: 10,
    step: 1,
  },
  'raid.bloodlust': {
    key: 'raid.bloodlust',
    label: 'Bloodlust/Heroism',
    description: 'Default raid buff state.',
    group: 'Raid Buffs',
    type: 'boolean',
    defaultValue: true,
  },
  'raid.arcaneIntellect': {
    key: 'raid.arcaneIntellect',
    label: 'Arcane Intellect',
    description: 'Default raid buff state.',
    group: 'Raid Buffs',
    type: 'boolean',
    defaultValue: true,
  },
  'raid.powerWordFortitude': {
    key: 'raid.powerWordFortitude',
    label: 'Power Word: Fortitude',
    description: 'Default raid buff state.',
    group: 'Raid Buffs',
    type: 'boolean',
    defaultValue: true,
  },
  'raid.markOfTheWild': {
    key: 'raid.markOfTheWild',
    label: 'Mark of the Wild',
    description: 'Default raid buff state.',
    group: 'Raid Buffs',
    type: 'boolean',
    defaultValue: true,
  },
  'raid.battleShout': {
    key: 'raid.battleShout',
    label: 'Battle Shout',
    description: 'Default raid buff state.',
    group: 'Raid Buffs',
    type: 'boolean',
    defaultValue: true,
  },
  'raid.huntersMark': {
    key: 'raid.huntersMark',
    label: "Hunter's Mark",
    description: 'Default raid debuff state.',
    group: 'Raid Buffs',
    type: 'boolean',
    defaultValue: true,
  },
  'raid.bleeding': {
    key: 'raid.bleeding',
    label: 'Bleeding Debuff',
    description: 'Default raid debuff state.',
    group: 'Raid Buffs',
    type: 'boolean',
    defaultValue: true,
  },
  'raid.mysticTouch': {
    key: 'raid.mysticTouch',
    label: 'Mystic Touch',
    description: 'Default external buff state.',
    group: 'Raid Buffs',
    type: 'boolean',
    defaultValue: true,
  },
  'raid.chaosBrand': {
    key: 'raid.chaosBrand',
    label: 'Chaos Brand',
    description: 'Default external buff state.',
    group: 'Raid Buffs',
    type: 'boolean',
    defaultValue: true,
  },
  'raid.skyfury': {
    key: 'raid.skyfury',
    label: 'Skyfury',
    description: 'Default external buff state.',
    group: 'Raid Buffs',
    type: 'boolean',
    defaultValue: true,
  },
  'raid.powerInfusion': {
    key: 'raid.powerInfusion',
    label: 'Power Infusion',
    description: 'Default external buff state.',
    group: 'Raid Buffs',
    type: 'boolean',
    defaultValue: false,
  },
  'consumable.flask': {
    key: 'consumable.flask',
    label: 'Flask',
    description: 'Default flask token.',
    group: 'Consumables',
    type: 'string',
    defaultValue: '',
  },
  'consumable.food': {
    key: 'consumable.food',
    label: 'Food',
    description: 'Default food token.',
    group: 'Consumables',
    type: 'string',
    defaultValue: '',
  },
  'consumable.potion': {
    key: 'consumable.potion',
    label: 'Potion',
    description: 'Default potion token.',
    group: 'Consumables',
    type: 'string',
    defaultValue: '',
  },
  'consumable.augmentation': {
    key: 'consumable.augmentation',
    label: 'Augmentation Rune',
    description: 'Default augmentation rune token.',
    group: 'Consumables',
    type: 'string',
    defaultValue: '',
  },
  'consumable.temporaryEnchant': {
    key: 'consumable.temporaryEnchant',
    label: 'Temporary Enchant',
    description: 'Default temporary enchant token.',
    group: 'Consumables',
    type: 'string',
    defaultValue: '',
  },
} as const satisfies Record<string, DefaultOptionDefinition>;

export type AppDefaultKey = keyof typeof APP_DEFAULTS_REGISTRY;
type WidenLiteral<T> = T extends string ? string : T extends number ? number : T extends boolean ? boolean : T;
export type AppDefaultValues = {
  [K in AppDefaultKey]: WidenLiteral<(typeof APP_DEFAULTS_REGISTRY)[K]['defaultValue']>;
};

type DefaultOverrideMap = Partial<Record<AppDefaultKey, unknown>>;

interface AppDefaultsStore {
  global: DefaultOverrideMap;
  characters: Record<string, DefaultOverrideMap>;
}

interface DefaultReadOptions {
  characterKey?: string | null;
}

interface DefaultWriteOptions {
  scope?: 'global' | 'character';
  characterKey?: string | null;
}

function clampNumber(v: number, def: DefaultOptionDefinition<number>): number {
  const min = typeof def.min === 'number' ? def.min : Number.NEGATIVE_INFINITY;
  const max = typeof def.max === 'number' ? def.max : Number.POSITIVE_INFINITY;
  return Math.min(max, Math.max(min, v));
}

function normalizeValue<K extends AppDefaultKey>(
  key: K,
  rawValue: unknown
): AppDefaultValues[K] | undefined {
  const def = APP_DEFAULTS_REGISTRY[key];
  if (def.type === 'boolean') {
    return (typeof rawValue === 'boolean' ? rawValue : undefined) as AppDefaultValues[K];
  }
  if (def.type === 'number') {
    if (typeof rawValue !== 'number' || !Number.isFinite(rawValue)) return undefined;
    return clampNumber(rawValue, def as DefaultOptionDefinition<number>) as AppDefaultValues[K];
  }
  if (typeof rawValue !== 'string') return undefined;
  if (def.type === 'select' && def.options && !def.options.some((o) => o.value === rawValue)) {
    return undefined;
  }
  return rawValue as AppDefaultValues[K];
}

function normalizeCharacterKey(characterKey?: string | null): string | null {
  const raw = String(characterKey || '').trim().toLowerCase();
  if (!raw) return null;
  const parts = raw.split(':').map((p) => normalizeCharacterKeyPart(p));
  if (parts.length >= 3) {
    const [region, realm, name] = parts;
    if (!region || !realm || !name) return null;
    return `${region}:${realm}:${name}`;
  }
  const compact = normalizeCharacterKeyPart(raw);
  return compact.length > 0 ? compact : null;
}

function toCompactCharacterKey(characterKey?: string | null): string | null {
  const normalized = normalizeCharacterKey(characterKey);
  if (!normalized) return null;
  return normalizeCharacterKeyPart(normalized.replace(/:/g, ''));
}

function getCharacterAliasKeys(store: AppDefaultsStore, characterKey?: string | null): string[] {
  const normalized = normalizeCharacterKey(characterKey);
  if (!normalized) return [];
  const compact = toCompactCharacterKey(normalized);
  const keys = new Set<string>();
  if (store.characters[normalized]) keys.add(normalized);
  if (compact && compact !== normalized && store.characters[compact]) keys.add(compact);
  return Array.from(keys);
}

function getCharacterOverridesMerged(store: AppDefaultsStore, characterKey?: string | null): DefaultOverrideMap {
  const aliasKeys = getCharacterAliasKeys(store, characterKey);
  if (aliasKeys.length === 0) return {};
  return aliasKeys.reduce<DefaultOverrideMap>((acc, key) => ({ ...acc, ...(store.characters[key] || {}) }), {});
}

export function setLastActiveCharacterDefaultsKey(characterKey?: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    const normalized = normalizeCharacterKey(characterKey);
    if (!normalized) return;
    window.localStorage.setItem(LAST_ACTIVE_CHARACTER_KEY_STORAGE, normalized);
  } catch {}
}

export function getLastActiveCharacterDefaultsKey(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(LAST_ACTIVE_CHARACTER_KEY_STORAGE);
    return normalizeCharacterKey(raw);
  } catch {
    return null;
  }
}

function sanitizeOverrideMap(raw: unknown): DefaultOverrideMap {
  if (!raw || typeof raw !== 'object') return {};
  const next: DefaultOverrideMap = {};
  (Object.keys(APP_DEFAULTS_REGISTRY) as AppDefaultKey[]).forEach((key) => {
    const normalized = normalizeValue(key, (raw as Record<string, unknown>)[key]);
    if (normalized != null) next[key] = normalized;
  });
  return next;
}

function readStore(): AppDefaultsStore {
  if (typeof window === 'undefined') return { global: {}, characters: {} };
  try {
    const raw = window.localStorage.getItem(APP_DEFAULTS_STORAGE_KEY);
    if (!raw) return { global: {}, characters: {} };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { global: {}, characters: {} };

    // v2 shape
    const globalOverrides = sanitizeOverrideMap((parsed as { global?: unknown }).global);
    const characterOverridesRaw = (parsed as { characters?: unknown }).characters;
    const characters: Record<string, DefaultOverrideMap> = {};
    if (characterOverridesRaw && typeof characterOverridesRaw === 'object') {
      Object.entries(characterOverridesRaw as Record<string, unknown>).forEach(([key, value]) => {
        const normalizedKey = normalizeCharacterKey(key);
        if (!normalizedKey) return;
        characters[normalizedKey] = sanitizeOverrideMap(value);
      });
    }
    if ('global' in (parsed as Record<string, unknown>) || 'characters' in (parsed as Record<string, unknown>)) {
      return { global: globalOverrides, characters };
    }

    // legacy flat shape => treat as global overrides
    return { global: sanitizeOverrideMap(parsed), characters: {} };
  } catch {
    return { global: {}, characters: {} };
  }
}

function writeStore(next: AppDefaultsStore): void {
  if (typeof window === 'undefined') return;
  try {
    const hasGlobal = Object.keys(next.global).length > 0;
    const hasCharacters = Object.values(next.characters).some((ov) => Object.keys(ov).length > 0);
    if (!hasGlobal && !hasCharacters) {
      window.localStorage.removeItem(APP_DEFAULTS_STORAGE_KEY);
      return;
    }
    const compactCharacters = Object.fromEntries(
      Object.entries(next.characters).filter(([, overrides]) => Object.keys(overrides).length > 0)
    );
    window.localStorage.setItem(
      APP_DEFAULTS_STORAGE_KEY,
      JSON.stringify({ global: next.global, characters: compactCharacters })
    );
  } catch {}
}

export function buildCharacterDefaultsKey(region?: string | null, realm?: string | null, name?: string | null): string | null {
  const r = normalizeCharacterKeyPart(region);
  const s = normalizeCharacterKeyPart(realm);
  const n = normalizeCharacterKeyPart(name);
  if (!r || !s || !n) return null;
  return `${r}:${s}:${n}`;
}

export function getCharacterDefaultsKeyFromSimcInput(input: string): string | null {
  const info = parseCharacterInfo(input || '');
  if (!info || info.kind !== 'character') return null;
  return buildCharacterDefaultsKey(info.region, info.server, info.name);
}

export function isCharacterDefaultOverridden(key: AppDefaultKey, characterKey?: string | null): boolean {
  const normalizedKey = normalizeCharacterKey(characterKey);
  if (!normalizedKey) return false;
  const store = readStore();
  const overrides = getCharacterOverridesMerged(store, normalizedKey);
  return !!overrides && Object.prototype.hasOwnProperty.call(overrides, key);
}

export function getCharacterOverrideCount(characterKey?: string | null): number {
  const normalizedKey = normalizeCharacterKey(characterKey);
  if (!normalizedKey) return 0;
  const store = readStore();
  const overrides = getCharacterOverridesMerged(store, normalizedKey);
  if (!overrides) return 0;
  return Object.keys(overrides).length;
}

export function getAppDefaultOption<K extends AppDefaultKey>(
  key: K,
  options?: DefaultReadOptions
): AppDefaultValues[K] {
  const def = APP_DEFAULTS_REGISTRY[key];
  const store = readStore();
  const charKey = normalizeCharacterKey(options?.characterKey);
  const charValue = charKey
    ? normalizeValue(key, getCharacterOverridesMerged(store, charKey)?.[key])
    : undefined;
  if (charValue != null) return charValue as AppDefaultValues[K];
  const globalValue = normalizeValue(key, store.global[key]);
  return (globalValue ?? def.defaultValue) as AppDefaultValues[K];
}

export function getAllAppDefaultOptions(options?: DefaultReadOptions): AppDefaultValues {
  const values = {} as AppDefaultValues;
  const mutable = values as Record<AppDefaultKey, DefaultOptionValue>;
  (Object.keys(APP_DEFAULTS_REGISTRY) as AppDefaultKey[]).forEach((key) => {
    mutable[key] = getAppDefaultOption(key, options);
  });
  return values;
}

export function setAppDefaultOption<K extends AppDefaultKey>(
  key: K,
  value: AppDefaultValues[K],
  options?: DefaultWriteOptions
): void {
  const store = readStore();
  const normalized = normalizeValue(key, value);
  if (normalized == null) return;
  if (options?.scope === 'character') {
    const charKey = normalizeCharacterKey(options.characterKey);
    if (!charKey) return;
    const charOverrides = { ...getCharacterOverridesMerged(store, charKey) };
    charOverrides[key] = normalized;
    store.characters[charKey] = charOverrides;
    getCharacterAliasKeys(store, charKey).forEach((alias) => {
      if (alias !== charKey) delete store.characters[alias];
    });
    writeStore(store);
    return;
  }
  store.global[key] = normalized;
  writeStore(store);
}

export function clearCharacterDefaultOption(key: AppDefaultKey, characterKey?: string | null): void {
  const charKey = normalizeCharacterKey(characterKey);
  if (!charKey) return;
  const store = readStore();
  const overrides = { ...getCharacterOverridesMerged(store, charKey) };
  delete overrides[key];
  store.characters[charKey] = overrides;
  getCharacterAliasKeys(store, charKey).forEach((alias) => {
    if (alias !== charKey) delete store.characters[alias];
  });
  writeStore(store);
}

export function resetGlobalAppDefaultOption(key: AppDefaultKey): void {
  const store = readStore();
  delete store.global[key];
  writeStore(store);
}

export function resetGlobalAppDefaultOptions(): void {
  const store = readStore();
  store.global = {};
  writeStore(store);
}

export function resetCharacterAppDefaultOptions(characterKey?: string | null): void {
  const charKey = normalizeCharacterKey(characterKey);
  if (!charKey) return;
  const store = readStore();
  getCharacterAliasKeys(store, charKey).forEach((alias) => {
    delete store.characters[alias];
  });
  delete store.characters[charKey];
  writeStore(store);
}

export function resetAllAppDefaultOptions(): void {
  writeStore({ global: {}, characters: {} });
}
