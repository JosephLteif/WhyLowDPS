import React, { useMemo } from 'react';
import { ResolvedItem } from '../../lib/types';
import GearItemRow from '../GearItemRow';
import TopGearUpgradeButton from './TopGearUpgradeButton';

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

interface UpgradeOption {
  bonus_id: number;
  level: number;
  max: number;
  name: string;
  fullName: string;
  itemLevel: number;
}

interface TopGearSlotGroupProps {
  label: string;
  slots: string[];
  equipped: ResolvedItem[];
  alternatives: ResolvedItem[];
  selectedUids: Record<string, Set<string>>;
  upgradeMenuFor: string | null;
  upgradeOptions: UpgradeOption[];
  loadingUpgrades: boolean;
  hasUpgradePathByUid: Record<string, boolean>;
  onToggle: (item: ResolvedItem) => void;
  onAddClick: (slot: string) => void;
  onUpgradeClick: (item: ResolvedItem) => void;
  onUpgradeSelect: (item: ResolvedItem, opt: UpgradeOption) => void;
  onCatalystConvert: (item: ResolvedItem) => void;
  onOptimize: (item: ResolvedItem) => void;
  canOptimizeItem: (item: ResolvedItem) => boolean;
  onItemContextMenu: (item: ResolvedItem, event: React.MouseEvent) => void;
  itemDetails: (item: ResolvedItem) => {
    text: string;
    color?: string;
    kind?: 'text' | 'gemIcon' | 'plain' | 'iconText';
    badgeVariant?: 'neutral' | 'gem' | 'enchant' | 'mod' | 'source';
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
}

export default function TopGearSlotGroup({
  label,
  slots,
  equipped,
  alternatives,
  upgradeMenuFor,
  upgradeOptions,
  loadingUpgrades,
  hasUpgradePathByUid,
  onToggle,
  onAddClick,
  onUpgradeClick,
  onUpgradeSelect,
  onCatalystConvert,
  onOptimize,
  canOptimizeItem,
  onItemContextMenu,
  itemDetails,
  isItemSelected,
  hasLimitWarning,
  onToggleAll,
  getWowheadUrl,
  getWowheadData,
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
          <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>

      <div className="space-y-1.5">
        {equipped.map((item, idx) => (
          (() => {
            const showOffSpecWarning = item.off_spec && !isTierOrCatalystItem(item);
            return (
          <GearItemRow
            key={`eq-${idx}`}
            icon={item.icon}
            name={item.name}
            nameColor={item.quality_color}
            specWarning={showOffSpecWarning ? OFF_SPEC_WARNING : undefined}
            limitWarning={hasLimitWarning?.(item) ? EMBELLISHMENT_LIMIT_WARNING : undefined}
            dimmed={showOffSpecWarning === true}
            details={itemDetails(item)}
            ilevel={item.ilevel}
            equipped
            showCheckbox={false}
            href={item.item_id > 0 ? getWowheadUrl(item.item_id) : undefined}
            wowheadData={item.item_id > 0 ? getWowheadData(item) : undefined}
            optimized={
              item.enchant_id > 0 ||
              item.gem_id > 0 ||
              (item.embellishment_item_id || 0) > 0
            }
            onContextMenu={(event) => onItemContextMenu(item, event)}
          >
            <TopGearUpgradeButton
              item={item}
              upgradeMenuFor={upgradeMenuFor}
              upgradeOptions={upgradeOptions}
              loadingUpgrades={loadingUpgrades}
              hasUpgradePath={hasUpgradePathByUid[item.uid] !== false}
              onUpgradeClick={() => onUpgradeClick(item)}
              onUpgradeSelect={(opt) => onUpgradeSelect(item, opt)}
              onCatalystConvert={item.can_catalyst ? () => onCatalystConvert(item) : undefined}
              onOptimize={canOptimizeItem(item) ? () => onOptimize(item) : undefined}
            />
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
            return (
          <GearItemRow
            key={`alt-${idx}`}
            icon={item.icon}
            name={item.name}
            nameColor={item.quality_color}
            specWarning={showOffSpecWarning ? OFF_SPEC_WARNING : undefined}
            limitWarning={hasLimitWarning?.(item) ? EMBELLISHMENT_LIMIT_WARNING : undefined}
            dimmed={showOffSpecWarning === true}
            details={itemDetails(item)}
            ilevel={item.ilevel}
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
              (item.embellishment_item_id || 0) > 0
            }
            onContextMenu={(event) => onItemContextMenu(item, event)}
          >
            <TopGearUpgradeButton
              item={item}
              upgradeMenuFor={upgradeMenuFor}
              upgradeOptions={upgradeOptions}
              loadingUpgrades={loadingUpgrades}
              hasUpgradePath={hasUpgradePathByUid[item.uid] !== false}
              onUpgradeClick={() => onUpgradeClick(item)}
              onUpgradeSelect={(opt) => onUpgradeSelect(item, opt)}
              onCatalystConvert={item.can_catalyst ? () => onCatalystConvert(item) : undefined}
              onOptimize={canOptimizeItem(item) ? () => onOptimize(item) : undefined}
            />
          </GearItemRow>
            );
          })()
        ))}
      </div>
    </div>
  );
}
