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
  onClear: () => void;
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
  onClear,
}: TopGearQuickSelectProps) {
  const comboLabel = `${comboCount.toLocaleString()} combo${comboCount !== 1 ? 's' : ''}`;
  const comboColorClass =
    comboCount > maxCombinations
      ? 'bg-red-500/10 text-red-400 border border-red-500/20'
      : comboCount > 0
        ? 'bg-surface-2 text-white border border-white/5'
        : 'bg-surface-2 text-muted border border-white/5';

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1">
        {vaultCount > 0 && (
          <button
            type="button"
            onClick={onToggleVault}
            className={`rounded-md px-2 py-1 text-[11px] font-bold uppercase tracking-wider transition-all ${
              allVaultSelected
                ? 'bg-amber-400/20 text-amber-300 ring-1 ring-amber-400/30'
                : 'text-amber-400/60 hover:bg-amber-400/10 hover:text-amber-300'
            }`}
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
        {hasSelection && (
          <button
            type="button"
            onClick={onClear}
            className="rounded-md px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-gray-500 transition-all hover:bg-white/[0.05] hover:text-gray-300"
          >
            Clear
          </button>
        )}
      </div>
      <span className={`flex items-center gap-1.5 rounded-md px-3 py-1 font-mono text-xs font-medium shadow-inner ${comboColorClass}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${comboCount > maxCombinations ? 'bg-red-500' : comboCount > 0 ? 'bg-emerald-500' : 'bg-gray-600'}`} />
        {comboLabel}
      </span>
    </div>
  );
}
