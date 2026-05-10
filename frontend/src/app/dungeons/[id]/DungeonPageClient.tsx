'use client';

import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import {
  API_URL,
  DungeonInfo,
  fetchJson,
  getDungeonData,
  getMythicKeystoneDungeonDetail,
  getMythicKeystoneDungeonIndex,
  type MythicKeystoneDungeonDetail,
} from '../../lib/api';
import { useWowheadTooltips } from '../../lib/useWowheadTooltips';
import { Instance } from '../../drop-finder/types';

type WowheadSpell = {
  id: number;
  name?: string;
  url?: string;
  icon_url?: string;
  description?: string;
};

type WowheadEncounter = {
  npc_id: number;
  name: string;
  url?: string;
  description?: string;
  image_url?: string;
  ability_spell_ids?: number[];
  ability_spell_urls?: string[];
  abilities?: WowheadSpell[];
};

type WowheadZone = {
  id: number;
  name: string;
  expansion?: number | null;
  url?: string;
  description?: string;
  image_url?: string;
  encounters?: WowheadEncounter[];
};

function isHttpUrl(value?: string | null): value is string {
  return !!value && /^https?:\/\//i.test(value);
}

function isBlizzardHost(value: string): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host.includes('blizzard.com') || host.includes('battle.net');
  } catch {
    return false;
  }
}

function buildImageProxyUrl(
  imageType: 'instance' | 'encounter',
  id: number | null | undefined,
  source?: string | null,
): string | null {
  if (!id || id <= 0) return null;
  const base = `${API_URL}/api/data/images/${imageType}/${id}?v=bapi3`;
  if (isHttpUrl(source) && isBlizzardHost(source)) {
    return `${base}&source=${encodeURIComponent(source)}`;
  }
  return base;
}

function formatMs(ms?: number | null): string | null {
  if (!ms || ms <= 0) return null;
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function normalizeName(input?: string | null): string {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function renderEncounterDescription(text: string, abilities: WowheadSpell[]): ReactNode {
  const chunks: ReactNode[] = [];
  const byName = new Map<string, WowheadSpell>();
  for (const ability of abilities) {
    byName.set(normalizeName(ability.name), ability);
  }

  const re = /\[([^\]]+)\]/g;
  let last = 0;
  let idx = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const start = m.index;
    const end = re.lastIndex;
    const token = m[1];

    if (start > last) {
      chunks.push(<span key={`txt-${idx++}`}>{text.slice(last, start)}</span>);
    }

    const matched = byName.get(normalizeName(token));
    const href = matched?.url || `https://www.wowhead.com/search?q=${encodeURIComponent(token)}`;
    chunks.push(
      <a
        key={`spell-${idx++}`}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="mx-0.5 inline-flex items-center rounded border border-white/20 bg-black/35 px-1.5 py-0.5 text-xs text-gold hover:bg-black/55"
        title={matched?.description || token}
      >
        {matched?.icon_url ? (
          <img src={matched.icon_url} alt="" className="mr-1 h-3.5 w-3.5 rounded-sm object-cover" />
        ) : null}
        {token}
      </a>,
    );
    last = end;
  }

  if (last < text.length) {
    chunks.push(<span key={`txt-${idx++}`}>{text.slice(last)}</span>);
  }
  return chunks;
}

