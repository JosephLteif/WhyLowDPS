'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  API_URL,
  DungeonAffix,
  DungeonInfo,
  DungeonSeasonData,
  fetchJson,
  GameDataState,
  getDungeonData,
  getDungeonDataCached,
  getGameDataState,
  getGameDataStateCached,
  getMythicKeystoneDungeonDetail,
  getMythicKeystoneDungeonIndex,
  type MythicKeystoneDungeonDetail,
  triggerDungeonDataRefresh,
} from '../lib/api';
import { useWowheadTooltips } from '../lib/useWowheadTooltips';
import type { Instance } from '../drop-finder/types';

const DUNGEON_PLACEHOLDERS: Record<string, { icon: string; zone: string }> = {
  'Siege of Boralus': { icon: 'https://wow.zamimages.com/logo/PoS.jpg', zone: 'Darkshore' },
  Atalzar: { icon: 'https://wow.zamimages.com/logo/Atalzar.jpg', zone: 'Nazmir' },
  Freehold: { icon: 'https://wow.zamimages.com/logo/Freehold.jpg', zone: 'Zuldazar' },
  'Kings Rest': { icon: 'https://wow.zamimages.com/logo/KingsRest.jpg', zone: 'Zuldazar' },
  'Temple of Sethraliss': {
    icon: 'https://wow.zamimages.com/logo/TempleSethraliss.jpg',
    zone: 'Zuljan Reach',
  },
  'Shrine of the Storm': { icon: 'https://wow.zamimages.com/logo/Shrine.jpg', zone: 'Vol dun' },
  'Necrotic Wake': { icon: 'https://wow.zamimages.com/logo/NecroticWake.jpg', zone: 'Maldraxxus' },
  Plaguefall: { icon: 'https://wow.zamimages.com/logo/Plaguefall.jpg', zone: 'Maldraxxus' },
  'Halls of Atonement': {
    icon: 'https://wow.zamimages.com/logo/HallsAtonement.jpg',
    zone: 'Maldraxxus',
  },
  'Spires of Ascension': {
    icon: 'https://wow.zamimages.com/logo/SpiresAscension.jpg',
    zone: 'Bastion',
  },
  'Sanguine Depths': {
    icon: 'https://wow.zamimages.com/logo/SanguineDepths.jpg',
    zone: 'Maldraxxus',
  },
  'Theater of Pain': { icon: 'https://wow.zamimages.com/logo/TheaterPain.jpg', zone: 'Maldraxxus' },
  Tazavesh: { icon: 'https://wow.zamimages.com/logo/Tazavesh.jpg', zone: 'Mechagon' },
};

function getDungeonPlaceholder(name: string) {
  const lower = name.toLowerCase();
  for (const [key, val] of Object.entries(DUNGEON_PLACEHOLDERS)) {
    if (lower.includes(key.toLowerCase())) {
      return val;
    }
  }
  return null;
}

