'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Link2 } from 'lucide-react';
import { API_URL, fetchJson } from '../lib/api';
import { useDismissOnOutside } from '../lib/useDismissOnOutside';

interface Character {
  name: string;
  realm: string;
  region: string;
  level: number;
  playable_class: number;
  playable_race: number;
  source?: 'bnet' | 'history';
}

export default function CharacterLinkButton({
  jobId,
  currentLinkedName,
  currentLinkedRealm,
  currentLinkedRegion,
}: {
  jobId: string;
  currentLinkedName?: string;
  currentLinkedRealm?: string;
  currentLinkedRegion?: string;
}) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [loading, setLoading] = useState(false);
  const [linking, setLinking] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (isOpen && characters.length === 0) {
      setLoading(true);
      Promise.all([
        fetchJson<{ characters: any[] }>(`${API_URL}/api/bnet/user/characters`).catch(() => ({
          characters: [],
        })),
        fetchJson<any[]>(`${API_URL}/api/history/characters`).catch(() => []),
      ])
        .then(([bnetResponse, historyData]) => {
          const bnetList = Array.isArray(bnetResponse)
            ? bnetResponse
            : bnetResponse?.characters || [];
          const merged: Character[] = bnetList.map((c: any) => ({ ...c, source: 'bnet' }));
          const historyList = Array.isArray(historyData) ? historyData : [];

          for (const h of historyList) {
            if (
              !merged.find(
                (m) =>
                  m.name.toLowerCase() === h.name.toLowerCase() &&
                  m.realm.toLowerCase() === h.realm.toLowerCase()
              )
            ) {
              merged.push({
                ...h,
                level: 0,
                playable_class: 0,
                playable_race: 0,
                source: 'history',
              });
            }
          }
          setCharacters(merged);
          setLoading(false);
        })
        .catch(() => setLoading(false));
    }
  }, [isOpen, characters.length]);

  const handleLink = async (char: Character) => {
    setLinking(true);
    try {
      await fetchJson(`${API_URL}/api/sim/${jobId}/link`, {
        method: 'POST',
        body: JSON.stringify({
          name: char.name,
          realm: char.realm,
          region: char.region,
        }),
      });
      // reload to reflect new state
      router.refresh();
    } catch (e) {
      console.error(e);
      setLinking(false);
    }
  };
  const handleUnlink = async () => {
    setLinking(true);
    try {
      await fetchJson(`${API_URL}/api/sim/${jobId}/link`, {
        method: 'POST',
        body: JSON.stringify({
          name: null,
          realm: null,
          region: null,
        }),
      });
      router.refresh();
    } catch (e) {
      console.error(e);
      setLinking(false);
    }
  };

  const currentLabel = currentLinkedName
    ? `${currentLinkedName} - ${currentLinkedRealm}`
    : 'Not Linked';

  useDismissOnOutside(rootRef, isOpen, () => setIsOpen(false));

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-surface-3"
      >
        <Link2 className="h-4 w-4 text-zinc-500" strokeWidth={2} />
        {currentLabel}
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full z-50 mt-2 w-64 rounded-xl border border-border bg-surface-2 p-2 shadow-xl">
          <div className="mb-2 flex items-center justify-between px-2 pt-1">
            <div className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
              Link to Character
            </div>
            {currentLinkedName && (
              <button
                onClick={handleUnlink}
                disabled={linking}
                className="rounded bg-red-500/10 px-1.5 py-0.5 text-[10px] text-red-500 transition-colors hover:bg-red-500/20"
              >
                Unlink
              </button>
            )}
          </div>
          <div className="max-h-60 space-y-1 overflow-y-auto">
            {loading ? (
              <div className="cursor-wait p-3 pl-2 text-sm text-zinc-400">Loading...</div>
            ) : characters.length === 0 ? (
              <div className="p-3 pl-2 text-sm text-zinc-400">
                No BNet chars found, or you aren&apos;t logged in.
              </div>
            ) : (
              characters.map((c, i) => (
                <button
                  key={i}
                  disabled={linking}
                  onClick={() => handleLink(c)}
                  className="w-full rounded-lg p-2 text-left text-sm text-zinc-300 transition-colors hover:bg-surface-3 disabled:opacity-50"
                >
                  <div className="flex items-center justify-between">
                    <div className="font-medium text-white">{c.name}</div>
                    {c.source === 'history' && (
                      <span className="rounded bg-zinc-800 px-1 text-[10px] uppercase tracking-tighter text-zinc-500">
                        History
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-zinc-500">{c.realm}</div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
