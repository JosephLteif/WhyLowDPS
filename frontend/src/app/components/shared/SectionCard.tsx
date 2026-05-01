import type { ReactNode } from 'react';

type SectionCardProps = {
  title: string;
  children: ReactNode;
  className?: string;
  titleClassName?: string;
};

export default function SectionCard({
  title,
  children,
  className = '',
  titleClassName = '',
}: SectionCardProps) {
  return (
    <div className={`rounded border border-white/10 bg-black/20 p-3 ${className}`.trim()}>
      <p className={`mb-2 text-[11px] font-bold uppercase tracking-wide text-zinc-500 ${titleClassName}`.trim()}>
        {title}
      </p>
      {children}
    </div>
  );
}
