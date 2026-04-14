'use client';

import { useEffect, useState } from 'react';
import {
  AUGMENT_RUNE_OPTIONS,
  FLASK_OPTIONS,
  FOOD_OPTIONS,
  OptionEntry,
  POTION_OPTIONS,
  TEMP_ENCHANT_OPTIONS,
} from './sim-options-catalog';

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

export function useConsumableOptions(expansionMin = 10) {
  const [flasks, setFlasks] = useState<OptionEntry[]>(FLASK_OPTIONS);
  const [foods, setFoods] = useState<OptionEntry[]>(FOOD_OPTIONS);
  const [potions, setPotions] = useState<OptionEntry[]>(POTION_OPTIONS);
  const [augments, setAugments] = useState<OptionEntry[]>(AUGMENT_RUNE_OPTIONS);
  const [tempEnchants, setTempEnchants] = useState<OptionEntry[]>(TEMP_ENCHANT_OPTIONS);

  useEffect(() => {
    let canceled = false;
    fetch(`/api/gear/consumable-options?expansion_min=${expansionMin}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: ConsumableOptionsResponse) => {
        if (canceled) return;
        if (Array.isArray(data.flasks) && data.flasks.length) setFlasks(dedupeOptions(data.flasks));
        if (Array.isArray(data.foods) && data.foods.length) setFoods(dedupeOptions(data.foods));
        if (Array.isArray(data.potions) && data.potions.length) {
          setPotions(dedupeOptions(data.potions));
        }
        if (Array.isArray(data.augments) && data.augments.length) {
          setAugments(dedupeOptions(data.augments));
        }
        if (Array.isArray(data.temp_enchants) && data.temp_enchants.length) {
          setTempEnchants(dedupeOptions(data.temp_enchants));
        }
      })
      .catch(() => {
        // Keep static fallback options if the endpoint is unavailable.
      });
    return () => {
      canceled = true;
    };
  }, [expansionMin]);

  return { flasks, foods, potions, augments, tempEnchants };
}
