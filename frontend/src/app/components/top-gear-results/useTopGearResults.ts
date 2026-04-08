import { useMemo, useState } from 'react';
import { calculateAverageIlevel } from '../../lib/ilevel';
import type { ResultItem, TopGearResult } from '../../lib/types';
import { ALL_SLOTS } from '../../lib/constants';

interface UseTopGearResultsProps {
  results: TopGearResult[];
  equippedGear?: Record<string, ResultItem>;
  baseDps: number;
}

export function useTopGearResults({
  results,
  equippedGear,
  baseDps,
}: UseTopGearResultsProps) {
  const bestResult = results.length > 0 ? results[0] : null;

  const hasEncounterData = useMemo(
    () => results.some((r) => r.items.some((it) => it.encounter)),
    [results]
  );

  type GroupMode = 'rank' | 'encounter';
  const [groupMode, setGroupMode] = useState<GroupMode>('rank');
  const [selectedResultName, setSelectedResultName] = useState<string | null>(null);

  const selectedResult = useMemo(() => {
    if (selectedResultName) {
      return results.find((r) => r.name === selectedResultName) || bestResult;
    }
    return bestResult;
  }, [selectedResultName, results, bestResult]);

  const groupedResults = useMemo(() => {
    if (groupMode === 'rank' || !hasEncounterData) return null;
    const groups: Record<string, TopGearResult[]> = {};
    for (const result of results) {
      const encounter = result.items[0]?.encounter || 'Unknown';
      if (!groups[encounter]) groups[encounter] = [];
      groups[encounter].push(result);
    }
    return Object.entries(groups).sort(([, a], [, b]) => {
      const bestA = a[0]?.delta ?? 0;
      const bestB = b[0]?.delta ?? 0;
      return bestB - bestA;
    });
  }, [results, groupMode, hasEncounterData]);

  const bestGearSet = useMemo(() => {
    if (!equippedGear) return {} as Record<string, ResultItem>;
    const gearSet: Record<string, ResultItem> = {};

    for (const slot of ALL_SLOTS) {
      if (equippedGear[slot]) {
        gearSet[slot] = { ...equippedGear[slot] };
      }
    }

    if (selectedResult) {
      for (const it of selectedResult.items) {
        if (!it.is_kept && it.slot === 'off_hand' && it.item_id === 0) {
          delete gearSet.off_hand;
          continue;
        }
        if (!it.is_kept && it.item_id > 0) {
          gearSet[it.slot] = { ...it };
        }
      }
    }
    return gearSet;
  }, [equippedGear, selectedResult]);

  const baseAvgIlevel = useMemo(() => {
    if (!equippedGear) return 0;
    return calculateAverageIlevel(equippedGear as any);
  }, [equippedGear]);

  const selectedAvgIlevel = useMemo(() => {
    if (!bestGearSet) return baseAvgIlevel;
    return calculateAverageIlevel(bestGearSet as any);
  }, [bestGearSet, baseAvgIlevel]);

  const upgradeSlots = useMemo(() => {
    const slots = new Set<string>();
    if (selectedResult && selectedResult.delta > 0) {
      for (const it of selectedResult.items) {
        if (!it.is_kept && it.item_id > 0) slots.add(it.slot);
      }
    }
    return slots;
  }, [selectedResult]);

  const downgradeSlots = useMemo(() => {
    const slots = new Set<string>();
    if (selectedResult && selectedResult.delta < 0) {
      for (const it of selectedResult.items) {
        if (!it.is_kept && it.item_id > 0) slots.add(it.slot);
      }
    }
    return slots;
  }, [selectedResult]);

  return {
    groupMode,
    setGroupMode,
    selectedResultName,
    setSelectedResultName,
    selectedResult,
    groupedResults,
    bestGearSet,
    baseAvgIlevel,
    selectedAvgIlevel,
    upgradeSlots,
    downgradeSlots,
    hasEncounterData,
  };
}
