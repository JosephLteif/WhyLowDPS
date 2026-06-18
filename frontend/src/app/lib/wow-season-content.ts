import expansions from '../data/wow/wow-expansions.json';
import instances from '../data/wow/wow-instances.json';
import encounters from '../data/wow/wow-encounters.json';
import seasons from '../data/wow/wow-seasons.json';
import mythicPlusDungeons from '../data/wow/wow-mythic-plus-dungeons.json';
import { API_URL, fetchJsonCached } from './api';

export type WowInstanceType = 'raid' | 'dungeon';

export interface WowExpansion {
  id: number;
  name: string;
  slug?: string;
}

export interface WowEncounter {
  id: number;
  name: string;
  instanceId: number;
  order?: number;
}

export interface WowInstance {
  id: number;
  name: string;
  type: WowInstanceType;
  expansionId: number;
  slug?: string;
  journalInstanceId?: number;
  mythicPlusDungeonId?: number;
  encounterIds?: number[];
  encounters?: WowEncounter[];
  imageUrl?: string;
}

export interface MythicPlusDungeonMapping {
  mythicPlusDungeonId: number;
  journalInstanceId: number;
}

export interface WowSeason {
  slug: string;
  name: string;
  expansionId: number;
  patch?: string;
  startDate?: string;
  endDate?: string;
  raidInstanceIds: number[];
  mythicPlusDungeonIds: number[];
}

export interface WowSeasonContent {
  season: WowSeason;
  raids: WowInstance[];
  dungeons: WowInstance[];
}

export interface WowSeasonContentInput {
  seasons: WowSeason[];
  instances: WowInstance[];
  encounters: WowEncounter[];
  mythicPlusDungeons?: MythicPlusDungeonMapping[];
}

export interface WowSeasonContentResult {
  content: WowSeasonContent[];
  warnings: string[];
}

interface DataFileContentResponse {
  content: string;
}

export type WowInstancesByExpansion = Record<number, { raids: WowInstance[]; dungeons: WowInstance[] }>;

const EXTERNAL_LINK_KEYS = new Set([
  'wowheadUrl',
  'wowheadSearch',
  'raiderIoUrl',
  'warcraftLogsUrl',
  'links',
]);

function warnDuplicate<T, K extends string | number>(
  items: T[],
  getKey: (item: T) => K | null | undefined,
  label: string,
  warnings: string[]
) {
  const seen = new Set<K>();
  for (const item of items) {
    const key = getKey(item);
    if (key == null) continue;
    if (seen.has(key)) warnings.push(`Duplicate ${label} ${key}`);
    seen.add(key);
  }
}

function withEncounters(instance: WowInstance, encountersById: Map<number, WowEncounter[]>) {
  return {
    ...instance,
    encounters: encountersById.get(instance.id) ?? [],
  };
}

export function groupWowInstancesByExpansion(instances: WowInstance[]): WowInstancesByExpansion {
  const grouped: WowInstancesByExpansion = {};
  for (const instance of instances) {
    grouped[instance.expansionId] ??= { raids: [], dungeons: [] };
    if (instance.type === 'raid') {
      grouped[instance.expansionId].raids.push(instance);
    } else {
      grouped[instance.expansionId].dungeons.push(instance);
    }
  }
  return grouped;
}

