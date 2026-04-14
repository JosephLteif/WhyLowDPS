import { useMemo, useState } from 'react';
import type { DropItem, UpgradeTracks } from './types';
import { getTrackInfo, resolveUpgrade, QUALITY_COLORS } from './types';

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
}: DropSlotListProps) {
  const [groupMode, setGroupMode] = useState<GroupMode>('slot');
  const visibleDrops = useMemo(() => {
    const next: Record<string, DropItem[]> = {};
    for (const [slot, items] of Object.entries(drops)) {
      const filtered = items.filter((item) => {
        if (slot !== 'Other') return true;
        if (item.specs && item.specs.length > 0) {
          const hasSpecMatch =
            classSpecIds.length > 0 && item.specs.some((id) => classSpecIds.includes(id));
          const hasClassMatch = classId != null && item.specs.includes(classId);
          if (hasSpecMatch || hasClassMatch) return true;
          // If we cannot confidently map class/spec IDs, don't hide potentially valid items.
          if (classSpecIds.length === 0 && classId == null) return item.off_spec !== true;
          return item.off_spec !== true;
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
    () => [...new Set(Object.values(visibleDrops).flat().map((item) => item.item_id))],
    [visibleDrops]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">
          {headerLabel} &mdash; {totalItems} items
          {selected.size > 0 && (
            <span className="ml-1.5 text-gold">({selected.size} selected)</span>
          )}
        </p>
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
                className={`rounded border px-3 py-1.5 text-sm font-medium transition-all ${
                  groupMode === mode
                    ? 'border-white bg-white text-black'
                    : 'border-border bg-surface-2 text-zinc-300 hover:border-zinc-500 hover:text-zinc-100'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            onClick={() => onSelectAll(visibleItemIds)}
            className="text-sm text-zinc-300 transition-colors hover:text-zinc-100"
          >
            Select all
          </button>
          <button
            onClick={onClear}
            className="text-sm text-zinc-300 transition-colors hover:text-zinc-100"
          >
            Clear
          </button>
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
                key={item.item_id}
                item={item}
                isSelected={selected.has(item.item_id)}
                onToggle={() => onToggle(item.item_id)}
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
  difficulty,
  dungeonDiff,
  upgradeLevel,
  upgradeTracks,
}: {
  item: DropItem;
  isSelected: boolean;
  onToggle: () => void;
  difficulty: string;
  dungeonDiff: string;
  upgradeLevel: number;
  upgradeTracks: UpgradeTracks;
}) {
  const resolved = resolveUpgrade(item, difficulty, dungeonDiff, upgradeLevel, upgradeTracks);
  const effectiveBonusId = getTrackInfo(item, difficulty, dungeonDiff)?.bonus_id;
  const isOffSpec = item.off_spec === true;

  return (
    <button
      onClick={onToggle}
      className={`flex items-start gap-3 rounded-lg border px-3.5 py-2.5 text-left transition-all ${
        isSelected
          ? 'border-gold/40 bg-gold/10'
          : 'border-border bg-surface-2 hover:border-gray-500'
      }`}
    >
      <div className="relative shrink-0">
        <img
          src={`https://render.worldofwarcraft.com/icons/56/${item.icon}.jpg`}
          alt=""
          className={`h-8 w-8 rounded ${isOffSpec ? 'opacity-70' : ''}`}
        />
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
          className={`block text-base font-semibold tracking-tight tabular-nums text-zinc-100 ${isOffSpec ? 'opacity-70' : ''}`}
        >
          {resolved.ilvl}
        </span>
      </div>
    </button>
  );
}
