export interface Instance {
  id: number;
  name: string;
  type: string;
  order?: number;
  zone?: string;
  expansion?: number;
  image_url?: string;
  image_background?: string;
  image_button?: string;
  image_button_small?: string;
  encounters: { id: number; name: string; image_url?: string }[];
}

export interface TrackInfo {
  ilvl: number;
  bonus_id: number;
  quality: number;
  track?: string;
  level?: number;
  max_level?: number;
}

export interface TrackLevel {
  level: number;
  max_level: number;
  ilvl: number;
  bonus_id: number;
  quality: number;
}

export type UpgradeTracks = Record<string, TrackLevel[]>;

function normalizeTrackName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function normalizeUpgradeTracks(input: unknown): UpgradeTracks {
  if (!input) return {};

  if (Array.isArray(input)) {
    const grouped: UpgradeTracks = {};
    for (const row of input as any[]) {
      const name = typeof row?.name === 'string' ? row.name.trim() : '';
      if (!name) continue;
      if (!grouped[name]) grouped[name] = [];
      grouped[name].push({
        level: Number(row.level || 0),
        max_level: Number(row.max || row.max_level || 0),
        ilvl: Number(row.itemLevel || row.ilevel || row.ilvl || 0),
        bonus_id: Number(row.bonus_id || 0),
        quality: Number(row.quality || 0),
      });
    }
    for (const key of Object.keys(grouped)) {
      grouped[key].sort((a, b) => a.level - b.level);
    }
    return grouped;
  }

  if (typeof input === 'object') {
    const grouped: UpgradeTracks = {};
    for (const [rawName, rows] of Object.entries(input as Record<string, unknown>)) {
      const name = rawName.trim();
      if (!name) continue;
      if (!Array.isArray(rows)) continue;
      grouped[name] = rows
        .map((row: any) => ({
          level: Number(row?.level || 0),
          max_level: Number(row?.max_level || row?.max || 0),
          ilvl: Number(row?.ilvl || row?.itemLevel || row?.ilevel || 0),
          bonus_id: Number(row?.bonus_id || 0),
          quality: Number(row?.quality || 0),
        }))
        .filter((row) => row.level > 0 && row.ilvl > 0)
        .sort((a, b) => a.level - b.level);
    }
    return grouped;
  }

  return {};
}

function getTrackLevelsForName(tracks: UpgradeTracks, trackName: string): TrackLevel[] | null {
  if (!trackName) return null;
  const normalized = normalizeTrackName(trackName);
  const direct = Object.keys(tracks).find((k) => normalizeTrackName(k) === normalized);
  if (direct) return tracks[direct];
  const lowered = trackName.trim().toLowerCase();
  const matched = Object.keys(tracks).find((k) => k.trim().toLowerCase() === lowered);
  return matched ? tracks[matched] : null;
}

export interface DropItem {
  item_id: number;
  name: string;
  icon: string;
  quality: number;
  ilevel: number;
  encounter: string;
  instance_name?: string;
  source_type?: string;
  is_catalyst?: boolean;
  can_catalyst?: boolean;
  inventory_type?: number;
  bonus_ids?: number[];
  difficulty_info?: Record<string, TrackInfo>;
  dungeon_info?: Record<string, TrackInfo>;
  specs?: number[];
  off_spec?: boolean;
}

export const QUALITY_COLORS: Record<number, string> = {
  1: 'text-gray-400',
  2: 'text-green-400',
  3: 'text-blue-400',
  4: 'text-purple-400',
  5: 'text-orange-400',
  6: 'text-amber-300',
};

export function getTrackInfo(
  item: DropItem,
  raidDiff: string,
  dungeonDiff: string
): TrackInfo | null {
  return item.dungeon_info?.[dungeonDiff] ?? item.difficulty_info?.[raidDiff] ?? null;
}

export function resolveUpgrade(
  item: DropItem,
  raidDiff: string,
  dungeonDiff: string,
  upgradeLevel: number,
  tracks: UpgradeTracks
): { ilvl: number; bonus_id: number; quality: number } {
  const base = getTrackInfo(item, raidDiff, dungeonDiff);
  if (!base || !base.track || upgradeLevel <= 0) {
    return {
      ilvl: base?.ilvl ?? item.ilevel,
      bonus_id: base?.bonus_id ?? 0,
      quality: base?.quality ?? item.quality,
    };
  }
  const trackLevels = getTrackLevelsForName(tracks, base.track);
  if (!trackLevels) return { ilvl: base.ilvl, bonus_id: base.bonus_id, quality: base.quality };
  const target = trackLevels.find((t) => t.level === upgradeLevel);
  if (!target) return { ilvl: base.ilvl, bonus_id: base.bonus_id, quality: base.quality };
  return { ilvl: target.ilvl, bonus_id: target.bonus_id, quality: target.quality };
}

export function detectClass(simcInput: string): string | null {
  const classRe =
    /^(warrior|paladin|hunter|rogue|priest|death_knight|deathknight|shaman|mage|warlock|monk|demon_hunter|demonhunter|druid|evoker)\s*=/i;

  for (const raw of simcInput.split('\n')) {
    const line = raw
      .trim()
      .replace(/^[\uFEFF\u200B\u200E\u200F]+/, '')
      .toLowerCase();
    const m = line.match(classRe);
    if (!m) continue;
    const klass = m[1];
    if (klass === 'deathknight') return 'death_knight';
    if (klass === 'demonhunter') return 'demon_hunter';
    return klass;
  }

  return null;
}

