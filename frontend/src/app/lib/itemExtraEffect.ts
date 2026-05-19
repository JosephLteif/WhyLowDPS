import { useEffect, useMemo, useState } from 'react';
import { API_URL, fetchJson } from './api';
import type { ResolvedItem } from './types';

export type ExtraEffect = 'Leech' | 'Speed' | 'Avoidance' | 'Indestructible';

type EffectQuery = { item_id: number; bonus_ids?: number[] };

const cache: Record<string, ExtraEffect[]> = {};

export function itemBonusKey(item_id: number, bonus_ids?: number[]): string {
  const sorted = Array.isArray(bonus_ids) ? [...bonus_ids].filter((b) => b > 0).sort((a, b) => a - b) : [];
  return `${item_id}:${sorted.join(':')}`;
}

function normalizeEffects(values: unknown): ExtraEffect[] {
  if (!Array.isArray(values)) return [];
  const out: ExtraEffect[] = [];
  for (const raw of values) {
    const v = String(raw || '').trim().toLowerCase();
    if (v === 'leech' && !out.includes('Leech')) out.push('Leech');
    if (v === 'speed' && !out.includes('Speed')) out.push('Speed');
    if (v === 'avoidance' && !out.includes('Avoidance')) out.push('Avoidance');
    if (v === 'indestructible' && !out.includes('Indestructible')) out.push('Indestructible');
  }
  return out;
}

function effectsFromKnownBonusIds(bonusIds?: number[]): ExtraEffect[] {
  const ids = Array.isArray(bonusIds) ? bonusIds : [];
  const out: ExtraEffect[] = [];
  const push = (e: ExtraEffect) => {
    if (!out.includes(e)) out.push(e);
  };
  for (const bid of ids) {
    if (bid === 42) push('Speed');
    if (bid === 43) push('Indestructible');
    if (bid === 40) push('Leech');
    if (bid === 41) push('Avoidance');
  }
  return out;
}

function detectFromText(item: Pick<ResolvedItem, 'simc_string' | 'source_type' | 'tag'>): ExtraEffect[] {
  const simc = String(item.simc_string || '').toLowerCase();
  const sourceType = String(item.source_type || '').toLowerCase();
  const tag = String(item.tag || '').toLowerCase();
  const text = `${simc},${sourceType},${tag}`;
  const out: ExtraEffect[] = [];
  if (/(?:^|,)leech=\d+/.test(simc) || /\bleech\b/.test(text)) out.push('Leech');
  if (/(?:^|,)speed=\d+/.test(simc) || /\bspeed\b/.test(text)) out.push('Speed');
  if (/(?:^|,)avoidance=\d+/.test(simc) || /\bavoidance\b/.test(text)) out.push('Avoidance');
  if (/(?:^|,)indestructible(?:=1)?(?:,|$)/.test(simc) || /\bindestructible\b/.test(text)) out.push('Indestructible');
  return out;
}

export function useItemExtraEffects(queries: EffectQuery[]): Record<string, ExtraEffect[]> {
  const [effectsByKey, setEffectsByKey] = useState<Record<string, ExtraEffect[]>>({});
  useMemo(
    () =>
      queries
        .filter((q) => q.item_id > 0)
        .map((q) => itemBonusKey(q.item_id, q.bonus_ids))
        .sort()
        .join(','),
    [queries]
  );
  const stableQueries = useMemo(() => {
    const unique = new Map<string, EffectQuery>();
    for (const q of queries) {
      if (q.item_id <= 0) continue;
      const key = itemBonusKey(q.item_id, q.bonus_ids);
      if (!unique.has(key)) unique.set(key, q);
    }
    return Array.from(unique.entries()).map(([key, query]) => ({ key, query }));
  }, [queries]);

  useEffect(() => {
    if (stableQueries.length === 0) return;

    const cached: Record<string, ExtraEffect[]> = {};
    const toFetch: Array<{ key: string; query: EffectQuery }> = [];
    for (const { key, query } of stableQueries) {
      if (cache[key] && cache[key].length > 0) cached[key] = cache[key];
      else toFetch.push({ key, query });
    }
    if (Object.keys(cached).length > 0) {
      setEffectsByKey((prev) => {
        let changed = false;
        for (const [k, nextValues] of Object.entries(cached)) {
          const prevValues = prev[k] || [];
          if (
            prevValues.length !== nextValues.length ||
            prevValues.some((v, i) => v !== nextValues[i])
          ) {
            changed = true;
            break;
          }
        }
        return changed ? { ...prev, ...cached } : prev;
      });
    }
    if (toFetch.length === 0) return;

    let cancelled = false;
    for (const { key, query } of toFetch) {
      (async () => {
        try {
          const params = new URLSearchParams();
          if (query.bonus_ids && query.bonus_ids.length > 0) params.set('bonus_ids', query.bonus_ids.join(','));
          const info = await fetchJson<{ extra_effects?: string[] }>(
            `${API_URL}/api/item-info/${query.item_id}?${params.toString()}`
          );
          if (cancelled) return;
          const effects = normalizeEffects(info?.extra_effects);
          cache[key] = effects;
          setEffectsByKey((prev) => {
            const prevValues = prev[key] || [];
            const same =
              prevValues.length === effects.length &&
              prevValues.every((v, i) => v === effects[i]);
            return same ? prev : { ...prev, [key]: effects };
          });
        } catch {
          if (cancelled) return;
          cache[key] = [];
          setEffectsByKey((prev) => (prev[key]?.length ? { ...prev, [key]: [] } : prev));
        }
      })();
    }

    return () => {
      cancelled = true;
    };
  }, [stableQueries]);

  return effectsByKey;
}

export function getItemExtraEffects(
  item: {
    item_id: number;
    bonus_ids?: number[];
    simc_string?: string;
    source_type?: string;
    tag?: string;
    extra_effects?: string[];
  },
  effectsByKey?: Record<string, ExtraEffect[]>
): ExtraEffect[] {
  const fromItem = normalizeEffects(item.extra_effects);
  if (fromItem.length > 0) return fromItem;
  const fromBonusIds = effectsFromKnownBonusIds(item.bonus_ids);
  if (fromBonusIds.length > 0) return fromBonusIds;
  const key = itemBonusKey(item.item_id, item.bonus_ids);
  const fromMap = normalizeEffects(effectsByKey?.[key]);
  if (fromMap.length > 0) return fromMap;
  return detectFromText({
    simc_string: item.simc_string || '',
    source_type: item.source_type || '',
    tag: item.tag || '',
  });
}
