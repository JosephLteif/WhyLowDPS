'use client';

import { useEffect, useState } from 'react';
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
  triggerDungeonDataRefresh,
} from '../lib/api';
import { useWowheadTooltips } from '../lib/useWowheadTooltips';

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

function getLocalInstanceImageUrl(
  instanceId?: number | null,
  sourceUrl?: string | null,
): string | null {
  if (!instanceId || instanceId <= 0) return null;
  const base = `${API_URL}/api/data/images/instance/${instanceId}?v=bapi2`;
  if (!sourceUrl || !/^https?:\/\//i.test(sourceUrl)) {
    return base;
  }
  const parsed = (() => {
    try {
      return new URL(sourceUrl);
    } catch {
      return null;
    }
  })();
  if (!parsed) return base;
  const host = parsed.hostname.toLowerCase();
  const isBlizzardCdn = host.includes('blizzard.com') || host.includes('battle.net');
  if (!isBlizzardCdn) return base;
  return `${base}&source=${encodeURIComponent(sourceUrl)}`;
}

function shouldPreferLocalInstanceImage(imageUrl?: string | null): boolean {
  if (!imageUrl) return false;
  return imageUrl.includes('/EncounterJournal/orig/ui-ej-background-');
}

function normalizeDungeonName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeAffixName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

type DisplayAffix = DungeonAffix & {
  wowhead_url?: string | null;
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
        <p className="truncate text-lg font-bold leading-tight text-zinc-100">{affix.name}</p>
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

function DungeonCard({ dungeon }: { dungeon: DungeonInfo; seasonName?: string }) {
  const placeholder = !dungeon.image_url ? getDungeonPlaceholder(dungeon.name) : null;
  const localInstanceImage = getLocalInstanceImageUrl(dungeon.id, dungeon.image_url);
  const preferredImageUrl =
    shouldPreferLocalInstanceImage(dungeon.image_url) && localInstanceImage
      ? localInstanceImage
      : dungeon.image_url;
  const imageUrl = preferredImageUrl || placeholder?.icon;
  const [imageFailed, setImageFailed] = useState(false);
  const zone = dungeon.zone || placeholder?.zone;
  const timer = formatMs(dungeon.keystone_timer_ms);
  const encounterCount = dungeon.encounters?.length || dungeon.num_bosses || null;
  const rawPayload = dungeon.blizzard_api_data
    ? JSON.stringify(dungeon.blizzard_api_data, null, 2)
    : null;

  return (
    <div className="group flex flex-col rounded-xl border border-white/15 bg-zinc-900/80 p-4 transition-all hover:border-gold/50 hover:bg-zinc-900">
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
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        <InfoPill label="Min level" value={dungeon.minimum_level} />
        <InfoPill label="Timer" value={timer} />
        <InfoPill label="Map ID" value={dungeon.map_id} />
        <InfoPill label="Challenge ID" value={dungeon.challenge_mode_id} />
        <InfoPill label="Bosses" value={encounterCount} />
        <InfoPill label="Slug" value={dungeon.slug} />
        <InfoPill label="Short" value={dungeon.short_name} />
      </div>

      {dungeon.keystone_upgrades && dungeon.keystone_upgrades.length > 0 && (
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
      )}

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
    </div>
  );
}

export default function DungeonsPage() {
  const [data, setData] = useState<DungeonSeasonData | null>(null);
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
  const affixSource = gameState?.active_affixes?.length
    ? 'Backend game state'
    : 'Backend dungeon cache';

  useWowheadTooltips([data?.current_affixes, data?.rotation_dungeons]);

  useEffect(() => {
    let cancelled = false;

    const loadDungeonData = async (preferCache: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const [seasonData, gameDataState] = await Promise.all([
          preferCache ? getDungeonDataCached() : getDungeonData(),
          (preferCache ? getGameDataStateCached() : getGameDataState()).catch(
            () => null as GameDataState | null,
          ),
        ]);
        const activeRotationIds = new Set<number>(gameDataState?.mplus_rotation ?? []);

        const enrichedDungeons = seasonData.rotation_dungeons.map((dungeon) => {
          const localInstanceImage = getLocalInstanceImageUrl(dungeon.id, dungeon.image_url);
          const preferredDungeonImage =
            shouldPreferLocalInstanceImage(dungeon.image_url) && localInstanceImage
              ? localInstanceImage
              : dungeon.image_url;

          return {
            ...dungeon,
            image_url: normalizeImageUrl(localInstanceImage || preferredDungeonImage),
          };
        });
        const filteredDungeons =
          activeRotationIds.size > 0
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
      const [seasonData, gameDataState] = await Promise.all([
        getDungeonData(),
        getGameDataState().catch(() => null as GameDataState | null),
      ]);
      const activeRotationIds = new Set<number>(gameDataState?.mplus_rotation ?? []);

      const enrichedDungeons = seasonData.rotation_dungeons.map((dungeon) => {
        const localInstanceImage = getLocalInstanceImageUrl(dungeon.id, dungeon.image_url);
        const preferredDungeonImage =
          shouldPreferLocalInstanceImage(dungeon.image_url) && localInstanceImage
            ? localInstanceImage
            : dungeon.image_url;

        return {
          ...dungeon,
          image_url: normalizeImageUrl(localInstanceImage || preferredDungeonImage),
        };
      });
      const filteredDungeons =
        activeRotationIds.size > 0
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
              <DungeonCard key={dungeon.id} dungeon={dungeon} seasonName={data.season_name} />
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
