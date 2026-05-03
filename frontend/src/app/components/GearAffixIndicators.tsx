'use client';

import { getIconUrl } from '../lib/useItemInfo';

type IndicatorItem = {
  icon?: string;
  name?: string;
  href?: string;
  wowheadData?: string;
  changed?: boolean;
};

interface GearAffixIndicatorsProps {
  gemEligible: boolean;
  enchantEligible: boolean;
  gem?: IndicatorItem;
  enchant?: IndicatorItem;
  align?: 'left' | 'right';
  size?: 16 | 18;
}

export default function GearAffixIndicators({
  gemEligible,
  enchantEligible,
  gem,
  enchant,
  align = 'left',
  size = 18,
}: GearAffixIndicatorsProps) {
  if (!gemEligible && !enchantEligible) return null;

  const sizeClass = size === 16 ? 'h-[16px] w-[16px]' : 'h-[18px] w-[18px]';
  const markerTextClass = size === 16 ? 'text-[9px]' : 'text-[10px]';
  const rtl = align === 'right';

  return (
    <div className={`flex shrink-0 flex-col gap-1 ${rtl ? 'items-end' : 'items-start'}`}>
      {gemEligible &&
        (gem?.icon ? (
          <a
            href={gem.href}
            data-wowhead={gem.wowheadData}
            title={gem.changed ? `Gem change needed: ${gem.name || 'Gem'}` : gem.name || 'Gem'}
            className={`relative inline-flex ${sizeClass} items-center justify-center overflow-hidden rounded-[4px] border ${
              gem.changed
                ? 'border-2 border-sky-300/95 bg-sky-500/30 ring-2 ring-sky-300/75'
                : 'border-sky-400/45 bg-sky-500/10'
            }`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.preventDefault()}
          >
            <img
              src={getIconUrl(gem.icon)}
              alt={gem.name || 'Gem'}
              width={size}
              height={size}
              className="h-full w-full"
              loading="lazy"
            />
            {gem.changed && (
              <span className="absolute -right-[2px] -top-[2px] inline-flex h-[8px] w-[8px] items-center justify-center rounded-full bg-amber-400 ring-1 ring-black/50" />
            )}
          </a>
        ) : (
          <span
            title="Gem slot empty"
            className={`inline-flex ${sizeClass} items-center justify-center overflow-hidden rounded-[4px] border border-sky-400/40 bg-sky-500/[0.06] ${markerTextClass} font-bold text-sky-300/80`}
          >
            G
          </span>
        ))}

      {enchantEligible &&
        (enchant?.icon ? (
          <a
            href={enchant.href}
            data-wowhead={enchant.wowheadData}
            title={
              enchant.changed
                ? `Enchant change needed: ${enchant.name || 'Enchant'}`
                : enchant.name || 'Enchant'
            }
            className={`relative inline-flex ${sizeClass} items-center justify-center overflow-hidden rounded-[4px] border ${
              enchant.changed
                ? 'border-2 border-emerald-300/95 bg-emerald-500/30 ring-2 ring-emerald-300/75'
                : 'border-emerald-400/45 bg-emerald-500/10'
            }`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.preventDefault()}
          >
            <img
              src={getIconUrl(enchant.icon)}
              alt={enchant.name || 'Enchant'}
              width={size}
              height={size}
              className="h-full w-full"
              loading="lazy"
            />
            {enchant.changed && (
              <span className="absolute -right-[2px] -top-[2px] inline-flex h-[8px] w-[8px] items-center justify-center rounded-full bg-amber-400 ring-1 ring-black/50" />
            )}
          </a>
        ) : (
          <span
            title="Enchant slot empty"
            className={`inline-flex ${sizeClass} items-center justify-center overflow-hidden rounded-[4px] border border-emerald-400/40 bg-emerald-500/[0.06] ${markerTextClass} font-bold text-emerald-300/80`}
          >
            E
          </span>
        ))}
    </div>
  );
}
