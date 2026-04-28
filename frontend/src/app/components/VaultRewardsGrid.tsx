'use client';

import { QUALITY_COLORS, getIconUrl, getWowheadData, getWowheadUrl, useItemInfo } from '../lib/useItemInfo';

export type VaultRewardItem = {
  slot: string;
  itemId: string;
  ilevel: string;
  bonusIds?: number[];
};

export default function VaultRewardsGrid({ items }: { items: VaultRewardItem[] }) {
  const itemInfo = useItemInfo(
    items.map((item) => ({
      item_id: Number(item.itemId),
      bonus_ids: item.bonusIds || [],
    })),
  );

  if (items.length === 0) {
    return <p className="text-[11px] italic text-zinc-600">No vault item lines found in the latest saved SimC profile.</p>;
  }

  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
      {items.map((item, idx) => (
        <div key={`${item.slot}-${item.itemId}-${idx}`} className="rounded border border-white/10 bg-black/25 p-2">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              {itemInfo[Number(item.itemId)]?.icon ? (
                <img
                  src={getIconUrl(itemInfo[Number(item.itemId)].icon)}
                  alt=""
                  className="h-8 w-8 rounded border border-white/10"
                />
              ) : (
                <div className="h-8 w-8 rounded border border-white/10 bg-black/30" />
              )}
              <div className="min-w-0">
                <span className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">{item.slot}</span>
                <a
                  href={getWowheadUrl(Number(item.itemId))}
                  target="_blank"
                  rel="noreferrer"
                  data-wowhead={`item=${item.itemId}${(() => {
                    const extra = getWowheadData(
                      item.bonusIds || [],
                      Number(itemInfo[Number(item.itemId)]?.ilevel || item.ilevel || 0),
                    );
                    return extra ? `&${extra}` : '';
                  })()}`}
                  className="block truncate text-[12px] font-semibold hover:underline"
                  style={{
                    color: QUALITY_COLORS[itemInfo[Number(item.itemId)]?.quality ?? 1] || '#ffffff',
                  }}
                >
                  {itemInfo[Number(item.itemId)]?.name || `Item ${item.itemId}`}
                </a>
              </div>
            </div>
            <span className="rounded border border-gold/20 bg-gold/10 px-1.5 py-0.5 text-[10px] font-bold text-gold">
              ilvl {itemInfo[Number(item.itemId)]?.ilevel || item.ilevel}
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between gap-2">
            <p className="font-mono text-[11px] text-zinc-400">Item ID: {item.itemId}</p>
            <span className="rounded border border-white/10 bg-black/30 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-300">
              Tier: {itemInfo[Number(item.itemId)]?.upgrade || '-'}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

