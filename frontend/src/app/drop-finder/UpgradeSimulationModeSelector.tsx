import { useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useDismissOnOutside } from '../lib/useDismissOnOutside';

export type UpgradeSimulationMode = 'current' | 'highest' | 'both';

export const UPGRADE_SIMULATION_MODE_OPTIONS: Array<{
  value: UpgradeSimulationMode;
  label: string;
  desc: string;
}> = [
  {
    value: 'current',
    label: 'Current only',
    desc: 'Sim drops at the selected difficulty level only.',
  },
  {
    value: 'highest',
    label: 'Highest only',
    desc: 'Sim drops at the max level of the selected track.',
  },
  {
    value: 'both',
    label: 'Current + Highest',
    desc: 'Sim both current and max-track versions together.',
  },
];

export default function UpgradeSimulationModeSelector({
  value,
  onChange,
  showDescription = true,
}: {
  value: UpgradeSimulationMode;
  onChange: (value: UpgradeSimulationMode) => void;
  showDescription?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const activeMode = UPGRADE_SIMULATION_MODE_OPTIONS.find((mode) => mode.value === value);
  const activeLabel = activeMode?.label ?? 'Current only';
  const activeDescription = activeMode?.desc ?? '';

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
          <ChevronDown
            className={`h-4 w-4 text-zinc-300 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
            strokeWidth={2}
          />
        </button>
        {open && (
          <div className="absolute z-50 mt-1 max-h-72 w-full overflow-y-auto overflow-x-hidden rounded-lg border border-border bg-surface-2 py-1 shadow-lg shadow-black/40">
            {UPGRADE_SIMULATION_MODE_OPTIONS.map((mode) => (
              <button
                key={mode.value}
                type="button"
                onMouseDown={() => {
                  onChange(mode.value);
                  setOpen(false);
                }}
                className={`flex w-full flex-col px-3.5 py-2 text-left transition-colors ${
                  mode.value === value
                    ? 'bg-gold/[0.08] text-gold'
                    : 'text-zinc-200 hover:bg-white/[0.04] hover:text-white'
                }`}
              >
                <span className="text-[15px]">{mode.label}</span>
                <span
                  className={`mt-0.5 text-[13px] ${
                    mode.value === value ? 'text-gold/90' : 'text-zinc-300'
                  }`}
                >
                  {mode.desc}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      {showDescription && activeDescription && <p className="text-[13px] text-zinc-300">{activeDescription}</p>}
    </div>
  );
}
