import { useEffect, useMemo, useRef, useState } from 'react';
import type { ResolvedItem } from '../../lib/types';
import { useDismissOnOutside } from '../../lib/useDismissOnOutside';

interface UpgradeOption {
  bonus_id: number;
  level: number;
  max: number;
  name: string;
  fullName: string;
  itemLevel: number;
}

interface TopGearItemContextMenuProps {
  item: ResolvedItem | null;
  x: number;
  y: number;
  canAddEnchant: boolean;
  canAddGem: boolean;
  otherTierOptions: UpgradeOption[];
  loadingOtherTierOptions: boolean;
  upgradeOptions: UpgradeOption[];
  loadingUpgrades: boolean;
  onClose: () => void;
  onLoadUpgradeOptions: (item: ResolvedItem) => Promise<void> | void;
  onLoadOtherTierOptions: () => Promise<void> | void;
  onUpgradeSelect: (item: ResolvedItem, option: UpgradeOption) => void;
  onApplyOtherTier: (item: ResolvedItem, option: UpgradeOption) => void;
  onCatalystConvert: (item: ResolvedItem) => void;
  onOptimize: (item: ResolvedItem) => void;
  onSetOrigin: (item: ResolvedItem, origin: 'bags' | 'vault') => void;
  onSetWishlist: (item: ResolvedItem, enabled: boolean) => void;
  onSetAscendant: (item: ResolvedItem, enabled: boolean) => void;
}

type SubmenuKey = 'upgrade' | 'tier' | 'enchant' | 'gem' | 'tags' | null;
type NestedSubmenuKey = 'origin' | null;

function isWishlist(item: ResolvedItem): boolean {
  const sourceType = String(item.source_type || '').toLowerCase();
  const tag = String(item.tag || '').toLowerCase();
  return sourceType.includes('wishlist') || tag.includes('wishlist');
}

