'use client';

import { useEffect, useState } from 'react';
import { API_URL, DungeonInfo, fetchJson, getDungeonData } from '../../lib/api';
import { useWowheadTooltips } from '../../lib/useWowheadTooltips';
import { Instance } from '../../drop-finder/types';

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

export default function DungeonPageClient({ id }: { id: string }) {
  const [dungeon, setDungeon] = useState<DungeonInfo | null>(null);
  const [instanceDetails, setInstanceDetails] = useState<Instance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    const dungeonId = parseInt(id, 10);

    Promise.all([getDungeonData(), fetchJson<Instance[]>(`${API_URL}/api/instances`)])
      .then(([seasonData, instances]) => {
        const found = seasonData.rotation_dungeons.find((d) => d.id === dungeonId);
        if (!found) {
          throw new Error('Dungeon not found in current rotation');
        }
        setDungeon(found);

        const inst = instances.find((i) => i.id === dungeonId);
        if (inst) {
          setInstanceDetails(inst);
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
          <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
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

  const dungeonImageSrc = buildImageProxyUrl('instance', dungeon.id, dungeon.image_url);

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
          <p className="text-zinc-400">{dungeon.zone || 'Unknown Zone'}</p>
        </div>
      </div>

      {dungeon.description && (
        <div className="rounded-xl border border-white/10 bg-white/5 p-6">
          <p className="text-zinc-300">{dungeon.description}</p>
        </div>
      )}

      {instanceDetails?.encounters && instanceDetails.encounters.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-xl font-bold text-zinc-200">Encounters</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {instanceDetails.encounters.map((encounter) => {
              const encounterImageSrc = buildImageProxyUrl(
                'encounter',
                encounter.id,
                encounter.image_url,
              );
              return (
                <div
                  key={encounter.id}
                  className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 p-4"
                >
                  {encounterImageSrc ? (
                    <img src={encounterImageSrc} alt="" className="h-12 w-12 rounded object-cover" />
                  ) : (
                    <div className="flex h-12 w-12 items-center justify-center rounded bg-zinc-800">
                      <span className="text-xl font-bold text-gold">?</span>
                    </div>
                  )}
                  <div>
                    <p className="font-bold text-zinc-200">{encounter.name}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
