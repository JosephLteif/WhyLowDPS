import React, { useMemo } from 'react';
import { Ellipsis } from 'lucide-react';
import { Plus } from 'lucide-react';
import { ResolvedItem } from '../../lib/types';
import type { ItemInfo } from '../../lib/useItemInfo';
import { QUALITY_COLORS } from '../../lib/useItemInfo';
import GearItemRow from '../GearItemRow';

const OFF_SPEC_WARNING = 'This item may not be intended for your spec.';
const EMBELLISHMENT_LIMIT_WARNING =
  'Too many embellished items are selected. Only 2 embellished items can be equipped.';

function isTierOrCatalystItem(item: ResolvedItem): boolean {
  if (item.is_catalyst || item.can_catalyst) return true;
  const sourceType = String(item.source_type || '').toLowerCase();
  const tag = String(item.tag || '').toLowerCase();
  const name = String(item.name || '').toLowerCase();
  if (sourceType.includes('catalyst') || sourceType.includes('tier') || tag.includes('catalyst') || tag.includes('tier')) {
    return true;
  }
  // Heuristic for class set naming patterns (e.g. "Abyssal Immolator's Grasp")
  return /\b\w+'s\s+(grasp|gauntlets|handguards|gloves|hood|helm|crown|mantle|spaulders|shoulders|raiment|robes|chestguard|waistwrap|girdle|leggings|legguards|greaves|treads|boots)\b/i.test(name);

}

interface TopGearSlotGroupProps {
  label: string;
  slots: string[];
  equipped: ResolvedItem[];
  alternatives: ResolvedItem[];
  itemInfoMap: Record<number, ItemInfo>;
  onToggle: (item: ResolvedItem) => void;
  onAddClick: (slot: string) => void;
  onItemContextMenu: (item: ResolvedItem, event: React.MouseEvent) => void;
  itemDetails: (item: ResolvedItem) => {
    text: string;
    color?: string;
    kind?: 'text' | 'gemIcon' | 'plain' | 'iconText';
    badgeVariant?: 'neutral' | 'gem' | 'enchant' | 'embellishment' | 'mod' | 'source';
    icon?: string;
    href?: string;
    wowheadData?: string;
    tooltip?: string;
  }[];
  isItemSelected: (item: ResolvedItem) => boolean;
  hasLimitWarning?: (item: ResolvedItem) => boolean;
  onToggleAll?: () => void;
  getWowheadUrl: (itemId: number) => string;
  getWowheadData: (item: ResolvedItem) => string;
  getDisplayIlevel?: (item: ResolvedItem) => number;
}

