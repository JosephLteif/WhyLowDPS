export default function RankingsHeader() {
  return (
    <div className="px-4 pb-2.5 pt-2">
      <div className="flex items-center justify-between gap-4 border-b border-white/10 pb-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="w-6 shrink-0 text-right text-[12px] uppercase tracking-[0.15em] text-zinc-300">
            #
          </span>
          <span className="text-[12px] uppercase tracking-[0.15em] text-zinc-300">
            Items & Talents
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="w-32 text-right text-[12px] uppercase tracking-[0.15em] text-zinc-300">
            DPS Change
          </span>
          <span className="w-20 text-right text-[12px] uppercase tracking-[0.15em] text-zinc-300">
            DPS
          </span>
          <span className="w-28 text-right text-[12px] uppercase tracking-[0.15em] text-zinc-300">
            Item Level
          </span>
        </div>
      </div>
    </div>
  );
}