export default function DungeonPageClient({ id }: { id: string }) {
  const [dungeon, setDungeon] = useState<DungeonInfo | null>(null);
  const [instanceDetails, setInstanceDetails] = useState<Instance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [wowheadZone, setWowheadZone] = useState<WowheadZone | null>(null);
  const [wowheadZonesIndex, setWowheadZonesIndex] = useState<WowheadZone[]>([]);
  const [mplusDetail, setMplusDetail] = useState<MythicKeystoneDungeonDetail | null>(null);

  useEffect(() => {
    if (!id) {
      setError('Missing dungeon id.');
      setLoading(false);
      return;
    }

    const dungeonId = parseInt(id, 10);
    if (!Number.isFinite(dungeonId) || dungeonId <= 0) {
      setError(`Invalid dungeon id: ${id}`);
      setLoading(false);
      return;
    }

    Promise.all([
      getDungeonData(),
      fetchJson<Instance[]>(`${API_URL}/api/instances`),
      fetchJson<{ zones?: WowheadZone[] }>(`${API_URL}/api/data/wowhead-zones-index`).catch(
        () => ({ zones: [] }),
      ),
    ])
      .then(async ([seasonData, instances, wowheadFile]) => {
        const found = seasonData.rotation_dungeons.find((d) => d.id === dungeonId);
        const inst = instances.find((i) => i.id === dungeonId) || null;
        if (inst) setInstanceDetails(inst);

        const zoneRows: WowheadZone[] = Array.isArray(wowheadFile?.zones) ? wowheadFile.zones : [];
        setWowheadZonesIndex(zoneRows);
        const lookupName = (found?.name || inst?.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const matched =
          zoneRows.find((z) => Number(z?.id ?? 0) === Number(found?.wowhead_id ?? 0)) ||
          zoneRows.find((z) => (z?.name || '').toLowerCase().replace(/[^a-z0-9]/g, '') === lookupName) ||
          zoneRows.find((z) => Number((z?.url || '').match(/zone=(\d+)/)?.[1] ?? 0) === dungeonId) ||
          null;
        setWowheadZone(matched);

        const resolvedDungeon: DungeonInfo =
          found ??
          ({
            id: dungeonId,
            name: matched?.name || inst?.name || `Dungeon ${dungeonId}`,
            description: matched?.description || null,
            zone: inst?.zone || null,
            slug: null,
            short_name: null,
            wowhead_id: matched?.id ?? null,
            num_bosses: matched?.encounters?.length ?? inst?.encounters?.length ?? null,
            expansion: matched?.expansion ?? null,
            expansion_name: null,
            map_id: null,
            challenge_mode_id: null,
            minimum_level: null,
            keystone_timer_ms: null,
            keystone_upgrades: [],
            encounters: (matched?.encounters || []).map((e) => e.name),
            blizzard_href: null,
            image_url: matched?.image_url || null,
            linked_code: undefined,
            blizzard_api_data: null,
          } as DungeonInfo);
        setDungeon(resolvedDungeon);

        try {
          const index = await getMythicKeystoneDungeonIndex('us');
          const normalizedFound = resolvedDungeon.name.toLowerCase().replace(/[^a-z0-9]/g, '');
          const detailId =
            index?.dungeons?.find(
              (d) =>
                String(d?.name || '')
                  .toLowerCase()
                  .replace(/[^a-z0-9]/g, '') === normalizedFound,
            )?.id ?? resolvedDungeon.id;
          if (Number(detailId) > 0) {
            const detail = await getMythicKeystoneDungeonDetail(Number(detailId), 'us');
            setMplusDetail(detail);
          }
        } catch {
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  useWowheadTooltips([dungeon, instanceDetails]);

  if (loading) {
    return (
      <div className="flex h-96 flex-col items-center justify-center gap-4">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-zinc-800 border-t-gold" />
        <p className="text-sm font-medium text-zinc-500">Loading dungeon...</p>
      </div>
    );
  }

  if (error || !dungeon) {
    return (
      <div className="mx-auto max-w-lg py-20 text-center">
        <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-red-500/10 text-red-500">
          <AlertTriangle className="h-8 w-8" strokeWidth={2} />
        </div>
        <h2 className="mb-2 text-xl font-bold text-zinc-200">Dungeon Not Found</h2>
        <p className="mb-6 text-zinc-500">{error || 'The dungeon could not be found.'}</p>
        <button
          onClick={() => window.location.reload()}
          className="rounded-lg bg-gold px-4 py-2 text-sm font-bold text-black"
        >
          Retry
        </button>
      </div>
    );
  }

  const dungeonImageSrc =
    wowheadZone?.image_url || buildImageProxyUrl('instance', dungeon.id, dungeon.image_url);
  const detailUpgrades = (mplusDetail?.keystone_upgrades ?? [])
    .map((u) => ({
      upgrade_level: Number(u?.upgrade_level ?? 0),
      qualifying_duration: Number(u?.qualifying_duration ?? 0),
    }))
    .filter((u) => u.upgrade_level > 0 && u.qualifying_duration > 0)
    .sort((a, b) => a.upgrade_level - b.upgrade_level);
  const oneChestDuration =
    detailUpgrades.find((upgrade) => upgrade.upgrade_level === 1)?.qualifying_duration ?? null;
  const timer = formatMs(dungeon.keystone_timer_ms ?? oneChestDuration);
  const keystoneUpgrades = (dungeon.keystone_upgrades ?? [])
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);

  const zoneEncounters = (wowheadZone?.encounters || []).map((enc) => ({
    npc_id: Number(enc?.npc_id ?? 0),
    name: String(enc?.name || ''),
    url: enc?.url || undefined,
    description: enc?.description || undefined,
    image_url: enc?.image_url || undefined,
    abilities: Array.isArray(enc?.abilities) ? enc.abilities : [],
    ability_spell_ids: Array.isArray(enc?.ability_spell_ids) ? enc.ability_spell_ids : [],
    ability_spell_urls: Array.isArray(enc?.ability_spell_urls) ? enc.ability_spell_urls : [],
  }));
  const globalEncounterLookup = new Map<string, WowheadEncounter>();
  for (const zone of wowheadZonesIndex) {
    for (const enc of zone.encounters || []) {
      const key = normalizeName(enc.name);
      if (key && !globalEncounterLookup.has(key)) {
        globalEncounterLookup.set(key, enc);
      }
    }
  }

  const fallbackEncounters: WowheadEncounter[] = (instanceDetails?.encounters || []).map((enc) => {
    const match =
      zoneEncounters.find((z) => normalizeName(z.name) === normalizeName(enc.name)) ||
      globalEncounterLookup.get(normalizeName(enc.name));
    return {
      npc_id: match?.npc_id || enc.id || 0,
      name: enc.name,
      url: match?.url,
      description: match?.description,
      image_url: enc.image_url || match?.image_url,
      abilities: match?.abilities || [],
      ability_spell_ids: match?.ability_spell_ids || [],
      ability_spell_urls: match?.ability_spell_urls || [],
    };
  });
  const sectionEncounters = zoneEncounters.length > 0 ? zoneEncounters : fallbackEncounters;
  const encounterCount =
    sectionEncounters.length || instanceDetails?.encounters?.length || dungeon.num_bosses || 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        {dungeonImageSrc ? (
          <img src={dungeonImageSrc} alt="" className="h-20 w-20 rounded-xl object-cover" />
        ) : (
          <div className="flex h-20 w-20 items-center justify-center rounded-xl bg-zinc-800">
            <span className="text-3xl font-bold text-zinc-600">{dungeon.name[0]}</span>
          </div>
        )}
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-gray-100">{dungeon.name}</h1>
          <p className="text-zinc-400">{dungeon.zone || wowheadZone?.name || 'Unknown Zone'}</p>
          {typeof wowheadZone?.expansion === 'number' && (
            <p className="text-xs text-zinc-500">Expansion {wowheadZone.expansion}</p>
          )}
          {wowheadZone?.url && (
            <a
              href={wowheadZone.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex rounded-md border border-gold/35 bg-gold/10 px-2 py-1 text-xs font-semibold text-gold"
            >
              Open on Wowhead
            </a>
          )}
        </div>
      </div>

      {(dungeon.description || wowheadZone?.description) && (
        <div className="rounded-xl border border-white/10 bg-white/5 p-6">
          <p className="text-zinc-300">{wowheadZone?.description || dungeon.description}</p>
        </div>
      )}

      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <div className="flex flex-wrap gap-2 text-sm">
          {timer ? <span
            className="rounded border border-white/15 bg-black/30 px-2 py-1 text-zinc-200">Timer: {timer}</span> : null}
          {dungeon.minimum_level ? <span className="rounded border border-white/15 bg-black/30 px-2 py-1 text-zinc-200">Min level: {dungeon.minimum_level}</span> : null}
          {dungeon.challenge_mode_id ? <span
            className="rounded border border-white/15 bg-black/30 px-2 py-1 text-zinc-200">Challenge ID: {dungeon.challenge_mode_id}</span> : null}
          {encounterCount ? <span
            className="rounded border border-white/15 bg-black/30 px-2 py-1 text-zinc-200">Encounters: {encounterCount}</span> : null}
        </div>
        {detailUpgrades.length > 0 ? (
          <div className="mt-3">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">Keystone Upgrade Timers</p>
            <div className="flex flex-wrap gap-1.5">
              {detailUpgrades.map((upgrade) => (
                <span
                  key={`upgrade-${upgrade.upgrade_level}`}
                  className="rounded bg-gold/10 px-2 py-0.5 text-[11px] text-gold"
                >
                  +{upgrade.upgrade_level} ({formatMs(upgrade.qualifying_duration)})
                </span>
              ))}
            </div>
          </div>
        ) : keystoneUpgrades.length > 0 ? (
          <div className="mt-3">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">Keystone Upgrades</p>
            <div className="flex flex-wrap gap-1.5">
              {keystoneUpgrades.map((upgrade) => (
                <span key={upgrade} className="rounded bg-gold/10 px-2 py-0.5 text-[11px] text-gold">
                  +{upgrade}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {sectionEncounters.length > 0 ? (
        <div className="space-y-3">
          <h2 className="text-xl font-bold text-zinc-200">Encounters</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sectionEncounters.map((encounter) => {
              const encounterImageSrc = encounter.image_url || null;
              return (
                <div
                  key={encounter.npc_id}
                  className="rounded-lg border border-white/10 bg-white/5 p-4"
                >
                  <div className="mb-3 flex items-center gap-3">
                    {encounterImageSrc ? (
                      <img src={encounterImageSrc} alt="" className="h-12 w-12 rounded object-cover" />
                    ) : (
                      <div className="flex h-12 w-12 items-center justify-center rounded bg-zinc-800">
                        <span className="text-xl font-bold text-gold">?</span>
                      </div>
                    )}
                    <div>
                      <p className="font-bold text-zinc-200">{encounter.name}</p>
                      {encounter.url && (
                        <a
                          href={encounter.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-gold hover:underline"
                        >
                          Wowhead
                        </a>
                      )}
                    </div>
                  </div>
                  {encounter.description && (
                    <p className="mb-3 text-sm text-zinc-300">
                      {renderEncounterDescription(encounter.description, encounter.abilities || [])}
                    </p>
                  )}
                  {(encounter.abilities || []).length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {(encounter.abilities || []).slice(0, 8).map((spell) => (
                        <a
                          key={spell.id}
                          href={spell.url || `https://www.wowhead.com/spell=${spell.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded border border-white/15 bg-black/30 px-2 py-1 text-xs text-zinc-200"
                        >
                          {spell.icon_url ? (
                            <img src={spell.icon_url} alt="" className="h-4 w-4 rounded-sm object-cover" />
                          ) : null}
                          <span>{spell.name || `Spell ${spell.id}`}</span>
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
