'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import {
  getDungeonData,
  getGameContext,
  getMythicKeystoneDungeonDetail,
  listInstances,
  type DungeonSeasonData,
  type DungeonInfo,
  type GameContext,
  type MythicKeystoneDungeonDetail,
} from '../lib/api';
import type { Instance } from '../drop-finder/types';
import {
  getRuntimeWowSeasonContent,
  getStaticWowSeasonContent,
  wowExpansions,
  type WowExpansion,
  type WowInstance,
  type WowInstanceType,
  type WowSeasonContent,
} from '../lib/wow-season-content';
import { AffixCard, type DisplayAffix, DungeonCard } from './shared';

type DungeonDataResponse = DungeonSeasonData & { error?: string };

const initialSeasonContent = getStaticWowSeasonContent().content;

function toCatalogDungeons(content: WowSeasonContent) {
  return content.dungeons.map((dungeon) => ({
    id: dungeon.id,
    name: dungeon.name,
    description: undefined,
    zone: null,
    slug: dungeon.slug ?? null,
    short_name: null,
    wowhead_id: null,
    num_bosses: null,
    expansion: dungeon.expansionId,
    expansion_name: content.season.expansion?.name ?? null,
    map_id: null,
    challenge_mode_id: dungeon.mythicPlusDungeonId ?? null,
    minimum_level: null,
    keystone_timer_ms: null,
    keystone_upgrades: [],
    encounters: [],
    blizzard_href: null,
    image_url: dungeon.imageUrl,
    linked_code: undefined,
    blizzard_api_data: null,
  }));
}

function toApiDungeonInfo(instance: Instance): DungeonInfo {
  const encounters = Array.isArray(instance.encounters) ? instance.encounters : [];
  return {
    id: instance.id,
    name: instance.name,
    description: undefined,
    zone: instance.zone ?? null,
    slug: null,
    short_name: null,
    wowhead_id: null,
    num_bosses: encounters.length || null,
    expansion: instance.expansion ?? null,
    expansion_name: null,
    map_id: null,
    challenge_mode_id: null,
    minimum_level: null,
    keystone_timer_ms: null,
    keystone_upgrades: [],
    encounters: encounters.map((encounter) => encounter.name),
    blizzard_href: null,
    image_url: instance.image_url,
    linked_code: undefined,
    blizzard_api_data: null,
  };
}

function synthesizeCurrentSeasonContent(
  existing: WowSeasonContent[],
  context: GameContext | null,
  instances: Instance[],
): WowSeasonContent[] {
  if (!context?.active_season?.name) return existing;
  const active = context.active_season;

  const instanceById = new Map(instances.map((instance) => [instance.id, instance]));
  const expansionId = context.current_expansion?.number ?? 0;
  const expansion = wowExpansions.find((entry) => entry.id === expansionId);
  const fromPool = (poolKey: string, type: WowInstanceType): WowInstance[] => {
    const poolId = context.pools?.[poolKey];
    const pool = poolId == null ? undefined : instanceById.get(poolId);
    return (pool?.encounters ?? [])
      .map((entry) => instanceById.get(entry.id))
      .filter((instance): instance is Instance => Boolean(instance))
      .map((instance) => ({
        id: instance.id,
        name: instance.name,
        type,
        expansionId: instance.expansion ?? expansionId,
        slug: undefined,
        encounterIds: instance.encounters?.map((encounter) => encounter.id),
        encounters: instance.encounters?.map((encounter) => ({
          id: encounter.id,
          name: encounter.name,
          instanceId: instance.id,
        })),
        imageUrl: instance.image_url,
      }));
  };

  const current: WowSeasonContent = {
    season: {
      slug: active.short_name || `season-${active.id ?? 'current'}`,
      name: active.name || 'Current Season',
      expansionId,
      expansion,
      raidInstanceIds: fromPool('raids', 'raid').map((instance) => instance.id),
      mythicPlusDungeonIds: fromPool('mplus', 'dungeon').map((instance) => instance.id),
      raidInstances: fromPool('raids', 'raid'),
      mythicPlusDungeons: fromPool('mplus', 'dungeon'),
      source: { gameContext: true },
    },
    raids: fromPool('raids', 'raid'),
    dungeons: fromPool('mplus', 'dungeon'),
  };

  const normalizedName = normalized(current.season.name);
  return [
    current,
    ...existing.filter((entry) => normalized(entry.season.name) !== normalizedName),
  ];
}

