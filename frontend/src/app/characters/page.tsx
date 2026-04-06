'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '../components/AuthContext';
import { API_URL } from '../lib/api';
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

export default function CharactersPage() {
  const { user, loading } = useAuth();
  const [characters, setCharacters] = useState<Character[]>([]);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

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
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {characters.map((char, idx) => {
            const classKey = char.class.toLowerCase().replace(/\s+/g, '_');
            const color = CLASS_COLORS[classKey] || '#ccc';
            const isAlliance = char.faction === 'Alliance';
            const factionColor = isAlliance ? 'rgba(30, 58, 138, 0.4)' : 'rgba(127, 29, 29, 0.4)';

            return (
              <div
                key={`${char.name}-${char.realm}-${idx}`}
                className="group card relative overflow-hidden flex flex-col h-64 transition-all hover:border-gold/30"
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

                <div className="relative z-10 flex flex-col h-full p-5">
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
                          isAlliance
                            ? 'bg-blue-600 text-white'
                            : 'bg-red-700 text-white'
                        }`}
                      >
                        {char.faction}
                      </span>
                      <span className="rounded border border-white/10 bg-black/20 backdrop-blur-sm px-1.5 py-0.5 text-[10px] font-bold text-zinc-200">
                        Level {char.level} • {char.mode}
                      </span>
                    </div>
                  </div>

                  <div className="mt-auto flex items-center justify-between gap-3">
                    <div className="flex flex-col">
                      <span className="text-[10px] font-semibold uppercase tracking-tighter text-zinc-500">Realm</span>
                      <span className="text-[13px] font-medium text-zinc-200">{char.realm}</span>
                    </div>

                    <button
                      onClick={() => copySimcString(char, idx)}
                      className={`flex items-center gap-2 rounded-lg border border-gold/20 bg-gold/5 px-3 py-2 text-[12px] font-bold text-gold transition-all hover:bg-gold hover:text-black active:scale-[0.97] ${
                        copiedIdx === idx ? 'bg-green-600/20 border-green-500/50 text-green-400' : ''
                      }`}
                    >
                      <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor">
                        {copiedIdx === idx ? (
                          <path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0z" />
                        ) : (
                          <path d="M4 1.5H3a2 2 0 0 0-2 2V14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V3.5a2 2 0 0 0-2-2h-1v1h1a1 1 0 0 1 1 1V14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1h1v-1z M9.5 1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-3a.5.5 0 0 1-.5-.5v-1a.5.5 0 0 1 .5-.5h3z" />
                        )}
                      </svg>
                      {copiedIdx === idx ? 'Copied!' : 'Copy SimC'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
