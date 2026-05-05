export type WowheadEntityKind = 'spell' | 'item';

const wowheadIconCaches: Record<WowheadEntityKind, Map<number, string>> = {
  spell: new Map<number, string>(),
  item: new Map<number, string>(),
};

function wowheadTooltipUrl(kind: WowheadEntityKind, id: number): string {
  return `https://nether.wowhead.com/tooltip/${kind}/${id}?dataEnv=1&locale=0`;
}

export async function fetchWowheadIcons(
  kind: WowheadEntityKind,
  ids: number[]
): Promise<Map<number, string>> {
  const cache = wowheadIconCaches[kind];
  const missing = ids.filter((id) => id > 0 && !cache.has(id));
  if (missing.length === 0) {
    return new Map(cache);
  }

  await Promise.all(
    missing.map(async (id) => {
      try {
        const res = await fetch(wowheadTooltipUrl(kind, id));
        if (!res.ok) return;
        const data = await res.json();
        if (typeof data?.icon === 'string' && data.icon.length > 0) {
          cache.set(id, data.icon);
        }
      } catch {
        // Ignore icon fetch failures.
      }
    })
  );

  return new Map(cache);
}

export function getWowheadIconCache(kind: WowheadEntityKind): Map<number, string> {
  return wowheadIconCaches[kind];
}
