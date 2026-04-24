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
  topClassName = 'top-14',
  className = '',
}: StickyPageHeaderProps) {
  return (
    <div className={`sticky ${topClassName} z-30 ${className}`.trim()}>
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-surface/95 px-3 py-2 shadow-md backdrop-blur-sm">
        <div className="min-w-0">{left}</div>
        {right ? <div className="shrink-0">{right}</div> : null}
      </div>
    </div>
  );
}
