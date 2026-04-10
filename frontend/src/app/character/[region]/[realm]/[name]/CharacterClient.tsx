'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState, useCallback } from 'react';
import { API_URL, fetchJson } from '../../../../lib/api';
import CharacterPanel from '../../../../components/CharacterPanel';
import { generateSimcString } from '../../../../lib/simc-generator';

export default function CharacterClient() {
  const params = useParams();
  const region = (params.region as string) || 'us';
  const realm = (params.realm as string) || '';
  const name = (params.name as string) || '';

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copying, setCopying] = useState(false);

  const fetchCharacterData = useCallback(
    async (refresh = false) => {
      if (!realm || !name) return;
      setLoading(true);
      setError('');

      try {
        const query = `?region=${region}${refresh ? '&refresh=true' : ''}`;
        const baseUrl = `${API_URL}/api/blizzard/character/${realm}/${name}`;

        const [profile, equipment, statistics, specializations, professions] =
          await Promise.all([
            fetchJson<any>(`${baseUrl}/profile${query}`),
            fetchJson<any>(`${baseUrl}/equipment${query}`).catch(() => ({ equipped_items: [] })),
            fetchJson<any>(`${baseUrl}/statistics${query}`).catch(() => ({})),
            fetchJson<any>(`${baseUrl}/specializations${query}`).catch(() => ({})),
            fetchJson<any>(`${baseUrl}/professions${query}`).catch(() => ({})),
          ]);

        setData({ profile, equipment, statistics, specializations, professions });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch character');
      } finally {
        setLoading(false);
      }
    },
    [region, realm, name]
  );

  useEffect(() => {
    fetchCharacterData();
  }, [fetchCharacterData]);

  const handleCopySimc = async () => {
    if (!data) return;
    setCopying(true);
    try {
      const simc = generateSimcString(data.profile, data.equipment);
      await navigator.clipboard.writeText(simc);
      // Subtle success feedback could be added here
    } catch (err) {
      console.error('Failed to copy SimC:', err);
    } finally {
      setTimeout(() => setCopying(false), 1000);
    }
  };

  if (loading) {
    return (
      <div className="flex h-96 flex-col items-center justify-center gap-4">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-zinc-800 border-t-gold" />
        <p className="text-sm font-medium text-zinc-500">Loading Character Profile...</p>
      </div>
    );
  }

  if (error) {
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
        <h2 className="mb-2 text-xl font-bold text-zinc-200">Character Not Found</h2>
        <p className="mb-6 text-zinc-500">{error}</p>
        <button
          onClick={() => fetchCharacterData(false)}
          className="rounded-lg bg-zinc-800 px-6 py-2 text-sm font-bold text-zinc-200 transition-colors hover:bg-zinc-700"
        >
          Try Again
        </button>
      </div>
    );
  }

  const { profile } = data;
  const characterMediaUrl = `${API_URL}/api/blizzard/character/${realm}/${name}/media/main?region=${region}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-black tracking-tight text-white">{profile.name}</h1>
            <span className="rounded-full bg-zinc-800 px-3 py-1 text-xs font-bold uppercase tracking-wider text-zinc-400">
              Lv {profile.level} {profile.race.name} {profile.character_class.name}
            </span>
            <div className="flex items-center gap-2 rounded-lg bg-gold/10 px-3 py-1 ring-1 ring-gold/20">
              <span className="text-[10px] font-bold uppercase tracking-widest text-gold/70">
                ILVL
              </span>
              <span className="text-sm font-black text-gold">{profile.equipped_item_level}</span>
              {profile.average_item_level !== profile.equipped_item_level && (
                <span className="text-[11px] font-bold text-gold/40">
                  ({profile.average_item_level})
                </span>
              )}
            </div>
            <button
              onClick={() => fetchCharacterData(true)}
              disabled={loading}
              className="ml-2 rounded border border-white/10 bg-black/20 px-3 py-1 text-xs font-bold text-zinc-200 backdrop-blur-sm hover:bg-white/10 active:scale-95 disabled:opacity-50"
            >
              {loading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
          <p className="mt-1 font-medium text-zinc-500">
            {profile.realm.name} — {region.toUpperCase()}
          </p>
        </div>
      </div>

      <CharacterPanel
        name={profile.name}
        realm={profile.realm.name}
        region={region}
        characterClass={profile.character_class.name}
        race={profile.race.name}
        level={profile.level}
        equipment={data.equipment}
        statistics={data.statistics}
        specializations={data.specializations}
        professions={data.professions}
        characterMediaUrl={characterMediaUrl}
      />
    </div>
  );
}
