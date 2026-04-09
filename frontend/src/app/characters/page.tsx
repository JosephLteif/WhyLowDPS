'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../components/AuthContext';
import { API_URL } from '../lib/api';
import { CLASS_COLORS } from '../lib/types';
import Link from 'next/link';

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

export default function CharactersPage() {
  const { user, loading } = useAuth();
  const [characters, setCharacters] = useState<Character[]>([]);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const fetchCharacters = useCallback(
    (refresh = false) => {
      if (!loading && user) {
        setFetching(true);
        fetch(`${API_URL}/api/bnet/user/characters${refresh ? '?refresh=true' : ''}`, {
          credentials: 'include',
        })
          .then(async (res) => {
            if (!res.ok) {
              const body = await res.text();
              throw new Error(`Failed to fetch characters: ${res.status} ${body}`);
            }
            return res.json();
          })
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

  const copySimcString = (char: Character, idx: number) => {
    const simcString = `armory=${char.region},${char.realm},${char.name}`;
    navigator.clipboard.writeText(simcString);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  };

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
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight text-gray-100">My Characters</h1>
        <div className="flex items-center gap-4">
          <p className="text-sm font-medium text-gold">{user.battletag}</p>
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
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {characters.map((char, idx) => {
            const classKey = char.class.toLowerCase().replace(/\s+/g, '_');
            const color = CLASS_COLORS[classKey] || '#ccc';
            const isAlliance = char.faction === 'Alliance';
            const factionColor = isAlliance ? 'rgba(30, 58, 138, 0.4)' : 'rgba(127, 29, 29, 0.4)';

            return (
              <Link
                key={`${char.name}-${char.realm}-${idx}`}
                href={`/character/${char.region.toLowerCase()}/${char.realm.toLowerCase().replace(/'/g, '').replace(/\s+/g, '-')}/${char.name.toLowerCase()}`}
                className="card group relative flex h-64 cursor-pointer flex-col overflow-hidden transition-all hover:border-gold/30 active:scale-[0.99]"
              >
                {/* Character Background Image */}
                <div className="absolute inset-0 z-0">
                  <img
                    src={`${API_URL}/api/blizzard/character/${char.realm}/${char.name}/media/main?region=${char.region}`}
                    alt=""
                    className="h-full w-full object-cover object-[50%_20%] transition-transform duration-500 group-hover:scale-105"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                  <div
                    className="absolute inset-0 bg-gradient-to-t from-surface via-surface/80 to-transparent"
                    style={{ backgroundColor: factionColor }}
                  />
                </div>

                <div className="relative z-10 flex h-full flex-col p-5">
                  <div className="flex items-start justify-between">
                    <div className="flex flex-col">
                      <span className="text-xl font-black tracking-tight" style={{ color }}>
                        {char.name}
                      </span>
                      <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-300">
                        {char.race} {char.class}
                      </span>
                    </div>
                    <div className="flex flex-col items-end gap-1.5">
                      <span
                        className={`rounded-md px-2 py-0.5 text-[10px] font-black uppercase tracking-widest shadow-sm ${
                          isAlliance ? 'bg-blue-600 text-white' : 'bg-red-700 text-white'
                        }`}
                      >
                        {char.faction}
                      </span>
                      <span className="rounded border border-white/10 bg-black/20 px-1.5 py-0.5 text-[10px] font-bold text-zinc-200 backdrop-blur-sm">
                        Level {char.level} • {char.mode}
                      </span>
                    </div>
                  </div>

                  <div className="mt-auto flex items-center justify-between gap-3">
                    <div className="flex flex-col">
                      <span className="text-[10px] font-semibold uppercase tracking-tighter text-zinc-500">
                        Realm
                      </span>
                      <span className="text-[13px] font-medium text-zinc-200">{char.realm}</span>
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
