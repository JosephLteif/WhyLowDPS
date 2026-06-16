'use client';

import { useEffect, useState } from 'react';

interface RaidBuffEntry {
  id: string;
  label: string;
  sourceLabel?: string;
  sourceDescription?: string;
  disabled?: boolean;
  spellId: number;
  icon: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

interface RaidBuffGridProps {
  entries: RaidBuffEntry[];
  onSelectAll?: () => void;
  onClear?: () => void;
}

const SPELL_ICON_CACHE = new Map<number, string>();
const SOURCE_TOOLTIPS: Record<string, string> = {
  override: 'Present in the SimC input the user provided.',
  manual: 'Set manually by the user.',
  default: 'Taken from the default settings.',
};

function useSpellIcons(spellIds: number[]) {
  const [icons, setIcons] = useState<Map<number, string>>(new Map());
  const depKey = spellIds.join(',');

  useEffect(() => {
    const missing = spellIds.filter((id) => id > 0 && !SPELL_ICON_CACHE.has(id));
    if (missing.length === 0) {
      setIcons(new Map(SPELL_ICON_CACHE));
      return;
    }

    let cancelled = false;
    Promise.all(
      missing.map(async (id) => {
        try {
          const res = await fetch(`https://nether.wowhead.com/tooltip/spell/${id}?dataEnv=1&locale=0`);
          if (!res.ok) return;
          const data = await res.json();
          if (data?.icon) SPELL_ICON_CACHE.set(id, data.icon);
        } catch {
          // Ignore fetch failures and keep fallback icon.
        }
      })
    ).then(() => {
      if (!cancelled) setIcons(new Map(SPELL_ICON_CACHE));
    });

    return () => {
      cancelled = true;
    };
  }, [depKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return icons;
}

export default function RaidBuffGrid({ entries, onSelectAll, onClear }: RaidBuffGridProps) {
  const spellIcons = useSpellIcons(entries.map((entry) => entry.spellId || 0));

  return (
    <div className="space-y-3">
      {(onSelectAll || onClear) && (
        <div className="flex items-center justify-end gap-2">
          {onSelectAll && (
            <button
              type="button"
              onClick={onSelectAll}
              className="h-7 rounded-md border border-amber-300/40 bg-amber-500/14 px-2.5 text-[11px] font-semibold text-amber-300 transition-colors hover:bg-amber-500/24 hover:text-amber-200"
            >
              All
            </button>
          )}
          {onClear && (
            <button
              type="button"
              onClick={onClear}
              className="h-7 rounded-md border border-zinc-600/80 bg-zinc-800/55 px-2.5 text-[11px] font-semibold text-zinc-200 transition-colors hover:border-zinc-500 hover:bg-zinc-700/65"
            >
              Clear
            </button>
          )}
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {entries.map((entry) => (
          <label
            key={entry.id}
            className={`flex items-center justify-between gap-2 rounded-md border px-2.5 py-2 transition-colors ${
              entry.checked ? 'border-gold/40 bg-gold/[0.08]' : 'border-border bg-surface hover:border-zinc-600'
            }`}
          >
            <a
              href={`https://www.wowhead.com/spell=${entry.spellId}`}
              target="_blank"
              rel="noreferrer"
              data-wowhead={`spell=${entry.spellId}`}
              className="flex min-w-0 items-center gap-2 text-zinc-100 hover:text-white"
              onClick={(e) => e.stopPropagation()}
            >
              <img
                src={`https://wow.zamimg.com/images/wow/icons/small/${spellIcons.get(entry.spellId) || entry.icon}.jpg`}
                onError={(e) => {
                  const img = e.currentTarget;
                  if (img.dataset.fallbackApplied === '1') return;
                  img.dataset.fallbackApplied = '1';
                  img.src = `https://wow.zamimg.com/images/wow/icons/small/${entry.icon}.jpg`;
                }}
                alt=""
                className="h-[22px] w-[22px] shrink-0 rounded-[4px]"
              />
              <span className="truncate text-[14px]">{entry.label}</span>
              {entry.sourceLabel && (
                <span
                  className="shrink-0 rounded border border-zinc-600/70 bg-zinc-800/70 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-300"
                  title={entry.sourceDescription || SOURCE_TOOLTIPS[entry.sourceLabel] || entry.sourceLabel}
                >
                  {entry.sourceLabel}
                </span>
              )}
            </a>
            <input
              type="checkbox"
              checked={entry.checked}
              onChange={(e) => entry.onChange(e.target.checked)}
              disabled={entry.disabled}
              className="h-4 w-4 accent-gold"
            />
          </label>
        ))}
      </div>
    </div>
  );
}
