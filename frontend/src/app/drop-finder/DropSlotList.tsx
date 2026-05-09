import { type ReactNode, useMemo, useState } from 'react';
import type { DropItem, UpgradeTracks } from './types';
import { getTrackInfo, itemMatchesActiveLootSpec, resolveUpgrade, QUALITY_COLORS } from './types';

const SLOT_ORDER = [
  'Main Hand',
  'Off Hand',
  'Head',
  'Neck',
  'Shoulder',
  'Back',
  'Chest',
  'Wrist',
  'Hands',
  'Waist',
  'Legs',
  'Feet',
  'Finger',
  'Trinket',
];

type GroupMode = 'slot' | 'instance';

interface DropSlotListProps {
  drops: Record<string, DropItem[]>;
  selected: Set<number>;
  onToggle: (itemId: number) => void;
  onSelectAll: (itemIds: number[]) => void;
  onClear: () => void;
  classSpecIds: number[];
  classId: number | null;
  difficulty: string;
  dungeonDiff: string;
  upgradeLevel: number;
  upgradeTracks: UpgradeTracks;
  headerLabel: string;
  headerActions?: ReactNode;
  headerBreakdown?: ReactNode;
  isWishlisted: (itemId: number) => boolean;
  onToggleWishlist: (
    item: DropItem,
    slotLabel: string,
    meta?: { ilvl?: number; bonusId?: number; upgradeLabel?: string }
  ) => void;
}

