'use client';

import type { ReactNode } from 'react';
import type { CSSProperties } from 'react';

interface GearItemCoreProps {
  align?: 'left' | 'right';
  itemHref?: string;
  itemWowheadData?: string;
  itemName: string;
  itemNameTitle?: string;
  itemNameColor?: string;
  itemNameClassName?: string;
  iconSrc: string;
  iconAlt?: string;
  iconWidth: number;
  iconHeight: number;
  iconContainerClassName: string;
  iconImageClassName?: string;
  iconContainerStyle?: CSSProperties;
  iconOverlay?: ReactNode;
  indicators?: ReactNode;
  headerExtras?: ReactNode;
  details?: ReactNode;
  detailsClassName?: string;
  textContainerClassName?: string;
}

export default function GearItemCore({
  align = 'left',
  itemHref,
  itemWowheadData,
  itemName,
  itemNameTitle,
  itemNameColor,
  itemNameClassName = 'block truncate text-sm font-semibold leading-tight',
  iconSrc,
  iconAlt = '',
  iconWidth,
  iconHeight,
  iconContainerClassName,
  iconImageClassName = 'h-full w-full',
  iconContainerStyle,
  iconOverlay,
  indicators,
  headerExtras,
  details,
  detailsClassName = 'mt-0.5 text-sm text-zinc-300',
  textContainerClassName = 'min-w-0 flex-1',
}: GearItemCoreProps) {
  const rtl = align === 'right';

  return (
    <>
      <a
        href={itemHref}
        data-wowhead={itemWowheadData}
        className={iconContainerClassName}
        style={iconContainerStyle}
        title={itemNameTitle || itemName}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.preventDefault()}
      >
        <img
          src={iconSrc}
          alt={iconAlt}
          width={iconWidth}
          height={iconHeight}
          className={iconImageClassName}
          loading="lazy"
        />
        {iconOverlay}
      </a>
      {indicators}
      <div className={`${textContainerClassName} ${rtl ? 'text-right' : ''}`}>
        <div className={`flex items-center gap-1.5 ${rtl ? 'flex-row-reverse' : ''}`}>
          <a
            href={itemHref}
            data-wowhead={itemWowheadData}
            className={itemNameClassName}
            style={itemNameColor ? { color: itemNameColor } : undefined}
            title={itemNameTitle || itemName}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.preventDefault()}
          >
            {itemName}
          </a>
          {headerExtras}
        </div>
        {details && <div className={detailsClassName}>{details}</div>}
      </div>
    </>
  );
}