function formatMs(ms?: number | null): string | null {
  if (!ms || ms <= 0) return null;
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function normalizeMplusName(name: string): string {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function normalizeImageUrl(url?: string | null): string | undefined {
  return url ?? undefined;
}

function mergeWithPreviousDungeonData(
  nextDungeons: DungeonInfo[],
  previousDungeons?: DungeonInfo[],
): DungeonInfo[] {
  if (!previousDungeons || previousDungeons.length === 0) {
    return nextDungeons;
  }

  const previousById = new Map<number, DungeonInfo>();
  const previousByName = new Map<string, DungeonInfo>();
  for (const dungeon of previousDungeons) {
    previousById.set(dungeon.id, dungeon);
    previousByName.set(normalizeDungeonName(dungeon.name), dungeon);
  }

  return nextDungeons.map((dungeon) => {
    const previous =
      previousById.get(dungeon.id) || previousByName.get(normalizeDungeonName(dungeon.name));
    if (!previous) return dungeon;

    const encounters =
      dungeon.encounters && dungeon.encounters.length > 0
        ? dungeon.encounters
        : (previous.encounters ?? []);
    const keystoneUpgrades =
      dungeon.keystone_upgrades && dungeon.keystone_upgrades.length > 0
        ? dungeon.keystone_upgrades
        : (previous.keystone_upgrades ?? []);

    return {
      ...dungeon,
      description: dungeon.description || previous.description,
      zone: dungeon.zone || previous.zone,
      slug: dungeon.slug || previous.slug,
      short_name: dungeon.short_name || previous.short_name,
      wowhead_id: dungeon.wowhead_id ?? previous.wowhead_id,
      num_bosses:
        dungeon.num_bosses ?? previous.num_bosses ?? (encounters.length > 0 ? encounters.length : null),
      expansion: dungeon.expansion ?? previous.expansion,
      expansion_name: dungeon.expansion_name || previous.expansion_name,
      map_id: dungeon.map_id ?? previous.map_id,
      challenge_mode_id: dungeon.challenge_mode_id ?? previous.challenge_mode_id,
      minimum_level: dungeon.minimum_level ?? previous.minimum_level,
      keystone_timer_ms: dungeon.keystone_timer_ms ?? previous.keystone_timer_ms,
      keystone_upgrades: keystoneUpgrades,
      encounters,
      blizzard_href: dungeon.blizzard_href || previous.blizzard_href,
      image_url: dungeon.image_url || previous.image_url,
      linked_code: dungeon.linked_code || previous.linked_code,
      blizzard_api_data: dungeon.blizzard_api_data ?? previous.blizzard_api_data,
    };
  });
}

function getLocalInstanceImageUrl(instanceId?: number | null): string | null {
  if (!instanceId || instanceId <= 0) return null;
  return `${API_URL}/api/data/images/instance/${instanceId}?v=bapi3`;
}

function normalizeDungeonName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function getCurrentMplusDungeonIds(instances: Instance[]): Set<number> {
  const mplusBucket =
    instances.find((instance) => instance.type === 'mplus-chest') ||
    instances.find((instance) => instance.name.toLowerCase() === 'mythic+ dungeons');
  if (!mplusBucket || !mplusBucket.encounters?.length) {
    return new Set<number>();
  }
  return new Set<number>(mplusBucket.encounters.map((encounter) => encounter.id));
}

function getRaidInstances(instances: Instance[]): Instance[] {
  return instances.filter((instance) => String(instance.type || '').toLowerCase() === 'raid');
}

function mergeWithInstancesFallback(dungeons: DungeonInfo[], instances: Instance[]): DungeonInfo[] {
  if (!instances.length) return dungeons;

  const instancesById = new Map<number, Instance>();
  const instancesByName = new Map<string, Instance>();
  for (const instance of instances) {
    instancesById.set(instance.id, instance);
    instancesByName.set(normalizeDungeonName(instance.name), instance);
  }

  return dungeons.map((dungeon) => {
    const fallback =
      instancesById.get(dungeon.id) || instancesByName.get(normalizeDungeonName(dungeon.name));
    if (!fallback) return dungeon;

    const fallbackEncounterNames = (fallback.encounters ?? [])
      .map((encounter) => encounter.name)
      .filter((name): name is string => !!name);
    const hasEncounterNames = (dungeon.encounters?.length ?? 0) > 0;
    const mergedEncounters: string[] = hasEncounterNames
      ? (dungeon.encounters ?? [])
      : fallbackEncounterNames;
    const mergedNumBosses =
      dungeon.num_bosses && dungeon.num_bosses > 0
        ? dungeon.num_bosses
        : mergedEncounters.length > 0
          ? mergedEncounters.length
          : null;

    return {
      ...dungeon,
      zone: dungeon.zone || fallback.zone || null,
      encounters: mergedEncounters,
      num_bosses: mergedNumBosses,
    };
  });
}

function normalizeAffixName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

type DisplayAffix = DungeonAffix & {
  wowhead_url?: string | null;
};
type WowheadZoneIndexEntry = {
  id?: number;
  name?: string;
  instance?: number;
  is_raid?: boolean;
  is_dungeon?: boolean;
  expansion?: number | null;
  url?: string;
  encounters?: Array<{ name?: string }>;
};

function AffixCard({ affix }: { affix: DisplayAffix }) {
  const iconUrl = affix.icon || null;
  const wowheadUrl =
    affix.wowhead_url || (affix.spell_id ? `https://wowhead.com/spell=${affix.spell_id}` : null);
  const iconNode = iconUrl ? (
    <img src={iconUrl} alt="" className="h-10 w-10 rounded object-cover" loading="lazy" />
  ) : (
    <span className="text-xl font-bold text-gold">{affix.name[0]}</span>
  );
  const wrappedIconNode = wowheadUrl ? (
    <a
      href={wowheadUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex h-10 w-10 items-center justify-center"
      aria-label={`Open ${affix.name} on Wowhead`}
    >
      {iconNode}
    </a>
  ) : (
    iconNode
  );

  return (
    <div className="flex items-center gap-3 rounded-lg border border-white/15 bg-zinc-900/75 p-4">
      <div
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md border border-white/10 bg-zinc-800">
        {wrappedIconNode}
      </div>
      <div className="min-w-0 flex-1">
        <p className="mb-1 text-lg font-bold leading-tight text-zinc-100 break-words">{affix.name}</p>
        <p className="text-sm leading-6 text-zinc-300 break-words">{affix.description}</p>
      </div>
    </div>
  );
}

function InfoPill({ label, value }: { label: string; value?: string | number | null }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <span className="rounded-md border border-white/10 bg-black/20 px-2 py-1 text-[11px] text-zinc-300">
      <span className="mr-1 text-zinc-500">{label}:</span>
      {value}
    </span>
  );
}

function DungeonCard({
  dungeon,
  mplusDetail,
}: {
  dungeon: DungeonInfo;
  seasonName?: string;
  mplusDetail?: MythicKeystoneDungeonDetail | null;
}) {
  const router = useRouter();
  const placeholder = !dungeon.image_url ? getDungeonPlaceholder(dungeon.name) : null;
  const localInstanceImage = getLocalInstanceImageUrl(dungeon.id);
  const imageUrl = localInstanceImage || dungeon.image_url || placeholder?.icon;
  const [imageFailed, setImageFailed] = useState(false);
  const zone = dungeon.zone || placeholder?.zone;
  const detailUpgrades = (mplusDetail?.keystone_upgrades ?? [])
    .map((upgrade) => ({
      upgrade_level: Number(upgrade?.upgrade_level ?? 0),
      qualifying_duration: Number(upgrade?.qualifying_duration ?? 0),
    }))
    .filter((upgrade) => upgrade.upgrade_level > 0 && upgrade.qualifying_duration > 0)
    .sort((a, b) => a.upgrade_level - b.upgrade_level);
  const oneChestDuration =
    detailUpgrades.find((upgrade) => upgrade.upgrade_level === 1)?.qualifying_duration ?? null;
  const timer = formatMs(dungeon.keystone_timer_ms ?? oneChestDuration);
  const encounterCount = dungeon.encounters?.length || dungeon.num_bosses || null;
  const wowheadZoneUrl =
    dungeon.wowhead_id && dungeon.wowhead_id > 0
      ? `https://www.wowhead.com/zone=${dungeon.wowhead_id}`
      : null;
  const rawPayload = dungeon.blizzard_api_data
    ? JSON.stringify(dungeon.blizzard_api_data, null, 2)
    : null;

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={() => router.push(`/dungeons/${dungeon.id}`)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          router.push(`/dungeons/${dungeon.id}`);
        }
      }}
      className="group block rounded-xl border border-white/15 bg-zinc-900/80 p-4 transition-all hover:border-gold/50 hover:bg-zinc-900"
    >
      {imageUrl && !imageFailed ? (
        <div className="relative mb-3 h-28 w-full overflow-hidden rounded-lg border border-white/10 bg-zinc-900">
          <img
            src={imageUrl}
            alt=""
            className="h-full w-full object-cover object-center"
            loading="lazy"
            onError={() => setImageFailed(true)}
          />
        </div>
      ) : (
        <div
          className="relative mb-3 flex h-28 w-full items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-black">
          <img
            src="/wow-logo.png"
            alt="WoW"
            className="h-[64%] w-[64%] max-h-24 max-w-24 object-contain opacity-95"
            loading="lazy"
          />
        </div>
      )}

      <div className="mb-3 min-w-0">
        <p className="truncate text-xl font-bold leading-tight text-zinc-100 sm:text-2xl">
          {dungeon.name}
        </p>
        {zone && <p className="truncate text-sm text-zinc-300">{zone}</p>}
        {dungeon.description && (
          <p className="mt-1 line-clamp-2 text-sm text-zinc-200">{dungeon.description}</p>
        )}
        {wowheadZoneUrl && (
          <div className="mt-2">
            <a
              href={wowheadZoneUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center rounded-md border border-gold/35 bg-gold/10 px-2 py-1 text-xs font-semibold text-gold transition-colors hover:bg-gold/20"
              aria-label={`Open ${dungeon.name} on Wowhead`}
            >
              View on Wowhead
            </a>
          </div>
        )}
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        <InfoPill label="Min level" value={dungeon.minimum_level} />
        <InfoPill label="Timer" value={timer} />
        <InfoPill label="Map ID" value={dungeon.map_id} />
        <InfoPill label="Challenge ID" value={dungeon.challenge_mode_id} />
        <InfoPill label="Slug" value={dungeon.slug} />
        <InfoPill label="Short" value={dungeon.short_name} />
      </div>

      {detailUpgrades.length > 0 ? (
        <div className="mb-2">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">
            Keystone Upgrade Timers
          </p>
          <div className="flex flex-wrap gap-1.5">
            {detailUpgrades.map((upgrade) => (
              <span
                key={`${dungeon.id}-upgrade-${upgrade.upgrade_level}`}
                className="rounded bg-gold/10 px-2 py-0.5 text-[11px] text-gold"
              >
                +{upgrade.upgrade_level} ({formatMs(upgrade.qualifying_duration)})
              </span>
            ))}
          </div>
        </div>
      ) : dungeon.keystone_upgrades && dungeon.keystone_upgrades.length > 0 ? (
        <div className="mb-2">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">
            Keystone Upgrades
          </p>
          <div className="flex flex-wrap gap-1.5">
            {dungeon.keystone_upgrades.map((upgrade) => (
              <span key={upgrade} className="rounded bg-gold/10 px-2 py-0.5 text-[11px] text-gold">
                +{upgrade}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {dungeon.encounters && dungeon.encounters.length > 0 && (
        <div className="mb-2">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">
            Encounters ({encounterCount})
          </p>
          <ul className="space-y-1 text-sm text-zinc-100">
            {dungeon.encounters.map((encounter) => (
              <li key={encounter}>{encounter}</li>
            ))}
          </ul>
        </div>
      )}

      {rawPayload && (
        <details className="mt-2 rounded-md border border-white/10 bg-black/20 p-2">
          <summary className="cursor-pointer text-xs font-semibold text-zinc-400">
            Blizzard API Raw Data
          </summary>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-[10px] leading-4 text-zinc-400">
            {rawPayload}
          </pre>
        </details>
      )}
    </article>
  );
}

export default function DungeonsPage() {
  const [data, setData] = useState<DungeonSeasonData | null>(null);
  const [mplusDetailsByName, setMplusDetailsByName] = useState<Record<string, MythicKeystoneDungeonDetail>>({});
  const [gameState, setGameState] = useState<GameDataState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [raids, setRaids] = useState<DungeonInfo[]>([]);
  const hasDungeons = (data?.rotation_dungeons?.length ?? 0) > 0;
  const backendError = (data as (DungeonSeasonData & { error?: string }) | null)?.error;
  const hasAnyBlizzardDetails =
    data?.rotation_dungeons?.some((d) => d.blizzard_href || d.blizzard_api_data) ?? false;
  const displayedAffixes: DisplayAffix[] = (() => {
    const backendAffixes = data?.current_affixes ?? [];
    if (!gameState?.active_affixes?.length) {
      return backendAffixes;
    }
    const byName = new Map<string, DisplayAffix>(
      backendAffixes.map((affix) => [normalizeAffixName(affix.name), affix]),
    );
    return gameState.active_affixes.map((name, idx) => {
      const matched = byName.get(normalizeAffixName(name));
      if (matched) return matched;
      return {
        id: 900000 + idx,
        name,
        description: '',
        icon: null,
        spell_id: null,
      };
    });
  })();
  const affixSource = 'Raider.IO (live)';

  useWowheadTooltips([data?.current_affixes, data?.rotation_dungeons]);

  useEffect(() => {
    let cancelled = false;

    const loadDungeonData = async (preferCache: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const [seasonData, gameDataState, fallbackInstances, wowheadIndexResp] = await Promise.all([
          preferCache ? getDungeonDataCached() : getDungeonData(),
          (preferCache ? getGameDataStateCached() : getGameDataState()).catch(
            () => null as GameDataState | null,
          ),
          fetchJson<Instance[]>(`${API_URL}/api/instances`).catch(() => [] as Instance[]),
          fetchJson<{ zones?: WowheadZoneIndexEntry[] }>(
            `${API_URL}/api/data/wowhead-zones-index`,
          ).catch(() => ({ zones: [] })),
        ]);
        const wowheadZoneIdByName = new Map<string, number>();
        const parsedZones: WowheadZoneIndexEntry[] = [];
        {
          const zones = Array.isArray(wowheadIndexResp?.zones) ? wowheadIndexResp.zones : [];
          parsedZones.push(...zones);
          for (const zone of zones) {
            const zid = Number(zone?.id ?? 0);
            const zname = typeof zone?.name === 'string' ? zone.name : '';
            if (zid > 0 && zname) {
              wowheadZoneIdByName.set(normalizeDungeonName(zname), zid);
            }
          }
        }
        const zonesByName = new Map<string, WowheadZoneIndexEntry>();
        for (const zone of parsedZones) {
          const n = typeof zone?.name === 'string' ? normalizeDungeonName(zone.name) : '';
          if (n && !zonesByName.has(n)) zonesByName.set(n, zone);
        }
        const zoneRaidRows: DungeonInfo[] = parsedZones
          .filter((zone) => zone?.is_raid === true)
          .map((zone) => {
            const zid = Number(zone?.id ?? 0);
            const name = String(zone?.name || '').trim();
            const matchedInstance = fallbackInstances.find(
              (inst) => normalizeDungeonName(inst.name) === normalizeDungeonName(name),
            );
            const encounters = Array.isArray(zone?.encounters)
              ? zone.encounters.map((e) => String(e?.name || '').trim()).filter((n) => n.length > 0)
              : (matchedInstance?.encounters || []).map((e) => String(e?.name || '').trim()).filter((n) => n.length > 0);
            return ({
              id: matchedInstance?.id ?? zid,
              name: name || `Raid ${zid}`,
              description: undefined,
              zone: matchedInstance?.zone || 'Raid',
              slug: undefined,
              short_name: undefined,
              wowhead_id: zid > 0 ? zid : null,
              num_bosses: encounters.length > 0 ? encounters.length : null,
              expansion: typeof zone?.expansion === 'number' ? zone.expansion : null,
              expansion_name: undefined,
              map_id: null,
              challenge_mode_id: null,
              minimum_level: null,
              keystone_timer_ms: null,
              keystone_upgrades: [],
              encounters,
              blizzard_href: undefined,
              image_url: normalizeImageUrl(getLocalInstanceImageUrl(matchedInstance?.id ?? zid)),
              linked_code: undefined,
              blizzard_api_data: null,
            } as unknown as DungeonInfo);
          })
          .filter((row) => row.id > 0);

        const fallbackRaidRows: DungeonInfo[] = getRaidInstances(fallbackInstances)
          .map((raid) => {
            const matchedZone = zonesByName.get(normalizeDungeonName(raid.name));
            const zid = Number(matchedZone?.id ?? 0);
            const encounters = Array.isArray(matchedZone?.encounters)
              ? matchedZone.encounters
                  .map((e) => String(e?.name || '').trim())
                  .filter((n) => n.length > 0)
              : (raid.encounters || [])
                  .map((e) => String(e?.name || '').trim())
                  .filter((n) => n.length > 0);
            return ({
              id: raid.id,
              name: raid.name,
              description: undefined,
              zone: raid.zone || 'Raid',
              slug: undefined,
              short_name: undefined,
              wowhead_id: zid > 0 ? zid : null,
              num_bosses: encounters.length > 0 ? encounters.length : null,
              expansion: typeof matchedZone?.expansion === 'number' ? matchedZone.expansion : null,
              expansion_name: undefined,
              map_id: null,
              challenge_mode_id: null,
              minimum_level: null,
              keystone_timer_ms: null,
              keystone_upgrades: [],
              encounters,
              blizzard_href: undefined,
              image_url: normalizeImageUrl(getLocalInstanceImageUrl(raid.id)),
              linked_code: undefined,
              blizzard_api_data: null,
            } as unknown as DungeonInfo);
          })
          .sort((a, b) => a.name.localeCompare(b.name));
        const raidRows: DungeonInfo[] = (zoneRaidRows.length > 0 ? zoneRaidRows : fallbackRaidRows).sort(
          (a, b) => a.name.localeCompare(b.name),
        );
        const activeRotationIds = new Set<number>(gameDataState?.mplus_rotation ?? []);
        const currentMplusIds = getCurrentMplusDungeonIds(fallbackInstances);
        const mergedWithFallback = mergeWithInstancesFallback(
          seasonData.rotation_dungeons,
          fallbackInstances,
        );

        const enrichedDungeons = mergedWithFallback.map((dungeon) => {
          const localInstanceImage = getLocalInstanceImageUrl(dungeon.id);
          const matchedWowheadId =
            wowheadZoneIdByName.get(normalizeDungeonName(dungeon.name)) ??
            (dungeon.wowhead_id && dungeon.wowhead_id > 0 ? dungeon.wowhead_id : null);

          return {
            ...dungeon,
            wowhead_id: matchedWowheadId,
            image_url: normalizeImageUrl(localInstanceImage || dungeon.image_url),
          };
        });
        const filteredDungeons =
          currentMplusIds.size > 0
            ? enrichedDungeons.filter((dungeon) => currentMplusIds.has(dungeon.id))
            : activeRotationIds.size > 0
            ? enrichedDungeons.filter((dungeon) => activeRotationIds.has(dungeon.id))
            : enrichedDungeons;

        if (!cancelled) {
          setGameState(gameDataState);
          setRaids(raidRows);
          setData((previous) => ({
            ...seasonData,
            rotation_dungeons: mergeWithPreviousDungeonData(
              filteredDungeons,
              previous?.rotation_dungeons,
            ),
          }));
        }
      } catch (err) {
        if (!cancelled) {
          setData(null);
          setError(err instanceof Error ? err.message : 'Failed to load dungeon data.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadDungeonData(true);

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadMplusDetails = async () => {
      if (!data?.rotation_dungeons?.length) {
        setMplusDetailsByName({});
        return;
      }
      try {
        const index = await getMythicKeystoneDungeonIndex('us');
        const indexByName = new Map<number | string, number>();
        for (const row of index?.dungeons || []) {
          const key = normalizeMplusName(row?.name || '');
          const id = Number(row?.id ?? 0);
          if (key && id > 0) indexByName.set(key, id);
        }

        const dungeonIds = Array.from(
          new Set(
            data.rotation_dungeons
              .map((dungeon) => {
                const matchedFromName = indexByName.get(normalizeMplusName(dungeon.name));
                const fallbackId = Number(dungeon.id ?? 0);
                return Number(matchedFromName ?? fallbackId);
              })
              .filter((id) => Number.isFinite(id) && id > 0),
          ),
        );
        const details = await Promise.all(
          dungeonIds.map((id) => getMythicKeystoneDungeonDetail(id, 'us').catch(() => null)),
        );
        if (cancelled) return;
        const byName: Record<string, MythicKeystoneDungeonDetail> = {};
        for (const detail of details) {
          if (!detail || typeof detail !== 'object') continue;
          const key = normalizeMplusName(detail.name || '');
          if (key) byName[key] = detail;
        }
        setMplusDetailsByName(byName);
      } catch {
        if (!cancelled) setMplusDetailsByName({});
      }
    };
    loadMplusDetails();
    return () => {
      cancelled = true;
    };
  }, [data?.rotation_dungeons]);

  const waitForDungeonSyncCompletion = async () => {
    const timeoutMs = 20000;
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      try {
        const status = await fetchJson<{ status?: string }>(`${API_URL}/api/data/status`);
        const value = (status.status || '').toLowerCase();
        if (value === 'ready' || value === 'error' || value === 'needs_credentials') {
          return;
        }
      } catch {
        return;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 700));
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      await triggerDungeonDataRefresh(true);
      await waitForDungeonSyncCompletion();
      const [seasonData, gameDataState, fallbackInstances, wowheadIndexResp] = await Promise.all([
        getDungeonData(),
        getGameDataState().catch(() => null as GameDataState | null),
        fetchJson<Instance[]>(`${API_URL}/api/instances`).catch(() => [] as Instance[]),
        fetchJson<{ zones?: WowheadZoneIndexEntry[] }>(
          `${API_URL}/api/data/wowhead-zones-index`,
        ).catch(() => ({ zones: [] })),
      ]);
      const parsedZones: WowheadZoneIndexEntry[] = [];
      const zones = Array.isArray(wowheadIndexResp?.zones) ? wowheadIndexResp.zones : [];
      parsedZones.push(...zones);
      const zonesByName = new Map<string, WowheadZoneIndexEntry>();
      for (const zone of parsedZones) {
        const n = typeof zone?.name === 'string' ? normalizeDungeonName(zone.name) : '';
        if (n && !zonesByName.has(n)) zonesByName.set(n, zone);
      }
      const zoneRaidRows: DungeonInfo[] = parsedZones
        .filter((zone) => zone?.is_raid === true)
        .map((zone) => {
          const zid = Number(zone?.id ?? 0);
          const name = String(zone?.name || '').trim();
          const matchedInstance = fallbackInstances.find(
            (inst) => normalizeDungeonName(inst.name) === normalizeDungeonName(name),
          );
          const encounters = Array.isArray(zone?.encounters)
            ? zone.encounters.map((e) => String(e?.name || '').trim()).filter((n) => n.length > 0)
            : (matchedInstance?.encounters || []).map((e) => String(e?.name || '').trim()).filter((n) => n.length > 0);
          return ({
            id: matchedInstance?.id ?? zid,
            name: name || `Raid ${zid}`,
            description: undefined,
            zone: matchedInstance?.zone || 'Raid',
            slug: undefined,
            short_name: undefined,
            wowhead_id: zid > 0 ? zid : null,
            num_bosses: encounters.length > 0 ? encounters.length : null,
            expansion: typeof zone?.expansion === 'number' ? zone.expansion : null,
            expansion_name: undefined,
            map_id: null,
            challenge_mode_id: null,
            minimum_level: null,
            keystone_timer_ms: null,
            keystone_upgrades: [],
            encounters,
            blizzard_href: undefined,
            image_url: normalizeImageUrl(getLocalInstanceImageUrl(matchedInstance?.id ?? zid)),
            linked_code: undefined,
            blizzard_api_data: null,
          } as unknown as DungeonInfo);
        })
        .filter((row) => row.id > 0);

      const fallbackRaidRows: DungeonInfo[] = getRaidInstances(fallbackInstances)
        .map((raid) => {
          const matchedZone = zonesByName.get(normalizeDungeonName(raid.name));
          const zid = Number(matchedZone?.id ?? 0);
          const encounters = Array.isArray(matchedZone?.encounters)
            ? matchedZone.encounters
                .map((e) => String(e?.name || '').trim())
                .filter((n) => n.length > 0)
            : (raid.encounters || [])
                .map((e) => String(e?.name || '').trim())
                .filter((n) => n.length > 0);
          return ({
            id: raid.id,
            name: raid.name,
            description: undefined,
            zone: raid.zone || 'Raid',
            slug: undefined,
            short_name: undefined,
            wowhead_id: zid > 0 ? zid : null,
            num_bosses: encounters.length > 0 ? encounters.length : null,
            expansion: typeof matchedZone?.expansion === 'number' ? matchedZone.expansion : null,
            expansion_name: undefined,
            map_id: null,
            challenge_mode_id: null,
            minimum_level: null,
            keystone_timer_ms: null,
            keystone_upgrades: [],
            encounters,
            blizzard_href: undefined,
            image_url: normalizeImageUrl(getLocalInstanceImageUrl(raid.id)),
            linked_code: undefined,
            blizzard_api_data: null,
          } as unknown as DungeonInfo);
        })
        .sort((a, b) => a.name.localeCompare(b.name));
      const raidRows: DungeonInfo[] = (zoneRaidRows.length > 0 ? zoneRaidRows : fallbackRaidRows).sort(
        (a, b) => a.name.localeCompare(b.name),
      );
      const activeRotationIds = new Set<number>(gameDataState?.mplus_rotation ?? []);
      const currentMplusIds = getCurrentMplusDungeonIds(fallbackInstances);
      const mergedWithFallback = mergeWithInstancesFallback(
        seasonData.rotation_dungeons,
        fallbackInstances,
      );

      const enrichedDungeons = mergedWithFallback.map((dungeon) => {
        const localInstanceImage = getLocalInstanceImageUrl(dungeon.id);

        return {
          ...dungeon,
          image_url: normalizeImageUrl(localInstanceImage || dungeon.image_url),
        };
      });
      const filteredDungeons =
        currentMplusIds.size > 0
          ? enrichedDungeons.filter((dungeon) => currentMplusIds.has(dungeon.id))
          : activeRotationIds.size > 0
          ? enrichedDungeons.filter((dungeon) => activeRotationIds.has(dungeon.id))
          : enrichedDungeons;

      setGameState(gameDataState);
      setRaids(raidRows);
      setData((previous) => ({
        ...seasonData,
        rotation_dungeons: mergeWithPreviousDungeonData(
          filteredDungeons,
          previous?.rotation_dungeons,
        ),
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh dungeon data.');
    } finally {
      setRefreshing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-96 flex-col items-center justify-center gap-4">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-zinc-800 border-t-gold" />
        <p className="text-sm font-medium text-zinc-500">Loading dungeon data...</p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="mx-auto max-w-lg py-20 text-center">
        <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-red-500/10 text-red-500">
          <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        </div>
        <h2 className="mb-2 text-xl font-bold text-zinc-200">Failed to Load Data</h2>
        <p className="mb-6 text-zinc-500">{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="rounded-lg bg-gold px-4 py-2 text-sm font-bold text-black"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white lg:text-4xl">
            Mythic+ Dungeons
          </h1>
          <p className="mt-2 text-base font-semibold text-zinc-300">
            {data?.season_name || 'Current Season'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleRefresh()}
            disabled={refreshing}
            className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm font-medium text-zinc-200 transition-colors hover:border-gold/60 hover:text-gold disabled:cursor-not-allowed disabled:opacity-60"
          >
            {refreshing ? 'Refreshing...' : 'Refresh Dungeons'}
          </button>
        </div>
      </div>

      {data && (
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-white/15 bg-zinc-900/70 p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Season</p>
            <p className="mt-2 text-2xl font-extrabold text-white">{data.season_name}</p>
          </div>
          <div className="rounded-xl border border-white/15 bg-zinc-900/70 p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Dungeons</p>
            <p className="mt-2 text-2xl font-extrabold text-white">{data.rotation_dungeons.length}</p>
            <p className="text-sm font-medium text-zinc-300">Currently in rotation</p>
          </div>
          <div className="rounded-xl border border-white/15 bg-zinc-900/70 p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Affixes</p>
            <p className="mt-2 text-2xl font-extrabold text-white">{data.current_affixes.length}</p>
            <p className="text-sm font-medium text-zinc-300">Active this week</p>
          </div>
        </section>
      )}

      {displayedAffixes.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-base font-bold uppercase tracking-wider text-zinc-300">
            This Week&apos;s Affixes
          </h2>
          <p className="text-sm font-medium text-zinc-400">Source: {affixSource}</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {displayedAffixes.map((affix) => (
              <AffixCard key={affix.id} affix={affix} />
            ))}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-base font-bold uppercase tracking-wider text-zinc-300">
          Season Dungeons ({data?.rotation_dungeons?.length || 0})
        </h2>
        {hasDungeons && !!backendError && !hasAnyBlizzardDetails && (
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            Blizzard dungeon detail payload is missing in local runtime cache. Showing best
            available fallback data from instances.
          </div>
        )}
        {data?.rotation_dungeons && data.rotation_dungeons.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.rotation_dungeons.map((dungeon) => (
              <DungeonCard
                key={dungeon.id}
                dungeon={dungeon}
                seasonName={data.season_name}
                mplusDetail={mplusDetailsByName[normalizeMplusName(dungeon.name)] || null}
              />
            ))}
          </div>
        ) : (
          <div className="border-white/8 rounded-xl border bg-white/[0.02] px-4 py-6 text-center">
            <p className="text-sm text-zinc-500">No dungeons available</p>
            <p className="mt-2 text-xs text-zinc-600">Dungeon data is currently unavailable.</p>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-bold uppercase tracking-wider text-zinc-300">
          Raids ({raids.length})
        </h2>
        {raids.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {raids.map((raid) => (
              <DungeonCard key={`raid-${raid.id}`} dungeon={raid} mplusDetail={null} />
            ))}
          </div>
        ) : (
          <div className="border-white/8 rounded-xl border bg-white/[0.02] px-4 py-6 text-center">
            <p className="text-sm text-zinc-500">No raids available</p>
            <p className="mt-2 text-xs text-zinc-600">
              Raid data is loaded from zones-encounters-index.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