function normalized(value: string | undefined): string {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function displaySeasonName(value: string | undefined): string {
  const name = String(value || '').trim();
  const parenthesizedName = name.match(/\(([^)]+)\)\s*$/)?.[1]?.trim();
  return parenthesizedName || name || 'Current Season';
}

function DungeonsPageSkeleton() {
  return (
    <div className="space-y-6" aria-label="Loading current dungeon data">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="h-10 w-80 max-w-full animate-pulse rounded bg-white/10" />
          <div className="mt-3 h-5 w-48 animate-pulse rounded bg-white/10" />
        </div>
        <div className="h-16 w-56 animate-pulse rounded-lg bg-white/10" />
      </div>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {[1, 2].map((idx) => (
          <div key={idx} className="rounded-xl border border-white/15 bg-zinc-900/70 p-4">
            <div className="h-3 w-28 animate-pulse rounded bg-white/10" />
            <div className="mt-4 h-8 w-20 animate-pulse rounded bg-white/10" />
            <div className="mt-3 h-4 w-32 animate-pulse rounded bg-white/10" />
          </div>
        ))}
      </section>

      <section className="space-y-3">
        <div className="h-5 w-56 animate-pulse rounded bg-white/10" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((idx) => (
            <div key={idx} className="rounded-xl border border-white/15 bg-zinc-900/80 p-4">
              <div className="h-7 w-2/3 animate-pulse rounded bg-white/10" />
              <div className="mt-4 h-5 w-32 animate-pulse rounded bg-white/10" />
              <div className="mt-4 space-y-2">
                <div className="h-4 w-36 animate-pulse rounded bg-white/10" />
                <div className="h-4 w-32 animate-pulse rounded bg-white/10" />
                <div className="h-4 w-40 animate-pulse rounded bg-white/10" />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

export default function DungeonsPage() {
  const [data, setData] = useState<DungeonDataResponse | null>(null);
  const [apiInstances, setApiInstances] = useState<Instance[]>([]);
  const [seasonContent, setSeasonContent] = useState<WowSeasonContent[]>(initialSeasonContent);
  const [expansions, setExpansions] = useState<WowExpansion[]>(wowExpansions);
  const [selectedExpansionId, setSelectedExpansionId] = useState<number | null>(null);
  const [selectedSeasonSlug, setSelectedSeasonSlug] = useState('');
  const [mplusDetailsById, setMplusDetailsById] = useState<
    Record<number, MythicKeystoneDungeonDetail>
  >({});
  const [mplusDetailsLoaded, setMplusDetailsLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getRuntimeWowSeasonContent(),
      listInstances().catch(() => []),
      getGameContext().catch(() => null),
    ])
      .then(([runtimeWow, instances, context]) => {
        if (cancelled) return;
        setApiInstances(instances);
        if (runtimeWow.expansions.length > 0) setExpansions(runtimeWow.expansions);
        if (runtimeWow.result.content.length > 0) {
          setSeasonContent(
            synthesizeCurrentSeasonContent(runtimeWow.result.content, context, instances),
          );
        }
      })
      .catch(() => {});

    getDungeonData()
      .then((response) => {
        if (!cancelled) setData(response as DungeonDataResponse);
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : 'Failed to load dungeon data.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const currentSeasonSlug = useMemo(() => {
    const contextSeason = seasonContent.find(
      (content) => content.season.source?.gameContext === true,
    );
    if (contextSeason) return contextSeason.season.slug;
    const apiSeasonName = normalized(data?.season_name);
    const matchingContent = seasonContent.find(
      (content) => normalized(content.season.name) === apiSeasonName
    );
    return matchingContent?.season.slug ?? '';
  }, [data?.season_name, seasonContent]);

  const currentExpansionId = useMemo(() => {
    const apiSeasonName = normalized(data?.season_name);
    return (
      expansions.find((expansion) => apiSeasonName.includes(normalized(expansion.name)))?.id ?? null
    );
  }, [data?.season_name, expansions]);

  const effectiveSeasonSlug = selectedSeasonSlug || currentSeasonSlug;
  const selectedContent = seasonContent.find(
    (content) => content.season.slug === effectiveSeasonSlug
  );
  const isCurrentSeason = !selectedSeasonSlug || selectedSeasonSlug === currentSeasonSlug;

  useEffect(() => {
    if (selectedSeasonSlug) return;
    if (!currentSeasonSlug) {
      if (selectedExpansionId == null && currentExpansionId != null) {
        setSelectedExpansionId(currentExpansionId);
      }
      return;
    }
    const currentContent = seasonContent.find(
      (content) => content.season.slug === currentSeasonSlug
    );
    setSelectedSeasonSlug(currentSeasonSlug);
    setSelectedExpansionId(currentContent?.season.expansionId ?? null);
  }, [
    currentExpansionId,
    currentSeasonSlug,
    seasonContent,
    selectedExpansionId,
    selectedSeasonSlug,
  ]);

  const expansionOptions = useMemo(() => {
    const availableIds = new Set(seasonContent.map((content) => content.season.expansionId));
    return expansions
      .filter((expansion) => availableIds.has(expansion.id))
      .sort((left, right) => right.id - left.id);
  }, [expansions, seasonContent]);

  const seasonOptions = useMemo(
    () =>
      seasonContent
        .filter(
          (content) =>
            selectedExpansionId == null || content.season.expansionId === selectedExpansionId
        )
        .sort((left, right) =>
          (right.season.startDate || '').localeCompare(left.season.startDate || '')
        ),
    [seasonContent, selectedExpansionId]
  );

  const currentDungeons = useMemo(() => {
    if (data?.rotation_dungeons && data.rotation_dungeons.length > 0) {
      return data.rotation_dungeons;
    }

    // Some Blizzard season payloads expose periods but omit the legacy dungeons
    // array; use the authoritative active Mythic+ pool instead of the full catalog.
    const pool = apiInstances.find((instance) => instance.id === -1);
    if (!pool) return [];
    const instancesById = new Map(apiInstances.map((instance) => [instance.id, instance]));
    const poolDungeons = Array.isArray(pool.encounters) ? pool.encounters : [];
    return poolDungeons
      .map((encounter) => instancesById.get(encounter.id))
      .filter((instance): instance is Instance => Boolean(instance))
      .map(toApiDungeonInfo);
  }, [apiInstances, data?.rotation_dungeons]);

  useEffect(() => {
    let cancelled = false;
    const dungeons = isCurrentSeason ? currentDungeons : [];
    if (dungeons.length === 0) {
      setMplusDetailsById({});
      setMplusDetailsLoaded(true);
      return () => {
        cancelled = true;
      };
    }

    setMplusDetailsLoaded(false);
    Promise.all(
      dungeons.map((dungeon) =>
        getMythicKeystoneDungeonDetail(dungeon.id, 'us')
          .then((detail) => [dungeon.id, detail] as const)
          .catch(() => null)
      )
    ).then((details) => {
      if (cancelled) return;
      const byId: Record<number, MythicKeystoneDungeonDetail> = {};
      for (const entry of details) {
        if (entry) byId[entry[0]] = entry[1];
      }
      setMplusDetailsById(byId);
      setMplusDetailsLoaded(true);
    });

    return () => {
      cancelled = true;
    };
  }, [currentDungeons, isCurrentSeason]);

  if (loading) return <DungeonsPageSkeleton />;

  if (error || !data) {
    return (
      <div className="mx-auto max-w-lg py-20 text-center">
        <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-red-500/10 text-red-500">
          <AlertTriangle className="h-8 w-8" strokeWidth={2} />
        </div>
        <h2 className="mb-2 text-xl font-bold text-zinc-200">Failed to Load Current Dungeons</h2>
        <p className="mb-6 text-zinc-500">{error || 'The Blizzard dungeon data is unavailable.'}</p>
        <button
          onClick={() => window.location.reload()}
          className="rounded-lg bg-gold px-4 py-2 text-sm font-bold text-black"
        >
          Retry
        </button>
      </div>
    );
  }

  const displayedAffixes: DisplayAffix[] = isCurrentSeason ? (data.current_affixes ?? []) : [];
  const displayedDungeons = isCurrentSeason
    ? currentDungeons
    : selectedContent
      ? toCatalogDungeons(selectedContent)
      : [];
  const selectedSeasonName = isCurrentSeason
    ? displaySeasonName(data.season_name)
    : selectedContent?.season.name || 'Selected Season';

  const handleExpansionChange = (value: string) => {
    if (!value) {
      setSelectedExpansionId(null);
      setSelectedSeasonSlug('');
      return;
    }
    const expansionId = Number(value);
    const nextSeasons = seasonContent
      .filter((content) => content.season.expansionId === expansionId)
      .sort((left, right) =>
        (right.season.startDate || '').localeCompare(left.season.startDate || '')
      );
    setSelectedExpansionId(Number.isFinite(expansionId) ? expansionId : null);
    setSelectedSeasonSlug(nextSeasons[0]?.season.slug || '');
  };

  const handleSeasonChange = (value: string) => {
    const content = seasonContent.find((entry) => entry.season.slug === value);
    setSelectedSeasonSlug(value);
    setSelectedExpansionId(content?.season.expansionId ?? null);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white lg:text-4xl">
            Mythic+ Dungeons
          </h1>
          <p className="mt-2 text-base font-semibold text-zinc-300">{selectedSeasonName}</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
            Expansion
            <select
              value={selectedExpansionId ?? ''}
              onChange={(event) => handleExpansionChange(event.currentTarget.value)}
              className="min-w-48 rounded-lg border border-white/15 bg-zinc-900 px-3 py-2 text-sm font-medium normal-case tracking-normal text-zinc-100"
            >
              <option value="">Current active season</option>
              {expansionOptions.map((expansion) => (
                <option key={expansion.id} value={expansion.id}>
                  {expansion.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
            Season
            <select
              value={effectiveSeasonSlug}
              onChange={(event) => handleSeasonChange(event.currentTarget.value)}
              className="min-w-56 rounded-lg border border-white/15 bg-zinc-900 px-3 py-2 text-sm font-medium normal-case tracking-normal text-zinc-100"
            >
              <option value="">Current active season</option>
              {seasonOptions.map((content) => (
                <option key={content.season.slug} value={content.season.slug}>
                  {content.season.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {isCurrentSeason ? (
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-white/15 bg-zinc-900/70 p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Dungeons in rotation
            </p>
            <p className="mt-2 text-2xl font-extrabold text-white">{currentDungeons.length}</p>
            <p className="text-sm font-medium text-zinc-300">Current season</p>
          </div>
          <div className="rounded-xl border border-white/15 bg-zinc-900/70 p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Current affixes
            </p>
            <p className="mt-2 text-2xl font-extrabold text-white">{displayedAffixes.length}</p>
            <p className="text-sm font-medium text-zinc-300">This week</p>
          </div>
        </section>
      ) : (
        <section className="rounded-xl border border-white/15 bg-zinc-900/70 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Dungeons in season
          </p>
          <p className="mt-2 text-2xl font-extrabold text-white">{displayedDungeons.length}</p>
          <p className="text-sm font-medium text-zinc-300">
            Current affixes, timers, scores, and encounters are shown only for the active season.
          </p>
        </section>
      )}

      {data.error && isCurrentSeason ? (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          {data.error}
        </div>
      ) : null}

      {displayedAffixes.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-base font-bold uppercase tracking-wider text-zinc-300">
            Current Season Affixes
          </h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {displayedAffixes.map((affix) => (
              <AffixCard key={affix.id} affix={affix} />
            ))}
          </div>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-base font-bold uppercase tracking-wider text-zinc-300">
          {isCurrentSeason ? 'Active Dungeons' : selectedSeasonName + ' Dungeons'}
        </h2>
        {displayedDungeons.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {displayedDungeons.map((dungeon, index) => (
              <DungeonCard
                key={`${dungeon.id}-${dungeon.name}-${index}`}
                dungeon={dungeon}
                showDetails={isCurrentSeason}
                mplusDetail={
                  isCurrentSeason
                    ? mplusDetailsLoaded
                      ? mplusDetailsById[dungeon.id] || null
                      : undefined
                    : null
                }
              />
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-6 text-center">
            <p className="text-sm text-zinc-500">
              {isCurrentSeason
                ? 'No active dungeons available from Blizzard.'
                : 'No dungeons are listed for this season.'}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
