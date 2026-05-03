import ComboSummary from '../ComboSummary';

interface TopGearQuickSelectProps {
  comboCount: number;
  maxCombinations: number;
  hasSelection: boolean;
  vaultCount: number;
  allVaultSelected: boolean;
  catalystCount: number;
  allCatalystSelected: boolean;
  onToggleVault: () => void;
  onToggleCatalyst: () => void;
  onSelectAll: () => void;
  onClear: () => void;
  comboBreakdown?: string | null;
}

export default function TopGearQuickSelect({
  comboCount,
  maxCombinations,
  hasSelection,
  vaultCount,
  allVaultSelected,
  catalystCount,
  allCatalystSelected,
  onToggleVault,
  onToggleCatalyst,
  onSelectAll,
  onClear,
  comboBreakdown = null,
}: TopGearQuickSelectProps) {
  const baseButtonClass =
    'rounded-md border px-2.5 py-1 text-[12px] font-semibold transition-colors';
  const goldButtonClass =
    'border-gold/45 bg-gold/[0.12] text-gold hover:bg-gold/[0.2]';
  const mutedButtonClass =
    'border-zinc-600 bg-zinc-900/70 text-zinc-200 hover:border-zinc-500 hover:bg-zinc-800';

  const breakdownPlaceholder = '0 normal combo(s) | +1 Currently Equipped';

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-2">
        {vaultCount > 0 && (
          <button
            type="button"
            onClick={onToggleVault}
            className={`${baseButtonClass} ${goldButtonClass}`}
          >
            Vault
          </button>
        )}
        {catalystCount > 0 && (
          <button
            type="button"
            onClick={onToggleCatalyst}
            className={`rounded-md px-2 py-1 text-[11px] font-bold uppercase tracking-wider transition-all ${
              allCatalystSelected
                ? 'bg-purple-400/20 text-purple-300 ring-1 ring-purple-400/30'
                : 'text-purple-400/60 hover:bg-purple-400/10 hover:text-purple-300'
            }`}
          >
            Catalyst
          </button>
        )}
        <button
          type="button"
          onClick={onSelectAll}
          className={`${baseButtonClass} ${goldButtonClass}`}
        >
          All
        </button>
        <button
          type="button"
          onClick={onClear}
          className={`${baseButtonClass} ${mutedButtonClass}`}
        >
          Clear
        </button>
        <ComboSummary
          comboCount={comboCount}
          maxCombinations={maxCombinations}
        />
      </div>
      <p
        className={`min-h-[18px] text-right text-[12px] font-medium ${
          comboBreakdown ? 'text-emerald-300/90' : 'invisible'
        }`}
      >
        {comboBreakdown || breakdownPlaceholder}
      </p>
    </div>
  );
}
