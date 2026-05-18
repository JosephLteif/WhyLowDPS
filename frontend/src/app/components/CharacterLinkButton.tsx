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
  class_name?: string;
  source?: 'bnet' | 'history';
}

const CLASS_META_BY_ID: Record<number, { label: string; color: string }> = {
  1: { label: 'Warrior', color: '#C79C6E' },
  2: { label: 'Paladin', color: '#F58CBA' },
  3: { label: 'Hunter', color: '#ABD473' },
  4: { label: 'Rogue', color: '#FFF569' },
  5: { label: 'Priest', color: '#FFFFFF' },
  6: { label: 'Death Knight', color: '#C41F3B' },
  7: { label: 'Shaman', color: '#0070DE' },
  8: { label: 'Mage', color: '#69CCF0' },
  9: { label: 'Warlock', color: '#9482C9' },
  10: { label: 'Monk', color: '#00FF96' },
  11: { label: 'Druid', color: '#FF7D0A' },
  12: { label: 'Demon Hunter', color: '#A330C9' },
  13: { label: 'Evoker', color: '#33937F' },
};

const CLASS_META_BY_KEY: Record<string, { label: string; color: string }> = Object.fromEntries(
  Object.values(CLASS_META_BY_ID).map((meta) => [meta.label.toLowerCase(), meta])
);
const CHARACTER_CLASS_CACHE_KEY = 'whylowdps_character_class_cache_v1';

function resolveClassMeta(char: Character): { label: string; color: string } | undefined {
  const byId = CLASS_META_BY_ID[Number(char.playable_class || 0)];
  if (byId) return byId;
  const playableClassRaw = String((char as any).playable_class || '')
    .trim()
    .toLowerCase();
  if (playableClassRaw && Number.isNaN(Number(playableClassRaw))) {
    const byPlayableClassName =
      CLASS_META_BY_KEY[playableClassRaw] ||
      CLASS_META_BY_KEY[playableClassRaw.replace(/_/g, ' ')] ||
      CLASS_META_BY_KEY[playableClassRaw.replace(/-/g, ' ')];
    if (byPlayableClassName) return byPlayableClassName;
  }
  const key = String(char.class_name || '')
    .trim()
    .toLowerCase();
  if (!key) return undefined;
  return (
    CLASS_META_BY_KEY[key] ||
    CLASS_META_BY_KEY[key.replace(/_/g, ' ')] ||
    CLASS_META_BY_KEY[key.replace(/-/g, ' ')]
  );
}

