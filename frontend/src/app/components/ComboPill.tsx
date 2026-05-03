interface ComboPillProps {
  comboCount: number;
  maxCombinations?: number;
  size?: 'sm' | 'md';
  glowWhenActive?: boolean;
  activeBy?: 'combos' | 'items';
  itemCount?: number;
}

export default function ComboPill({
  comboCount,
  maxCombinations,
  size = 'sm',
  glowWhenActive = false,
  activeBy = 'combos',
  itemCount = 0,
}: ComboPillProps) {
  const hasItems = itemCount > 0;
  const isActive = activeBy === 'items' ? hasItems : comboCount > 0;
  const isOverLimit =
    Number.isFinite(maxCombinations) &&
    (maxCombinations as number) > 0 &&
    comboCount > (maxCombinations as number);
  const comboLabel = `${comboCount.toLocaleString()} combo(s)`;

  const comboColorClass = isOverLimit
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
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
      {comboLabel}
    </span>
  );
}