export default function DropSlotList({
  drops,
  selected,
  onToggle,
  onSelectAll,
  onClear,
  classSpecIds,
  classId,
  difficulty,
  dungeonDiff,
  upgradeLevel,
  upgradeTracks,
  headerLabel,
  headerActions,
  headerBreakdown,
  isWishlisted,
  onToggleWishlist,
}: DropSlotListProps) {
  const [groupMode, setGroupMode] = useState<GroupMode>('slot');
  const baseButtonClass = 'rounded-md border px-3 py-1.5 text-sm font-medium transition-colors';
  const goldButtonClass = 'border-gold/45 bg-gold/[0.12] text-gold hover:bg-gold/[0.2]';
  const mutedButtonClass =
    'border-zinc-600 bg-zinc-900/70 text-zinc-200 hover:border-zinc-500 hover:bg-zinc-800';

  const visibleDrops = useMemo(() => {
    const next: Record<string, DropItem[]> = {};
    for (const [slot, items] of Object.entries(drops)) {
      const filtered = items.filter((item) => {
        if (item.specs && item.specs.length > 0) {
          if (!itemMatchesActiveLootSpec(item.specs, classSpecIds, classId)) {
            return false;
          }
        }

        // If we cannot map class/spec IDs, keep previous fallback behavior and
        // avoid showing known off-spec items.
        if (classSpecIds.length === 0 && classId == null && item.off_spec === true) {
          return false;
        }
        return true;
      });
      if (filtered.length > 0) {
        next[slot] = filtered;
      }
    }
    return next;
  }, [drops, classSpecIds, classId]);

  const totalItems = Object.values(visibleDrops).reduce((n, items) => n + items.length, 0);

  const allItems = useMemo(() => Object.values(visibleDrops).flat(), [visibleDrops]);

  const instanceSorted = useMemo(() => {
    const groups = new Map<string, DropItem[]>();
    for (const item of allItems) {
      const inst = item.instance_name || 'Unknown';
      const list = groups.get(inst) || [];
      list.push(item);
      groups.set(inst, list);
    }
    return [...groups.entries()];
  }, [allItems]);

  const slotSorted = useMemo(
    () =>
      [...Object.entries(visibleDrops)].sort(([a], [b]) => {
        const ai = SLOT_ORDER.indexOf(a);
        const bi = SLOT_ORDER.indexOf(b);
        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      }),
    [visibleDrops]
  );

  const visibleItemIds = useMemo(
    () => [
      ...new Set(
        Object.values(visibleDrops)
          .flat()
          .map((item) => item.item_id)
      ),
    ],
    [visibleDrops]
  );

  return (
    <div className="space-y-4">
      <div className="sticky top-[var(--app-header-height)] z-20 -mx-1 rounded-lg border border-border/70 bg-surface/95 px-3 py-2 shadow-md backdrop-blur-sm">
        <div className="flex items-start justify-between gap-3">
          <p className="pt-2 text-sm text-white">
            {headerLabel} &mdash; {totalItems} items
            {selected.size > 0 && (
              <span className="ml-1.5 text-gold">({selected.size} selected)</span>
            )}
          </p>
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-3">
              <div className="flex gap-1.5">
                {(
                  [
                    ['instance', 'By Instance'],
                    ['slot', 'By Slot'],
                  ] as const
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    onClick={() => setGroupMode(mode)}
                    className={`${baseButtonClass} ${
                      groupMode === mode ? 'border-white bg-white text-black' : mutedButtonClass
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <button
                onClick={() => onSelectAll(visibleItemIds)}
                className={`${baseButtonClass} ${goldButtonClass}`}
              >
                Select all
              </button>
              <button onClick={onClear} className={`${baseButtonClass} ${mutedButtonClass}`}>
                Clear
              </button>
              {headerActions}
            </div>
            {headerBreakdown ? (
              <p className="text-right text-xs text-emerald-300/90">{headerBreakdown}</p>
            ) : null}
          </div>
        </div>
      </div>

      {(groupMode === 'instance' ? instanceSorted : slotSorted).map(([groupLabel, items]) => (
        <div key={groupLabel} className="card p-4">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-widest text-muted">
            {groupLabel}
            <span className="ml-1.5 font-medium normal-case tracking-normal text-zinc-300">
              ({items.length})
            </span>
          </h3>
          <div className="flex flex-wrap gap-2">
            {items.map((item) => (
              <DropItemCard
                key={`${item.item_id}:${item.encounter || ''}:${item.instance_name || ''}:${groupLabel}`}
                item={item}
                isSelected={selected.has(item.item_id)}
                onToggle={() => onToggle(item.item_id)}
                isWishlisted={isWishlisted(item.item_id)}
                onToggleWishlist={(meta) => onToggleWishlist(item, String(groupLabel), meta)}
                difficulty={difficulty}
                dungeonDiff={dungeonDiff}
                upgradeLevel={upgradeLevel}
                upgradeTracks={upgradeTracks}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function DropItemCard({
  item,
  isSelected,
  onToggle,
  isWishlisted,
  onToggleWishlist,
  difficulty,
  dungeonDiff,
  upgradeLevel,
  upgradeTracks,
}: {
  item: DropItem;
  isSelected: boolean;
  onToggle: () => void;
  isWishlisted: boolean;
  onToggleWishlist: (meta?: { ilvl?: number; bonusId?: number; upgradeLabel?: string }) => void;
  difficulty: string;
  dungeonDiff: string;
  upgradeLevel: number;
  upgradeTracks: UpgradeTracks;
}) {
  const resolved = resolveUpgrade(item, difficulty, dungeonDiff, upgradeLevel, upgradeTracks);
  const trackInfo = getTrackInfo(item, difficulty, dungeonDiff);
  const effectiveBonusId = trackInfo?.bonus_id;
  const isOffSpec = item.off_spec === true;
  const upgradeLabel = trackInfo?.track
    ? `${trackInfo.track}${trackInfo.level ? ` ${trackInfo.level}` : ''}`
    : undefined;

  return (
    <div
      onClick={onToggle}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle();
        }
      }}
      className={`relative flex items-start gap-3 rounded-lg border px-3.5 py-2.5 pr-10 text-left transition-all ${
        isSelected
          ? 'border-gold/40 bg-gold/10'
          : 'border-border bg-surface-2 hover:border-gray-500'
      }`}
    >
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onToggleWishlist({
            ilvl: resolved.ilvl,
            bonusId: resolved.bonus_id || undefined,
            upgradeLabel,
          });
        }}
        className={`absolute right-2 top-2 rounded p-1 transition-colors ${
          isWishlisted
            ? 'text-rose-300 hover:bg-rose-500/20'
            : 'text-zinc-500 hover:bg-white/10 hover:text-zinc-200'
        }`}
        title={isWishlisted ? 'Remove from wishlist' : 'Add to wishlist'}
      >
        <svg
          viewBox="0 0 16 16"
          className="h-4 w-4"
          fill={isWishlisted ? 'currentColor' : 'none'}
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M8 13.2l-4.5-4.2a2.8 2.8 0 010-4 2.9 2.9 0 014 0L8 5.5l.5-.5a2.9 2.9 0 014 0 2.8 2.8 0 010 4L8 13.2z" />
        </svg>
      </button>
      <div className="relative shrink-0">
        <a
          href={`https://www.wowhead.com/item=${item.item_id}`}
          data-wowhead={`item=${item.item_id}${effectiveBonusId ? `&bonus=${effectiveBonusId}` : ''}`}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          className="block"
        >
          <img
            src={`https://render.worldofwarcraft.com/icons/56/${item.icon}.jpg`}
            alt=""
            className={`h-8 w-8 rounded ${isOffSpec ? 'opacity-70' : ''}`}
          />
        </a>
        {isOffSpec && (
          <div
            className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-[11px] font-bold text-black"
            title="Off-spec: may not drop for your main spec"
          >
            !
          </div>
        )}
      </div>
      <div className={`min-w-0 ${isOffSpec ? 'opacity-70' : ''}`}>
        <a
          href={`https://www.wowhead.com/item=${item.item_id}`}
          data-wowhead={`item=${item.item_id}${effectiveBonusId ? `&bonus=${effectiveBonusId}` : ''}`}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className={`block text-sm font-semibold leading-tight ${QUALITY_COLORS[resolved.quality] || 'text-gray-300'}`}
        >
          {item.name}
        </a>
        {item.encounter && <span className="text-sm text-zinc-300">{item.encounter}</span>}
      </div>
      <div className="ml-1 shrink-0">
        <span
          className={`block text-base font-semibold tabular-nums tracking-tight text-zinc-100 ${isOffSpec ? 'opacity-70' : ''}`}
        >
          {resolved.ilvl}
        </span>
      </div>
    </div>
  );
}
