import { DifficultyDef } from '../../lib/types';

interface AddItemDifficultyToggleProps {
  difficulties: DifficultyDef[];
  selectedDifficulty: string;
  onSelect: (key: string) => void;
}

export default function AddItemDifficultyToggle({
  difficulties,
  selectedDifficulty,
  onSelect,
}: AddItemDifficultyToggleProps) {
  return (
    <div className="flex shrink-0 items-center gap-3">
      <span className="hidden text-[9px] font-black uppercase tracking-widest text-slate-600 xl:block">
        Difficulty
      </span>
      <div className="flex gap-0.5 rounded-xl border border-white/5 bg-black/40 p-0.5">
        {difficulties.map((d) => {
          const isSelected = selectedDifficulty === d.key;
          const colorClass = d.key.includes('lfr')
            ? 'text-green-400'
            : d.key.includes('normal')
              ? 'text-blue-400'
              : d.key.includes('heroic')
                ? 'text-purple-400'
                : d.key.includes('mythic')
                  ? 'text-orange-400'
                  : 'text-slate-400';

          const activeBg = d.key.includes('lfr')
            ? 'bg-green-500/20 border-green-500/20'
            : d.key.includes('normal')
              ? 'bg-blue-500/20 border-blue-500/20'
              : d.key.includes('heroic')
                ? 'bg-purple-500/20 border-purple-500/20'
                : d.key.includes('mythic')
                  ? 'bg-orange-500/20 border-orange-500/20'
                  : 'bg-white/10 border-white/10';

          return (
            <button
              key={d.key}
              onClick={() => onSelect(d.key)}
              className={`rounded-lg border px-3 py-1 text-[9px] font-black uppercase tracking-wider transition-all ${
                isSelected
                  ? `${activeBg} ${colorClass} border-white/10`
                  : 'border-transparent text-slate-600 hover:bg-white/5 hover:text-slate-400'
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
