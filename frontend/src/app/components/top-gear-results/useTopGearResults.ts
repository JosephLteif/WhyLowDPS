import { useMemo, useState } from 'react';
import { calculateAverageIlevel } from '../../lib/ilevel';
import type { ResultItem, TopGearResult } from '../../lib/types';
import { ALL_SLOTS } from '../../lib/constants';

interface UseTopGearResultsProps {
  results: TopGearResult[];
  equippedGear?: Record<string, ResultItem>;
  baseDps: number;
}

export function useTopGearResults({ results, equippedGear, baseDps }: UseTopGearResultsProps) {
  const bestResult = results.length > 0 ? results[0] : null;

  const hasGroupingData = useMemo(
    () => results.some((r) => r.items.some((it) => it.instance_name || it.encounter)),
    [results]
  );

  type GroupMode = 'rank' | 'instance';
  const [groupMode, setGroupMode] = useState<GroupMode>('rank');
  const [selectedResultName, setSelectedResultName] = useState<string | null>(null);

  const selectedResult = useMemo(() => {
    if (selectedResultName) {
      return results.find((r) => r.name === selectedResultName) || bestResult;
    }
    return bestResult;
  }, [selectedResultName, results, bestResult]);

  const groupedResults = useMemo(() => {
    if (groupMode === 'rank') return null;
    const scoredItems = results
      .map((r) => r.items.find((it) => !it.is_kept && it.item_id > 0))
      .filter((it): it is NonNullable<typeof it> => !!it);
    const raidCount = scoredItems.filter((it) => it.source_type === 'raid').length;
    const dungeonCount = scoredItems.filter((it) => it.source_type === 'dungeon').length;
    const groupByBoss = raidCount > 0 && dungeonCount === 0;

    const groups: Record<string, TopGearResult[]> = {};
    for (const result of results) {
      if (result.name.startsWith('Currently Equipped')) {
        (groups.__ungrouped__ ||= []).push(result);
        continue;
      }

      const primaryItem =
        result.items.find((it) => !it.is_kept && it.item_id > 0) ||
        result.items.find((it) => it.item_id > 0);
      const label = groupByBoss
        ? primaryItem?.encounter || primaryItem?.instance_name || 'Unknown'
        : primaryItem?.instance_name || primaryItem?.encounter || 'Unknown';
      if (label === 'Unknown') {
        (groups.__ungrouped__ ||= []).push(result);
      } else {
        (groups[label] ||= []).push(result);
      }
    }
    return Object.entries(groups)
      .map(([instance, group]) => [instance, [...group].sort((a, b) => b.delta - a.delta)] as const)
      .sort(([aName, aGroup], [bName, bGroup]) => {
        const bestA = aGroup[0]?.delta ?? 0;
        const bestB = bGroup[0]?.delta ?? 0;
        if (bestB !== bestA) return bestB - bestA;
        return aName.localeCompare(bName);
      });
  }, [results, groupMode]);

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
    hasGroupingData,
  };
}
