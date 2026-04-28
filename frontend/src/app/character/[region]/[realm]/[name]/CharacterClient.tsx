'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import {
  API_URL,
  deleteCharacterProfile,
  fetchJson,
  listCharacterProfiles,
  SavedCharacterProfile,
} from '@/app/lib/api';
import CharacterPanel from '../../../../components/CharacterPanel';
import ConfirmModal from '../../../../components/ConfirmModal';

function CopyIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
      />
    </svg>
  );
}

export default function CharacterClient() {
  const params = useParams();
  const searchParams = useSearchParams();

  // Robust resolution from params or URL path
  let region = (searchParams.get('region') || (params.region as string) || 'us').toLowerCase();
  let realm = (searchParams.get('realm') || (params.realm as string) || '').toLowerCase();
  let name = (searchParams.get('name') || (params.name as string) || '').toLowerCase();
  const tabParam = (searchParams.get('tab') || '').toLowerCase();
  const initialTab =
    tabParam === 'vault' || tabParam === 'mythic' || tabParam === 'profile' || tabParam === 'raiding'
      ? (tabParam as 'vault' | 'mythic' | 'profile' | 'raiding')
      : undefined;

  const usingPlaceholderSegments = realm === 'realm' && name === 'name';

  if ((!realm || !name || usingPlaceholderSegments) && typeof window !== 'undefined') {
    const query = new URLSearchParams(window.location.search);
    const queryRegion = query.get('region');
    const queryRealm = query.get('realm');
    const queryName = query.get('name');
    if (queryRegion && queryRealm && queryName) {
      region = queryRegion.toLowerCase();
      realm = queryRealm.toLowerCase();
      name = queryName.toLowerCase();
    } else {
      const parts = window.location.pathname.split('/').filter(Boolean);
      // Expected pattern: character/[region]/[realm]/[name]
      const charIndex = parts.indexOf('character');
      if (charIndex !== -1 && parts.length >= charIndex + 4) {
        region = parts[charIndex + 1];
        realm = parts[charIndex + 2];
        name = parts[charIndex + 3];
      }
    }
  }

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savedProfiles, setSavedProfiles] = useState<SavedCharacterProfile[]>([]);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [mainCharacterKey, setMainCharacterKey] = useState<string>('');
  const [mainCharacterSaving, setMainCharacterSaving] = useState(false);
  const [mainCharacterError, setMainCharacterError] = useState<string | null>(null);

  // Fetch saved profiles for this character
  useEffect(() => {
    if (!name || !realm || !region) return;
    listCharacterProfiles({ name, realm, region })
      .then(setSavedProfiles)
      .catch(() => setSavedProfiles([]));
  }, [name, realm, region]);

  useEffect(() => {
    fetch(`${API_URL}/api/user/config`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg) => {
        const key = String(cfg?.main_character || '');
        setMainCharacterKey(key);
      })
      .catch(() => setMainCharacterKey(''));
  }, []);

  const handleDeleteProfiles = useCallback(async () => {
    for (const p of savedProfiles) {
      await deleteCharacterProfile(p.id);
    }
    setSavedProfiles([]);
  }, [savedProfiles]);

  const fetchCharacterData = useCallback(
    async (refresh = false) => {
      if (!realm || !name) return;
      setLoading(true);
      setError('');

      try {
        const query = `?region=${region}${refresh ? '&refresh=true' : ''}`;
        const baseUrl = `${API_URL}/api/blizzard/character/${realm}/${name}`;

        const [
          profile,
          equipment,
          statistics,
          specializations,
          professions,
          mythicPlus,
          raidEncounters,
        ] = await Promise.all([
          fetchJson<any>(`${baseUrl}/profile${query}`),
          fetchJson<any>(`${baseUrl}/equipment${query}`).catch(() => ({ equipped_items: [] })),
          fetchJson<any>(`${baseUrl}/statistics${query}`).catch(() => ({})),
          fetchJson<any>(`${baseUrl}/specializations${query}`).catch(() => ({})),
          fetchJson<any>(`${baseUrl}/professions${query}`).catch(() => ({})),
          fetchJson<any>(`${baseUrl}/mythic-keystone-profile${query}`).catch(() => ({})),
          fetchJson<any>(`${baseUrl}/encounters/raids${query}`).catch(() => ({})),
        ]);

        setData({
          profile,
          equipment,
          statistics,
          specializations,
          professions,
          mythicPlus,
          raidEncounters,
        });
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
  const canonicalRegion = region.toLowerCase();
  const canonicalRealm = String(profile.realm?.slug || realm).toLowerCase();
  const canonicalName = String(profile.name || name).toLowerCase();
  const currentKey = `${canonicalRegion}|${canonicalRealm}|${canonicalName}`;
  const isMainCharacter = mainCharacterKey === currentKey;
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
            {savedProfiles.length > 0 && (
              <>
                <button
                  onClick={() => {
                    const latestProfile = savedProfiles[0];
                    navigator.clipboard.writeText(latestProfile.simc_input);
                  }}
                  className="ml-2 flex items-center gap-1.5 rounded border border-white/10 bg-black/20 px-3 py-1 text-xs font-bold text-zinc-200 backdrop-blur-sm hover:bg-white/10 active:scale-95"
                >
                  <CopyIcon />
                  Copy SimC
                </button>
                <button
                  onClick={() => setDeleteModalOpen(true)}
                  className="ml-2 flex items-center gap-1.5 rounded border border-white/10 bg-black/20 px-3 py-1 text-xs font-bold text-red-400 backdrop-blur-sm hover:bg-white/10 active:scale-95"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                    />
                  </svg>
                  Delete SimC
                </button>
              </>
            )}
            <button
              onClick={async () => {
                setMainCharacterSaving(true);
                setMainCharacterError(null);
                try {
                  const next = isMainCharacter ? '' : currentKey;
                  const res = await fetch(`${API_URL}/api/user/config`, {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ key: 'main_character', value: next }),
                  });
                  if (!res.ok) {
                    const msg = await res.text().catch(() => '');
                    throw new Error(msg || `Request failed (${res.status})`);
                  }
                  setMainCharacterKey(next);
                } catch (err) {
                  setMainCharacterError(err instanceof Error ? err.message : 'Failed to save main character');
                } finally {
                  setMainCharacterSaving(false);
                }
              }}
              disabled={mainCharacterSaving}
              className={`ml-2 rounded border px-3 py-1 text-xs font-bold backdrop-blur-sm active:scale-95 ${
                isMainCharacter
                  ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-300'
                  : 'border-white/10 bg-black/20 text-zinc-200 hover:bg-white/10'
              }`}
            >
              {mainCharacterSaving ? 'Saving...' : isMainCharacter ? 'Main Character' : 'Set as Main'}
            </button>
          </div>
          {mainCharacterError && (
            <p className="mt-1 text-xs text-red-400">Set as Main failed: {mainCharacterError}</p>
          )}
          <p className="mt-1 font-medium text-zinc-500">
            {profile.realm.name} - {region.toUpperCase()}
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
        mythicPlus={data.mythicPlus}
        raidEncounters={data.raidEncounters}
        characterMediaUrl={characterMediaUrl}
        latestSimcInput={savedProfiles[0]?.simc_input || null}
        initialTab={initialTab}
      />
      <ConfirmModal
        isOpen={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        onConfirm={handleDeleteProfiles}
        title="Delete SimC Profiles"
        message={`Are you sure you want to delete all saved SimC profiles for ${profile.name}? This action cannot be undone.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="danger"
      />
    </div>
  );
}
