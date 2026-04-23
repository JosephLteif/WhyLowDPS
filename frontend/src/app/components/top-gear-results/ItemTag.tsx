import { getIconUrl, getWowheadData, getWowheadUrl, QUALITY_COLORS } from '../../lib/useItemInfo';
import type { EnchantInfo, GemInfo, ItemInfo } from '../../lib/useItemInfo';
import type { ResultItem } from '../../lib/types';
import { SLOT_LABELS } from '../../lib/types';

interface ItemTagProps {
  item: ResultItem;
  info?: ItemInfo;
  enchant?: EnchantInfo;
  gem?: GemInfo;
}

export default function ItemTag({ item, info, enchant, gem }: ItemTagProps) {
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
    <div
      className={`flex min-w-0 max-w-full items-center gap-2 px-0.5 py-0.5 ${kept ? 'opacity-40' : ''}`}
    >
      <a
        href={item.item_id > 0 ? getWowheadUrl(item.item_id) : undefined}
        data-wowhead={whData}
        className="h-[22px] w-[22px] shrink-0 overflow-hidden rounded"
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => {
          e.preventDefault();
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={getIconUrl(icon)}
          alt=""
          width={22}
          height={22}
          className="h-full w-full"
          loading="lazy"
        />
      </a>
      <span
        className="min-w-0 whitespace-normal break-words text-[15px] font-semibold leading-tight"
        style={{ color: qc }}
      >
        {name}
      </span>
      <span className="shrink-0 text-[14px] text-zinc-100/90">({slotName})</span>
      {enchant?.icon && (
        <a
          href={enchantHref}
          data-wowhead={enchantTooltipData}
          className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center overflow-hidden rounded-sm border border-emerald-400/45 bg-emerald-500/10"
          title={enchant.name || 'Enchant'}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => {
            e.preventDefault();
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={getIconUrl(enchant.icon)}
            alt=""
            width={18}
            height={18}
            className="h-full w-full"
            loading="lazy"
          />
        </a>
      )}
      {gem?.icon && (
        <a
          href={gemHref}
          data-wowhead={gemTooltipData}
          className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center overflow-hidden rounded-sm border border-sky-400/45 bg-sky-500/10"
          title={gem.name || 'Gem'}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => {
            e.preventDefault();
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={getIconUrl(gem.icon)}
            alt=""
            width={18}
            height={18}
            className="h-full w-full"
            loading="lazy"
          />
        </a>
      )}
      {item.upgrade_levels ? (
        <span className="shrink-0 text-[11px] font-bold uppercase tracking-wider text-emerald-400">
          +{item.upgrade_levels}
        </span>
      ) : item.origin === 'vault' ? (
        <span className="shrink-0 text-[11px] font-bold uppercase tracking-wider text-amber-400">
          V
        </span>
      ) : null}
      {sourceLabel && (
        <span className="min-w-0 whitespace-normal break-words text-[13px] text-cyan-300/75">
          {sourceLabel}
        </span>
      )}
    </div>
  );
}
