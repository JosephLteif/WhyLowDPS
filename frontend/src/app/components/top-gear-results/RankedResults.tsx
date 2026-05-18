import { useState } from 'react';
import type { ResultItem, TopGearResult } from '../../lib/types';
import type { EnchantInfo, GemInfo, ItemInfo } from '../../lib/useItemInfo';
import type { Instance } from '../../drop-finder/types';

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
  currencies?: Record<string, { id: number; name: string; icon: string }>;
  dropBaselineIlevelByKey?: Record<string, number>;
  getExactStatsStatus?: (result: TopGearResult) => {
    status: 'idle' | 'loading' | 'ready' | 'error' | 'same_base';
    label?: string;
  };
  onLoadExactStats?: (result: TopGearResult) => void;
  onAddResultToWishlist?: (result: TopGearResult) => void;
  isResultWishlisted?: (result: TopGearResult) => boolean;
  sourceInstances?: Instance[];
  baselineTierBySlot?: Record<string, string>;
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
  currencies,
  dropBaselineIlevelByKey = {},
  getExactStatsStatus,
  onLoadExactStats,
  onAddResultToWishlist,
  isResultWishlisted,
  sourceInstances = [],
  baselineTierBySlot = {},
}: RankedResultsProps) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? results : results.slice(0, INITIAL_VISIBLE);
  const hasMore = results.length > INITIAL_VISIBLE;

  return (
    <div className="space-y-1">
      <RankingsHeader />
      {visible.map((result, idx) =>
        (() => {
          const exact = getExactStatsStatus?.(result) || { status: 'idle' as const };
          return (
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
              currencies={currencies}
              dropBaselineIlevelByKey={dropBaselineIlevelByKey}
              exactStatsStatus={exact.status}
              exactStatsLabel={exact.label}
              onLoadExactStats={onLoadExactStats ? () => onLoadExactStats(result) : undefined}
              exactStatsButtonLabel={
                exact.status === 'loading'
                  ? 'Starting...'
                  : exact.status === 'ready' || exact.status === 'error'
                    ? 'Go to Sim'
                    : 'Start Sim'
              }
              exactStatsButtonVariant={
                exact.status === 'ready' || exact.status === 'error' ? 'goto' : 'start'
              }
              exactStatsButtonDisabled={exact.status === 'loading'}
              onAddToWishlist={
                onAddResultToWishlist ? () => onAddResultToWishlist(result) : undefined
              }
              isWishlisted={isResultWishlisted ? isResultWishlisted(result) : false}
              sourceInstances={sourceInstances}
              baselineTierBySlot={baselineTierBySlot}
            />
          );
        })()
      )}
      {hasMore && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-2 w-full rounded-lg border border-border bg-surface-2 py-2.5 text-sm text-zinc-300 transition-all hover:border-zinc-600 hover:text-zinc-100"
        >
          {expanded
            ? 'Show less'
            : `Show all ${results.length} results (+${results.length - INITIAL_VISIBLE} more)`}
        </button>
      )}
    </div>
  );
}
