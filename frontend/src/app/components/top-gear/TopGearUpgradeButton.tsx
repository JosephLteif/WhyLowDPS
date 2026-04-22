import { useRef } from 'react';
import { ResolvedItem } from '../../lib/types';
import { useDismissOnOutside } from '../../lib/useDismissOnOutside';

interface UpgradeOption {
  bonus_id: number;
  level: number;
  max: number;
  name: string;
  fullName: string;
  itemLevel: number;
}

interface TopGearUpgradeButtonProps {
  item: ResolvedItem;
  upgradeMenuFor: string | null;
  upgradeOptions: UpgradeOption[];
  loadingUpgrades: boolean;
  onUpgradeClick: () => void;
  onUpgradeSelect: (opt: UpgradeOption) => void;
  onCatalystConvert?: () => void;
  onOptimize?: () => void;
}

export default function TopGearUpgradeButton({
  item,
  upgradeMenuFor,
  upgradeOptions,
  loadingUpgrades,
  onUpgradeClick,
  onUpgradeSelect,
  onCatalystConvert,
  onOptimize,
}: TopGearUpgradeButtonProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const upgradeMatch = item.upgrade.match(/(\d+)\s*\/\s*(\d+)/);
  const currentLevel = upgradeMatch ? Number.parseInt(upgradeMatch[1], 10) : null;
  const maxLevel = upgradeMatch ? Number.parseInt(upgradeMatch[2], 10) : null;
  const isTrackMaxed =
    currentLevel != null && maxLevel != null && Number.isFinite(currentLevel) && Number.isFinite(maxLevel)
      ? currentLevel >= maxLevel
      : false;
  const showUpgradeButton = !!item.upgrade && !isTrackMaxed;
  const canRender = showUpgradeButton || !!onCatalystConvert || !!onOptimize;
  const isMenuOpen = upgradeMenuFor === item.uid;
  useDismissOnOutside(rootRef, isMenuOpen, () => {
    onUpgradeClick();
  });
  if (!canRender) return null;
  const upgradeLower = item.upgrade.toLowerCase();
  const track = upgradeLower.includes('champion')
    ? 'Champion'
    : upgradeLower.includes('myth')
      ? 'Mythic'
      : upgradeLower.includes('hero')
        ? 'Heroic'
        : upgradeLower.includes('crafted')
          ? 'Crafted'
          : 'Unknown';
  const trackColorClass =
    track === 'Champion'
      ? 'text-emerald-300'
      : track === 'Mythic'
        ? 'text-purple-300'
        : track === 'Heroic'
          ? 'text-sky-300'
          : 'text-zinc-400';
  const trackBgClass =
    track === 'Champion'
      ? 'border-emerald-400/40 bg-emerald-500/10'
      : track === 'Mythic'
        ? 'border-purple-400/40 bg-purple-500/10'
        : track === 'Heroic'
          ? 'border-sky-400/40 bg-sky-500/10'
          : 'border-white/10 bg-white/[0.03]';

  return (
    <div ref={rootRef} className="relative flex shrink-0 items-center gap-1">
      {onOptimize && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onOptimize();
          }}
          className="flex h-6 w-6 items-center justify-center rounded-md border border-white/10 bg-gradient-to-br from-emerald-500/30 via-amber-400/30 to-fuchsia-500/30 text-amber-100 transition-colors hover:from-emerald-500/40 hover:via-amber-400/40 hover:to-fuchsia-500/40"
          title="Optimize Enchants and Sockets"
        >
          <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 1a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0v-1.5A.75.75 0 018 1zm3.536 2.22a.75.75 0 011.06 0l1.061 1.06a.75.75 0 01-1.06 1.061l-1.061-1.06a.75.75 0 010-1.06zM15 8a.75.75 0 01-.75.75h-1.5a.75.75 0 010-1.5h1.5A.75.75 0 0115 8zm-2.22 3.536a.75.75 0 010 1.06l-1.06 1.061a.75.75 0 11-1.061-1.06l1.06-1.061a.75.75 0 011.061 0zM8 15a.75.75 0 01-.75-.75v-1.5a.75.75 0 011.5 0v1.5A.75.75 0 018 15zm-3.536-2.22a.75.75 0 01-1.06 0l-1.061-1.06a.75.75 0 011.06-1.061l1.061 1.06a.75.75 0 010 1.06zM1 8a.75.75 0 01.75-.75h1.5a.75.75 0 010 1.5h-1.5A.75.75 0 011 8zm2.22-3.536a.75.75 0 010-1.06l1.06-1.061a.75.75 0 011.061 1.06l-1.06 1.061a.75.75 0 01-1.061 0z" />
          </svg>
        </button>
      )}

      {showUpgradeButton && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onUpgradeClick();
          }}
          className={`flex h-6 w-6 items-center justify-center rounded-md border transition-colors ${
            isMenuOpen
              ? 'border-gold/50 bg-gold/20 text-gold'
              : `${trackBgClass} ${trackColorClass} hover:brightness-110`
          }`}
          title={`Upgrade Track: ${track}`}
        >
          <svg
            className="h-3 w-3"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M8 12V4M5 7l3-3 3 3" />
          </svg>
        </button>
      )}

      {isMenuOpen && (
        <div className="absolute right-0 top-full z-50 mt-1 min-w-[200px] rounded-lg border border-border bg-surface py-1 shadow-2xl backdrop-blur-md">
          {onCatalystConvert && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onCatalystConvert();
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-purple-300 hover:bg-purple-500/10 hover:text-purple-200"
            >
              <svg className="h-3 w-3 shrink-0" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 1a1 1 0 011 1v2.07A5.001 5.001 0 0113 9a5 5 0 01-10 0 5.001 5.001 0 014-4.93V2a1 1 0 011-1zm0 5a3 3 0 100 6 3 3 0 000-6z" />
              </svg>
              Convert to Catalyst
            </button>
          )}
          {onCatalystConvert && showUpgradeButton && <div className="my-1 border-t border-border/50" />}

          {showUpgradeButton && (
            <div className="max-h-[300px] overflow-y-auto">
              {loadingUpgrades ? (
                <div className="px-3 py-2 text-xs italic text-muted">Loading options...</div>
              ) : upgradeOptions.length === 0 ? (
                <div className="px-3 py-2 text-xs italic text-muted">No upgrade paths found</div>
              ) : (
                upgradeOptions.map((opt) => {
                  const isCurrent = item.bonus_ids.includes(opt.bonus_id);
                  return (
                    <button
                      key={opt.bonus_id}
                      type="button"
                      disabled={isCurrent}
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        onUpgradeSelect(opt);
                      }}
                      className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs ${
                        isCurrent
                          ? 'cursor-default bg-white/5 opacity-40'
                          : 'text-gray-300 hover:bg-white/[0.08] hover:text-white'
                      }`}
                    >
                      <span className="truncate">{opt.fullName}</span>
                      <span className="shrink-0 font-mono text-[14px] font-semibold tabular-nums text-zinc-300 group-hover:text-zinc-100">
                        {opt.itemLevel}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