export function buildWowSeasonContent(input: WowSeasonContentInput): WowSeasonContentResult {
  const warnings: string[] = [];
  warnDuplicate(input.seasons, (season) => season.slug, 'season slug', warnings);
  warnDuplicate(input.instances, (instance) => instance.id, 'instance id', warnings);
  warnDuplicate(input.encounters, (encounter) => encounter.id, 'encounter id', warnings);

  const instancesById = new Map(input.instances.map((instance) => [instance.id, instance]));
  const instancesByMythicPlusId = new Map<number, WowInstance>();
  for (const instance of input.instances) {
    if (instance.mythicPlusDungeonId != null) {
      instancesByMythicPlusId.set(instance.mythicPlusDungeonId, instance);
    }
  }
  for (const mapping of input.mythicPlusDungeons ?? []) {
    const instance = instancesById.get(mapping.journalInstanceId);
    if (instance) instancesByMythicPlusId.set(mapping.mythicPlusDungeonId, instance);
  }

  const encountersById = new Map(input.encounters.map((encounter) => [encounter.id, encounter]));
  const encountersByInstanceId = new Map<number, WowEncounter[]>();
  for (const encounter of input.encounters) {
    const list = encountersByInstanceId.get(encounter.instanceId) ?? [];
    list.push(encounter);
    encountersByInstanceId.set(encounter.instanceId, list);
  }

  const content = input.seasons.map((season) => {
    const raids = season.raidInstanceIds.flatMap((id) => {
      const instance = instancesById.get(id);
      if (!instance) {
        warnings.push(`Season ${season.slug} references missing raid instance id ${id}`);
        return [];
      }
      return [withEncounters(instance, encountersByInstanceId)];
    });

    const dungeons = season.mythicPlusDungeonIds.flatMap((id) => {
      const instance = instancesByMythicPlusId.get(id) ?? instancesById.get(id);
      if (!instance) {
        warnings.push(`Season ${season.slug} references missing Mythic+ dungeon id ${id}`);
        return [];
      }
      return [withEncounters(instance, encountersByInstanceId)];
    });

    return { season, raids, dungeons };
  });

  for (const instance of input.instances) {
    for (const encounterId of instance.encounterIds ?? []) {
      if (!encountersById.has(encounterId)) {
        warnings.push(`Instance ${instance.id} references missing encounter id ${encounterId}`);
      }
    }
  }

  return { content, warnings };
}

export function validateNoExternalLinkFields(value: unknown): string[] {
  const warnings: string[] = [];

  function visit(node: unknown, path: string) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach((child, index) => visit(child, `${path}[${index}]`));
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      const childPath = `${path}.${key}`;
      if (EXTERNAL_LINK_KEYS.has(key)) warnings.push(`External link field found at ${childPath}`);
      visit(child, childPath);
    }
  }

  visit(value, 'root');
  return warnings;
}

export function selectDefaultWowSeasonSlug(
  seasons: WowSeason[],
  now: Date = new Date(),
): string | undefined {
  const today = now.toISOString().slice(0, 10);
  const sorted = [...seasons].sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));
  const active = [...sorted]
    .reverse()
    .find(
      (season) =>
        (!season.startDate || season.startDate <= today) &&
        (!season.endDate || season.endDate >= today),
    );
  if (active) return active.slug;

  const mostRecentStarted = [...sorted]
    .reverse()
    .find((season) => !season.startDate || season.startDate <= today);
  return mostRecentStarted?.slug ?? sorted.at(-1)?.slug;
}

export const wowExpansions = expansions as WowExpansion[];
export const wowInstances = instances as WowInstance[];
export const wowEncounters = encounters as WowEncounter[];
export const wowSeasons = seasons as WowSeason[];
export const wowMythicPlusDungeons = mythicPlusDungeons as MythicPlusDungeonMapping[];

export function getStaticWowSeasonContent(): WowSeasonContentResult {
  return buildWowSeasonContent({
    seasons: wowSeasons,
    instances: wowInstances,
    encounters: wowEncounters,
    mythicPlusDungeons: wowMythicPlusDungeons,
  });
}

async function fetchDataFileArray<T>(key: string): Promise<T[]> {
  const response = await fetchJsonCached<DataFileContentResponse>(
    `${API_URL}/api/data/files/${key}`,
    { ttl: 60_000 },
  );
  const parsed = JSON.parse(response.content);
  return Array.isArray(parsed) ? (parsed as T[]) : [];
}

export async function getRuntimeWowSeasonContent(): Promise<{
  expansions: WowExpansion[];
  seasons: WowSeason[];
  result: WowSeasonContentResult;
}> {
  try {
    const [runtimeExpansions, runtimeInstances, runtimeEncounters, runtimeSeasons, runtimeMplus] =
      await Promise.all([
        fetchDataFileArray<WowExpansion>('wow_expansions'),
        fetchDataFileArray<WowInstance>('wow_instances'),
        fetchDataFileArray<WowEncounter>('wow_encounters'),
        fetchDataFileArray<WowSeason>('wow_seasons'),
        fetchDataFileArray<MythicPlusDungeonMapping>('wow_mythic_plus_dungeons'),
      ]);
    return {
      expansions: runtimeExpansions,
      seasons: runtimeSeasons,
      result: buildWowSeasonContent({
        seasons: runtimeSeasons,
        instances: runtimeInstances,
        encounters: runtimeEncounters,
        mythicPlusDungeons: runtimeMplus,
      }),
    };
  } catch {
    return {
      expansions: wowExpansions,
      seasons: wowSeasons,
      result: getStaticWowSeasonContent(),
    };
  }
}
