'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { API_URL, getGameContext, listInstances } from '../lib/api';
import { wowExpansions } from '../lib/wow-season-content';
import type { Instance } from '../drop-finder/types';

type RaidEncounter = {
  id: number;
  name: string;
  imageUrl?: string;
};

function resolveAssetUrl(url?: string): string | undefined {
  if (!url) return undefined;
  return url.startsWith('/') ? `${API_URL}${url}` : url;
}

function normalizeEncounter(raw: unknown): RaidEncounter | null {
  if (raw && typeof raw === 'object') {
    const value = raw as Record<string, unknown>;
    const name = typeof value.name === 'string' ? value.name.trim() : '';
    const id = Number(value.id);
    const imageUrl = typeof value.image_url === 'string' ? value.image_url : undefined;
    if (value.trash === true || id < 0) return null;
    if (name && Number.isFinite(id)) return { id, name, imageUrl };
  }

  if (typeof raw === 'string') {
    const id = Number(raw.match(/\bid=([^;}\s]+)/)?.[1]);
    const name = raw.match(/\bname=(.*?)(?:; [A-Za-z_][A-Za-z0-9_]*=|}$)/)?.[1]?.trim();
    if (name && Number.isFinite(id)) return { id, name };
  }

  return null;
}

function RaidArtwork({ raid }: { raid: Instance }) {
  const apiImageUrl = resolveAssetUrl(raid.image_url);
  const [imageUrl, setImageUrl] = useState(apiImageUrl);

  return imageUrl ? (
    <img
      src={imageUrl}
      alt=""
      className="h-40 w-full object-cover"
      loading="lazy"
      onError={() => {
        setImageUrl(undefined);
      }}
    />
  ) : (
    <div className="h-40 bg-zinc-800" aria-hidden="true" />
  );
}

function RaidCard({ raid }: { raid: Instance }) {
  const encounters = (Array.isArray(raid.encounters) ? raid.encounters : [])
    .map(normalizeEncounter)
    .filter((encounter): encounter is RaidEncounter => Boolean(encounter));

  return (
    <article className="overflow-hidden rounded-xl border border-white/15 bg-zinc-900/80">
      <RaidArtwork raid={raid} />
      <div className="p-4">
        <h2 className="text-xl font-bold text-zinc-100">{raid.name}</h2>
        <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">
          {encounters.length} encounters
        </p>
        {encounters.length > 0 ? (
          <ul className="mt-4 space-y-2">
            {encounters.map((encounter) => (
              <li
                key={`${raid.id}-${encounter.id}`}
                className="flex items-center gap-2 text-sm text-zinc-200"
              >
                {resolveAssetUrl(encounter.imageUrl) ? (
                  <img
                    src={resolveAssetUrl(encounter.imageUrl)}
                    alt=""
                    className="h-7 w-7 rounded object-cover"
                    loading="lazy"
                  />
                ) : null}
                <span>{encounter.name}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-zinc-500">No encounter details are available.</p>
        )}
      </div>
    </article>
  );
}

export default function RaidsPage() {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [activeRaidPoolId, setActiveRaidPoolId] = useState<number | null>(null);
  const [selectedExpansionId, setSelectedExpansionId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([listInstances(), getGameContext().catch(() => null)])
      .then(([data, context]) => {
        if (cancelled) return;
        setInstances(data);
        setActiveRaidPoolId(context?.pools?.raids ?? null);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load raids.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const raids = useMemo(() => {
    const apiRaids = instances.filter((instance) => instance.type === 'raid' && instance.id > 0);
    if (activeRaidPoolId == null) return [];
    const activePool = instances.find((instance) => instance.id === activeRaidPoolId);
    if (!activePool) return [];
    const activeEncounterIds = new Set(
      (activePool?.encounters ?? []).map((encounter) => encounter.id)
    );
    return apiRaids.filter((raid) =>
      raid.encounters.some((encounter) => activeEncounterIds.has(encounter.id))
    );
  }, [activeRaidPoolId, instances]);
  const expansionIds = useMemo(
    () =>
      [
        ...new Set(raids.map((raid) => raid.expansion).filter((id): id is number => id != null)),
      ].sort((left, right) => right - left),
    [raids]
  );
  const currentExpansionId = expansionIds[0] ?? null;
  const effectiveExpansionId = selectedExpansionId ?? currentExpansionId;
  const visibleRaids = raids.filter(
    (raid) => effectiveExpansionId == null || raid.expansion === effectiveExpansionId
  );
  const expansionNames = new Map(wowExpansions.map((expansion) => [expansion.id, expansion.name]));

  if (loading) {
    return <div className="h-64 animate-pulse rounded-xl border border-white/10 bg-white/5" />;
  }

  if (error) {
    return (
      <div className="mx-auto max-w-lg py-20 text-center">
        <AlertTriangle className="mx-auto mb-4 h-8 w-8 text-red-400" />
        <h1 className="text-xl font-bold text-zinc-100">Failed to load raids</h1>
        <p className="mt-2 text-zinc-500">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white lg:text-4xl">Raids</h1>
          <p className="mt-2 text-base font-semibold text-zinc-300">
            Blizzard raid names, artwork, and encounters
          </p>
        </div>
        <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
          Expansion
          <select
            value={effectiveExpansionId ?? ''}
            onChange={(event) => setSelectedExpansionId(Number(event.currentTarget.value) || null)}
            className="min-w-56 rounded-lg border border-white/15 bg-zinc-900 px-3 py-2 text-sm font-medium normal-case tracking-normal text-zinc-100"
          >
            {expansionIds.map((id) => (
              <option key={id} value={id}>
                {expansionNames.get(id) ?? `Expansion ${id}`}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="rounded-xl border border-white/10 bg-zinc-900/50 p-4 text-sm text-zinc-400">
        {visibleRaids.length} raid{visibleRaids.length === 1 ? '' : 's'} available from Blizzard
        data.
      </div>

      {visibleRaids.length > 0 ? (
        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visibleRaids.map((raid) => (
            <RaidCard key={raid.id} raid={raid} />
          ))}
        </section>
      ) : (
        <div className="rounded-xl border border-white/10 bg-zinc-900/50 p-10 text-center text-zinc-500">
          No raids are available for this expansion.
        </div>
      )}
    </div>
  );
}
