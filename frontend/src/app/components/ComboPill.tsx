import { Loader2 } from 'lucide-react';

interface ComboPillProps {
  comboCount: number;
  maxCombinations?: number;
  isComputing?: boolean;
  limitReached?: boolean;
  size?: 'sm' | 'md';
  glowWhenActive?: boolean;
  activeBy?: 'combos' | 'items';
  itemCount?: number;
}

export default function ComboPill({
  comboCount,
  maxCombinations,
  isComputing = false,
  limitReached = false,
  size = 'sm',
  glowWhenActive = false,
  activeBy = 'combos',
  itemCount = 0,
}: ComboPillProps) {
  const hasItems = itemCount > 0;
  const isActive = activeBy === 'items' ? hasItems : comboCount > 0;
  const configuredLimit =
    typeof maxCombinations === 'number' && Number.isFinite(maxCombinations) && maxCombinations > 0
      ? maxCombinations
      : null;
  const isOverLimit = limitReached || (configuredLimit != null && comboCount > configuredLimit);
  const comboLabel = isComputing
    ? 'Computing…'
    : isOverLimit
      ? `${comboCount.toLocaleString()} combo(s) (over limit)`
      : `${comboCount.toLocaleString()} combo(s)`;

  const comboColorClass = isComputing
    ? 'bg-gold/10 text-gold border border-gold/20'
    : isOverLimit
      ? 'bg-red-500/10 text-red-400 border border-red-500/20'
      : isActive
        ? 'bg-surface-2 text-white border border-white/5'
        : 'bg-surface-2 text-muted border border-white/5';

  const dotClass = isOverLimit ? 'bg-red-500' : isActive ? 'bg-emerald-500' : 'bg-gray-600';

  const sizeClass =
    size === 'md'
      ? 'rounded-lg px-3.5 py-1.5 font-mono text-sm font-semibold'
      : 'rounded-md px-3 py-1 font-mono text-xs font-medium';

  const glowClass =
    glowWhenActive && isActive
      ? 'ring-1 ring-emerald-400/40 shadow-[0_0_18px_rgba(16,185,129,0.28)]'
      : '';

  return (
    <span
      className={`inline-flex items-center gap-1.5 shadow-inner ${comboColorClass} ${sizeClass} ${glowClass}`}
      title={
        isComputing
          ? 'Calculating combination count…'
          : isOverLimit
            ? configuredLimit != null
              ? `Cannot start a simulation: ${comboCount.toLocaleString()} combinations exceeds the configured limit of ${configuredLimit.toLocaleString()}.`
              : `Cannot start a simulation: ${comboCount.toLocaleString()} combinations exceeds its configured limit.`
            : undefined
      }
      aria-live="polite"
    >
      {isComputing ? (
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
      ) : (
        <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
      )}
      {comboLabel}
    </span>
  );
}
