import { API_URL } from '../lib/api';
import type { Instance } from './types';

interface DungeonGridProps {
  value?: string;
  onChange?: (value: string) => void;
  multi?: boolean;
  selectedValues?: Set<string>;
  allSelected?: boolean;
  onToggleValue?: (value: string) => void;
  onToggleAll?: () => void;
  instances: Instance[];
  allKey: string;
  allLabel: string;
}

function instanceImageSrc(inst: Instance): string | null {
  if (inst.id <= 0) return null;
  return `${API_URL}/api/data/images/instance/${inst.id}`;
}

function ImageLayer({ src }: { src: string }) {
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      onError={(event) => {
        event.currentTarget.hidden = true;
      }}
      className="absolute inset-0 h-full w-full object-cover transition-all duration-300"
    />
  );
}

function MissingImageFallback() {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black p-3">
      <img
        src="/wow-logo.png"
        alt="WoW"
        className="h-[72%] max-h-36 w-[72%] max-w-36 -translate-y-2 object-contain opacity-95"
      />
    </div>
  );
}

export default function DungeonGrid({
  value,
  onChange,
  multi = false,
  selectedValues,
  allSelected = false,
  onToggleValue,
  onToggleAll,
  instances,
  allKey,
  allLabel,
}: DungeonGridProps) {
  const isTileActive = (key: string) =>
    multi ? (selectedValues?.has(key) ?? false) : value === key;
  const isAllActive = multi ? allSelected : value === allKey;

  const allTileImages = instances
    .filter((inst) => inst.id !== 1312 && inst.name !== 'World Bosses')
    .map((inst) => ({ inst, src: instanceImageSrc(inst) }))
    .filter((x) => !!x.src)
    .slice(0, 4);

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
      {/* "All" tile */}
      <button
        onClick={() => {
          if (multi) onToggleAll?.();
          else onChange?.(allKey);
        }}
        className={`group relative flex aspect-[16/9] items-end overflow-hidden rounded-lg border transition-all duration-150 ${
          isAllActive
            ? 'border-gold/60 shadow-[0_0_12px_rgba(200,153,42,0.14)] ring-1 ring-gold/30'
            : 'border-border hover:border-gold/20'
        }`}
      >
        <div className="absolute inset-0 bg-black" />
        <MissingImageFallback />
        <div
          className="absolute inset-0 grid"
          style={{
            gridTemplateColumns: `repeat(${Math.max(allTileImages.length, 1)}, minmax(0, 1fr))`,
          }}
        >
          {allTileImages.map(({ inst, src }) => (
            <div key={inst.id} className="relative h-full w-full overflow-hidden">
              {src && <ImageLayer src={src} />}
            </div>
          ))}
        </div>
        <div className="relative w-full px-3 pb-3 pt-1">
          <p
            className={`text-base font-bold leading-snug drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)] ${isAllActive ? 'text-gold' : 'text-white'}`}
          >
            {allLabel}
          </p>
        </div>
      </button>

      {/* Individual dungeon tiles */}
      {instances.map((inst) => (
        <button
          key={inst.id}
          onClick={() => {
            if (multi) onToggleValue?.(String(inst.id));
            else onChange?.(String(inst.id));
          }}
          className={`group relative flex aspect-[16/9] items-end overflow-hidden rounded-lg border transition-all duration-150 ${
            isTileActive(String(inst.id))
              ? 'border-gold/60 shadow-[0_0_10px_rgba(200,153,42,0.14)] ring-1 ring-gold/30'
              : 'border-border hover:border-gold/20'
          }`}
        >
          <div className="absolute inset-0 bg-black" />
          <MissingImageFallback />
          {instanceImageSrc(inst) && (
            <div className="absolute inset-0 overflow-hidden">
              <ImageLayer src={instanceImageSrc(inst)!} />
            </div>
          )}
          <div className="relative w-full px-3 pb-3 pt-1">
            <p
              className={`text-base font-bold leading-snug drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)] ${
                isTileActive(String(inst.id)) ? 'text-gold' : 'text-white'
              }`}
            >
              {inst.name}
            </p>
          </div>
        </button>
      ))}
    </div>
  );
}
