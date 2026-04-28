import type { ReactNode } from 'react';
import ComboPill from './ComboPill';

interface ComboSummaryProps {
  comboCount: number;
  maxCombinations?: number;
  size?: 'sm' | 'md';
  glowWhenActive?: boolean;
  activeBy?: 'combos' | 'items';
  itemCount?: number;
  align?: 'start' | 'end';
  breakdown?: ReactNode;
  className?: string;
  breakdownClassName?: string;
}

export default function ComboSummary({
  comboCount,
  maxCombinations,
  size = 'sm',
  glowWhenActive = false,
  activeBy = 'combos',
  itemCount = 0,
  align = 'end',
  breakdown,
  className = '',
  breakdownClassName = 'text-xs text-zinc-400',
}: ComboSummaryProps) {
  const alignClass = align === 'start' ? 'items-start' : 'items-end';

  return (
    <div className={`flex flex-col gap-1 ${alignClass} ${className}`.trim()}>
      <ComboPill
        comboCount={comboCount}
        maxCombinations={maxCombinations}
        size={size}
        glowWhenActive={glowWhenActive}
        activeBy={activeBy}
        itemCount={itemCount}
      />
      {breakdown ? <p className={breakdownClassName}>{breakdown}</p> : null}
    </div>
  );
}
