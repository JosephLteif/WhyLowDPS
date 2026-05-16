'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import {
  API_URL,
  DungeonInfo,
  DungeonSeasonData,
  fetchJson,
  fetchJsonCached,
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
import {
  AffixCard,
  DisplayAffix,
  DungeonCard,
  getCurrentMplusDungeonIds,
  getLocalInstanceImageUrl,
  getRaidInstances,
  mergeWithInstancesFallback,
  normalizeAffixName,
  normalizeDungeonName,
  normalizeImageUrl,
  normalizeMplusName,
  WowheadZonesIndexSummary,
} from './shared';
import type { Instance } from '../drop-finder/types';

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

export default function DungeonsPage() {
  const [data, setData] = useState<DungeonSeasonData | null>(null);
  const [mplusDetailsByName, setMplusDetailsByName] = useState<Record<string, MythicKeystoneDungeonDetail>>({});
  const [gameState, setGameState] = useState<GameDataState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
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
        const [seasonData, gameDataState, fallbackInstances, zonesSummaryResp] = await Promise.all([
          preferCache ? getDungeonDataCached() : getDungeonData(),
          (preferCache ? getGameDataStateCached() : getGameDataState()).catch(
            () => null as GameDataState | null,
          ),
          fetchJsonCached<Instance[]>(`${API_URL}/api/instances`, { ttl: 60_000 }).catch(
            () => [] as Instance[],
          ),
          fetchJsonCached<WowheadZonesIndexSummary>(
            `${API_URL}/api/data/wowhead-zones-index/summary?kind=dungeon`,
            { ttl: 60_000 },
          ).catch(() => ({ zones: [], raids: [] })),
        ]);
        const wowheadZoneIdByName = new Map<string, number>();
        const parsedRaids = Array.isArray(zonesSummaryResp?.raids) ? zonesSummaryResp.raids : [];
        {
          const zones = Array.isArray(zonesSummaryResp?.zones) ? zonesSummaryResp.zones : [];
          for (const zone of zones) {
            const zid = Number(zone?.id ?? 0);
            const zname = typeof zone?.name === 'string' ? zone.name : '';
            if (zid > 0 && zname) {
              wowheadZoneIdByName.set(normalizeDungeonName(zname), zid);
            }
          }
        }
        const zonesByName = new Map<string, { id?: number; name?: string; expansion?: number | null; encounters?: string[] }>();
        for (const zone of parsedRaids) {
          const n = typeof zone?.name === 'string' ? normalizeDungeonName(zone.name) : '';
          if (n && !zonesByName.has(n)) zonesByName.set(n, zone);
        }
        const zoneRaidRows: DungeonInfo[] = parsedRaids
          .map((zone) => {
            const zid = Number(zone?.id ?? 0);
            const name = String(zone?.name || '').trim();
            const matchedInstance = fallbackInstances.find(
              (inst) => normalizeDungeonName(inst.name) === normalizeDungeonName(name),
            );
            const encounters = Array.isArray(zone?.encounters)
              ? zone.encounters.map((e) => String(e || '').trim()).filter((n) => n.length > 0)
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
                  .map((e) => String(e || '').trim())
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
            wowheadZoneIdByName.get(normalizeDungeonName(dungeon.name)) ?? null;

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
      const [seasonData, gameDataState, fallbackInstances, zonesSummaryResp] = await Promise.all([
        getDungeonData(),
        getGameDataState().catch(() => null as GameDataState | null),
        fetchJsonCached<Instance[]>(`${API_URL}/api/instances`, { ttl: 60_000 }).catch(
          () => [] as Instance[],
        ),
        fetchJsonCached<WowheadZonesIndexSummary>(
          `${API_URL}/api/data/wowhead-zones-index/summary?kind=dungeon`,
          { ttl: 60_000 },
        ).catch(() => ({ zones: [], raids: [] })),
      ]);
      const parsedRaids = Array.isArray(zonesSummaryResp?.raids) ? zonesSummaryResp.raids : [];
      const zonesByName = new Map<string, { id?: number; name?: string; expansion?: number | null; encounters?: string[] }>();
      for (const zone of parsedRaids) {
        const n = typeof zone?.name === 'string' ? normalizeDungeonName(zone.name) : '';
        if (n && !zonesByName.has(n)) zonesByName.set(n, zone);
      }
      const zoneRaidRows: DungeonInfo[] = parsedRaids
        .map((zone) => {
          const zid = Number(zone?.id ?? 0);
          const name = String(zone?.name || '').trim();
          const matchedInstance = fallbackInstances.find(
            (inst) => normalizeDungeonName(inst.name) === normalizeDungeonName(name),
          );
          const encounters = Array.isArray(zone?.encounters)
            ? zone.encounters.map((e) => String(e || '').trim()).filter((n) => n.length > 0)
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
                .map((e) => String(e || '').trim())
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
          <AlertTriangle className="h-8 w-8" strokeWidth={2} />
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
                mplusDetail={mplusDetailsByName[normalizeMplusName(dungeon.name)] || null}
                detailsBasePath="/dungeons/details"
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

    </div>
  );
}
