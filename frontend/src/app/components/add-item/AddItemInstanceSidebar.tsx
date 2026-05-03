interface Instance {
  id: number;
  name: string;
  type: string;
}

interface AddItemInstanceSidebarProps {
  instances: Instance[];
  selectedInstance: number;
  onSelect: (id: number) => void;
}

export default function AddItemInstanceSidebar({
  instances,
  selectedInstance,
  onSelect,
}: AddItemInstanceSidebarProps) {
  const hasOnlyCraftedFilters =
    instances.length > 0 && instances.every((inst) => inst.type === 'crafted-slot');

  // Sort: put meta-instances (id < 0) first, like "M+ Dungeons" / "Season 1 Raids".
  // Crafted slot filters keep their explicit order.
  const sorted = hasOnlyCraftedFilters
    ? instances
    : [...instances].sort((a, b) => {
        if (a.id < 0 && b.id >= 0) return -1;
        if (a.id >= 0 && b.id < 0) return 1;
        return 0;
      });

  return (
    <div className="scrollbar-thin scrollbar-thumb-white/10 w-52 shrink-0 space-y-0.5 overflow-y-auto border-r border-border bg-surface/50 p-1.5">
      {sorted.map((inst) => {
        const isActive = selectedInstance === inst.id;
        const isMeta = inst.id < 0 && inst.type !== 'search';
        return (
          <button
            key={inst.id}
            onClick={() => onSelect(inst.id)}
            className={`group flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-all duration-150 ${
              isActive
                ? 'border border-gold/20 bg-gold/[0.08] text-gold shadow-sm'
                : 'border border-transparent text-zinc-400 hover:bg-white/[0.03] hover:text-zinc-200'
            }`}
          >
            <div
              className={`h-1.5 w-1.5 shrink-0 rounded-full transition-transform group-hover:scale-125 ${
                isMeta
                  ? 'bg-gold shadow-[0_0_6px_rgba(212,168,67,0.4)]'
                  : inst.type === 'raid'
                    ? 'bg-orange-500 shadow-[0_0_6px_rgba(249,115,22,0.3)]'
                    : inst.type.includes('pvp')
                      ? 'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.3)]'
                      : 'bg-blue-500 shadow-[0_0_6px_rgba(59,130,246,0.3)]'
              }`}
            />
            <span className={`truncate text-xs leading-tight ${isMeta ? 'font-bold' : 'font-semibold'}`}>
              {inst.name}
            </span>
          </button>
        );
      })}
      {instances.length === 0 && (
        <div className="p-6 text-center text-xs italic text-zinc-600">No instances found</div>
      )}
    </div>
  );
}
