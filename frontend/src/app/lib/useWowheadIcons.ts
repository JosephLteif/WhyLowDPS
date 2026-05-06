import { useEffect, useMemo, useState } from 'react';
import { fetchWowheadIcons, getWowheadIconCache, type WowheadEntityKind } from './wowhead-icons';

export function useWowheadIcons(kind: WowheadEntityKind, ids: number[]) {
  const [icons, setIcons] = useState<Map<number, string>>(() => new Map(getWowheadIconCache(kind)));
  const normalizedIds = useMemo(() => {
    const unique = new Set<number>();
    for (const raw of ids) {
      const n = Number(raw || 0);
      if (Number.isFinite(n) && n > 0) unique.add(n);
    }
    return Array.from(unique).sort((a, b) => a - b);
  }, [ids]);
  const depKey = useMemo(() => normalizedIds.join(','), [normalizedIds]);
  const stableIds = useMemo(
    () => (depKey ? depKey.split(',').map((v) => Number(v)).filter((n) => Number.isFinite(n) && n > 0) : []),
    [depKey]
  );

  useEffect(() => {
    let cancelled = false;
    fetchWowheadIcons(kind, stableIds).then((next) => {
      if (!cancelled) setIcons(next);
    });
    return () => {
      cancelled = true;
    };
  }, [kind, depKey, stableIds]);

  return icons;
}

export function useSpellIcons(spellIds: number[]) {
  return useWowheadIcons('spell', spellIds);
}

export function useItemIcons(itemIds: number[]) {
  return useWowheadIcons('item', itemIds);
}
