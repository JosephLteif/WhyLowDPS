'use client';

import { useEffect, useState } from 'react';
import { API_URL, DungeonInfo, fetchJson } from '../lib/api';
import type { Instance } from '../drop-finder/types';
import { DungeonCard, WowheadZoneIndexEntry, getLocalInstanceImageUrl, getRaidInstances, normalizeDungeonName, normalizeImageUrl } from '../dungeons/shared';

export default function RaidsPage() {
  const [raids, setRaids] = useState<DungeonInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [fallbackInstances, wowheadIndexResp] = await Promise.all([
          fetchJson<Instance[]>(`${API_URL}/api/instances`).catch(() => [] as Instance[]),
          fetchJson<{ zones?: WowheadZoneIndexEntry[] }>(`${API_URL}/api/data/wowhead-zones-index`).catch(() => ({ zones: [] })),
        ]);
        const parsedZones: WowheadZoneIndexEntry[] = Array.isArray(wowheadIndexResp?.zones) ? wowheadIndexResp.zones : [];
        const zonesByName = new Map<string, WowheadZoneIndexEntry>();
        for (const zone of parsedZones) {
          const n = typeof zone?.name === 'string' ? normalizeDungeonName(zone.name) : '';
          if (n && !zonesByName.has(n)) zonesByName.set(n, zone);
        }
        const fallbackRaidRows: DungeonInfo[] = getRaidInstances(fallbackInstances).map((raid) => {
          const matchedZone = zonesByName.get(normalizeDungeonName(raid.name));
          const zid = Number(matchedZone?.id ?? 0);
          const encounters = (raid.encounters || []).map((e) => String(e?.name || '').trim()).filter((n) => n.length > 0);
          return {
            id: raid.id, name: raid.name, description: undefined, zone: raid.zone || 'Raid', slug: undefined, short_name: undefined,
            wowhead_id: zid > 0 ? zid : null, num_bosses: encounters.length > 0 ? encounters.length : null, expansion: typeof matchedZone?.expansion === 'number' ? matchedZone.expansion : null, expansion_name: undefined,
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

  if (loading) return <div className="py-12 text-sm text-zinc-400">Loading raids...</div>;

  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-extrabold tracking-tight text-white lg:text-4xl">Raids</h1>
      {raids.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {raids.map((raid) => <DungeonCard key={`raid-${raid.id}`} dungeon={raid} mplusDetail={null} detailsBasePath="/raids/details" />)}
        </div>
      ) : (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-6 text-sm text-zinc-500">No raids available.</div>
      )}
    </div>
  );
}
