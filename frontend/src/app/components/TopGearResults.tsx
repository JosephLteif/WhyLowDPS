'use client';

import Link from 'next/link';
import { API_URL } from '../lib/api';
import DpsHeroCard from './DpsHeroCard';
import GearOverview from './GearOverview';
import { useItemInfo, useEnchantInfo, useGemInfo } from '../lib/useItemInfo';
import type { ItemInfo, EnchantInfo, GemInfo, ItemQuery } from '../lib/useItemInfo';
import { useWowheadTooltips } from '../lib/useWowheadTooltips';
import { useMemo, useState, type ReactNode } from 'react';
import type { TopGearResult, ResultItem } from '../lib/types';
import { useTopGearResults } from './top-gear-results/useTopGearResults';
import RankingsHeader from './top-gear-results/RankingsHeader';
import ResultRow from './top-gear-results/ResultRow';
import RankedResults from './top-gear-results/RankedResults';
import SimResultTalentsCard from './SimResultTalentsCard';
import { addItemsToWishlist, buildWishlistOwnerKey } from '../lib/wishlist';
import type { DropItem } from '../drop-finder/types';

interface TopGearResultsProps {
  playerName: string;
  playerClass: string;
  playerRealm?: string;
  playerRegion?: string;
  baseDps: number;
  results: TopGearResult[];
  equippedGear?: Record<string, ResultItem>;
  dpsError?: number;
  dpsErrorPct?: number;
  fightLength?: number;
  desiredTargets?: number;
  iterations?: number;
  targetError?: number;
  elapsedTime?: number;
  stageTimings?: Array<{ name: string; elapsed: number }>;
  talentString?: string;
  currencies?: Record<string, { id: number; name: string; icon: string }>;
  enableWishlistActions?: boolean;
}

