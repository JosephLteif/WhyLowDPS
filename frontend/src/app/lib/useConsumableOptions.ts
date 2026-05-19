'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AUGMENT_RUNE_OPTIONS,
  FLASK_OPTIONS,
  FOOD_OPTIONS,
  OptionEntry,
  POTION_OPTIONS,
  TEMP_ENCHANT_OPTIONS,
} from './sim-options-catalog';
import { API_URL } from './api';

type ConsumableOptionsResponse = {
  flasks?: OptionEntry[];
  foods?: OptionEntry[];
  potions?: OptionEntry[];
  augments?: OptionEntry[];
  temp_enchants?: OptionEntry[];
};

function dedupeOptions(options: OptionEntry[]): OptionEntry[] {
  const seen = new Set<string>();
  const out: OptionEntry[] = [];
  for (const opt of options) {
    const key = `${opt.token || ''}::${opt.key || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(opt);
  }
  return out;
}

function inferQuality(opt: OptionEntry): number | undefined {
  if (opt.craftingQuality && opt.craftingQuality >= 1 && opt.craftingQuality <= 3) return opt.craftingQuality;
  const token = String(opt.token || opt.key || '').toLowerCase();
  const tokenMatch = token.match(/_([1-3])$/);
  if (tokenMatch) return Number(tokenMatch[1]);
  const label = String(opt.label || '');
  if (/\(gold\)/i.test(label) || /\btier\s*3\b/i.test(label)) return 3;
  if (/\(silver\)/i.test(label) || /\btier\s*2\b/i.test(label)) return 2;
  if (/\(bronze\)/i.test(label) || /\btier\s*1\b/i.test(label)) return 1;
  return undefined;
}

function normalizeQuality(options: OptionEntry[]): OptionEntry[] {
  return options.map((opt) => ({ ...opt, craftingQuality: inferQuality(opt) }));
}

export function useConsumableOptions(expansion = 11) {
  const filterByExpansion = useCallback((options: OptionEntry[]): OptionEntry[] => {
    if (!Number.isFinite(expansion) || expansion <= 0) return options;
    return options.filter((opt) => {
      const optionExpansion = opt.expansion;
      if (typeof optionExpansion !== 'number' || !Number.isFinite(optionExpansion)) return false;
      return optionExpansion === expansion;
    });
  }, [expansion]);

  const [flasks, setFlasks] = useState<OptionEntry[]>(filterByExpansion(normalizeQuality(FLASK_OPTIONS)));
  const [foods, setFoods] = useState<OptionEntry[]>(filterByExpansion(normalizeQuality(FOOD_OPTIONS)));
  const [potions, setPotions] = useState<OptionEntry[]>(filterByExpansion(normalizeQuality(POTION_OPTIONS)));
  const [augments, setAugments] = useState<OptionEntry[]>(
    filterByExpansion(normalizeQuality(AUGMENT_RUNE_OPTIONS))
  );
  const [tempEnchants, setTempEnchants] = useState<OptionEntry[]>(
    filterByExpansion(normalizeQuality(TEMP_ENCHANT_OPTIONS))
  );

  useEffect(() => {
    let canceled = false;
    const query =
      Number.isFinite(expansion) && expansion > 0
        ? `?expansion=${encodeURIComponent(String(expansion))}`
        : '';
    fetch(`${API_URL}/api/gear/consumable-options${query}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: ConsumableOptionsResponse) => {
        if (canceled) return;
        if (Array.isArray(data.flasks) && data.flasks.length) {
          setFlasks(filterByExpansion(dedupeOptions(normalizeQuality(data.flasks))));
        }
        if (Array.isArray(data.foods) && data.foods.length) {
          setFoods(filterByExpansion(dedupeOptions(normalizeQuality(data.foods))));
        }
        if (Array.isArray(data.potions) && data.potions.length) {
          setPotions(filterByExpansion(dedupeOptions(normalizeQuality(data.potions))));
        }
        if (Array.isArray(data.augments) && data.augments.length) {
          setAugments(filterByExpansion(dedupeOptions(normalizeQuality(data.augments))));
        }
        if (Array.isArray(data.temp_enchants) && data.temp_enchants.length) {
          setTempEnchants(filterByExpansion(dedupeOptions(normalizeQuality(data.temp_enchants))));
        }
      })
      .catch(() => {
        // Keep static fallback options if the endpoint is unavailable.
      });
    return () => {
      canceled = true;
    };
  }, [expansion, filterByExpansion]);

  return { flasks, foods, potions, augments, tempEnchants };
}
