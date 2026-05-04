/**
 * Shared gear item row used across Top Gear, Upgrade Compare, and other pages.
 * Renders an item with icon, quality-colored name, detail parts, and optional checkbox.
 */

interface DetailPart {
  text: string;
  color?: string;
  kind?: 'text' | 'gemIcon' | 'plain' | 'iconText';
  badgeVariant?: 'neutral' | 'gem' | 'enchant' | 'mod' | 'source';
  icon?: string;
  href?: string;
  wowheadData?: string;
  tooltip?: string;
}

interface GearItemRowProps {
  /** Item icon name (e.g. "inv_helm_cloth_raidmage_s_01") */
  icon: string;
  /** Item name */
  name: string;
  /** CSS color for the item name (quality color) */
  nameColor: string;
  /** Detail parts shown below the name (tag, upgrade, gem, enchant, etc.) */
  details?: DetailPart[];
  /** Item level shown on the right */
  ilevel?: number;
  /** Whether this row has a selectable checkbox */
  selectable?: boolean;
  /** Whether the checkbox visuals should be displayed */
  showCheckbox?: boolean;
  /** Current checked state (only used when selectable) */
  checked?: boolean;
  /** Checkbox change handler */
  onToggle?: () => void;
  /** Whether this is the currently equipped item (shows static checkmark) */
  equipped?: boolean;
  /** Vault item styling */
  vault?: boolean;
  /** Catalyst item styling */
  catalyst?: boolean;
  /** Wowhead link URL */
  href?: string;
  /** Wowhead data attribute */
  wowheadData?: string;
  /** Whether the item has manual optimizations (gems/enchants) */
  optimized?: boolean;
  /** Optional content rendered after the details (e.g. upgrade button) */
  children?: React.ReactNode;
  /** Optional inline indicators shown next to the item name */
  headerExtras?: React.ReactNode;
  /** Optional indicators shown near the item icon */
  iconExtras?: React.ReactNode;
  /** Optional context menu handler (e.g. right-click item actions) */
  onContextMenu?: (event: React.MouseEvent) => void;
  /** Optional inline warning shown below item details */
  specWarning?: string;
  /** Optional red inline warning shown below item details */
  limitWarning?: string;
  /** Dims the row content for lower-priority items (e.g. off-spec) */
  dimmed?: boolean;
  /** Flips layout so icon is on the right side */
  reverse?: boolean;
}

