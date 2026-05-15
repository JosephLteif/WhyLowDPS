import { useRef } from 'react';
import { ArrowUp, Repeat, Sparkles } from 'lucide-react';
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
  hasUpgradePath?: boolean;
  onUpgradeClick: () => void;
  onUpgradeSelect: (opt: UpgradeOption) => void;
  onCatalystConvert?: () => void;
  onOptimize?: () => void;
  showOptimizeButton?: boolean;
  optimizeDisabled?: boolean;
  optimizeDisabledReason?: string;
  optimizeTitle?: string;
}

export default function TopGearUpgradeButton({
  item,
  upgradeMenuFor,
  upgradeOptions,
  loadingUpgrades,
  hasUpgradePath = true,
  onUpgradeClick,
  onUpgradeSelect,
  onCatalystConvert,
  onOptimize,
  showOptimizeButton = false,
  optimizeDisabled = false,
  optimizeDisabledReason,
  optimizeTitle = 'Optimize Enchants and Sockets',
}: TopGearUpgradeButtonProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const upgradeMatch = item.upgrade.match(/(\d+)\s*\/\s*(\d+)/);
  const currentLevel = upgradeMatch ? Number.parseInt(upgradeMatch[1], 10) : null;
  const maxLevel = upgradeMatch ? Number.parseInt(upgradeMatch[2], 10) : null;
  const isTrackMaxed =
    currentLevel != null && maxLevel != null && Number.isFinite(currentLevel) && Number.isFinite(maxLevel)
      ? currentLevel >= maxLevel
      : false;
  const hasTrackUpgrade = !!upgradeMatch && !isTrackMaxed && hasUpgradePath;
  const showActionMenuButton = hasTrackUpgrade || !!onCatalystConvert;
  const showOptimizeAction = showOptimizeButton || !!onOptimize || optimizeDisabled;
  const canRender = showActionMenuButton || showOptimizeAction;
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
          : 'border-border bg-surface-2/80';

  const optimizeButton = showOptimizeAction ? (
    <button
      type="button"
      disabled={optimizeDisabled || !onOptimize}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        if (optimizeDisabled || !onOptimize) return;
        onOptimize();
      }}
      className={`flex h-6 w-6 items-center justify-center rounded-md border transition-colors ${
        optimizeDisabled || !onOptimize
          ? 'cursor-not-allowed border-border bg-surface-2/70 text-zinc-500'
          : 'border-border bg-gradient-to-br from-emerald-500/25 via-amber-400/25 to-fuchsia-500/25 text-amber-100 hover:from-emerald-500/35 hover:via-amber-400/35 hover:to-fuchsia-500/35'
      }`}
      title={optimizeDisabled ? optimizeDisabledReason || optimizeTitle : optimizeTitle}
    >
      <Sparkles className="h-4 w-4" strokeWidth={2} />
    </button>
  ) : (
    <span aria-hidden="true" className="h-6 w-6 shrink-0 opacity-0" />
  );

  const actionMenuButton = showActionMenuButton ? (
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
      title={hasTrackUpgrade ? `Upgrade Track: ${track}` : 'Item Actions'}
    >
      <ArrowUp className="h-3 w-3" strokeWidth={2} />
    </button>
  ) : (
    <span aria-hidden="true" className="h-6 w-6 shrink-0 opacity-0" />
  );

  return (
    <div ref={rootRef} className="relative flex min-w-[3.5rem] shrink-0 items-center justify-end gap-1">
      {showActionMenuButton ? (
        <>
          {optimizeButton}
          {actionMenuButton}
        </>
      ) : (
        <>
          <span aria-hidden="true" className="h-6 w-6 shrink-0 opacity-0" />
          {optimizeButton}
        </>
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
              <Repeat className="h-3 w-3 shrink-0" strokeWidth={2} />
              Convert to Catalyst
            </button>
          )}
          {onCatalystConvert && hasTrackUpgrade && <div className="my-1 border-t border-border/50" />}

          {hasTrackUpgrade && (
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