async function fetchCharacterClassName(
  realm: string,
  name: string,
  region?: string
): Promise<string | null> {
  const realmSlug = realm.toLowerCase().replace(/'/g, '').replace(/\s+/g, '-');
  const url = new URL(
    `${API_URL}/api/blizzard/character/${encodeURIComponent(realmSlug)}/${encodeURIComponent(
      name.toLowerCase()
    )}/profile`,
    window.location.origin
  );
  if (region) url.searchParams.set('region', region.toLowerCase());
  const data = await fetchJson<any>(url.toString());
  const value =
    (typeof data?.character_class?.name === 'string' && data.character_class.name) ||
    (typeof data?.class_name === 'string' && data.class_name) ||
    '';
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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
  const [classResolving, setClassResolving] = useState(false);
  const [linkedClassName, setLinkedClassName] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const linkedRegionRef = useRef<string | undefined>(currentLinkedRegion);

  useEffect(() => {
    linkedRegionRef.current = currentLinkedRegion;
  }, [currentLinkedRegion]);

  const currentLinkedCharacter = characters.find(
    (c) =>
      !!currentLinkedName &&
      !!currentLinkedRealm &&
      c.name.toLowerCase() === currentLinkedName.toLowerCase() &&
      c.realm.toLowerCase() === currentLinkedRealm.toLowerCase()
  );
  const currentClassMeta = currentLinkedCharacter
    ? resolveClassMeta(currentLinkedCharacter)
    : linkedClassName
      ? resolveClassMeta({
          name: currentLinkedName || '',
          realm: currentLinkedRealm || '',
          region: currentLinkedRegion || '',
          level: 0,
          playable_class: 0,
          playable_race: 0,
          class_name: linkedClassName,
        })
      : undefined;

  useEffect(() => {
    if (!currentLinkedName || !currentLinkedRealm) return;
    if (currentClassMeta) return;
    let cancelled = false;
    void fetchCharacterClassName(currentLinkedRealm, currentLinkedName, currentLinkedRegion)
      .then((className) => {
        if (cancelled || !className) return;
        setLinkedClassName(className);
        if (typeof window !== 'undefined') {
          try {
            const raw = localStorage.getItem(CHARACTER_CLASS_CACHE_KEY);
            const cache = raw ? (JSON.parse(raw) as Record<string, string>) : {};
            const key = `${currentLinkedName.toLowerCase()}|${currentLinkedRealm.toLowerCase()}|${(currentLinkedRegion || '').toLowerCase()}`;
            cache[key] = className;
            localStorage.setItem(CHARACTER_CLASS_CACHE_KEY, JSON.stringify(cache));
          } catch {
            // ignore cache write issues
          }
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [currentLinkedName, currentLinkedRealm, currentLinkedRegion, currentClassMeta]);

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
          const merged: Character[] = bnetList.map((c: any) => ({
            ...c,
            playable_class:
              Number(c?.playable_class) ||
              Number(c?.class_id) ||
              Number(c?.character_class?.id) ||
              Number(c?.class?.id) ||
              0,
            class_name:
              c?.class_name ||
              (typeof c?.playable_class === 'string' ? c.playable_class : '') ||
              c?.character_class?.name ||
              c?.character_class?.class?.name ||
              c?.class?.name ||
              '',
            source: 'bnet',
          }));
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
                playable_class:
                  Number(h?.playable_class) ||
                  Number(h?.class_id) ||
                  Number(h?.character_class?.id) ||
                  Number(h?.class?.id) ||
                  0,
                playable_race: 0,
                class_name:
                  h?.class_name ||
                  h?.class ||
                  (typeof h?.playable_class === 'string' ? h.playable_class : '') ||
                  h?.character_class?.name ||
                  h?.character_class?.class?.name ||
                  h?.spec_name ||
                  '',
                source: 'history',
              });
            }
          }
          if (typeof window !== 'undefined') {
            try {
              const raw = localStorage.getItem(CHARACTER_CLASS_CACHE_KEY);
              const cache = raw ? (JSON.parse(raw) as Record<string, string>) : {};
              for (const c of merged) {
                if (resolveClassMeta(c)) continue;
                const key = `${c.name.toLowerCase()}|${c.realm.toLowerCase()}|${(c.region || '').toLowerCase()}`;
                const cachedClass = cache[key];
                if (cachedClass && cachedClass.trim()) {
                  c.class_name = cachedClass;
                }
              }
            } catch {
              // ignore cache parse issues
            }
          }
          setCharacters(merged);
          const needsClass = merged.filter((c) => !resolveClassMeta(c));
          if (needsClass.length > 0) {
            void Promise.all(
              needsClass.map(async (c) => {
                try {
                  const className = await fetchCharacterClassName(
                    c.realm,
                    c.name,
                    c.region || linkedRegionRef.current
                  );
                  return {
                    key: `${c.name.toLowerCase()}|${c.realm.toLowerCase()}|${(c.region || '').toLowerCase()}`,
                    className,
                  };
                } catch {
                  return {
                    key: `${c.name.toLowerCase()}|${c.realm.toLowerCase()}|${(c.region || '').toLowerCase()}`,
                    className: null,
                  };
                }
              })
            ).then((resolved) => {
              if (typeof window !== 'undefined') {
                try {
                  const raw = localStorage.getItem(CHARACTER_CLASS_CACHE_KEY);
                  const cache = raw ? (JSON.parse(raw) as Record<string, string>) : {};
                  for (const row of resolved) {
                    if (!row.className) continue;
                    cache[row.key] = row.className;
                  }
                  localStorage.setItem(CHARACTER_CLASS_CACHE_KEY, JSON.stringify(cache));
                } catch {
                  // ignore cache write issues
                }
              }
              setCharacters((prev) =>
                prev.map((c) => {
                  if (resolveClassMeta(c)) return c;
                  const key = `${c.name.toLowerCase()}|${c.realm.toLowerCase()}|${(c.region || '').toLowerCase()}`;
                  const hit = resolved.find((r) => r.key === key);
                  if (!hit?.className) return c;
                  return { ...c, class_name: hit.className };
                })
              );
            });
          }
          setLoading(false);
        })
        .catch(() => setLoading(false));
    }
  }, [isOpen, characters.length]);

  useEffect(() => {
    if (!isOpen || characters.length === 0 || classResolving) return;
    const needsClass = characters.filter((c) => !resolveClassMeta(c));
    if (needsClass.length === 0) return;
    setClassResolving(true);
    void Promise.all(
      needsClass.map(async (c) => {
        try {
          const className = await fetchCharacterClassName(
            c.realm,
            c.name,
            c.region || linkedRegionRef.current
          );
          return {
            key: `${c.name.toLowerCase()}|${c.realm.toLowerCase()}|${(c.region || '').toLowerCase()}`,
            className,
          };
        } catch {
          return {
            key: `${c.name.toLowerCase()}|${c.realm.toLowerCase()}|${(c.region || '').toLowerCase()}`,
            className: null,
          };
        }
      })
    )
      .then((resolved) => {
        if (typeof window !== 'undefined') {
          try {
            const raw = localStorage.getItem(CHARACTER_CLASS_CACHE_KEY);
            const cache = raw ? (JSON.parse(raw) as Record<string, string>) : {};
            for (const row of resolved) {
              if (!row.className) continue;
              cache[row.key] = row.className;
            }
            localStorage.setItem(CHARACTER_CLASS_CACHE_KEY, JSON.stringify(cache));
          } catch {
            // ignore cache write issues
          }
        }
        setCharacters((prev) =>
          prev.map((c) => {
            if (resolveClassMeta(c)) return c;
            const key = `${c.name.toLowerCase()}|${c.realm.toLowerCase()}|${(c.region || '').toLowerCase()}`;
            const hit = resolved.find((r) => r.key === key);
            if (!hit?.className) return c;
            return { ...c, class_name: hit.className };
          })
        );
      })
      .finally(() => setClassResolving(false));
  }, [isOpen, characters, classResolving]);

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
        <span style={currentClassMeta ? { color: currentClassMeta.color } : undefined}>
          {currentLabel}
        </span>
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
                    <div className="font-medium" style={{ color: resolveClassMeta(c)?.color || '#ffffff' }}>
                      {c.name}
                    </div>
                    {c.source === 'history' && (
                      <span className="rounded bg-zinc-800 px-1 text-[10px] uppercase tracking-tighter text-zinc-500">
                        History
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs text-zinc-500">{c.realm}</div>
                    {resolveClassMeta(c)?.label ? (
                      <div
                        className="text-xs font-semibold"
                        style={{ color: resolveClassMeta(c)!.color }}
                      >
                        {resolveClassMeta(c)!.label}
                      </div>
                    ) : null}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
