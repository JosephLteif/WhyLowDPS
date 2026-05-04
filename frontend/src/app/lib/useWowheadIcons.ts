import { useEffect, useMemo, useState } from 'react';
import { fetchWowheadIcons, getWowheadIconCache, type WowheadEntityKind } from './wowhead-icons';

export function useWowheadIcons(kind: WowheadEntityKind, ids: number[]) {
  const [icons, setIcons] = useState<Map<number, string>>(() => new Map(getWowheadIconCache(kind)));
  const depKey = useMemo(() => ids.join(','), [ids]);

  useEffect(() => {
    let cancelled = false;
    fetchWowheadIcons(kind, ids).then((next) => {
      if (!cancelled) setIcons(next);
    });
    return () => {
      cancelled = true;
    };
  }, [kind, depKey, ids]);

  return icons;
}

export function useSpellIcons(spellIds: number[]) {
  return useWowheadIcons('spell', spellIds);
}

export function useItemIcons(itemIds: number[]) {
  return useWowheadIcons('item', itemIds);
}
