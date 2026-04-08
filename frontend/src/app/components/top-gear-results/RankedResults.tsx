import { useState } from 'react';
import type {
  ResultItem,
  TopGearResult,
} from '../../lib/types';
import type {
  EnchantInfo,
  GemInfo,
  ItemInfo,
} from '../../lib/useItemInfo';

import RankingsHeader from './RankingsHeader';
import ResultRow from './ResultRow';

const INITIAL_VISIBLE = 8;

interface RankedResultsProps {
  results: TopGearResult[];
  maxDps: number;
  baseDps: number;
  equippedGear?: Record<string, ResultItem>;
  baseAvgIlevel: number;
  itemInfoMap: Record<number, ItemInfo>;
  enchantInfoMap: Record<number, EnchantInfo>;
  gemInfoMap: Record<number, GemInfo>;
  selectedResultName: string | null;
  onSelectResult: (name: string) => void;
}

export default function RankedResults({
  results,
  maxDps,
  baseDps,
  equippedGear,
  baseAvgIlevel,
  itemInfoMap,
  enchantInfoMap,
  gemInfoMap,
  selectedResultName,
  onSelectResult,
}: RankedResultsProps) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? results : results.slice(0, INITIAL_VISIBLE);
  const hasMore = results.length > INITIAL_VISIBLE;

  return (
    <div className="space-y-1">
      <RankingsHeader />
      {visible.map((result, idx) => (
        <ResultRow
          key={result.name}
          result={result}
          rank={idx + 1}
          maxDps={maxDps}
          baseDps={baseDps}
          equippedGear={equippedGear}
          baseAvgIlevel={baseAvgIlevel}
          isBest={idx === 0 && result.delta > 0}
          isSelected={result.name === (selectedResultName || results[0]?.name)}
          onSelect={() => onSelectResult(result.name)}
          itemInfoMap={itemInfoMap}
          enchantInfoMap={enchantInfoMap}
          gemInfoMap={gemInfoMap}
        />
      ))}
      {hasMore && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-2 w-full rounded-lg border border-border bg-surface-2 py-2 text-xs text-zinc-400 transition-all hover:border-zinc-600 hover:text-zinc-200"
        >
          {expanded
            ? 'Show less'
            : `Show all ${results.length} results (+${
                results.length - INITIAL_VISIBLE
              } more)`}
        </button>
      )}
    </div>
  );
}
