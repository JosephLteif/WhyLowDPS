interface ToggleButtonGroupProps<T extends string | number> {
  value: T;
  onChange: (value: T) => void;
  options: { key: T; label: string; sublabel?: string }[];
  size?: 'sm' | 'md';
}

export default function ToggleButtonGroup<T extends string | number>({
  value,
  onChange,
  options,
  size = 'md',
}: ToggleButtonGroupProps<T>) {
  const padding = size === 'sm' ? 'px-3.5 py-2 text-[13px]' : 'px-4 py-2.5 text-sm';

  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => (
        <button
          key={String(opt.key)}
          onClick={() => onChange(opt.key)}
          className={`rounded-lg border font-medium transition-all duration-150 ${padding} ${
            value === opt.key
              ? 'border-gold/40 bg-gold/[0.08] text-gold'
              : 'border-border bg-surface-2 text-zinc-300 hover:border-zinc-500 hover:text-zinc-100'
          }`}
        >
          {opt.label}
          {opt.sublabel && (
            <span className="ml-1 text-sm font-medium text-zinc-300">{opt.sublabel}</span>
          )}
        </button>
      ))}
    </div>
  );
}
