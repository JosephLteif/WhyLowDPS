import { getIconUrl } from '../../lib/useItemInfo';

export type ItemBadgeVariant = 'neutral' | 'gem' | 'enchant' | 'mod' | 'source';

interface ItemBadgeProps {
  text: string;
  variant?: ItemBadgeVariant;
  className?: string;
  textClassName?: string;
  backgroundClassName?: string;
  borderClassName?: string;
  icon?: string;
  href?: string;
  wowheadData?: string;
  title?: string;
  iconSize?: number;
}

export default function ItemBadge({
  text,
  variant = 'neutral',
  className = '',
  textClassName = '',
  backgroundClassName = '',
  borderClassName = '',
  icon,
  href,
  wowheadData,
  title,
  iconSize = 16,
}: ItemBadgeProps) {
  const variantDefaults: Record<ItemBadgeVariant, { text: string; bg: string; border: string }> = {
    neutral: { text: 'text-zinc-300', bg: 'bg-white/[0.04]', border: 'border-white/10' },
    gem: { text: 'text-sky-200', bg: 'bg-sky-500/12', border: 'border-sky-400/45' },
    enchant: { text: 'text-emerald-200', bg: 'bg-emerald-500/12', border: 'border-emerald-400/45' },
    mod: { text: 'text-amber-200', bg: 'bg-amber-500/12', border: 'border-amber-400/35' },
    source: { text: 'text-zinc-200', bg: 'bg-white/[0.06]', border: 'border-white/15' },
  };
  const defaults = variantDefaults[variant];

  const body = (
    <>
      {icon ? (
        <img
          src={getIconUrl(icon)}
          alt=""
          width={iconSize}
          height={iconSize}
          className="shrink-0 rounded-[3px]"
          loading="lazy"
        />
      ) : null}
      <span className="min-w-0 whitespace-normal break-words leading-snug">{text}</span>
    </>
  );

  const baseClass =
    'inline-flex min-w-0 max-w-full items-start gap-1 rounded-md border px-1.5 py-0.5 text-[12px] leading-snug';
  const resolvedClass = `${baseClass} ${defaults.text} ${defaults.bg} ${defaults.border} ${textClassName} ${backgroundClassName} ${borderClassName} ${className}`.trim();

  if (href) {
    return (
      <a
        href={href}
        data-wowhead={wowheadData}
        title={wowheadData ? undefined : title || text}
        className={resolvedClass}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.preventDefault()}
      >
        {body}
      </a>
    );
  }

  return (
    <span title={title || text} className={resolvedClass}>
      {body}
    </span>
  );
}
