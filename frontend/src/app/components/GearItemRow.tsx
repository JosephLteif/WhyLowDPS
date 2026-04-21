/**
 * Shared gear item row used across Top Gear, Upgrade Compare, and other pages.
 * Renders an item with icon, quality-colored name, detail parts, and optional checkbox.
 */

interface DetailPart {
  text: string;
  color?: string;
  kind?: 'text' | 'gemIcon' | 'plain' | 'iconText';
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
}: GearItemRowProps) {
  const hasLeadingControl = showCheckbox && (selectable || equipped);
  const detailsIndentClass = hasLeadingControl ? 'pl-[1.875rem]' : 'pl-0';
  const mainIconUrl = getIconUrl(icon);

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
              ? 'ring-2 ring-amber-400/70'
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
              className="h-full w-full"
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
              ? 'ring-2 ring-amber-400/70'
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
              className="h-full w-full"
              loading="lazy"
            />
          ) : (
            <div className="h-full w-full bg-surface-2" />
          )}
        </div>
      )}

      {/* Name + details */}
      <div className="min-w-0 flex-1">
        <span
          className="block whitespace-normal break-words text-[16px] leading-tight"
          style={{ color: nameColor }}
        >
          {name}
        </span>
      </div>

      {/* Right side: children + ilvl */}
      {children}
      {ilevel != null && ilevel > 0 && (
        <span className="mt-0.5 shrink-0 font-mono text-[15px] font-semibold tabular-nums text-zinc-200">
          {ilevel}
        </span>
      )}

      {details && details.length > 0 && (
        <div className={`min-w-0 basis-full pt-0.5 ${detailsIndentClass}`}>
          <div className="flex flex-wrap items-center gap-1.5">
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
                (() => {
                  const detailIconUrl = getIconUrl(p.icon);
                  return (
                <a
                  key={i}
                  href={p.href}
                  data-wowhead={p.wowheadData}
                  title={p.wowheadData ? undefined : p.tooltip || p.text}
                  className={`inline-flex min-w-0 max-w-full items-start gap-1 rounded-md border border-emerald-400/35 bg-emerald-500/10 px-1.5 py-0.5 text-[12px] leading-snug ${p.color || 'text-emerald-300'}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={p.href ? (e) => e.preventDefault() : undefined}
                >
                  {detailIconUrl ? (
                    <img
                      src={detailIconUrl}
                      alt={p.text}
                      width={16}
                      height={16}
                      className="h-4 w-4 rounded-[3px]"
                    />
                  ) : (
                    <span className="inline-flex h-4 w-4 items-center justify-center rounded-[3px] bg-white/10 text-[10px]">
                      ?
                    </span>
                  )}
                  <span className="min-w-0 whitespace-normal break-words leading-snug">
                    {p.text}
                  </span>
                </a>
                  );
                })()
              ) : p.kind === 'plain' ? (
                <span
                  key={i}
                  className={`text-[13px] leading-snug ${p.color || 'text-zinc-300'}`}
                  title={p.tooltip || p.text}
                >
                  {p.text}
                </span>
              ) : (
                <span
                  key={i}
                  className={`inline-flex max-w-full items-center rounded-md border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[12px] leading-snug text-zinc-300 ${p.color || ''}`}
                  title={p.tooltip || p.text}
                >
                  {p.text}
                </span>
              )
            )}
          </div>
        </div>
      )}
    </>
  );

  // Row styling
  const baseClass =
    'flex flex-wrap items-start gap-x-2.5 gap-y-1 rounded-md px-2.5 py-2 transition-colors';

  if (selectable) {
    return (
      <label
        className={`group cursor-pointer ${baseClass} ${
          checked
            ? vault
              ? 'border border-transparent bg-amber-400/[0.14] ring-[1.5px] ring-inset ring-amber-300/90'
              : catalyst
                ? 'border border-transparent bg-purple-400/[0.14] ring-[1.5px] ring-inset ring-purple-300/90'
                : 'border border-transparent bg-gold/[0.14] ring-[1.5px] ring-inset ring-gold-light/90'
            : vault
              ? 'border border-zinc-600/70 bg-amber-400/[0.04] ring-1 ring-amber-400/30 hover:border-zinc-500/80 hover:bg-amber-400/[0.08] hover:ring-amber-400/50'
              : catalyst
                ? 'border border-zinc-600/70 bg-purple-400/[0.04] ring-1 ring-purple-400/30 hover:border-zinc-500/80 hover:bg-purple-400/[0.08] hover:ring-purple-400/50'
                : 'border border-zinc-700/80 bg-white/[0.01] hover:border-zinc-500/80 hover:bg-white/[0.03]'
        }`}
      >
        {content}
      </label>
    );
  }

  return <div className={`${baseClass} ${equipped ? 'bg-white/[0.03]' : ''}`}>{content}</div>;
}
