'use client';

import { type ReactNode } from 'react';

interface ToggleOptionCardProps {
  checked: boolean;
  onToggle: () => void;
  title: string;
  description: string;
  disabled?: boolean;
  titleClassName?: string;
  descriptionClassName?: string;
  activeClassName?: string;
  activeKnobClassName?: string;
  inactiveClassName?: string;
  inactiveKnobClassName?: string;
  note?: ReactNode;
}

export default function ToggleOptionCard({
  checked,
  onToggle,
  title,
  description,
  disabled = false,
  titleClassName = 'text-[15px] font-medium text-zinc-100 transition-colors group-hover:text-white',
  descriptionClassName = 'text-[13px] text-zinc-300',
  activeClassName = 'bg-gold',
  activeKnobClassName = 'bg-black',
  inactiveClassName = 'border border-border bg-surface-2',
  inactiveKnobClassName = 'bg-gray-500',
  note,
}: ToggleOptionCardProps) {
  return (
    <div className="group flex flex-1 items-center gap-3">
      <button
        type="button"
        aria-pressed={checked}
        aria-disabled={disabled}
        onClick={onToggle}
        disabled={disabled}
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
          checked ? activeClassName : inactiveClassName
        } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
      >
        <div
          className={`absolute top-0.5 h-4 w-4 rounded-full transition-all ${
            checked ? `left-[18px] ${activeKnobClassName}` : `left-0.5 ${inactiveKnobClassName}`
          }`}
        />
      </button>
      <div>
        <span className={titleClassName}>
          {title}
        </span>
        <p className={descriptionClassName}>{description}</p>
        {note ? <div className="mt-1 text-[12px]">{note}</div> : null}
      </div>
    </div>
  );
}
