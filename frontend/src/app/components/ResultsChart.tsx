'use client';

import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { useSpellIcons } from '../lib/useWowheadIcons';
import { useWowheadTooltips } from '../lib/useWowheadTooltips';

interface Ability {
  name: string;
  portion_dps: number;
  school: string;
  spell_id?: number;
  children?: Ability[];
}

interface ResultsChartProps {
  dps: number;
  abilities: Ability[];
}

function SpellIcon({ icon }: { icon: string }) {
  return (
    <img
      src={`https://wow.zamimg.com/images/wow/icons/small/${icon}.jpg`}
      alt=""
      className="h-5 w-5 shrink-0 rounded-[3px]"
    />
  );
}

// Hardcoded icons for abilities that lack a spell_id (e.g. auto_attack id=0)
const FALLBACK_ICONS: Record<string, string> = {
  auto_attack: 'inv_sword_04',
};
const DEFAULT_FALLBACK_ICON = 'inv_misc_questionmark';

const SCHOOL_COLORS: Record<string, string> = {
  physical: '#D4A843',
  holy: '#F5E6A3',
  fire: '#EF6461',
  nature: '#6BCB77',
  frost: '#6CB4EE',
  shadow: '#B07CD8',
  arcane: '#E88AED',
};

export default function ResultsChart({ dps, abilities }: ResultsChartProps) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const safeAbilities = (Array.isArray(abilities) ? abilities : []).filter(
    (a) => a && Number.isFinite(Number(a.portion_dps))
  );
  const totalDps = dps || safeAbilities.reduce((s, a) => s + Number(a.portion_dps || 0), 0);
  const top = safeAbilities.slice(0, 15);
  const maxDps = top.length > 0 ? top[0].portion_dps : 1;
  const spellIds = top.flatMap((a) => [
    a.spell_id || 0,
    ...(a.children?.map((c) => c.spell_id || 0) ?? []),
  ]);
  const tooltipDepKey = spellIds
    .filter((id) => Number.isFinite(id) && id > 0)
    .sort((a, b) => a - b)
    .join(',');
  const icons = useSpellIcons(spellIds);
  useWowheadTooltips([tooltipDepKey]);

  return (
    <div className="card p-5">
      <h3 className="mb-4 text-sm font-medium uppercase tracking-widest text-muted">
        Damage Breakdown
      </h3>
      <div className="space-y-1">
        {top.map((a, i) => {
          const color = SCHOOL_COLORS[a.school] || SCHOOL_COLORS.physical;
          const pct = totalDps > 0 ? (a.portion_dps / totalDps) * 100 : 0;
          const barWidth = maxDps > 0 ? (a.portion_dps / maxDps) * 100 : 0;
          const name = a.name.replace(/_/g, ' ');
          const hasChildren = a.children && a.children.length > 0;
          const isOpen = expanded.has(i);

          return (
            <div key={i}>
              <div
                className={`group relative flex h-8 items-center pr-3 ${hasChildren ? 'cursor-pointer' : ''}`}
                onClick={
                  hasChildren
                    ? () =>
                        setExpanded((prev) => {
                          const next = new Set(prev);
                          if (next.has(i)) next.delete(i);
                          else next.add(i);
                          return next;
                        })
                    : undefined
                }
              >
                <div
                  className="absolute inset-y-0 left-0 rounded-r opacity-[0.08] transition-opacity group-hover:opacity-[0.14]"
                  style={{ width: `${barWidth}%`, backgroundColor: color }}
                />
                <div
                  className="absolute bottom-1 left-0 top-1 w-[3px] rounded-full"
                  style={{ backgroundColor: color, opacity: 0.6 }}
                />
                <span className="relative flex flex-1 items-center gap-2 truncate pl-3 text-sm text-zinc-200">
                  {hasChildren && (
                    <ChevronRight
                      className={`h-3.5 w-3.5 shrink-0 text-gray-400 transition-transform duration-150 ${isOpen ? 'rotate-90' : ''}`}
                      strokeWidth={2}
                    />
                  )}
                  <a
                    href={a.spell_id ? `https://www.wowhead.com/spell=${a.spell_id}` : '#'}
                    data-wowhead={a.spell_id ? `spell=${a.spell_id}` : undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.preventDefault()}
                    className="inline-flex items-center gap-2 min-w-0"
                  >
                    <SpellIcon
                      icon={
                        (a.spell_id && icons.get(a.spell_id)) ||
                        FALLBACK_ICONS[a.name.toLowerCase()] ||
                        DEFAULT_FALLBACK_ICON
                      }
                    />
                    <span className="truncate">{name}</span>
                  </a>
                </span>
                <span className="relative w-16 shrink-0 text-right font-mono text-sm tabular-nums text-zinc-100">
                  {Math.round(a.portion_dps).toLocaleString()}
                </span>
                <span className="relative w-12 shrink-0 text-right font-mono text-sm tabular-nums text-zinc-100">
                  {pct.toFixed(1)}%
                </span>
              </div>
              {isOpen &&
                a.children?.slice(0, 40).map((child, ci) => {
                  const childColor = SCHOOL_COLORS[child.school] || SCHOOL_COLORS.physical;
                  const childPct = totalDps > 0 ? (child.portion_dps / totalDps) * 100 : 0;
                  const childName = child.name.replace(/_/g, ' ');
                  return (
                    <div key={ci} className="group relative flex h-7 items-center pr-3">
                      <div
                        className="absolute bottom-0.5 top-0.5 w-[2px] rounded-full"
                        style={{
                          left: '13px',
                          backgroundColor: childColor,
                          opacity: 0.3,
                        }}
                      />
                      <span className="relative flex flex-1 items-center gap-2 truncate pl-10 text-sm text-zinc-200">
                        <a
                          href={child.spell_id ? `https://www.wowhead.com/spell=${child.spell_id}` : '#'}
                          data-wowhead={child.spell_id ? `spell=${child.spell_id}` : undefined}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.preventDefault()}
                          className="inline-flex items-center gap-2 min-w-0"
                        >
                          <SpellIcon
                            icon={
                              (child.spell_id && icons.get(child.spell_id)) ||
                              FALLBACK_ICONS[child.name.toLowerCase()] ||
                              DEFAULT_FALLBACK_ICON
                            }
                          />
                          <span className="truncate">{childName}</span>
                        </a>
                      </span>
                      <span className="relative w-16 shrink-0 text-right font-mono text-sm tabular-nums text-zinc-300">
                        {Math.round(child.portion_dps).toLocaleString()}
                      </span>
                      <span className="relative w-12 shrink-0 text-right font-mono text-sm tabular-nums text-zinc-300">
                        {childPct.toFixed(1)}%
                      </span>
                    </div>
                  );
                })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