function hasModifierItemId(sourceType: string | undefined, itemId: number): boolean {
  const src = String(sourceType || '');
  const re = new RegExp(`(?:^|\\s)mod:${itemId}(?=\\s|$)`, 'i');
  return re.test(src);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

function getSubmenuPosition(
  parentLeft: number,
  parentTop: number,
  parentWidth: number,
  anchorOffsetTop: number,
  panelWidth: number,
  panelHeight: number,
  preferredSide: 'auto' | 'left' | 'right' = 'auto'
): { left: number; top: number } {
  const margin = 8;
  const viewportW = typeof window !== 'undefined' ? window.innerWidth : 1920;
  const viewportH = typeof window !== 'undefined' ? window.innerHeight : 1080;

  const canOpenRight = parentLeft + parentWidth + 8 + panelWidth <= viewportW - margin;
  const canOpenLeft = parentLeft - panelWidth - 8 >= margin;

  let openRight: boolean;
  if (preferredSide === 'right') {
    openRight = canOpenRight || !canOpenLeft;
  } else if (preferredSide === 'left') {
    openRight = !(canOpenLeft || !canOpenRight);
  } else {
    openRight = canOpenRight || !canOpenLeft;
  }

  const left = openRight
    ? clamp(parentLeft + parentWidth + 8, margin, viewportW - panelWidth - margin)
    : clamp(parentLeft - panelWidth - 8, margin, viewportW - panelWidth - margin);
  const top = clamp(parentTop + anchorOffsetTop, margin, viewportH - panelHeight - margin);

  return { left, top };
}

export default function TopGearItemContextMenu({
  item,
  x,
  y,
  canAddEnchant,
  canAddGem,
  otherTierOptions,
  loadingOtherTierOptions,
  upgradeOptions,
  loadingUpgrades,
  onClose,
  onLoadUpgradeOptions,
  onLoadOtherTierOptions,
  onUpgradeSelect,
  onApplyOtherTier,
  onCatalystConvert,
  onOptimize,
  onSetOrigin,
  onSetWishlist,
  onSetAscendant,
}: TopGearItemContextMenuProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [activeSubmenu, setActiveSubmenu] = useState<SubmenuKey>(null);
  const [activeNestedSubmenu, setActiveNestedSubmenu] = useState<NestedSubmenuKey>(null);
  const [activeTierGroup, setActiveTierGroup] = useState<string | null>(null);
  const [upgradeLoadedForUid, setUpgradeLoadedForUid] = useState<string | null>(null);

  useDismissOnOutside(rootRef, !!item, onClose);

  useEffect(() => {
    if (!item) return;
    setActiveSubmenu(null);
    setActiveNestedSubmenu(null);
    setActiveTierGroup(null);
    setUpgradeLoadedForUid(null);
  }, [item]);

  useEffect(() => {
    if (!item) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [item, onClose]);

  const menuPos = useMemo(() => {
    const margin = 8;
    const menuWidth = 240;
    const menuHeight = 300;
    const maxX = typeof window !== 'undefined' ? window.innerWidth - menuWidth - margin : x;
    const maxY = typeof window !== 'undefined' ? window.innerHeight - menuHeight - margin : y;
    return {
      left: Math.max(margin, Math.min(x, maxX)),
      top: Math.max(margin, Math.min(y, maxY)),
    };
  }, [x, y]);

  const groupedTierOptions = useMemo(() => {
    const groups: Record<string, UpgradeOption[]> = {};
    for (const option of otherTierOptions) {
      const group = option.name || 'Other';
      if (!groups[group]) groups[group] = [];
      groups[group].push(option);
    }
    for (const key of Object.keys(groups)) {
      groups[key].sort((a, b) => a.level - b.level || a.itemLevel - b.itemLevel);
    }
    return groups;
  }, [otherTierOptions]);
  const tierGroupNames = useMemo(() => Object.keys(groupedTierOptions), [groupedTierOptions]);

  if (!item) return null;

  const wishlist = isWishlist(item);
  const canMarkOrigin = item.origin !== 'equipped';
  const canUpgrade = !!item.upgrade;
  const canCatalyst = !!item.can_catalyst;
  const isAscendantApplied =
    hasModifierItemId(item.source_type, 268552) ||
    String(item.source_type || '').toLowerCase().includes('ascendant_voidcore') ||
    String(item.tag || '').toLowerCase().includes('ascendant');

  const openUpgradeSubmenu = async () => {
    setActiveSubmenu('upgrade');
    if (!canUpgrade || upgradeLoadedForUid === item.uid) return;
    await onLoadUpgradeOptions(item);
    setUpgradeLoadedForUid(item.uid);
  };
  const openTierSubmenu = async () => {
    setActiveSubmenu('tier');
    setActiveNestedSubmenu(null);
    await onLoadOtherTierOptions();
  };

  const Action = ({
    label,
    onClick,
    danger,
    disabled,
  }: {
    label: string;
    onClick: () => void;
    danger?: boolean;
    disabled?: boolean;
  }) => (
    <button
      type="button"
      disabled={disabled}
      onMouseEnter={() => {
        setActiveSubmenu(null);
        setActiveNestedSubmenu(null);
        setActiveTierGroup(null);
      }}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        if (disabled) return;
        onClick();
      }}
      className={`w-full px-3 py-2 text-left text-xs transition-colors ${
        disabled
          ? 'cursor-not-allowed text-zinc-500'
          : danger
            ? 'text-rose-300 hover:bg-rose-500/10'
            : 'text-zinc-200 hover:bg-white/[0.07]'
      }`}
    >
      {label}
    </button>
  );

  const ParentAction = ({
    label,
    submenu,
    onOpen,
    disabled,
  }: {
    label: string;
    submenu: SubmenuKey;
    onOpen?: () => void;
    disabled?: boolean;
  }) => (
    <button
      type="button"
      disabled={disabled}
      onMouseEnter={() => {
        if (disabled) return;
        setActiveSubmenu(submenu);
        if (submenu !== 'tags') setActiveNestedSubmenu(null);
        if (submenu !== 'tier') setActiveTierGroup(null);
        onOpen?.();
      }}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        if (disabled) return;
        setActiveSubmenu(submenu);
        if (submenu !== 'tags') setActiveNestedSubmenu(null);
        if (submenu !== 'tier') setActiveTierGroup(null);
        onOpen?.();
      }}
      className={`flex w-full items-center justify-between px-3 py-2 text-left text-xs transition-colors ${
        disabled
          ? 'cursor-not-allowed text-zinc-500'
          : 'text-zinc-200 hover:bg-white/[0.07]'
      }`}
    >
      <span>{label}</span>
      <span className="text-zinc-500">{'>'}</span>
    </button>
  );

  const mainWidth = 240;
  const itemRow = 32;
  const upgradePos = getSubmenuPosition(
    menuPos.left,
    menuPos.top,
    mainWidth,
    itemRow * 1,
    270,
    320
  );
  const enchantPos = getSubmenuPosition(
    menuPos.left,
    menuPos.top,
    mainWidth,
    itemRow * 3,
    220,
    80
  );
  const gemPos = getSubmenuPosition(
    menuPos.left,
    menuPos.top,
    mainWidth,
    itemRow * 4,
    220,
    80
  );
  const tagsPos = getSubmenuPosition(
    menuPos.left,
    menuPos.top,
    mainWidth,
    itemRow * 5,
    240,
    120
  );
  const tierPos = getSubmenuPosition(menuPos.left, menuPos.top, mainWidth, itemRow * 2, 280, 360);
  const tagsOpensRight = tagsPos.left > menuPos.left;
  const originPos = getSubmenuPosition(
    tagsPos.left,
    tagsPos.top,
    240,
    28,
    200,
    96,
    tagsOpensRight ? 'right' : 'left'
  );
  const tierGroupPos = getSubmenuPosition(
    tierPos.left,
    tierPos.top,
    280,
    0,
    280,
    360,
    tierPos.left > menuPos.left ? 'right' : 'left'
  );

  return (
    <div ref={rootRef} className="fixed inset-0 z-[120] pointer-events-none">
      <div
        className="fixed min-w-[240px] pointer-events-auto rounded-lg border border-border bg-surface py-1 shadow-2xl"
        style={{ left: menuPos.left, top: menuPos.top }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        <div className="border-b border-border/60 px-3 py-2 text-[10px] uppercase tracking-widest text-zinc-500">
          Item Actions
        </div>

        <ParentAction
          label="Upgrade iLvl"
          submenu="upgrade"
          onOpen={openUpgradeSubmenu}
          disabled={!canUpgrade}
        />
        <ParentAction label="Set Tier / iLvl" submenu="tier" onOpen={openTierSubmenu} />
        {canAddEnchant && <ParentAction label="Add Enchant" submenu="enchant" />}
        {canAddGem && <ParentAction label="Add Gem" submenu="gem" />}
        <ParentAction label="Source & Tags" submenu="tags" />

        {canCatalyst && (
          <Action
            label="Convert To Catalyst"
            onClick={() => {
              onCatalystConvert(item);
              onClose();
            }}
          />
        )}
        <Action
          label={isAscendantApplied ? 'Remove Ascendant Voidcore' : 'Apply Ascendant Voidcore'}
          onClick={() => {
            onSetAscendant(item, !isAscendantApplied);
            onClose();
          }}
        />
        <Action label="Close" onClick={onClose} />
      </div>

      {activeSubmenu === 'upgrade' && (
        <div
          className="fixed z-[121] min-w-[270px] pointer-events-auto rounded-lg border border-border bg-surface py-1 shadow-2xl"
          style={{ left: upgradePos.left, top: upgradePos.top }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          {loadingUpgrades ? (
            <div className="px-3 py-2 text-xs italic text-zinc-400">Loading options...</div>
          ) : upgradeOptions.length === 0 ? (
            <div className="px-3 py-2 text-xs italic text-zinc-400">No upgrade paths found</div>
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
                    if (isCurrent) return;
                    onUpgradeSelect(item, opt);
                    onClose();
                  }}
                  className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs ${
                    isCurrent
                      ? 'cursor-default bg-white/5 text-zinc-500'
                      : 'text-zinc-200 hover:bg-white/[0.07]'
                  }`}
                >
                  <span className="truncate">{opt.fullName}</span>
                  <span className="shrink-0 font-mono text-[12px] tabular-nums">{opt.itemLevel}</span>
                </button>
              );
            })
          )}
        </div>
      )}

      {activeSubmenu === 'tier' && (
        <div
          className="fixed z-[121] min-w-[280px] pointer-events-auto rounded-lg border border-border bg-surface py-1 shadow-2xl"
          style={{ left: tierPos.left, top: tierPos.top }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onMouseEnter={() => {
            setActiveSubmenu('tier');
            setActiveNestedSubmenu(null);
          }}
        >
          {loadingOtherTierOptions ? (
            <div className="px-3 py-2 text-xs italic text-zinc-400">Loading tier options...</div>
          ) : otherTierOptions.length === 0 ? (
            <div className="px-3 py-2 text-xs italic text-zinc-400">No tier options found</div>
          ) : (
            <div className="max-h-[360px] overflow-y-auto">
              {tierGroupNames.map((groupName) => (
                <button
                  key={`tier-group-${groupName}`}
                  type="button"
                  onMouseEnter={() => {
                    setActiveSubmenu('tier');
                    setActiveTierGroup(groupName);
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    setActiveSubmenu('tier');
                    setActiveTierGroup(groupName);
                  }}
                  className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs ${
                    activeTierGroup === groupName
                      ? 'bg-white/[0.07] text-zinc-100'
                      : 'text-zinc-200 hover:bg-white/[0.07]'
                  }`}
                >
                  <span className="truncate">{groupName}</span>
                  <span className="text-zinc-500">{'>'}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {activeSubmenu === 'tier' && activeTierGroup && groupedTierOptions[activeTierGroup] && (
        <div
          className="fixed z-[122] min-w-[280px] pointer-events-auto rounded-lg border border-border bg-surface py-1 shadow-2xl"
          style={{ left: tierGroupPos.left, top: tierGroupPos.top }}
          onMouseEnter={() => {
            setActiveSubmenu('tier');
          }}
        >
          <div className="border-b border-border/60 px-3 py-2 text-[10px] uppercase tracking-widest text-zinc-500">
            {activeTierGroup}
          </div>
          <div className="max-h-[360px] overflow-y-auto">
            {groupedTierOptions[activeTierGroup].map((opt) => (
              <button
                key={`tier-option-${opt.bonus_id}`}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  onApplyOtherTier(item, opt);
                  onClose();
                }}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs text-zinc-200 hover:bg-white/[0.07]"
              >
                <span className="truncate">
                  {opt.level}/{opt.max}
                </span>
                <span className="shrink-0 font-mono text-[12px] tabular-nums">{opt.itemLevel}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {canAddEnchant && activeSubmenu === 'enchant' && (
        <div
          className="fixed z-[121] min-w-[220px] pointer-events-auto rounded-lg border border-border bg-surface py-1 shadow-2xl"
          style={{ left: enchantPos.left, top: enchantPos.top }}
        >
          <Action
            label="Choose Enchant..."
            onClick={() => {
              onOptimize(item);
              onClose();
            }}
          />
        </div>
      )}

      {canAddGem && activeSubmenu === 'gem' && (
        <div
          className="fixed z-[121] min-w-[220px] pointer-events-auto rounded-lg border border-border bg-surface py-1 shadow-2xl"
          style={{ left: gemPos.left, top: gemPos.top }}
        >
          <Action
            label="Choose Gem..."
            onClick={() => {
              onOptimize(item);
              onClose();
            }}
          />
        </div>
      )}

      {activeSubmenu === 'tags' && (
        <div
          className="fixed z-[121] min-w-[240px] pointer-events-auto rounded-lg border border-border bg-surface py-1 shadow-2xl"
          style={{ left: tagsPos.left, top: tagsPos.top }}
          onMouseEnter={() => setActiveSubmenu('tags')}
        >
          <button
            type="button"
            disabled={!canMarkOrigin}
            onMouseEnter={() => {
              if (!canMarkOrigin) return;
              setActiveSubmenu('tags');
              setActiveNestedSubmenu('origin');
            }}
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              if (!canMarkOrigin) return;
              setActiveSubmenu('tags');
              setActiveNestedSubmenu('origin');
            }}
            className={`flex w-full items-center justify-between px-3 py-2 text-left text-xs transition-colors ${
              !canMarkOrigin
                ? 'cursor-not-allowed text-zinc-500'
                : 'text-zinc-200 hover:bg-white/[0.07]'
            }`}
          >
            <span>Set Origin</span>
            <span className="text-zinc-500">{'>'}</span>
          </button>
          <Action
            label={wishlist ? 'Unmark Wishlist' : 'Mark As Wishlist'}
            onClick={() => {
              onSetWishlist(item, !wishlist);
              onClose();
            }}
          />
        </div>
      )}

      {activeSubmenu === 'tags' && activeNestedSubmenu === 'origin' && (
        <div
          className="fixed z-[122] min-w-[200px] pointer-events-auto rounded-lg border border-border bg-surface py-1 shadow-2xl"
          style={{ left: originPos.left, top: originPos.top }}
          onMouseEnter={() => {
            setActiveSubmenu('tags');
            setActiveNestedSubmenu('origin');
          }}
        >
          <Action
            label="Mark As Vault"
            disabled={!canMarkOrigin || item.origin === 'vault'}
            onClick={() => {
              onSetOrigin(item, 'vault');
              onClose();
            }}
          />
          <Action
            label="Mark As Bags"
            disabled={!canMarkOrigin || item.origin === 'bags'}
            onClick={() => {
              onSetOrigin(item, 'bags');
              onClose();
            }}
          />
        </div>
      )}
    </div>
  );
}
