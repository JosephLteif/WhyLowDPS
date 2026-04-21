'use client';

import { useRef, useState } from 'react';
import { useDismissOnOutside } from '../lib/useDismissOnOutside';

const FIGHT_STYLES = [
  { value: 'Patchwerk', label: 'Patchwerk', desc: 'Pure single-target with no movement.' },
  {
    value: 'CastingPatchwerk',
    label: 'Casting Patchwerk',
    desc: 'Single-target focused on uninterrupted casting.',
  },
  {
    value: 'HecticAddCleave',
    label: 'Hectic Add Cleave',
    desc: 'Single-target priority with frequent add waves for cleave.',
  },
  {
    value: 'CleaveAdd',
    label: 'Cleave Add',
    desc: 'Two-target style with regular cleave pressure.',
  },
  {
    value: 'LightMovement',
    label: 'Light Movement',
    desc: 'Mostly stationary with occasional movement windows.',
  },
  {
    value: 'HeavyMovement',
    label: 'Heavy Movement',
    desc: 'Frequent movement that interrupts ideal uptime.',
  },
  {
    value: 'DungeonSlice',
    label: 'Dungeon Slice',
    desc: 'Mythic+ style pull cadence with mixed pack sizes.',
  },
  {
    value: 'DungeonRoute',
    label: 'Dungeon Route',
    desc: 'Route-driven dungeon simulation from scripted pulls.',
  },
  {
    value: 'HelterSkelter',
    label: 'Helter Skelter',
    desc: 'Chaotic encounter with movement, swaps, and disruptions.',
  },
];

interface FightStyleSelectorProps {
  value: string;
  onChange: (value: string) => void;
}

export default function FightStyleSelector({ value, onChange }: FightStyleSelectorProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const activeStyle = FIGHT_STYLES.find((fs) => fs.value === value);
  const activeLabel = activeStyle?.label ?? value;
  const activeDescription = activeStyle?.desc ?? '';

  useDismissOnOutside(rootRef, open, () => setOpen(false));

  return (
    <div className="space-y-1.5">
      <div ref={rootRef} className="relative">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="input-field flex w-full items-center justify-between text-[15px] font-medium"
        >
          <span>{activeLabel}</span>
          <svg
            className={`h-4 w-4 text-zinc-300 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 6l4 4 4-4" />
          </svg>
        </button>
        {open && (
          <div className="absolute z-50 mt-1 max-h-72 w-full overflow-y-auto overflow-x-hidden rounded-lg border border-border bg-surface-2 py-1 shadow-lg shadow-black/40">
            {FIGHT_STYLES.map((fs) => (
              <button
                key={fs.value}
                type="button"
                onMouseDown={() => {
                  onChange(fs.value);
                  setOpen(false);
                }}
                className={`flex w-full flex-col px-3.5 py-2 text-left transition-colors ${
                  fs.value === value
                    ? 'bg-gold/[0.08] text-gold'
                    : 'text-zinc-200 hover:bg-white/[0.04] hover:text-white'
                }`}
              >
                <span className="text-[15px]">{fs.label}</span>
                <span
                  className={`mt-0.5 text-[13px] ${
                    fs.value === value ? 'text-gold/90' : 'text-zinc-300'
                  }`}
                >
                  {fs.desc}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      {activeDescription && <p className="text-[13px] text-zinc-300">{activeDescription}</p>}
    </div>
  );
}
