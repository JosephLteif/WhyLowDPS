'use client';

import { useEffect, useMemo, useState, type ImgHTMLAttributes } from 'react';
import { getIconUrl } from '../../lib/useItemInfo';

const UNKNOWN_ICON = getIconUrl('inv_misc_questionmark');

function iconBaseName(icon: string): string {
  if (/^https?:\/\//i.test(icon)) return '';
  return (
    icon
      .replace(/\.(jpg|jpeg|png|webp)$/i, '')
      .split('/')
      .pop() || ''
  );
}

interface WowIconProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  icon?: string | null;
}

export default function WowIcon({ icon, alt = '', onError, ...props }: WowIconProps) {
  const urls = useMemo(() => {
    const raw = String(icon || '').trim();
    const base = iconBaseName(raw);
    return Array.from(
      new Set(
        [
          raw ? getIconUrl(raw) : '',
          base ? `https://render.worldofwarcraft.com/icons/56/${base}.jpg` : '',
          UNKNOWN_ICON,
        ].filter(Boolean)
      )
    );
  }, [icon]);
  const [urlIndex, setUrlIndex] = useState(0);

  useEffect(() => {
    setUrlIndex(0);
  }, [icon]);

  return (
    <img
      {...props}
      alt={alt}
      src={urls[urlIndex] || UNKNOWN_ICON}
      onError={(event) => {
        onError?.(event);
        setUrlIndex((current) => Math.min(current + 1, urls.length - 1));
      }}
    />
  );
}