function getIconUrl(iconName: string): string {
  const raw = String(iconName || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  const noExt = raw.replace(/\.(jpg|jpeg|png|webp)$/i, '');
  const base = noExt.split('/').pop() || noExt;
  return `https://render.worldofwarcraft.com/icons/56/${base}.jpg`;
}

export default function GearItemRow({
  icon,
  name,
  nameColor,
  details,
  ilevel,
  selectable,
  showCheckbox = true,
  checked,
  onToggle,
  equipped,
  vault,
  catalyst,
  href,
  wowheadData,
  optimized: _optimized,
  children,
  headerExtras,
  iconExtras,
  onContextMenu,
  specWarning,
  limitWarning,
  dimmed = false,
  reverse = false,
}: GearItemRowProps) {
  const hasLeadingControl = showCheckbox && (selectable || equipped);
  const detailsIndentClass = hasLeadingControl ? 'pl-[1.875rem]' : 'pl-0';
  const mainIconUrl = getIconUrl(icon);
  const textAlignClass = reverse ? 'text-right' : '';

  const content = (
    <>
      {/* Checkbox or equipped indicator */}
      {selectable ? (
        <>
          <input type="checkbox" checked={checked} onChange={onToggle} className="peer sr-only" />
          {showCheckbox && (
            <div
              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-[3px] border transition-all ${
                checked ? 'border-gold bg-gold' : 'border-gray-600 group-hover:border-gray-500'
              }`}
            >
              {checked && (
                <svg className="h-3 w-3 text-black" viewBox="0 0 16 16" fill="none">
                  <path
                    d="M12 5L6.5 10.5L4 8"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </div>
          )}
        </>
      ) : equipped && showCheckbox ? (
        <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-[3px] bg-white/10">
          <svg className="h-3 w-3 text-white/40" viewBox="0 0 16 16" fill="none">
            <path
              d="M12 5L6.5 10.5L4 8"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      ) : null}

      {/* Item icon */}
      {href ? (
        <a
          href={href}
          data-wowhead={wowheadData}
          className={`mt-0.5 h-8 w-8 shrink-0 overflow-hidden rounded ${
            vault
              ? 'ring-2 ring-violet-400/70'
              : catalyst
                ? 'ring-2 ring-purple-400/70'
                : 'ring-1 ring-white/5'
          }`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          {mainIconUrl ? (
            <img
              src={mainIconUrl}
              alt={name}
              width={32}
              height={32}
              className={`h-full w-full ${dimmed ? 'brightness-90 saturate-75' : ''}`}
              loading="lazy"
            />
          ) : (
            <div className="h-full w-full bg-surface-2" />
          )}
        </a>
      ) : (
        <div
          className={`mt-0.5 h-8 w-8 shrink-0 overflow-hidden rounded ${
            vault
              ? 'ring-2 ring-violet-400/70'
              : catalyst
                ? 'ring-2 ring-purple-400/70'
                : 'ring-1 ring-white/5'
          }`}
        >
          {mainIconUrl ? (
            <img
              src={mainIconUrl}
              alt={name}
              width={32}
              height={32}
              className={`h-full w-full ${dimmed ? 'brightness-90 saturate-75' : ''}`}
              loading="lazy"
            />
          ) : (
            <div className="h-full w-full bg-surface-2" />
          )}
        </div>
      )}
      {iconExtras && (
        <div className={`mt-0.5 flex shrink-0 flex-col gap-0.5 ${reverse ? 'items-end' : 'items-start'}`}>
          {iconExtras}
        </div>
      )}

      {/* Name + details */}
      <div className={`min-w-0 flex-1 ${textAlignClass}`}>
        <div className={`flex min-w-0 items-center gap-1.5 ${reverse ? 'justify-end' : ''}`}>
          <span
            className={`block min-w-0 whitespace-normal break-words text-[16px] leading-tight ${
              dimmed ? 'opacity-70' : ''
            }`}
            style={{ color: nameColor }}
          >
            {name}
          </span>
          {headerExtras}
        </div>
      </div>

      {/* Right side: children + ilvl */}
      {children}
      {ilevel != null && ilevel > 0 && (
        <span
          className={`mt-0.5 shrink-0 font-mono text-[15px] font-semibold tabular-nums text-zinc-200 ${
            dimmed ? 'opacity-70' : ''
          }`}
        >
          {ilevel}
        </span>
      )}

      {details && details.length > 0 && (
        <div
          className={`min-w-0 basis-full pt-0.5 ${detailsIndentClass} ${dimmed ? 'opacity-75' : ''} ${
            reverse ? 'text-right' : ''
          }`}
        >
          <div className={`flex flex-wrap items-center gap-1.5 ${reverse ? 'justify-end' : ''}`}>
            {details.map((p, i) =>
              p.kind === 'gemIcon' && p.icon ? (
                (() => {
                  const detailIconUrl = getIconUrl(p.icon);
                  return (
                <a
                  key={i}
                  href={p.href}
                  data-wowhead={p.wowheadData}
                  title={p.wowheadData ? undefined : p.tooltip || p.text}
                  className={`inline-flex h-6 w-6 items-center justify-center overflow-hidden rounded border border-sky-400/40 bg-sky-500/10 ${p.color || ''}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={p.href ? (e) => e.preventDefault() : undefined}
                >
                  {detailIconUrl ? (
                    <img
                      src={detailIconUrl}
                      alt={p.text}
                      width={24}
                      height={24}
                      className="h-full w-full"
                    />
                  ) : (
                    <span className="text-[10px]">?</span>
                  )}
                </a>
                  );
                })()
              ) : p.kind === 'iconText' && p.icon ? (
                <ItemBadge
                  key={i}
                  text={p.text}
                  icon={p.icon}
                  href={p.href}
                  wowheadData={p.wowheadData}
                  title={p.tooltip || p.text}
                  variant={p.badgeVariant || 'neutral'}
                  className={p.color || ''}
                />
              ) : p.kind === 'plain' ? (
                <span
                  key={i}
                  className={`text-[13px] leading-snug ${p.color || 'text-zinc-300'}`}
                  title={p.tooltip || p.text}
                >
                  {p.text}
                </span>
              ) : (
                <ItemBadge
                  key={i}
                  text={p.text}
                  title={p.tooltip || p.text}
                  variant="neutral"
                  className={p.color || ''}
                />
              )
            )}
          </div>
        </div>
      )}

      {specWarning && (
        <div className={`min-w-0 basis-full pt-0.5 ${detailsIndentClass} ${reverse ? 'text-right' : ''}`}>
          <div className="inline-flex max-w-full items-center gap-2 rounded-md border border-amber-400/40 bg-amber-500/12 px-2 py-1 text-[12px] font-semibold text-amber-200">
            <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm bg-amber-500/20 text-amber-300">
              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor" aria-hidden="true">
                <path d="M10 2.5L18 16.5H2L10 2.5zm0 5.1a1 1 0 00-1 1v3.3a1 1 0 002 0V8.6a1 1 0 00-1-1zm0 7.1a1.1 1.1 0 100-2.2 1.1 1.1 0 000 2.2z" />
              </svg>
            </span>
            <span className="min-w-0 whitespace-normal break-words">{specWarning}</span>
          </div>
        </div>
      )}

      {limitWarning && (
        <div className={`min-w-0 basis-full pt-0.5 ${detailsIndentClass}`}>
          <div className="inline-flex max-w-full items-center gap-2 rounded-md border border-red-400/45 bg-red-500/12 px-2 py-1 text-[12px] font-semibold text-red-200">
            <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm bg-red-500/20 text-red-300">
              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor" aria-hidden="true">
                <path d="M10 2.5L18 16.5H2L10 2.5zm0 5.1a1 1 0 00-1 1v3.3a1 1 0 002 0V8.6a1 1 0 00-1-1zm0 7.1a1.1 1.1 0 100-2.2 1.1 1.1 0 000 2.2z" />
              </svg>
            </span>
            <span className="min-w-0 whitespace-normal break-words">{limitWarning}</span>
          </div>
        </div>
      )}
    </>
  );

  // Row styling
  const baseClass = `flex flex-wrap items-start gap-x-2.5 gap-y-1 rounded-md px-2.5 py-2 transition-colors ${
    reverse ? 'flex-row-reverse' : ''
  }`;

  if (selectable) {
    return (
      <label
        onContextMenu={onContextMenu}
        className={`group cursor-pointer ${baseClass} ${
          checked
            ? vault
              ? 'border border-violet-200/70 bg-violet-300/[0.22] ring-2 ring-inset ring-violet-100 shadow-[0_0_0_1px_rgba(167,139,250,0.45)]'
              : catalyst
                ? 'border border-transparent bg-purple-400/[0.14] ring-[1.5px] ring-inset ring-purple-300/90'
                : 'border border-transparent bg-gold/[0.14] ring-[1.5px] ring-inset ring-gold-light/90'
            : vault
              ? 'border border-zinc-700/90 bg-violet-500/[0.015] ring-1 ring-violet-500/20 hover:border-violet-400/45 hover:bg-violet-500/[0.06] hover:ring-violet-400/35'
              : catalyst
                ? 'border border-zinc-600/70 bg-purple-400/[0.04] ring-1 ring-purple-400/30 hover:border-zinc-500/80 hover:bg-purple-400/[0.08] hover:ring-purple-400/50'
                : 'border border-zinc-700/80 bg-white/[0.01] hover:border-zinc-500/80 hover:bg-white/[0.03]'
        }`}
      >
        {content}
      </label>
    );
  }

  return (
    <div
      onContextMenu={onContextMenu}
      className={`${baseClass} ${equipped ? 'bg-white/[0.03]' : ''}`}
    >
      {content}
    </div>
  );
}
import ItemBadge from './shared/ItemBadge';
