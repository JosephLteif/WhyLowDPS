import { SLOT_LABELS } from '../../lib/types';
import { ExternalItem } from './useAddItemState';

interface AddItemSearchOverlayProps {
  isVisible: boolean;
  isGlobalLoading: boolean;
  globalSearch: string;
  results: ExternalItem[];
  onSelect: (item: ExternalItem) => void;
  onShowAll: () => void;
}

export default function AddItemSearchOverlay({
  isVisible,
  isGlobalLoading,
  globalSearch,
  results,
  onSelect,
  onShowAll,
}: AddItemSearchOverlayProps) {
  if (!isVisible || globalSearch.length < 2) return null;

  return (
    <div
      className="animate-in fade-in slide-in-from-top-2 absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-xl border border-white/10 bg-[#0d0d10] shadow-2xl duration-200"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="scrollbar-thin scrollbar-thumb-white/10 max-h-[400px] overflow-y-auto">
        {isGlobalLoading ? (
          <div className="animate-pulse p-4 text-center text-[10px] text-slate-500">
            Syncing Global Loot...
          </div>
        ) : results.length === 0 ? (
          <div className="p-4 text-center text-lg font-bold text-white">
            No matches found for &quot;{globalSearch}&quot;
          </div>
        ) : (
          <>
            {results.slice(0, 10).map((item) => (
              <button
                key={item.item_id}
                onClick={() => onSelect(item)}
                className="group flex w-full items-center gap-3 border-b border-white/5 p-3 transition-colors last:border-0 hover:bg-white/[0.03]"
              >
                <img
                  src={
                    `https://wow.zamimg.com/images/wow/icons/large/${item.icon}.jpg` ||
                    '/assets/unknown.png'
                  }
                  className="h-8 w-8 rounded-lg shadow-lg"
                  alt=""
                />
                <div className="min-w-0 flex-1 text-left">
                  <div className="truncate text-xs font-bold text-white transition-colors group-hover:text-blue-400">
                    {item.name}
                  </div>
                  <div className="truncate text-[10px] text-slate-500">
                    {item.encounter} • {item.instance_name}
                  </div>
                </div>
                <div className="text-[10px] font-black uppercase tracking-tighter text-slate-700">
                  {SLOT_LABELS[item.inventory_type]}
                </div>
              </button>
            ))}

            {results.length > 10 && (
              <div className="border-b border-white/5 bg-black/40 p-2 text-center text-[10px] italic text-slate-600">
                +{results.length - 10} more results...
              </div>
            )}

            <button
              onClick={onShowAll}
              className="w-full bg-blue-600/10 p-3 text-xs font-black uppercase tracking-widest text-blue-400 transition-all hover:bg-blue-600/20"
            >
              Show All Results ({results.length})
            </button>
          </>
        )}
      </div>
    </div>
  );
}
