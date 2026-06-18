'use client';

import { useEffect, useState } from 'react';
import { API_URL, DungeonInfo, fetchJsonCached } from '../lib/api';
import type { Instance } from '../drop-finder/types';
import { DungeonCard, WowheadZonesIndexSummary, getLocalInstanceImageUrl, getRaidInstances, normalizeDungeonName, normalizeImageUrl } from '../dungeons/shared';
import {
  getRuntimeWowSeasonContent,
  wowExpansions,
  wowSeasons,
  type WowExpansion,
  type WowSeason,
} from '../lib/wow-season-content';
import {
  filterRaidsByExpansion,
  getCurrentSeasonExpansionId,
  listRaidExpansionOptions,
} from './raid-expansion-filter';

function RaidsPageSkeleton() {
  return (
    <div className="space-y-4" aria-label="Loading raids">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="h-10 w-36 animate-pulse rounded bg-white/10" />
          <div className="mt-3 h-4 w-32 animate-pulse rounded bg-white/10" />
        </div>
        <div className="h-16 w-56 animate-pulse rounded-lg bg-white/10" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3, 4, 5, 6].map((idx) => (
          <div key={`raid-card-skeleton-${idx}`} className="rounded-xl border border-white/15 bg-zinc-900/80 p-4">
            <div className="mb-3 h-28 w-full animate-pulse rounded-lg bg-white/10" />
            <div className="h-7 w-2/3 animate-pulse rounded bg-white/10" />
            <div className="mt-4 h-3 w-24 animate-pulse rounded bg-white/10" />
            <div className="mt-3 space-y-2">
              <div className="h-4 w-40 animate-pulse rounded bg-white/10" />
              <div className="h-4 w-32 animate-pulse rounded bg-white/10" />
              <div className="h-4 w-36 animate-pulse rounded bg-white/10" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function RaidsPage() {
  const [raids, setRaids] = useState<DungeonInfo[]>([]);
  const [expansions, setExpansions] = useState<WowExpansion[]>(wowExpansions);
  const [seasons, setSeasons] = useState<WowSeason[]>(wowSeasons);
  const [selectedExpansionId, setSelectedExpansionId] = useState<number | null>(
    getCurrentSeasonExpansionId(wowSeasons),
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [fallbackInstances, runtimeWow, zonesSummaryResp] = await Promise.all([
          fetchJsonCached<Instance[]>(`${API_URL}/api/instances`, { ttl: 60_000 }).catch(
            () => [] as Instance[],
          ),
          getRuntimeWowSeasonContent().catch(() => null),
          fetchJsonCached<WowheadZonesIndexSummary>(
            `${API_URL}/api/data/wowhead-zones-index/summary?kind=raid`,
            { ttl: 60_000 },
          ).catch(() => ({ zones: [], raids: [] })),
        ]);
        if (!cancelled && runtimeWow) {
          setExpansions(runtimeWow.expansions);
          setSeasons(runtimeWow.seasons);
          setSelectedExpansionId((current) => current ?? getCurrentSeasonExpansionId(runtimeWow.seasons));
        }
        const parsedRaids = Array.isArray(zonesSummaryResp?.raids) ? zonesSummaryResp.raids : [];
        const zonesByName = new Map<string, { id?: number; name?: string; expansion?: number | null; encounters?: string[] }>();
        for (const zone of parsedRaids) {
          const n = typeof zone?.name === 'string' ? normalizeDungeonName(zone.name) : '';
          if (n && !zonesByName.has(n)) zonesByName.set(n, zone);
        }
        const fallbackRaidRows: DungeonInfo[] = getRaidInstances(fallbackInstances).map((raid) => {
          const matchedZone = zonesByName.get(normalizeDungeonName(raid.name));
          const zid = Number(matchedZone?.id ?? 0);
          const encounters = (raid.encounters || []).map((e) => String(e?.name || '').trim()).filter((n) => n.length > 0);
          return {
            id: raid.id, name: raid.name, description: undefined, zone: raid.zone || 'Raid', slug: undefined, short_name: undefined,
            wowhead_id: zid > 0 ? zid : null, num_bosses: encounters.length > 0 ? encounters.length : null, expansion: raid.expansion ?? (typeof matchedZone?.expansion === 'number' ? matchedZone.expansion : null), expansion_name: undefined,
            map_id: null, challenge_mode_id: null, minimum_level: null, keystone_timer_ms: null, keystone_upgrades: [], encounters, blizzard_href: undefined,
            image_url: normalizeImageUrl(getLocalInstanceImageUrl(raid.id)), linked_code: undefined, blizzard_api_data: null,
          } as unknown as DungeonInfo;
        })
          .filter((raid) => {
            const name = raid.name.trim().toLowerCase();
            if (!name) return false;
            if (name.includes('world boss')) return false;
            if (name.startsWith('season ')) return false;
            return (raid.encounters?.length ?? 0) > 0;
          })
          .sort((a, b) => a.name.localeCompare(b.name));
        if (!cancelled) setRaids(fallbackRaidRows);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) return <RaidsPageSkeleton />;

  const expansionOptions = listRaidExpansionOptions(raids, expansions);
  const currentExpansionId = getCurrentSeasonExpansionId(seasons);
  const filteredRaids = filterRaidsByExpansion(raids, selectedExpansionId);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white lg:text-4xl">Raids</h1>
          {selectedExpansionId === currentExpansionId ? (
            <p className="mt-2 text-sm font-medium text-zinc-400">Current expansion</p>
          ) : null}
        </div>
        {expansionOptions.length > 1 ? (
          <label className="flex flex-col gap-1 text-sm font-semibold text-zinc-300">
            Expansion
            <select
              value={selectedExpansionId ?? ''}
              onChange={(event) => {
                const next = Number(event.target.value);
                setSelectedExpansionId(Number.isFinite(next) ? next : null);
              }}
              className="min-w-56 rounded-lg border border-white/15 bg-zinc-950 px-3 py-2 text-sm font-medium text-zinc-100 outline-none transition-colors hover:border-gold/50 focus:border-gold"
            >
              {expansionOptions.map((expansion) => (
                <option key={expansion.id} value={expansion.id}>
                  {expansion.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      {filteredRaids.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredRaids.map((raid) => <DungeonCard key={`raid-${raid.id}`} dungeon={raid} mplusDetail={null} detailsBasePath="/raids/details" />)}
        </div>
      ) : (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-6 text-sm text-zinc-500">No raids available.</div>
      )}
    </div>
  );
}