function CollapsibleSection({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between border-b border-border/60 bg-white/[0.01] px-5 py-3.5 text-left transition-colors hover:bg-white/[0.03]"
      >
        <span className="text-xs font-medium uppercase tracking-widest text-muted">{title}</span>
        <svg
          className={`h-3.5 w-3.5 text-zinc-500 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>
      {open && <div className="p-5">{children}</div>}
    </div>
  );
}

export default function TopGearResults({
  playerName,
  playerClass,
  playerRealm,
  playerRegion,
  baseDps,
  results,
  equippedGear,
  dpsError,
  dpsErrorPct,
  fightLength,
  desiredTargets,
  iterations,
  targetError,
  elapsedTime,
  stageTimings,
  talentString,
  currencies,
  enableWishlistActions = false,
}: TopGearResultsProps) {
  const {
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
  } = useTopGearResults({ results, equippedGear, baseDps });

  const maxDps = results.length > 0 ? results[0].dps : baseDps;

  const allItemQueries = useMemo(() => {
    const seen = new Set<string>();
    const queries: ItemQuery[] = [];
    const addItem = (it: { item_id: number; bonus_ids?: number[] }) => {
      if (it.item_id <= 0) return;
      const key = `${it.item_id}:${(it.bonus_ids || []).sort().join(':')}`;
      if (!seen.has(key)) {
        seen.add(key);
        queries.push({ item_id: it.item_id, bonus_ids: it.bonus_ids });
      }
    };
    for (const r of results) {
      for (const it of r.items) addItem(it);
    }
    if (equippedGear) {
      for (const it of Object.values(equippedGear)) addItem(it);
    }
    return queries;
  }, [results, equippedGear]);

  const itemInfoMap = useItemInfo(allItemQueries);

  const allEnchantIds = useMemo(() => {
    const ids = new Set<number>();
    const addEnchant = (id?: number) => {
      if (id && id > 0) ids.add(id);
    };
    for (const r of results) {
      for (const it of r.items) addEnchant(it.enchant_id);
    }
    if (equippedGear) {
      for (const it of Object.values(equippedGear)) addEnchant(it.enchant_id);
    }
    return [...ids];
  }, [results, equippedGear]);

  const enchantInfoMap = useEnchantInfo(allEnchantIds);

  const allGemIds = useMemo(() => {
    const ids = new Set<number>();
    const addGem = (id?: number) => {
      if (id && id > 0) ids.add(id);
    };
    for (const r of results) {
      for (const it of r.items) addGem(it.gem_id);
    }
    if (equippedGear) {
      for (const it of Object.values(equippedGear)) addGem(it.gem_id);
    }
    return [...ids];
  }, [results, equippedGear]);

  const gemInfoMap = useGemInfo(allGemIds);
  useWowheadTooltips([itemInfoMap]);

  const hasGearOverview = equippedGear && Object.keys(equippedGear).length > 0;
  const [wishlistFeedback, setWishlistFeedback] = useState('');
  const wishlistOwnerKey = useMemo(
    () =>
      buildWishlistOwnerKey({
        name: playerName,
        realm: playerRealm,
        region: playerRegion,
        className: playerClass,
      }),
    [playerName, playerRealm, playerRegion, playerClass]
  );

  const changedSelectedItems = useMemo(
    () => selectedResult?.items.filter((it) => !it.is_kept && it.item_id > 0) ?? [],
    [selectedResult]
  );

  const handleAddSelectedToWishlist = () => {
    if (changedSelectedItems.length === 0) {
      setWishlistFeedback('No changed items in this selection.');
      return;
    }

    const entries = changedSelectedItems.map((it) => {
      const dropItem: DropItem = {
        item_id: it.item_id,
        name: it.name,
        icon: it.icon,
        quality: it.quality,
        ilevel: it.ilevel,
        encounter: it.encounter || '',
        instance_name: it.instance_name,
        source_type: it.source_type || 'Drop Finder Result',
        inventory_type: it.inventory_type,
        bonus_ids: Array.isArray(it.bonus_ids) ? it.bonus_ids : [],
      };
      return {
        item: dropItem,
        slot: it.slot.replace(/_/g, ' '),
        meta: {
          ilvl: it.ilevel,
          bonusId: Array.isArray(it.bonus_ids) && it.bonus_ids.length > 0 ? it.bonus_ids[0] : undefined,
          upgradeLabel: it.upgrade || undefined,
        },
      };
    });

    const { added, skipped } = addItemsToWishlist(entries, wishlistOwnerKey);
    if (added > 0 && skipped > 0) {
      setWishlistFeedback(`Added ${added} item(s), ${skipped} already saved.`);
    } else if (added > 0) {
      setWishlistFeedback(`Added ${added} item(s) to wishlist.`);
    } else {
      setWishlistFeedback('All selected items are already in wishlist.');
    }
  };

  const characterRenderUrl =
    playerRealm && playerName
      ? `${API_URL}/api/blizzard/character/${encodeURIComponent(
          playerRealm.toLowerCase()
        )}/${encodeURIComponent(playerName.toLowerCase())}/media/render${
          playerRegion ? `?region=${playerRegion.toLowerCase()}` : ''
        }`
      : null;

  return (
    <div className="space-y-6">
      <DpsHeroCard
        playerName={playerName}
        playerClass={playerClass}
        playerRealm={playerRealm}
        playerRegion={playerRegion}
        dps={selectedResult?.dps || baseDps}
        dpsError={selectedResult?.target_error ?? dpsError}
        dpsErrorPct={dpsErrorPct}
        fightLength={fightLength}
        desiredTargets={desiredTargets}
        iterations={iterations}
        targetError={targetError}
        elapsedTime={elapsedTime}
        stageTimings={stageTimings}
        avgIlevel={selectedAvgIlevel}
        avgIlevelGain={selectedAvgIlevel - baseAvgIlevel}
      >
        {selectedResult && (
          <div className="mt-4 flex flex-col items-center gap-2">
            {selectedResult.delta > 0 ? (
              <div className="flex items-center gap-1.5 rounded-md bg-emerald-500/10 px-3 py-1.5 text-emerald-400">
                <span className="text-sm font-bold">
                  +{Math.round(selectedResult.delta).toLocaleString()} DPS (
                  {((selectedResult.delta / baseDps) * 100).toFixed(1)}%)
                </span>
                <span className="text-xs opacity-60">upgrade</span>
              </div>
            ) : selectedResult.delta < 0 ? (
              <div className="flex items-center gap-1.5 rounded-md bg-red-500/10 px-3 py-1.5 text-red-400">
                <span className="text-sm font-bold">
                  {Math.round(selectedResult.delta).toLocaleString()} DPS (
                  {((selectedResult.delta / baseDps) * 100).toFixed(1)}%)
                </span>
                <span className="text-xs opacity-60">downgrade</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 rounded-md bg-zinc-500/10 px-3 py-1.5 text-zinc-400">
                <span className="text-sm font-bold italic">Currently Equipped</span>
              </div>
            )}

            {selectedResultName && selectedResultName !== results[0]?.name && (
              <span className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">
                Viewing Selection: {selectedResultName}
              </span>
            )}
            {selectedResultName === results[0]?.name && selectedResult.delta > 0 && (
              <span className="text-[11px] uppercase tracking-[0.16em] text-gold/80">
                Best Gear Combination
              </span>
            )}
          </div>
        )}
      </DpsHeroCard>

      {hasGearOverview && (
        <CollapsibleSection title="Character Panel">
          <GearOverview
            gear={bestGearSet}
            title={
              selectedResultName && selectedResultName !== results[0]?.name
                ? 'Selected Gear'
                : 'Best Gear'
            }
            characterRenderUrl={characterRenderUrl}
            upgradeSlots={upgradeSlots}
            downgradeSlots={downgradeSlots}
            currencies={currencies}
          />
        </CollapsibleSection>
      )}

      {talentString && (
        <CollapsibleSection title="Talents" defaultOpen={false}>
          <SimResultTalentsCard talentString={talentString} />
        </CollapsibleSection>
      )}

      <CollapsibleSection title="Rankings">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-[13px] font-semibold uppercase tracking-[0.16em] text-zinc-300">
            Rankings
          </p>
          <div className="flex items-center gap-3">
            {enableWishlistActions && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleAddSelectedToWishlist}
                  className="rounded border border-gold/30 bg-gold/10 px-3 py-1.5 text-xs font-semibold text-gold transition-colors hover:bg-gold/20"
                >
                  Add Selection To Wishlist
                </button>
                <Link
                  href="/wishlist"
                  className="rounded border border-border bg-surface-2 px-3 py-1.5 text-xs text-zinc-200 transition-colors hover:border-zinc-500 hover:text-white"
                >
                  Open Wishlist
                </Link>
              </div>
            )}
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-widest text-zinc-600">Group by</span>
              <div className="flex gap-1">
                {(
                  [
                    ['rank', 'Rank'],
                    ['instance', 'Dungeon/Raid'],
                  ] as const
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    onClick={() => setGroupMode(mode)}
                    className={`rounded border px-3 py-1.5 text-[14px] font-medium transition-all ${
                      groupMode === mode
                        ? 'border-white bg-white text-black'
                        : 'border-border bg-surface-2 text-gray-400 hover:border-gray-500 hover:text-white'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <span className="font-mono text-[14px] text-zinc-300">{results.length} results</span>
          </div>
        </div>
        {enableWishlistActions && wishlistFeedback && (
          <div className="mb-3 text-xs text-zinc-300">{wishlistFeedback}</div>
        )}

        {groupMode === 'instance' ? (
          <div className="space-y-6">
            {(groupedResults ?? [[hasGroupingData ? 'Unknown' : 'All Results', results]]).map(
              ([instance, group]) => (
                <div key={instance}>
                  {instance !== '__ungrouped__' && (
                    <div className="mb-2 flex items-center gap-2 border-b border-border/50 pb-1.5">
                      <span className="text-[15px] font-semibold text-zinc-200">{instance}</span>
                      <span className="font-mono text-[13px] text-zinc-400">
                        {group.length} items
                      </span>
                    </div>
                  )}
                  <RankingsHeader />
                  <div className="space-y-1">
                    {group.map((result) => (
                      <ResultRow
                        key={result.name}
                        result={result}
                        maxDps={maxDps}
                        baseDps={baseDps}
                        equippedGear={equippedGear}
                        baseAvgIlevel={baseAvgIlevel}
                        isBest={result === results[0] && result.delta > 0}
                        isSelected={result.name === (selectedResultName || results[0]?.name)}
                        onSelect={() => setSelectedResultName(result.name)}
                        itemInfoMap={itemInfoMap}
                        enchantInfoMap={enchantInfoMap}
                        gemInfoMap={gemInfoMap}
                        currencies={currencies}
                      />
                    ))}
                  </div>
                </div>
              )
            )}
          </div>
        ) : (
          <RankedResults
            results={results}
            maxDps={maxDps}
            baseDps={baseDps}
            equippedGear={equippedGear}
            baseAvgIlevel={baseAvgIlevel}
            itemInfoMap={itemInfoMap}
            enchantInfoMap={enchantInfoMap}
            gemInfoMap={gemInfoMap}
            selectedResultName={selectedResultName}
            onSelectResult={setSelectedResultName}
            currencies={currencies}
          />
        )}
      </CollapsibleSection>
    </div>
  );
}
