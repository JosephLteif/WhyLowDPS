'use client';

import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import {
  API_URL,
  DungeonInfo,
  fetchJsonCached,
  getDungeonDataCached,
  type MythicKeystoneDungeonDetail,
} from '../../lib/api';
import { useWowheadTooltips } from '../../lib/useWowheadTooltips';
import { useAuth } from '../../components/AuthContext';
import { Instance } from '../../drop-finder/types';
import { getRaidInstances } from '../shared';

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

type WowheadZoneMatchResponse = {
  zone?: WowheadZone | null;
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
  return decodeHtmlEntities(input)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function decodeHtmlEntities(input?: string | null): string {
  const text = String(input || '');
  return text
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function singularizeWord(word: string): string {
  if (word.length < 4) return word;
  if (word.endsWith('ies') && word.length > 4) return `${word.slice(0, -3)}y`;
  if (/(ches|shes|xes|zes|ses)$/.test(word) && word.length > 4) return word.slice(0, -2);
  if (word.endsWith('s') && !/(ss|is|us)$/.test(word)) return word.slice(0, -1);
  return word;
}

function buildNameVariants(input?: string | null): string[] {
  const raw = decodeHtmlEntities(input)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .trim();
  if (!raw) return [];
  const words = raw.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const variants = new Set<string>();
  variants.add(words.join(''));

  const singularWords = words.map(singularizeWord);
  variants.add(singularWords.join(''));

  return Array.from(variants).filter(Boolean);
}

function renderEncounterDescription(text: string, abilities: WowheadSpell[]): ReactNode {
  const chunks: ReactNode[] = [];
  const byName = new Map<string, WowheadSpell>();
  for (const ability of abilities) {
    for (const key of buildNameVariants(ability.name)) {
      if (!byName.has(key)) {
        byName.set(key, ability);
      }
    }
  }

  const re = /\[([^\]]+)\]/g;
  let last = 0;
  let idx = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const start = m.index;
    const end = re.lastIndex;
    const token = decodeHtmlEntities(m[1]);

    if (start > last) {
      chunks.push(<span key={`txt-${idx++}`}>{decodeHtmlEntities(text.slice(last, start))}</span>);
    }

    const tokenKeys = buildNameVariants(token);
    const matched = tokenKeys.map((k) => byName.get(k)).find((v) => !!v);
    const href = matched?.url || `https://www.wowhead.com/search?q=${encodeURIComponent(token)}`;
    chunks.push(
      <a
        key={`spell-${idx++}`}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="mx-0.5 inline-flex items-center rounded border border-white/20 bg-black/35 px-1.5 py-0.5 text-xs text-gold hover:bg-black/55"
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
    chunks.push(<span key={`txt-${idx++}`}>{decodeHtmlEntities(text.slice(last))}</span>);
  }
  return chunks;
}

function EncounterAvatar({
  npcId,
  name,
  sourceImageUrl,
  fallbackIconUrl,
}: {
  npcId: number;
  name: string;
  sourceImageUrl?: string | null;
  fallbackIconUrl?: string | null;
}) {
  const proxyImage = buildImageProxyUrl('encounter', npcId, sourceImageUrl);
  const preferredSource =
    isHttpUrl(sourceImageUrl) && !sourceImageUrl.includes('/images/logos/share-icon.png')
      ? sourceImageUrl
      : null;
  const preferredAbilityIcon = isHttpUrl(fallbackIconUrl) ? fallbackIconUrl : null;
  const sources = [preferredSource, preferredAbilityIcon, proxyImage].filter(
    (url): url is string => !!url,
  );
  const [sourceIndex, setSourceIndex] = useState(0);
  const src = sources[sourceIndex] || null;

  useEffect(() => {
    setSourceIndex(0);
  }, [preferredSource, preferredAbilityIcon, proxyImage]);

  if (!src) {
    return (
      <div className="flex h-12 w-12 items-center justify-center rounded bg-zinc-800">
        <span className="text-xl font-bold text-gold">{name[0] || '?'}</span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt=""
      className="h-12 w-12 rounded object-cover"
      onError={() => {
        if (sourceIndex < sources.length - 1) {
          setSourceIndex((idx) => idx + 1);
        }
      }}
    />
  );
}

export default function DungeonPageClient({ id, kind = 'dungeon' }: { id: string; kind?: 'dungeon' | 'raid' }) {
  const { lightMode } = useAuth();
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
      kind === 'dungeon'
        ? getDungeonDataCached().catch(() => ({ rotation_dungeons: [] as DungeonInfo[] }))
        : Promise.resolve({ rotation_dungeons: [] as DungeonInfo[] }),
      fetchJsonCached<Instance[]>(`${API_URL}/api/instances`, {
        ttl: 60_000,
      }).catch(() => [] as Instance[]),
    ])
      .then(async ([seasonData, instances]) => {
        const pool =
          kind === 'raid'
            ? getRaidInstances(instances).map((instance) => ({ id: instance.id }))
            : seasonData.rotation_dungeons;
        const found = (pool as Array<{ id: number }>).find((d) => d.id === dungeonId) as DungeonInfo | undefined;
        const inst = instances.find((i) => i.id === dungeonId) || null;
        if (inst) setInstanceDetails(inst);

        const lookupName = found?.name || inst?.name || '';
        const matchedResp = await fetchJsonCached<WowheadZoneMatchResponse>(
          `${API_URL}/api/data/wowhead-zones-index/match?instance_id=${encodeURIComponent(String(dungeonId))}&wowhead_id=${encodeURIComponent(String(found?.wowhead_id ?? ''))}&name=${encodeURIComponent(lookupName)}&is_raid=${encodeURIComponent(String(kind === 'raid'))}`,
          { ttl: 60_000 },
        ).catch(() => ({ zone: null }));
        const matched = matchedResp?.zone || null;
        setWowheadZone(matched);
        setWowheadZonesIndex(matched ? [matched] : []);

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

        if (!lightMode && kind === 'dungeon') void (async () => {
          try {
            const index = await fetchJsonCached<{ dungeons?: Array<{ id?: number; name?: string }> }>(
              `${API_URL}/api/blizzard/mythic-keystone/dungeon/index?region=us`,
              { ttl: 60_000 },
            );
            const normalizedFound = resolvedDungeon.name.toLowerCase().replace(/[^a-z0-9]/g, '');
            const detailId =
              index?.dungeons?.find(
                (d) =>
                  String(d?.name || '')
                    .toLowerCase()
                    .replace(/[^a-z0-9]/g, '') === normalizedFound,
              )?.id ?? resolvedDungeon.id;
            if (Number(detailId) > 0) {
              const detail = await fetchJsonCached<MythicKeystoneDungeonDetail>(
                `${API_URL}/api/blizzard/mythic-keystone/dungeon/${encodeURIComponent(String(detailId))}?region=us`,
                { ttl: 60_000 },
              );
              setMplusDetail(detail);
            }
          } catch {
          }
        })();
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id, kind, lightMode]);

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
              return (
                <div
                  key={encounter.npc_id}
                  className="rounded-lg border border-white/10 bg-white/5 p-4"
                >
                  <div className="mb-3 flex items-center gap-3">
                    <EncounterAvatar
                      npcId={encounter.npc_id}
                      name={encounter.name}
                      sourceImageUrl={encounter.image_url || null}
                      fallbackIconUrl={encounter.abilities?.[0]?.icon_url || null}
                    />
                    <div>
                      <p className="font-bold text-zinc-200">{decodeHtmlEntities(encounter.name)}</p>
                      {encounter.url && (
                        <a
                          href={encounter.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1 inline-flex items-center rounded-md border border-gold/35 bg-gold/10 px-2 py-1 text-xs font-semibold text-gold transition-colors hover:bg-gold/20"
                        >
                          View on Wowhead
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
                            <span>{decodeHtmlEntities(spell.name || `Spell ${spell.id}`)}</span>
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
