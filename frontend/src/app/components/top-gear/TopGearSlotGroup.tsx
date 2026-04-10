import { ResolvedItem } from '../../lib/types';
import GearItemRow from '../GearItemRow';
import TopGearUpgradeButton from './TopGearUpgradeButton';

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
  onToggle: (item: ResolvedItem) => void;
  onAddClick: (slot: string) => void;
  onUpgradeClick: (item: ResolvedItem) => void;
  onUpgradeSelect: (item: ResolvedItem, opt: UpgradeOption) => void;
  onCatalystConvert: (item: ResolvedItem) => void;
  onOptimize: (item: ResolvedItem) => void;
  itemDetails: (item: ResolvedItem) => { text: string; color?: string }[];
  isItemSelected: (item: ResolvedItem) => boolean;
  getWowheadUrl: (itemId: number) => string;
  getWowheadData: (item: ResolvedItem) => string;
}

export default function TopGearSlotGroup({
  label,
  slots,
  equipped,
  alternatives,
  selectedUids,
  upgradeMenuFor,
  upgradeOptions,
  loadingUpgrades,
  onToggle,
  onAddClick,
  onUpgradeClick,
  onUpgradeSelect,
  onCatalystConvert,
  onOptimize,
  itemDetails,
  isItemSelected,
  getWowheadUrl,
  getWowheadData,
}: TopGearSlotGroupProps) {
  return (
    <div className="card group/card space-y-1.5 p-4 transition-all hover:bg-white/[0.02]">
      <div className="flex items-center justify-between">
        <h2 className="text-[10px] font-bold uppercase tracking-[0.25em] text-muted group-hover/card:text-gray-400">
          {label}
        </h2>
        <button
          onClick={() => onAddClick(slots[0])}
          className="flex h-5 w-5 items-center justify-center rounded-full bg-white/5 text-muted transition-all hover:bg-gold/10 hover:text-gold"
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

      <div className="space-y-1">
        {equipped.map((item, idx) => (
          <GearItemRow
            key={`eq-${idx}`}
            icon={item.icon}
            name={item.name}
            nameColor={item.quality_color}
            details={itemDetails(item)}
            ilevel={item.ilevel}
            equipped
            href={item.item_id > 0 ? getWowheadUrl(item.item_id) : undefined}
            wowheadData={item.item_id > 0 ? getWowheadData(item) : undefined}
            optimized={item.enchant_id > 0 || item.gem_id > 0}
          >
            <TopGearUpgradeButton
              item={item}
              upgradeMenuFor={upgradeMenuFor}
              upgradeOptions={upgradeOptions}
              loadingUpgrades={loadingUpgrades}
              onUpgradeClick={() => onUpgradeClick(item)}
              onUpgradeSelect={(opt) => onUpgradeSelect(item, opt)}
              onCatalystConvert={item.can_catalyst ? () => onCatalystConvert(item) : undefined}
              onOptimize={() => onOptimize(item)}
            />
          </GearItemRow>
        ))}

        {equipped.length > 0 && alternatives.length > 0 && (
          <div className="!my-2.5 h-px bg-gradient-to-r from-transparent via-border/40 to-transparent" />
        )}

        {alternatives.map((item, idx) => (
          <GearItemRow
            key={`alt-${idx}`}
            icon={item.icon}
            name={item.name}
            nameColor={item.quality_color}
            details={itemDetails(item)}
            ilevel={item.ilevel}
            selectable
            checked={isItemSelected(item)}
            onToggle={() => onToggle(item)}
            vault={item.origin === 'vault'}
            catalyst={item.is_catalyst}
            href={item.item_id > 0 ? getWowheadUrl(item.item_id) : undefined}
            wowheadData={item.item_id > 0 ? getWowheadData(item) : undefined}
            optimized={item.enchant_id > 0 || item.gem_id > 0}
          >
            <TopGearUpgradeButton
              item={item}
              upgradeMenuFor={upgradeMenuFor}
              upgradeOptions={upgradeOptions}
              loadingUpgrades={loadingUpgrades}
              onUpgradeClick={() => onUpgradeClick(item)}
              onUpgradeSelect={(opt) => onUpgradeSelect(item, opt)}
              onCatalystConvert={item.can_catalyst ? () => onCatalystConvert(item) : undefined}
              onOptimize={() => onOptimize(item)}
            />
          </GearItemRow>
        ))}
      </div>
    </div>
  );
}
