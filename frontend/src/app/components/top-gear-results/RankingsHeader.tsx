export default function RankingsHeader() {
  return (
    <div className="px-3 pb-2 pt-1">
      <div className="flex items-center justify-between gap-3 border-b border-white/5 pb-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="w-5 shrink-0 text-right text-[10px] uppercase tracking-widest text-zinc-600">
            #
          </span>
          <span className="text-[10px] uppercase tracking-widest text-zinc-600">
            Items & Talents
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="w-28 text-right text-[10px] uppercase tracking-widest text-zinc-600">
            DPS Change
          </span>
          <span className="w-16 text-right text-[10px] uppercase tracking-widest text-zinc-600">
            DPS
          </span>
          <span className="w-24 text-right text-[10px] uppercase tracking-widest text-zinc-600">
            Item Level
          </span>
        </div>
      </div>
    </div>
  );
}
