'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ChevronDown, Copy, Heart, Trash2 } from 'lucide-react';
import {
  API_URL,
  deleteCharacterProfile,
  fetchJson,
  listCharacterProfiles,
  SavedCharacterProfile,
} from '@/app/lib/api';
import { buildWishlistHref } from '@/app/lib/wishlist';
import CharacterPanel from '../../../../components/CharacterPanel';
import ConfirmModal from '../../../../components/ConfirmModal';
import ToggleOptionCard from '../../../../components/shared/ToggleOptionCard';

const LOCAL_TRACKED_CHARACTERS_KEY = 'whylowdps_tracked_characters';
const LAST_REFRESH_PREFIX = 'whylowdps_last_refresh_';

type RosterCharacter = {
  name?: string;
  realm?: string;
  region?: string;
  class?: string;
  className?: string;
  character_class?: { name?: string };
};

function normalizeCharacterSlug(value?: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/'/g, '')
    .replace(/\s+/g, '-');
}

function CopyIcon() {
  return <Copy className="h-4 w-4" strokeWidth={2} />;
}

export default function CharacterClient() {
  const params = useParams();
  const searchParams = useSearchParams();

  // Robust resolution from params or URL path
  let region = (searchParams.get('region') || (params.region as string) || 'us').toLowerCase();
  let realm = (searchParams.get('realm') || (params.realm as string) || '').toLowerCase();
  let name = (searchParams.get('name') || (params.name as string) || '').toLowerCase();
  const tabParam = (searchParams.get('tab') || '').toLowerCase();
  const forceRefresh = (searchParams.get('refresh') || '').toLowerCase() === 'true';
  const initialTab =
    tabParam === 'vault' ||
    tabParam === 'mythic' ||
    tabParam === 'profile' ||
    tabParam === 'raiding'
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
  const [trackedCharacterKeys, setTrackedCharacterKeys] = useState<string[]>([]);
  const [rosterCharacters, setRosterCharacters] = useState<RosterCharacter[]>([]);
  const [trackSaving, setTrackSaving] = useState(false);
  const [trackError, setTrackError] = useState<string | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(null);
  const [simcMenuOpen, setSimcMenuOpen] = useState(false);
  const simcMenuRef = useRef<HTMLDivElement | null>(null);

  // Fetch saved profiles for this character
  useEffect(() => {
    if (!name || !realm || !region) return;
    listCharacterProfiles({ name, realm, region })
      .then(setSavedProfiles)
      .catch(() => setSavedProfiles([]));
  }, [name, realm, region]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const raw = localStorage.getItem(LOCAL_TRACKED_CHARACTERS_KEY) || '[]';
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) setTrackedCharacterKeys(parsed.map((v) => String(v)));
    } catch {
      setTrackedCharacterKeys([]);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchJson<{ characters?: RosterCharacter[] } | RosterCharacter[]>(
      `${API_URL}/api/bnet/user/characters`
    )
      .then((response) => {
        if (cancelled) return;
        const list = Array.isArray(response) ? response : response?.characters || [];
        setRosterCharacters(Array.isArray(list) ? list : []);
      })
      .catch(() => {
        if (cancelled) return;
        setRosterCharacters([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!simcMenuOpen) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && simcMenuRef.current?.contains(target)) return;
      setSimcMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSimcMenuOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [simcMenuOpen]);

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
      const requestedKey = `${region.toLowerCase()}|${realm.toLowerCase()}|${name.toLowerCase()}`;

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
        if (refresh) {
          const ts = Date.now();
          setLastRefreshedAt(ts);
          if (typeof window !== 'undefined') {
            localStorage.setItem(`${LAST_REFRESH_PREFIX}${requestedKey}`, String(ts));
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch character');
      } finally {
        setLoading(false);
      }
    },
    [region, realm, name]
  );

  useEffect(() => {
    fetchCharacterData(forceRefresh);
  }, [fetchCharacterData, forceRefresh]);

  const refreshStorageKey = `${LAST_REFRESH_PREFIX}${region.toLowerCase()}|${realm.toLowerCase()}|${name.toLowerCase()}`;
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const raw = localStorage.getItem(refreshStorageKey);
    const parsed = raw ? Number(raw) : 0;
    setLastRefreshedAt(Number.isFinite(parsed) && parsed > 0 ? parsed : null);
  }, [refreshStorageKey]);

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
          <AlertTriangle className="h-8 w-8" strokeWidth={2} />
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
  const isTrackedCharacter = trackedCharacterKeys.includes(currentKey);
  const rosterCharacter =
    rosterCharacters.find((char) => {
      const charName = String(char.name || '').toLowerCase();
      const charRealm = normalizeCharacterSlug(char.realm);
      const charRegion = String(char.region || '').toLowerCase();
      return (
        charName === canonicalName && charRealm === canonicalRealm && charRegion === canonicalRegion
      );
    }) || null;
  const rosterWishlistHref = rosterCharacter
    ? buildWishlistHref({
        name: rosterCharacter.name || profile.name,
        realm: rosterCharacter.realm || profile.realm?.name || realm,
        region: rosterCharacter.region || region,
        className:
          rosterCharacter.className ||
          rosterCharacter.class ||
          rosterCharacter.character_class?.name ||
          profile.character_class?.name,
      })
    : '';
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
            {rosterWishlistHref ? (
              <Link
                href={rosterWishlistHref}
                className="ml-2 flex items-center gap-1.5 rounded border border-rose-400/35 bg-rose-500/15 px-3 py-1 text-xs font-bold text-rose-200 backdrop-blur-sm hover:bg-rose-500/25 active:scale-95"
              >
                <Heart className="h-4 w-4" strokeWidth={2} />
                Open Wishlist
              </Link>
            ) : null}
            {savedProfiles.length > 0 && (
              <div ref={simcMenuRef} className="relative ml-2">
                <button
                  type="button"
                  onClick={() => setSimcMenuOpen((prev) => !prev)}
                  aria-expanded={simcMenuOpen}
                  className="flex items-center gap-1.5 rounded border border-white/10 bg-black/20 px-3 py-1 text-xs font-bold text-zinc-200 backdrop-blur-sm hover:bg-white/10 active:scale-95"
                >
                  <CopyIcon />
                  SimC
                  <ChevronDown
                    className={`h-3.5 w-3.5 transition-transform ${simcMenuOpen ? 'rotate-180' : ''}`}
                    strokeWidth={2}
                  />
                </button>
                {simcMenuOpen ? (
                  <div className="absolute right-0 top-8 z-40 min-w-[150px] rounded-md border border-white/15 bg-[#111317] p-1 shadow-xl">
                    <button
                      type="button"
                      onClick={() => {
                        const latestProfile = savedProfiles[0];
                        navigator.clipboard.writeText(latestProfile.simc_input);
                        setSimcMenuOpen(false);
                      }}
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-zinc-200 hover:bg-white/10"
                    >
                      <Copy className="h-3.5 w-3.5" strokeWidth={2} />
                      Copy SimC
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDeleteModalOpen(true);
                        setSimcMenuOpen(false);
                      }}
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-red-300 hover:bg-red-500/10"
                    >
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                      Delete SimC
                    </button>
                  </div>
                ) : null}
              </div>
            )}
            <div className="ml-2">
              <ToggleOptionCard
                checked={isTrackedCharacter}
                onToggle={() => {
                  if (trackSaving) return;
                  void (async () => {
                    setTrackSaving(true);
                    setTrackError(null);
                    try {
                      const next = isTrackedCharacter
                        ? trackedCharacterKeys.filter((k) => k !== currentKey)
                        : [...trackedCharacterKeys, currentKey];
                      if (typeof window !== 'undefined') {
                        localStorage.setItem(LOCAL_TRACKED_CHARACTERS_KEY, JSON.stringify(next));
                      }
                      setTrackedCharacterKeys(next);
                    } catch (err) {
                      setTrackError(
                        err instanceof Error ? err.message : 'Failed to update tracked characters'
                      );
                    } finally {
                      setTrackSaving(false);
                    }
                  })();
                }}
                title={trackSaving ? 'Track Character (Saving...)' : 'Track Character'}
                description="Add this character to your tracked characters on the dashboard."
                titleClassName="text-xs font-bold text-zinc-200"
                descriptionClassName="text-[11px] text-zinc-400"
              />
            </div>
          </div>
          {trackError && (
            <p className="mt-1 text-xs text-red-400">Track Character failed: {trackError}</p>
          )}
          <p className="mt-1 font-medium text-zinc-500">
            {profile.realm.name} - {region.toUpperCase()}
          </p>
          {lastRefreshedAt ? (
            <p className="mt-1 text-xs text-zinc-500">
              Last refreshed at {new Date(lastRefreshedAt).toLocaleString()}
            </p>
          ) : null}
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
