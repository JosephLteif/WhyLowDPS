import { useEffect, useState } from 'react';
import type { ResultItem, TopGearResult } from '../../lib/types';
import type { EnchantInfo, GemInfo, ItemInfo } from '../../lib/useItemInfo';
import type { Instance } from '../../drop-finder/types';

import RankingsHeader from './RankingsHeader';
import ResultRow from './ResultRow';

const INITIAL_VISIBLE = 8;
const PAGE_SIZE = 10;

export interface ResultListProps {
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
  showHeader?: boolean;
  showRanks?: boolean;
  isBestResult?: (result: TopGearResult, index: number) => boolean;
}

export function ResultList({
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
  showHeader = true,
  showRanks = true,
  isBestResult,
}: ResultListProps) {
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE);

  useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE);
  }, [results]);

  const visible = results.slice(0, visibleCount);
  const hasMore = visibleCount < results.length;
  const nextCount = Math.min(PAGE_SIZE, results.length - visibleCount);
  const formatCount = (count: number) => count.toLocaleString();

  return (
    <div className="space-y-1">
      {showHeader && <RankingsHeader />}
      {visible.map((result, idx) =>
        (() => {
          const exact = getExactStatsStatus?.(result) || { status: 'idle' as const };
          return (
            <ResultRow
              key={result.name}
              result={result}
              rank={showRanks ? idx + 1 : undefined}
              maxDps={maxDps}
              baseDps={baseDps}
              equippedGear={equippedGear}
              baseAvgIlevel={baseAvgIlevel}
              isBest={isBestResult ? isBestResult(result, idx) : idx === 0 && result.delta > 0}
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
        <div className="border-border bg-surface-2 mt-2 rounded-lg border p-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="px-1 text-xs text-zinc-400">
              Showing {formatCount(visible.length)} of {formatCount(results.length)} results
            </span>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setVisibleCount((count) => count + nextCount)}
                className="border-border rounded border px-3 py-1.5 text-sm text-zinc-300 transition-colors hover:border-zinc-600 hover:text-zinc-100"
              >
                Show next {formatCount(nextCount)}
              </button>
              <button
                type="button"
                onClick={() => setVisibleCount(results.length)}
                className="border-gold/40 bg-gold/10 text-gold hover:bg-gold/20 rounded border px-3 py-1.5 text-sm transition-colors"
              >
                Show all {formatCount(results.length)}
              </button>
            </div>
          </div>
        </div>
      )}
      {visibleCount > INITIAL_VISIBLE && results.length > INITIAL_VISIBLE && (
        <button
          type="button"
          onClick={() => setVisibleCount(INITIAL_VISIBLE)}
          className="border-border bg-surface-2 mt-2 w-full rounded-lg border py-2.5 text-sm text-zinc-300 transition-colors hover:border-zinc-600 hover:text-zinc-100"
        >
          Show fewer
        </button>
      )}
    </div>
  );
}

export default function RankedResults(props: ResultListProps) {
  return <ResultList {...props} />;
}
