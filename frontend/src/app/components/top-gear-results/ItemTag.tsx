import { getIconUrl, getWowheadData, getWowheadUrl, QUALITY_COLORS } from '../../lib/useItemInfo';
import type { EnchantInfo, GemInfo, ItemInfo } from '../../lib/useItemInfo';
import type { ResultItem } from '../../lib/types';
import { SLOT_LABELS } from '../../lib/types';
import ItemBadge from '../shared/ItemBadge';

interface ItemTagProps {
  item: ResultItem;
  info?: ItemInfo;
  enchant?: EnchantInfo;
  gem?: GemInfo;
  upgradeState?: 'upgrade' | 'downgrade' | null;
  ilevelText?: string;
  ilevelTooltip?: string;
  ilevelHighlightClass?: string;
  gemChanged?: boolean;
  enchantChanged?: boolean;
}

export default function ItemTag({
  item,
  info,
  enchant,
  gem,
  upgradeState = null,
  ilevelText,
  ilevelTooltip,
  ilevelHighlightClass = '',
  gemChanged = false,
  enchantChanged = false,
}: ItemTagProps) {
  const sourceTypeRaw = String(item.source_type || '').toLowerCase();
  const hasAscendantVoidcore =
    sourceTypeRaw.includes('mod:268552') ||
    sourceTypeRaw.includes('ascendant_voidcore') ||
    String(item.tag || '').toLowerCase().includes('ascendant');

  const qc = info ? QUALITY_COLORS[info.quality] || '#fff' : '#fff';
  const name = info?.name || item.name || `Item ${item.item_id}`;
  const icon = info?.icon || 'inv_misc_questionmark';
  const kept = item.is_kept;
  const whData =
    item.item_id > 0
      ? getWowheadData(item.bonus_ids, item.ilevel, item.enchant_id, item.gem_id)
      : undefined;

  const slotName = SLOT_LABELS[item.slot] || item.slot;
  const sourceLabel = item.encounter || item.instance_name || '';

  const enchantItemId = enchant?.item_id || 0;
  const enchantId = enchant?.enchant_id || item.enchant_id || 0;
  const enchantTooltipData =
    enchantItemId > 0 ? `item=${enchantItemId}` : enchantId > 0 ? `spell=${enchantId}` : undefined;
  const enchantHref =
    enchantItemId > 0
      ? getWowheadUrl(enchantItemId)
      : enchantId > 0
        ? `https://www.wowhead.com/spell=${enchantId}`
        : undefined;

  const gemId = gem?.gem_id || item.gem_id || 0;
  const gemTooltipData = gemId > 0 ? `item=${gemId}` : undefined;
  const gemHref = gemId > 0 ? getWowheadUrl(gemId) : undefined;

  return (
    <div className={`grid min-w-0 max-w-full grid-cols-[32px_minmax(0,1fr)] gap-x-3 gap-y-1 px-0.5 py-1 ${kept ? 'opacity-40' : ''}`}>
      <a
        href={item.item_id > 0 ? getWowheadUrl(item.item_id) : undefined}
        data-wowhead={whData}
        className="col-start-1 row-start-1 mt-0.5 h-8 w-8 shrink-0 overflow-hidden rounded ring-1 ring-white/5"
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.preventDefault()}
      >
        <img
          src={getIconUrl(icon)}
          alt=""
          width={32}
          height={32}
          className="h-full w-full"
          loading="lazy"
        />
      </a>

      <div className="col-start-2 row-start-1 min-w-0">
        <div className="mb-1 flex min-w-0 flex-wrap items-center gap-1.5">
          {ilevelText && (
            <span
              title={ilevelTooltip}
              className={`inline-flex shrink-0 items-center rounded border px-2 py-0.5 text-[11px] font-semibold leading-none ${
                ilevelHighlightClass?.includes('emerald')
                  ? 'border-emerald-400/45 bg-emerald-500/10 text-emerald-200/90'
                  : ilevelHighlightClass?.includes('red')
                    ? 'border-red-400/45 bg-red-500/10 text-red-200/90'
                    : 'border-zinc-400/40 bg-zinc-500/10 text-zinc-200/90'
              }`}
            >
              {ilevelText}
            </span>
          )}
          {sourceLabel && (
            <span className="inline-flex shrink-0 items-center rounded border border-amber-400/45 bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold leading-none text-amber-200">
              {sourceLabel}
            </span>
          )}
          <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
            {slotName}
          </span>
          {item.upgrade_levels ? (
            <span className="shrink-0 text-[11px] font-bold uppercase tracking-wider text-emerald-400">
              +{item.upgrade_levels}
            </span>
          ) : item.origin === 'vault' ? (
            <span className="shrink-0 text-[11px] font-bold uppercase tracking-wider text-amber-400">V</span>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="min-w-0 whitespace-normal break-words text-[16px] leading-tight" style={{ color: qc }}>
            {name}
          </span>
        </div>
      </div>

      <div className="col-span-2 col-start-1 row-start-2 flex min-w-0 flex-wrap items-center gap-1.5">
          {gem?.icon && (
            <ItemBadge
              text={gem.name || 'Gem'}
              variant="gem"
              icon={gem.icon}
              href={gemHref}
              wowheadData={gemTooltipData}
              title={gem.name || 'Gem'}
              className={
                gemChanged
                  ? 'border-sky-300/80 bg-sky-500/22 text-sky-100 ring-1 ring-sky-300/60'
                  : 'border-sky-400/45 bg-sky-500/10 text-sky-200/90'
              }
              iconSize={14}
            />
          )}

          {enchant?.icon && (
            <ItemBadge
              text={enchant.name || 'Enchant'}
              variant="enchant"
              icon={enchant.icon}
              href={enchantHref}
              wowheadData={enchantTooltipData}
              title={enchant.name || 'Enchant'}
              className={
                enchantChanged
                  ? 'border-emerald-300/80 bg-emerald-500/22 text-emerald-100 ring-1 ring-emerald-300/60'
                  : 'border-emerald-400/45 bg-emerald-500/10 text-emerald-200/90'
              }
              iconSize={14}
            />
          )}

          {hasAscendantVoidcore && (
            <ItemBadge
              text="Ascendant Voidcore"
              variant="mod"
              icon="inv_1205_voidforge_sovereignvoidcores_cosmicvoid"
              href="https://www.wowhead.com/item=268552/ascendant-voidcore"
              wowheadData="item=268552"
              className="text-amber-200 border-amber-400/50 bg-amber-500/18"
              iconSize={14}
            />
          )}
      </div>
    </div>
  );
}
