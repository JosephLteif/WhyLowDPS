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
  return (
    <div className="scrollbar-thin scrollbar-thumb-white/10 w-72 space-y-1 overflow-y-auto border-r border-white/5 bg-black/20 p-2">
      {instances.map((inst) => (
        <button
          key={inst.id}
          onClick={() => onSelect(inst.id)}
          className={`group flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition-all duration-200 ${
            selectedInstance === inst.id
              ? 'border border-blue-500/20 bg-blue-600/10 text-blue-400 shadow-lg shadow-blue-900/5'
              : 'border border-transparent text-slate-400 hover:bg-white/[0.03]'
          }`}
        >
          <div
            className={`h-1.5 w-1.5 rounded-full transition-transform group-hover:scale-125 ${
              inst.type === 'raid'
                ? 'bg-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.4)]'
                : inst.type.includes('pvp')
                  ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.4)]'
                  : 'bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.4)]'
            }`}
          />
          <span className="truncate text-xs font-semibold leading-none">{inst.name}</span>
        </button>
      ))}
      {instances.length === 0 && (
        <div className="p-8 text-center text-xs italic text-slate-600">No instances found</div>
      )}
    </div>
  );
}