export function detectSpec(simcInput: string): string | null {
  const normalize = (value: string) => value.trim().toLowerCase().replace(/[\s-]+/g, '_');

  for (const raw of simcInput.split('\n')) {
    const line = raw
      .trim()
      .replace(/^[\uFEFF\u200B\u200E\u200F]+/, '');
    const specMatch = line.match(/^spec\s*=\s*([a-z_]+)/i);
    if (specMatch) return normalize(specMatch[1]);
  }

  // Fallback for exports that include loot_spec but no explicit spec line.
  const lootSpecMatch = simcInput.match(/^#\s*loot_spec\s*=\s*([^\r\n#]+)/im);
  if (lootSpecMatch) {
    return normalize(lootSpecMatch[1]);
  }

  return null;
}

const CLASS_SPECS: Record<string, string[]> = {
  warrior: ['arms', 'fury', 'protection'],
  paladin: ['holy', 'protection', 'retribution'],
  hunter: ['beast_mastery', 'marksmanship', 'survival'],
  rogue: ['assassination', 'outlaw', 'subtlety'],
  priest: ['discipline', 'holy', 'shadow'],
  death_knight: ['blood', 'frost', 'unholy'],
  deathknight: ['blood', 'frost', 'unholy'],
  shaman: ['elemental', 'enhancement', 'restoration'],
  mage: ['arcane', 'fire', 'frost'],
  warlock: ['affliction', 'demonology', 'destruction'],
  monk: ['brewmaster', 'mistweaver', 'windwalker'],
  druid: ['balance', 'feral', 'guardian', 'restoration'],
  demon_hunter: ['havoc', 'vengeance'],
  demonhunter: ['havoc', 'vengeance'],
  evoker: ['devastation', 'preservation', 'augmentation'],
};

export function getClassSpecs(className: string): string[] {
  return CLASS_SPECS[className] ?? [];
}

const SPEC_IDS: Record<string, number> = {
  arms: 71,
  fury: 72,
  protection_warrior: 73,
  holy_paladin: 65,
  protection_paladin: 66,
  retribution: 70,
  beast_mastery: 253,
  marksmanship: 254,
  survival: 255,
  assassination: 259,
  outlaw: 260,
  subtlety: 261,
  discipline: 256,
  holy_priest: 257,
  shadow: 258,
  blood: 250,
  frost_dk: 251,
  unholy: 252,
  elemental: 262,
  enhancement: 263,
  restoration_shaman: 264,
  arcane: 62,
  fire: 63,
  frost_mage: 64,
  affliction: 265,
  demonology: 266,
  destruction: 267,
  brewmaster: 268,
  windwalker: 269,
  mistweaver: 270,
  balance: 102,
  feral: 103,
  guardian: 104,
  restoration_druid: 105,
  havoc: 577,
  vengeance: 581,
  devastation: 1467,
  preservation: 1468,
  augmentation: 1473,
};

const CLASS_IDS: Record<string, number> = {
  warrior: 1,
  paladin: 2,
  hunter: 3,
  rogue: 4,
  priest: 5,
  death_knight: 6,
  deathknight: 6,
  shaman: 7,
  mage: 8,
  warlock: 9,
  monk: 10,
  druid: 11,
  demon_hunter: 12,
  demonhunter: 12,
  evoker: 13,
};

export function getSpecId(className: string, specName: string): number | null {
  // Handle ambiguous spec names using class context
  const key = (() => {
    switch (specName) {
      case 'protection':
        return className === 'warrior' ? 'protection_warrior' : 'protection_paladin';
      case 'holy':
        return className === 'paladin' ? 'holy_paladin' : 'holy_priest';
      case 'frost':
        return className === 'mage' ? 'frost_mage' : 'frost_dk';
      case 'restoration':
        return className === 'shaman' ? 'restoration_shaman' : 'restoration_druid';
      default:
        return specName;
    }
  })();
  return SPEC_IDS[key] ?? null;
}

export function getClassId(className: string): number | null {
  return CLASS_IDS[className] ?? null;
}

export function itemMatchesActiveLootSpec(
  itemSpecs: number[] | undefined,
  activeSpecIds: number[],
  classId: number | null
): boolean {
  if (!itemSpecs || itemSpecs.length === 0) return true;

  // Values > 13 are spec IDs. If present, they are authoritative.
  const specEntries = itemSpecs.filter((id) => id > 13);
  if (specEntries.length > 0) {
    if (activeSpecIds.length === 0) return true;
    return specEntries.some((id) => activeSpecIds.includes(id));
  }

  // Class-only restriction list (allowableClasses).
  const classEntries = itemSpecs.filter((id) => id > 0 && id <= 13);
  if (classEntries.length === 0) return true;
  if (classId == null) return true;
  return classEntries.includes(classId);
}

export function formatSpecName(spec: string): string {
  return spec.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
