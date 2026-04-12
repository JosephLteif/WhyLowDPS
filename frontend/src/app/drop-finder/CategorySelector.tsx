import { useMemo } from 'react';
import type { DungeonCategory } from '../lib/types';

interface CategoryTab {
  key: string;
  label: string;
  icon: string;
}

interface CategorySelectorProps {
  category: string;
  onChange: (key: string) => void;
  dungeonCats: { cat: DungeonCategory; instances: unknown[] }[];
}

export default function CategorySelector({
  category,
  onChange,
  dungeonCats,
}: CategorySelectorProps) {
  const tabs = useMemo(() => {
    const result: CategoryTab[] = [
      {
        key: 'raids',
        label: 'Raids',
        icon: 'M8 1l2 4 4.5.7-3.2 3.1.8 4.5L8 11l-4.1 2.3.8-4.5L1.5 5.7 6 5z',
      },
    ];
    for (const dc of dungeonCats) {
      const icon =
        dc.cat.key === 'mplus'
          ? 'M8 1v14M1 8h14M4 4l8 8M12 4l-8 8'
          : 'M2 2h12v12H2zM5 5h6M5 8h6M5 11h3';
      result.push({ key: dc.cat.key, label: dc.cat.label, icon });
    }
    return result;
  }, [dungeonCats]);

  return (
    <div className="grid grid-cols-3 gap-3">
      {tabs.map((cat) => (
        <button
          key={cat.key}
          onClick={() => onChange(cat.key)}
          className={`card min-h-[106px] p-6 text-center transition-all ${category === cat.key ? 'border-gold/50 bg-gold/[0.03]' : 'hover:border-gold/20'}`}
        >
          <div
            className={`mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl border ${
              category === cat.key
                ? 'border-gold/40 bg-gold/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]'
                : 'border-gold/20 bg-gold/[0.10]'
            }`}
          >
            <svg
              className="h-6 w-6 text-gold"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.65"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d={cat.icon} />
            </svg>
          </div>
          <p
            className={`text-[1.05rem] font-semibold leading-tight transition-colors ${
              category === cat.key ? 'text-gold' : 'text-white'
            }`}
          >
            {cat.label}
          </p>
        </button>
      ))}
    </div>
  );
}
