import type { Instance } from '../drop-finder/types';
import type { DungeonInfo } from '../lib/api';
import type { WowExpansion, WowSeasonContent } from '../lib/wow-season-content';

const STATIC_KEYSTONE_TIMERS: Record<number, { timerMs: number; upgrades: number[] }> = {
  1272: { timerMs: 1_800_000, upgrades: [1, 2, 3] },
  1210: { timerMs: 1_800_000, upgrades: [1, 2, 3] },
  1267: { timerMs: 1_950_000, upgrades: [1, 2, 3] },
  1268: { timerMs: 1_800_000, upgrades: [1, 2, 3] },
  1298: { timerMs: 1_980_000, upgrades: [1, 2, 3] },
  1012: { timerMs: 2_340_000, upgrades: [1, 2, 3] },
  1187: { timerMs: 2_220_000, upgrades: [1, 2, 3] },
  1178: { timerMs: 1_920_000, upgrades: [1, 2, 3] },
};

const EXPANSION_ORDER: Record<string, number> = {
  classic: 0,
  'burning-crusade': 1,
  'wrath-of-the-lich-king': 2,
  cataclysm: 3,
  'mists-of-pandaria': 4,
  'warlords-of-draenor': 5,
  legion: 6,
  'battle-for-azeroth': 7,
  shadowlands: 8,
  dragonflight: 9,
  'the-war-within': 10,
  midnight: 11,
  'current-season': 12,
};

function currentMplusBucket(instances: Instance[]): Instance | undefined {
  return (
    instances.find((instance) => instance.type === 'mplus-chest') ||
    instances.find((instance) => instance.name.toLowerCase() === 'mythic+ dungeons')
  );
}

export function currentMplusInstanceIds(instances: Instance[]): number[] {
  const bucket = currentMplusBucket(instances);
  if (!bucket?.encounters?.length) return [];
  return bucket.encounters.map((encounter) => encounter.id).filter((id) => id > 0);
}

function instanceToDungeonInfo(instance: Instance): DungeonInfo {
  const encounters = (instance.encounters ?? [])
    .map((encounter) => String(encounter?.name || '').trim())
    .filter((name) => name.length > 0);

  return {
    id: instance.id,
    name: instance.name,
    description: undefined,
    zone: instance.zone || null,
    slug: undefined,
    short_name: undefined,
    wowhead_id: null,
    num_bosses: encounters.length > 0 ? encounters.length : null,
    expansion: instance.expansion ?? null,
    expansion_name: undefined,
    map_id: null,
    challenge_mode_id: null,
    minimum_level: null,
    keystone_timer_ms: null,
    keystone_upgrades: [],
    encounters,
    blizzard_href: undefined,
    image_url: instance.image_url,
    linked_code: undefined,
    blizzard_api_data: null,
  };
}

function fallbackDungeonsFromCurrentMplusBucket(instances: Instance[]): DungeonInfo[] {
  const byId = new Map(instances.map((instance) => [instance.id, instance]));
  return currentMplusInstanceIds(instances)
    .map((id) => byId.get(id))
    .filter((instance): instance is Instance => !!instance)
    .map(instanceToDungeonInfo);
}

export function filterCurrentSeasonDungeons(
  enrichedDungeons: DungeonInfo[],
  fallbackInstances: Instance[],
  activeRotationIds: Set<number>,
): DungeonInfo[] {
  const currentIds = currentMplusInstanceIds(fallbackInstances);
  if (currentIds.length > 0) {
    const currentIdSet = new Set(currentIds);
    const filtered = enrichedDungeons.filter((dungeon) => currentIdSet.has(dungeon.id));
    return filtered.length > 0 ? filtered : fallbackDungeonsFromCurrentMplusBucket(fallbackInstances);
  }

  if (activeRotationIds.size > 0) {
    return enrichedDungeons.filter((dungeon) => activeRotationIds.has(dungeon.id));
  }

  return enrichedDungeons;
}

export function seasonContentDungeonsToDungeonInfo(content: WowSeasonContent): DungeonInfo[] {
  return content.dungeons.map((dungeon) => {
    const encounters = (dungeon.encounters ?? [])
      .map((encounter) => encounter.name.trim())
      .filter((name) => name.length > 0);
    const timer = STATIC_KEYSTONE_TIMERS[dungeon.id];

    return {
      id: dungeon.id,
      name: dungeon.name,
      description: undefined,
      zone: null,
      slug: dungeon.slug,
      short_name: undefined,
      wowhead_id: null,
      num_bosses: encounters.length > 0 ? encounters.length : null,
      expansion: dungeon.expansionId,
      expansion_name: undefined,
      map_id: null,
      challenge_mode_id: dungeon.mythicPlusDungeonId ?? null,
      minimum_level: null,
      keystone_timer_ms: timer?.timerMs ?? null,
      keystone_upgrades: timer?.upgrades ?? [],
      encounters,
      blizzard_href: undefined,
      image_url: dungeon.imageUrl,
      linked_code: undefined,
      blizzard_api_data: null,
    };
  });
}

export function listDungeonExpansionOptions(
  contents: WowSeasonContent[],
  expansions: WowExpansion[],
): WowExpansion[] {
  const expansionNames = new Map(expansions.map((expansion) => [expansion.id, expansion.name]));
  const selectedIds = new Set(contents.map((content) => content.season.expansionId));
  const ordered = expansions
    .filter((expansion) => selectedIds.has(expansion.id))
    .map((expansion) => ({ id: expansion.id, name: expansion.name }));
  ordered.sort((a, b) => {
    const left = EXPANSION_ORDER[expansions.find((expansion) => expansion.id === a.id)?.slug || ''] ?? 999;
    const right = EXPANSION_ORDER[expansions.find((expansion) => expansion.id === b.id)?.slug || ''] ?? 999;
    if (left !== right) return right - left;
    return a.name.localeCompare(b.name);
  });
  for (const id of selectedIds) {
    if (!ordered.some((expansion) => expansion.id === id)) {
      ordered.push({ id, name: expansionNames.get(id) || `Expansion ${id}` });
    }
  }
  return ordered;
}

export function listDungeonSeasonOptions(
  contents: WowSeasonContent[],
  expansionId: number | null,
): WowSeasonContent[] {
  if (expansionId == null) return contents;
  return contents.filter((content) => content.season.expansionId === expansionId);
}

export function selectSeasonSlugForExpansion(
  contents: WowSeasonContent[],
  expansionId: number | null,
  currentSeasonSlug: string,
): string {
  const options = listDungeonSeasonOptions(contents, expansionId);
  if (options.some((content) => content.season.slug === currentSeasonSlug)) {
    return currentSeasonSlug;
  }
  return options.at(-1)?.season.slug ?? currentSeasonSlug;
}
