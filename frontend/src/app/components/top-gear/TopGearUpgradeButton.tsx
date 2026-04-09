import { ResolvedItem } from '../../lib/types';

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
  if (!item.upgrade && !onCatalystConvert) return null;
  const isMenuOpen = upgradeMenuFor === item.uid;

  return (
    <div className="relative flex shrink-0 items-center gap-0.5">
      {onOptimize && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onOptimize();
          }}
          className="flex h-5 w-5 items-center justify-center rounded text-gray-600 transition-colors hover:bg-white/[0.05] hover:text-gold"
          title="Optimize Gems/Enchants"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 1a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0v-1.5A.75.75 0 018 1zm3.536 2.22a.75.75 0 011.06 0l1.061 1.06a.75.75 0 01-1.06 1.061l-1.061-1.06a.75.75 0 010-1.06zM15 8a.75.75 0 01-.75.75h-1.5a.75.75 0 010-1.5h1.5A.75.75 0 0115 8zm-2.22 3.536a.75.75 0 010 1.06l-1.06 1.061a.75.75 0 11-1.061-1.06l1.06-1.061a.75.75 0 011.061 0zM8 15a.75.75 0 01-.75-.75v-1.5a.75.75 0 011.5 0v1.5A.75.75 0 018 15zm-3.536-2.22a.75.75 0 01-1.06 0l-1.061-1.06a.75.75 0 011.06-1.061l1.061 1.06a.75.75 0 010 1.06zM1 8a.75.75 0 01.75-.75h1.5a.75.75 0 010 1.5h-1.5A.75.75 0 011 8zm2.22-3.536a.75.75 0 010-1.06l1.06-1.061a.75.75 0 011.061 1.06l-1.06 1.061a.75.75 0 01-1.061 0z" />
          </svg>
        </button>
      )}

      {item.upgrade && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onUpgradeClick();
          }}
          className={`flex h-5 w-5 items-center justify-center rounded transition-colors ${
            isMenuOpen
              ? 'bg-gold/20 text-gold'
              : 'text-gray-600 hover:bg-white/[0.05] hover:text-gray-400'
          }`}
          title="Add copy at different upgrade level"
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
          {onCatalystConvert && item.upgrade && <div className="my-1 border-t border-border/50" />}

          {item.upgrade && (
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
                      <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted group-hover:text-white/60">
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
