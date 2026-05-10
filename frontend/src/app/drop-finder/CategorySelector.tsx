import { useMemo } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Crosshair, Map, Swords } from 'lucide-react';
import type { DungeonCategory } from '../lib/types';

interface CategoryTab {
  key: string;
  label: string;
  icon: LucideIcon;
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
        icon: Swords,
      },
    ];
    for (const dc of dungeonCats) {
      const icon = dc.cat.key === 'mplus' ? Crosshair : Map;
      result.push({ key: dc.cat.key, label: dc.cat.label, icon });
    }
    return result;
  }, [dungeonCats]);

  return (
    <div className="grid grid-cols-3 gap-3">
      {tabs.map((cat) => (
        (() => {
          const Icon = cat.icon;
          return (
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
            <Icon className="h-6 w-6 text-gold" strokeWidth={1.65} />
          </div>
          <p
            className={`text-[1.05rem] font-semibold leading-tight transition-colors ${
              category === cat.key ? 'text-gold' : 'text-white'
            }`}
          >
            {cat.label}
          </p>
        </button>
          );
        })()
      ))}
    </div>
  );
}
