'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useDismissOnOutside } from '../../lib/useDismissOnOutside';
import { useWowheadTooltips } from '../../lib/useWowheadTooltips';

interface Option {
  value: string;
  label: string;
  desc?: string;
  icon?: string;
  href?: string;
  wowheadData?: string;
}

interface CustomSelectProps {
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  variant?: 'default' | 'header';
}

function SelectIconImage({ icon }: { icon: string }) {
  const urls = useMemo(
    () => [
      `https://wow.zamimg.com/images/wow/icons/large/${icon}.jpg`,
      `https://render.worldofwarcraft.com/icons/56/${icon}.jpg`,
      'https://wow.zamimg.com/images/wow/icons/large/inv_misc_questionmark.jpg',
    ],
    [icon]
  );
  const [srcIndex, setSrcIndex] = useState(0);

  useEffect(() => {
    setSrcIndex(0);
  }, [icon]);

  return (
    <img
      src={urls[srcIndex]}
      alt=""
      className="h-full w-full"
      loading="lazy"
      onError={() => {
        setSrcIndex((current) => (current < urls.length - 1 ? current + 1 : current));
      }}
    />
  );
}

export default function CustomSelect({
  value,
  options,
  onChange,
  placeholder = 'Select option...',
  className = '',
  variant = 'default',
}: CustomSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selected = options.find((o) => o.value === value);
  useWowheadTooltips([open, options.length, value]);
  const isHeader = variant === 'header';

  useDismissOnOutside(rootRef, open, () => setOpen(false));

  const renderIcon = (opt: Option, sizeClass = 'h-5 w-5') => {
    if (!opt.icon) return null;
    const content = <SelectIconImage icon={opt.icon} />;

    if (opt.href || opt.wowheadData) {
      return (
        <a
          href={opt.href || '#'}
          data-wowhead={opt.wowheadData}
          className={`inline-flex ${sizeClass} shrink-0 overflow-hidden rounded border border-white/15`}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          {content}
        </a>
      );
    }

    return (
      <span className={`inline-flex ${sizeClass} shrink-0 overflow-hidden rounded border border-white/15`}>
        {content}
      </span>
    );
  };

  return (
    <div
      ref={rootRef}
      className={`relative ${className}`}
      data-stop-add="true"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          setOpen(!open);
        }}
        className={`flex w-full items-center justify-between rounded border border-border bg-surface-2 px-2.5 text-white transition-all hover:border-border-light focus:border-gold outline-none ${
          isHeader
            ? 'py-2 text-[10px] font-bold uppercase tracking-wider'
            : 'py-1.5 text-[11px] font-medium'
        }`}
      >
        <span className="flex min-w-0 items-center gap-2">
          {selected && renderIcon(selected)}
          <span className={`truncate ${!selected ? (isHeader ? 'text-zinc-300' : 'text-zinc-500') : ''}`}>
            {selected ? selected.label : placeholder}
          </span>
        </span>
        <svg
          className={`h-3 w-3 text-zinc-400 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 6l4 4 4-4" />
        </svg>
      </div>

      {open && (
        <div className="absolute z-[110] mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-border bg-surface-3 py-1 shadow-2xl shadow-black">
          {options.map((opt) => (
            <div
              key={opt.value}
              role="option"
              aria-selected={opt.value === value}
              tabIndex={0}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onChange(opt.value);
                setOpen(false);
              }}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                e.preventDefault();
                onChange(opt.value);
                setOpen(false);
              }}
              className={`flex w-full flex-col px-3 py-1.5 text-left transition-colors ${
                opt.value === value
                  ? 'bg-gold/10 text-gold'
                  : 'text-zinc-300 hover:bg-white/5 hover:text-white'
              }`}
            >
              <span
                className={`flex min-w-0 items-center gap-2 ${
                  isHeader
                    ? 'text-[10px] font-bold uppercase tracking-wider'
                    : 'text-[11px] font-semibold'
                }`}
              >
                {renderIcon(opt)}
                <span className="truncate">{opt.label}</span>
              </span>
              {opt.desc && (
                <span className={`text-[10px] ${opt.value === value ? 'text-gold/70' : 'text-zinc-500'}`}>
                  {opt.desc}
                </span>
              )}
            </div>
          ))}
          {options.length === 0 && (
            <div className="px-3 py-2 text-[10px] italic text-zinc-500">No options available</div>
          )}
        </div>
      )}
    </div>
  );
}
