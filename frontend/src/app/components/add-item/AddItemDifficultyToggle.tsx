import { DifficultyDef } from '../../lib/types';

interface AddItemDifficultyToggleProps {
  difficulties: DifficultyDef[];
  selectedDifficulty: string;
  onSelect: (key: string) => void;
  label?: string;
}

export default function AddItemDifficultyToggle({
  difficulties,
  selectedDifficulty,
  onSelect,
  label = 'Difficulty',
}: AddItemDifficultyToggleProps) {
  return (
    <div className="flex shrink-0 items-center gap-2.5">
      <span className="hidden text-[9px] font-black uppercase tracking-widest text-white xl:block">
        {label}
      </span>
      <div className="flex gap-0.5 rounded-lg border border-border bg-surface-2 p-0.5">
        {difficulties.map((d) => {
          const isSelected = selectedDifficulty === d.key;

          return (
            <button
              key={d.key}
              onClick={() => onSelect(d.key)}
              className={`rounded-md border px-3 py-1.5 text-[10px] font-black uppercase tracking-wider transition-all ${
                isSelected
                  ? 'bg-gold text-black shadow-sm border-transparent'
                  : 'border-transparent text-zinc-300 hover:bg-white/5 hover:text-white'
              }`}
            >
              {d.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
