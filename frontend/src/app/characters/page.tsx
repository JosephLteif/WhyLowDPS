'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../components/AuthContext';
import { API_URL, fetchJson, fetchJsonCached } from '../lib/api';
import { characterHref } from '../lib/routes';
import { CLASS_COLORS } from '../lib/types';

interface Character {
  name: string;
  realm: string;
  region: string;
  class: string;
  race: string;
  faction: string;
  level: number;
  mode: string;
}

function normalizeClassKey(value: string): string {
  return (value || '').toLowerCase().replace(/\s+/g, '_');
}

function normalizeFaction(value: string): 'alliance' | 'horde' | 'other' {
  const v = (value || '').toLowerCase();
  if (v.includes('alliance')) return 'alliance';
  if (v.includes('horde')) return 'horde';
  return 'other';
}

function normalizeRegion(value: string): string {
  return (value || 'us').toLowerCase();
}

function CharacterCard({ char, faction }: { char: Character; faction: 'alliance' | 'horde' }) {
  const classKey = normalizeClassKey(char.class);
  const color = CLASS_COLORS[classKey] || '#d4d4d8';
  const isAlliance = faction === 'alliance';

  return (
    <Link
      href={characterHref(
        char.region,
        char.realm.toLowerCase().replace(/'/g, '').replace(/\s+/g, '-'),
        char.name
      )}
      className="group relative flex min-h-56 overflow-hidden rounded-lg border border-white/10 bg-[#0c0c0f] transition-all hover:border-gold/35"
    >
      <div className="absolute inset-0">
        <img
          src={`${API_URL}/api/blizzard/character/${char.realm}/${char.name}/media/main?region=${char.region}`}
          alt=""
          className="h-full w-full object-cover object-[50%_18%]"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
        <div
          className={`absolute inset-0 bg-gradient-to-t ${
            isAlliance
              ? 'from-[#080a10] via-[#080a10]/35 to-transparent'
              : 'from-[#100808] via-[#100808]/35 to-transparent'
          }`}
        />
      </div>

      <div className="relative z-10 flex w-full flex-col p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-lg font-black tracking-tight" style={{ color }}>
              {char.name}
            </p>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-300">
              {char.race} {char.class}
            </p>
          </div>
          <span
            className={`rounded-md px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-white ${
              isAlliance ? 'bg-blue-700' : 'bg-red-700'
            }`}
          >
            {isAlliance ? 'Alliance' : 'Horde'}
          </span>
        </div>

        <div className="mt-auto flex items-end justify-between">
          <p className="text-[13px] font-medium text-zinc-200">{char.realm}</p>
          <p className="text-[11px] font-semibold text-zinc-300">
            {normalizeRegion(char.region).toUpperCase()} · L{char.level}
          </p>
        </div>
      </div>
    </Link>
  );
}

export default function CharactersPage() {
  const { user, loading } = useAuth();
  const [characters, setCharacters] = useState<Character[]>([]);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [regionFilter, setRegionFilter] = useState<'all' | string>('all');
  const [classFilter, setClassFilter] = useState<'all' | string>('all');
  const [realmFilter, setRealmFilter] = useState<'all' | string>('all');

  const fetchCharacters = useCallback(
    (refresh = false) => {
      if (!loading && user) {
        setFetching(true);
        const url = `${API_URL}/api/bnet/user/characters`;
        const promise = refresh
          ? fetchJson<{ characters: Character[] }>(`${url}?refresh=true`)
          : fetchJsonCached<{ characters: Character[] }>(url, { ttl: 600000 });

        promise
          .then((data) => setCharacters(data.characters || []))
          .catch((err) => setError(err.message))
          .finally(() => setFetching(false));
      }
    },
    [loading, user]
  );

  useEffect(() => {
    fetchCharacters();
  }, [fetchCharacters]);

  const regions = useMemo(() => {
    const set = new Set<string>();
    for (const c of characters) set.add(normalizeRegion(c.region));
    return Array.from(set).sort();
  }, [characters]);

  const classes = useMemo(() => {
    const set = new Set<string>();
    for (const c of characters) set.add(c.class);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [characters]);

  const realms = useMemo(() => {
    const set = new Set<string>();
    for (const c of characters) set.add(c.realm);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [characters]);

  const filteredCharacters = useMemo(() => {
    const query = search.toLowerCase().trim();
    return characters.filter((char) => {
      if (regionFilter !== 'all' && normalizeRegion(char.region) !== regionFilter) return false;
      if (classFilter !== 'all' && char.class !== classFilter) return false;
      if (realmFilter !== 'all' && char.realm !== realmFilter) return false;
      if (!query) return true;
      const haystack = `${char.name} ${char.realm} ${char.class} ${char.race} ${char.region}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [characters, search, regionFilter, classFilter, realmFilter]);

  const allianceCharacters = useMemo(
    () => filteredCharacters.filter((c) => normalizeFaction(c.faction) === 'alliance'),
    [filteredCharacters]
  );
  const hordeCharacters = useMemo(
    () => filteredCharacters.filter((c) => normalizeFaction(c.faction) === 'horde'),
    [filteredCharacters]
  );

  if (loading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-800 border-t-gold" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex h-[50vh] flex-col items-center justify-center text-center">
        <h1 className="mb-2 text-2xl font-bold tracking-tight text-gray-100">Access Denied</h1>
        <p className="text-base text-zinc-400">
          Please log in with Battle.net to view your characters.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <h1 className="text-2xl font-bold tracking-tight text-gray-100">My Characters</h1>
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm font-medium text-gold">{user.battletag}</p>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search character, realm, class..."
            className="h-9 w-72 max-w-full rounded-md border border-white/10 bg-black/20 px-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-gold/70 focus:outline-none"
          />
          <select
            value={regionFilter}
            onChange={(e) => setRegionFilter(e.target.value)}
            className="h-9 rounded-md border border-white/10 bg-[#121218] px-2.5 text-sm text-zinc-100 focus:border-gold/70 focus:outline-none"
            style={{ colorScheme: 'dark' }}
          >
            <option value="all">All Regions</option>
            {regions.map((region) => (
              <option key={region} value={region}>
                {region.toUpperCase()}
              </option>
            ))}
          </select>
          <select
            value={classFilter}
            onChange={(e) => setClassFilter(e.target.value)}
            className="h-9 rounded-md border border-white/10 bg-[#121218] px-2.5 text-sm text-zinc-100 focus:border-gold/70 focus:outline-none"
            style={{ colorScheme: 'dark' }}
          >
            <option value="all">All Classes</option>
            {classes.map((klass) => (
              <option key={klass} value={klass}>
                {klass}
              </option>
            ))}
          </select>
          <select
            value={realmFilter}
            onChange={(e) => setRealmFilter(e.target.value)}
            className="h-9 rounded-md border border-white/10 bg-[#121218] px-2.5 text-sm text-zinc-100 focus:border-gold/70 focus:outline-none"
            style={{ colorScheme: 'dark' }}
          >
            <option value="all">All Realms</option>
            {realms.map((realm) => (
              <option key={realm} value={realm}>
                {realm}
              </option>
            ))}
          </select>
          <button
            onClick={() => fetchCharacters(true)}
            disabled={fetching}
            className="rounded border border-white/10 bg-black/20 px-3 py-1 text-xs font-bold text-zinc-200 backdrop-blur-sm hover:bg-white/10 active:scale-95 disabled:opacity-50"
          >
            {fetching ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      {fetching ? (
        <div className="flex h-32 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-800 border-t-gold" />
        </div>
      ) : error ? (
        <div className="card border-red-500/20 bg-red-500/[0.03] p-6 text-center">
          <p className="text-sm font-semibold text-red-400">{error}</p>
        </div>
      ) : characters.length === 0 ? (
        <div className="card p-12 text-center">
          <p className="text-zinc-400">No characters found on this account.</p>
        </div>
      ) : filteredCharacters.length === 0 ? (
        <div className="card p-12 text-center">
          <p className="text-zinc-400">No characters match these filters.</p>
        </div>
      ) : (
        <div className="space-y-8">
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold uppercase tracking-wider text-blue-300">Alliance</h2>
              <span className="text-xs text-zinc-500">{allianceCharacters.length} characters</span>
            </div>
            {allianceCharacters.length === 0 ? (
              <div className="rounded-lg border border-white/8 bg-white/[0.02] px-4 py-6 text-sm text-zinc-500">
                No Alliance characters in current filters.
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {allianceCharacters.map((char, idx) => (
                  <CharacterCard
                    key={`alliance-${char.name}-${char.realm}-${idx}`}
                    char={char}
                    faction="alliance"
                  />
                ))}
              </div>
            )}
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold uppercase tracking-wider text-red-300">Horde</h2>
              <span className="text-xs text-zinc-500">{hordeCharacters.length} characters</span>
            </div>
            {hordeCharacters.length === 0 ? (
              <div className="rounded-lg border border-white/8 bg-white/[0.02] px-4 py-6 text-sm text-zinc-500">
                No Horde characters in current filters.
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {hordeCharacters.map((char, idx) => (
                  <CharacterCard
                    key={`horde-${char.name}-${char.realm}-${idx}`}
                    char={char}
                    faction="horde"
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
