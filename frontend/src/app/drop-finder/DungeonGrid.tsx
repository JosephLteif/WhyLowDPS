/* eslint-disable @next/next/no-img-element */
import { API_URL } from '../lib/api';
import type { Instance } from './types';

interface DungeonGridProps {
  value: string;
  onChange: (value: string) => void;
  instances: Instance[];
  allKey: string;
  allLabel: string;
}

function imgSrc(imageUrl: string): string {
  return imageUrl.startsWith('/') ? `${API_URL}${imageUrl}` : imageUrl;
}

function instanceImageSrc(inst: Instance): string | null {
  const localBlizzardImage =
    inst.id > 0 ? `${API_URL}/api/data/instance-images/instance-${inst.id}.jpg` : null;
  const direct = inst.image_url?.trim();
  if (!direct) return localBlizzardImage;

  const resolvedDirect = imgSrc(direct);
  // Prefer clean downloaded Blizzard JPGs over faded EJ background art.
  if (resolvedDirect.includes('/EncounterJournal/orig/ui-ej-background-')) {
    return localBlizzardImage || resolvedDirect;
  }

  return resolvedDirect;
}

function backgroundStyleFor(src: string | null): Record<string, string> | null {
  if (!src) return null;

  return {
    backgroundImage: `url(${src})`,
  };
}

function MissingImageFallback() {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black p-3">
      <img
        src="/wow-logo.png"
        alt="WoW"
        className="-translate-y-2 h-[72%] w-[72%] max-h-36 max-w-36 object-contain opacity-95"
      />
    </div>
  );
}

export default function DungeonGrid({
  value,
  onChange,
  instances,
  allKey,
  allLabel,
}: DungeonGridProps) {
  const allTileImages = instances
    .filter((inst) => inst.id !== 1312 && inst.name !== 'World Bosses')
    .map((inst) => ({ inst, src: instanceImageSrc(inst) }))
    .filter((x) => !!x.src)
    .slice(0, 4);

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
      {/* "All" tile */}
      <button
        onClick={() => onChange(allKey)}
        className={`group relative flex aspect-[16/9] items-end overflow-hidden rounded-lg border transition-all duration-150 ${
          value === allKey
            ? 'border-gold/50 shadow-[0_0_12px_rgba(200,153,42,0.15)]'
            : 'border-border hover:border-gold/20'
        }`}
      >
        <div className="absolute inset-0 bg-black" />
        {allTileImages.length === 0 && <MissingImageFallback />}
        <div
          className="absolute inset-0 grid"
          style={{ gridTemplateColumns: `repeat(${Math.max(allTileImages.length, 1)}, minmax(0, 1fr))` }}
        >
          {allTileImages.map(({ inst }) => (
              <div
                key={inst.id}
                className="h-full w-full bg-cover bg-center bg-no-repeat"
                style={backgroundStyleFor(instanceImageSrc(inst)) ?? undefined}
              />
            ))}
        </div>
        <div className="relative w-full px-3 pb-3 pt-1">
          <p
            className={`text-base font-bold leading-snug drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)] ${value === allKey ? 'text-gold' : 'text-white'}`}
          >
            {allLabel}
          </p>
        </div>
      </button>

      {/* Individual dungeon tiles */}
      {instances.map((inst) => (
        <button
          key={inst.id}
          onClick={() => onChange(String(inst.id))}
          className={`group relative flex aspect-[16/9] items-end overflow-hidden rounded-lg border transition-all duration-150 ${
            value === String(inst.id)
              ? 'border-gold/50 shadow-[0_0_12px_rgba(200,153,42,0.15)]'
              : 'border-border hover:border-gold/20'
          }`}
        >
          <div className="absolute inset-0 bg-black" />
          <MissingImageFallback />
          {instanceImageSrc(inst) && (
            <div className="absolute inset-0 overflow-hidden">
              <div
                className="absolute inset-0 bg-cover bg-center bg-no-repeat transition-all duration-300"
                style={backgroundStyleFor(instanceImageSrc(inst)) ?? undefined}
              />
            </div>
          )}
          <div className="relative w-full px-3 pb-3 pt-1">
            <p
              className={`text-base font-bold leading-snug drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)] ${
                value === String(inst.id) ? 'text-gold' : 'text-white'
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
