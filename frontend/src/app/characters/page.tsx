'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '../components/AuthContext';
import { API_URL } from '../lib/api';
import { CLASS_COLORS } from '../lib/types';

interface Character {
  name: string;
  realm: string;
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

  useEffect(() => {
    if (!loading && user) {
      setFetching(true);
      fetch(`${API_URL}/api/bnet/user/characters`, { credentials: 'same-origin' })
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
  }, [user, loading]);

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
        <p className="text-base text-zinc-400">Please log in with Battle.net to view your characters.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight text-gray-100">My Characters</h1>
        <p className="text-sm font-medium text-gold">{user.battletag}</p>
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
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {characters.map((char, idx) => {
            const classKey = char.class.toLowerCase().replace(/\s+/g, '_');
            const color = CLASS_COLORS[classKey] || '#ccc';

            return (
              <div key={`${char.name}-${char.realm}-${idx}`} className="card flex flex-col p-4">
                <div className="flex items-start justify-between">
                  <div className="flex flex-col">
                    <span className="text-lg font-bold" style={{ color }}>
                      {char.name}
                    </span>
                    <span className="text-xs text-zinc-400">
                      Level {char.level} {char.race} {char.class}
                    </span>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                        char.faction === 'Alliance'
                          ? 'bg-blue-950/40 text-blue-400'
                          : char.faction === 'Horde'
                          ? 'bg-red-950/40 text-red-400'
                          : 'bg-zinc-800 text-zinc-400'
                      }`}
                    >
                      {char.faction}
                    </span>
                    <span className="rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-zinc-300">
                      {char.mode}
                    </span>
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between border-t border-border/50 pt-3 text-[12px]">
                  <span className="text-zinc-500">Realm</span>
                  <span className="font-medium text-zinc-300">{char.realm}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}