export default function TopGearSlotGroup({
  label,
  slots,
  equipped,
  alternatives,
  itemInfoMap,
  onToggle,
  onAddClick,
  onItemContextMenu,
  itemDetails,
  isItemSelected,
  hasLimitWarning,
  onToggleAll,
  getWowheadUrl,
  getWowheadData,
  getDisplayIlevel,
}: TopGearSlotGroupProps) {
  useMemo(() => {
    const totalItems = equipped.length + alternatives.length;
    if (totalItems === 0) return true;
    let selectedCount = 0;
    equipped.forEach((it) => {
      if (isItemSelected(it)) selectedCount++;
    });
    alternatives.forEach((it) => {
      if (isItemSelected(it)) selectedCount++;
    });
    return selectedCount === totalItems;
  }, [equipped, alternatives, isItemSelected]);
  return (
    <div className="card group/card space-y-1.5 p-4 transition-all hover:bg-white/[0.02]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-300 group-hover/card:text-zinc-100">
            {label}
          </h2>
          {onToggleAll && (
            <button
              onClick={onToggleAll}
              className="rounded-md border border-gold/45 bg-gold/[0.12] px-2.5 py-1 text-[12px] font-semibold text-gold transition-colors hover:bg-gold/[0.2]"
            >
              All
            </button>
          )}
        </div>
        <button
          onClick={() => onAddClick(slots[0])}
          className="flex h-6 w-6 items-center justify-center rounded-full bg-gold/[0.12] text-gold transition-colors hover:bg-gold/[0.2]"
          title={`Add ${label.toLowerCase()}`}
        >
          <Plus className="h-3 w-3" strokeWidth={2.5} />
        </button>
      </div>

      <div className="space-y-1.5">
        {equipped.map((item, idx) => (
          (() => {
            const showOffSpecWarning = item.off_spec && !isTierOrCatalystItem(item);
            const info = itemInfoMap[item.item_id];
            const nameColor = info ? QUALITY_COLORS[info.quality] || item.quality_color : item.quality_color;
            return (
          <GearItemRow
            key={`eq-${idx}`}
            icon={item.icon}
            name={item.name}
            nameColor={nameColor}
            specWarning={showOffSpecWarning ? OFF_SPEC_WARNING : undefined}
            limitWarning={hasLimitWarning?.(item) ? EMBELLISHMENT_LIMIT_WARNING : undefined}
            dimmed={showOffSpecWarning === true}
            details={itemDetails(item)}
            ilevel={getDisplayIlevel ? getDisplayIlevel(item) : item.ilevel}
            equipped
            showCheckbox={false}
            href={item.item_id > 0 ? getWowheadUrl(item.item_id) : undefined}
            wowheadData={item.item_id > 0 ? getWowheadData(item) : undefined}
            optimized={
              item.enchant_id > 0 ||
              item.gem_id > 0 ||
              (item.gem_ids?.length || 0) > 0 ||
              (item.embellishment_item_id || 0) > 0
            }
            onContextMenu={(event) => onItemContextMenu(item, event)}
          >
            <button
              type="button"
              onClick={(event) => onItemContextMenu(item, event)}
              onContextMenu={(event) => onItemContextMenu(item, event)}
              className="mt-0.5 inline-flex h-6 items-center gap-1 rounded-md border border-white/15 bg-white/[0.03] px-2 text-[11px] font-semibold text-zinc-200 transition-colors hover:border-white/25 hover:bg-white/[0.08]"
              title="Open item actions"
            >
              <Ellipsis className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          </GearItemRow>
            );
          })()
        ))}

        {equipped.length > 0 && alternatives.length > 0 && (
          <div className="!my-2.5 h-px bg-gradient-to-r from-transparent via-border/40 to-transparent" />
        )}

        {alternatives.map((item, idx) => (
          (() => {
            const showOffSpecWarning = item.off_spec && !isTierOrCatalystItem(item);
            const info = itemInfoMap[item.item_id];
            const nameColor = info ? QUALITY_COLORS[info.quality] || item.quality_color : item.quality_color;
            return (
          <GearItemRow
            key={`alt-${idx}`}
            icon={item.icon}
            name={item.name}
            nameColor={nameColor}
            specWarning={showOffSpecWarning ? OFF_SPEC_WARNING : undefined}
            limitWarning={hasLimitWarning?.(item) ? EMBELLISHMENT_LIMIT_WARNING : undefined}
            dimmed={showOffSpecWarning === true}
            details={itemDetails(item)}
            ilevel={getDisplayIlevel ? getDisplayIlevel(item) : item.ilevel}
            selectable
            showCheckbox={false}
            checked={isItemSelected(item)}
            onToggle={() => onToggle(item)}
            vault={item.origin === 'vault'}
            catalyst={item.is_catalyst}
            href={item.item_id > 0 ? getWowheadUrl(item.item_id) : undefined}
            wowheadData={item.item_id > 0 ? getWowheadData(item) : undefined}
            optimized={
              item.enchant_id > 0 ||
              item.gem_id > 0 ||
              (item.gem_ids?.length || 0) > 0 ||
              (item.embellishment_item_id || 0) > 0
            }
            onContextMenu={(event) => onItemContextMenu(item, event)}
          >
            <button
              type="button"
              onClick={(event) => onItemContextMenu(item, event)}
              onContextMenu={(event) => onItemContextMenu(item, event)}
              className="mt-0.5 inline-flex h-6 items-center gap-1 rounded-md border border-white/15 bg-white/[0.03] px-2 text-[11px] font-semibold text-zinc-200 transition-colors hover:border-white/25 hover:bg-white/[0.08]"
              title="Open item actions"
            >
              <Ellipsis className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          </GearItemRow>
            );
          })()
        ))}
      </div>
    </div>
  );
}
