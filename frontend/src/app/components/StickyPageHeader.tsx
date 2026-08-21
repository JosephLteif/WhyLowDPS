import type { ReactNode } from 'react';

interface StickyPageHeaderProps {
  left: ReactNode;
  right?: ReactNode;
  topClassName?: string;
  className?: string;
}

export default function StickyPageHeader({
  left,
  right,
  topClassName = 'top-[var(--app-header-height)]',
  className = '',
}: StickyPageHeaderProps) {
  return (
    <div className={`sticky ${topClassName} z-30 ${className}`.trim()}>
      <div className="flex flex-col items-stretch gap-2 rounded-lg border border-border/70 bg-surface/95 px-3 py-2 shadow-md backdrop-blur-sm sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <div className="min-w-0">{left}</div>
        {right ? <div className="shrink-0 self-start sm:self-auto">{right}</div> : null}
      </div>
    </div>
  );
}
