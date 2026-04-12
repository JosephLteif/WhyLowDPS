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

  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 ${
        kept ? 'opacity-40' : 'bg-white/[0.04]'
      }`}
    >
      <div className="h-[18px] w-[18px] shrink-0 overflow-hidden rounded-sm">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={getIconUrl(icon)}
          alt=""
          width={18}
          height={18}
          className="h-full w-full"
          loading="lazy"
        />
      </div>
      <a
        href={item.item_id > 0 ? getWowheadUrl(item.item_id) : undefined}
        data-wowhead={whData}
        className="max-w-[130px] truncate text-[13px] font-medium no-underline"
        style={{ color: qc }}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => {
          e.preventDefault();
        }}
      >
        {name}
      </a>
      <span className="text-[12px] text-zinc-400">({slotName})</span>
      {item.upgrade_levels ? (
        <span className="shrink-0 text-[11px] font-bold uppercase tracking-wider text-emerald-400">
          +{item.upgrade_levels}
        </span>
      ) : item.origin === 'vault' ? (
        <span className="shrink-0 text-[11px] font-bold uppercase tracking-wider text-amber-400">
          V
        </span>
      ) : null}
      {enchant?.name && (
        <span
          className="max-w-[80px] truncate text-[12px] text-emerald-300/80"
          title={enchant.name}
        >
          {enchant.name}
        </span>
      )}
    </div>
  );
}
