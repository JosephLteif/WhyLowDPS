'use client';

import { useState } from 'react';
import {
  DungeonSeasonData,
  DungeonAffix,
  DungeonInfo,
} from '../lib/api';
import { useWowheadTooltips } from '../lib/useWowheadTooltips';

const DUNGEON_PLACEHOLDERS: Record<string, { icon: string; zone: string }> = {
  'Siege of Boralus': { icon: 'https://wow.zamimages.com/logo/PoS.jpg', zone: 'Darkshore' },
  'Atalzar': { icon: 'https://wow.zamimages.com/logo/Atalzar.jpg', zone: 'Nazmir' },
  'Freehold': { icon: 'https://wow.zamimages.com/logo/Freehold.jpg', zone: 'Zuldazar' },
  'Kings Rest': { icon: 'https://wow.zamimages.com/logo/KingsRest.jpg', zone: 'Zuldazar' },
  'Temple of Sethraliss': { icon: 'https://wow.zamimages.com/logo/TempleSethraliss.jpg', zone: 'Zuljan Reach' },
  'Shrine of the Storm': { icon: 'https://wow.zamimages.com/logo/Shrine.jpg', zone: 'Vol dun' },
  'Necrotic Wake': { icon: 'https://wow.zamimages.com/logo/NecroticWake.jpg', zone: 'Maldraxxus' },
  'Plaguefall': { icon: 'https://wow.zamimages.com/logo/Plaguefall.jpg', zone: 'Maldraxxus' },
  'Halls of Atonement': { icon: 'https://wow.zamimages.com/logo/HallsAtonement.jpg', zone: 'Maldraxxus' },
  'Spires of Ascension': { icon: 'https://wow.zamimages.com/logo/SpiresAscension.jpg', zone: 'Bastion' },
  'Sanguine Depths': { icon: 'https://wow.zamimages.com/logo/SanguineDepths.jpg', zone: 'Maldraxxus' },
  'Theater of Pain': { icon: 'https://wow.zamimages.com/logo/TheaterPain.jpg', zone: 'Maldraxxus' },
  'Tazavesh': { icon: 'https://wow.zamimages.com/logo/Tazavesh.jpg', zone: 'Mechagon' },
};

function getDungeonPlaceholder(name: string) {
  const lower = name.toLowerCase();
  for (const [key, val] of Object.entries(DUNGEON_PLACEHOLDERS)) {
    if (lower.includes(key.toLowerCase())) {
      return val;
    }
  }
  return null;
}

function formatMs(ms?: number | null): string | null {
  if (!ms || ms <= 0) return null;
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function AffixCard({ affix }: { affix: DungeonAffix }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 p-3">
      {affix.spell_id ? (
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-zinc-800" data-wowhead={`spell=${affix.spell_id}`}>
          {affix.icon ? (
            <img src={affix.icon} alt="" className="h-10 w-10 rounded object-cover" />
          ) : (
            <span className="text-xl font-bold text-gold">{affix.name[0]}</span>
          )}
        </div>
      ) : (
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-zinc-800">
          <span className="text-xl font-bold text-gold">{affix.name[0]}</span>
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate font-bold text-zinc-200">{affix.name}</p>
        <p className="line-clamp-2 text-xs text-zinc-500">{affix.description}</p>
      </div>
    </div>
  );
}

function InfoPill({ label, value }: { label: string; value?: string | number | null }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <span className="rounded-md border border-white/10 bg-black/20 px-2 py-1 text-[11px] text-zinc-300">
      <span className="mr-1 text-zinc-500">{label}:</span>
      {value}
    </span>
  );
}

function DungeonCard({
  dungeon,
}: {
  dungeon: DungeonInfo;
  seasonName?: string;
}) {

  const placeholder = !dungeon.image_url ? getDungeonPlaceholder(dungeon.name) : null;
  const imageUrl = dungeon.image_url || placeholder?.icon;
  const zone = dungeon.zone || placeholder?.zone;
  const timer = formatMs(dungeon.keystone_timer_ms);
  const rawPayload = dungeon.blizzard_api_data ? JSON.stringify(dungeon.blizzard_api_data, null, 2) : null;

  return (
    <div className="group flex flex-col rounded-xl border border-white/10 bg-white/5 p-4 transition-all hover:border-gold/50 hover:bg-white/[0.05]">
      <div className="mb-3 flex gap-3">
        {imageUrl ? (
          <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md bg-zinc-800">
            <img src={imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
          </div>
        ) : (
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md bg-zinc-800">
            <span className="text-2xl font-bold text-zinc-600">{dungeon.name[0]}</span>
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold text-zinc-200">{dungeon.name}</p>
          {zone && <p className="truncate text-xs text-zinc-500">{zone}</p>}
          {dungeon.description && (
            <p className="mt-1 line-clamp-2 text-xs text-zinc-400">{dungeon.description}</p>
          )}
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        <InfoPill label="Min level" value={dungeon.minimum_level} />
        <InfoPill label="Timer" value={timer} />
        <InfoPill label="Map ID" value={dungeon.map_id} />
        <InfoPill label="Challenge ID" value={dungeon.challenge_mode_id} />
        <InfoPill label="Slug" value={dungeon.slug} />
        <InfoPill label="Short" value={dungeon.short_name} />
      </div>

      {dungeon.keystone_upgrades && dungeon.keystone_upgrades.length > 0 && (
        <div className="mb-2">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Keystone Upgrades</p>
          <div className="flex flex-wrap gap-1.5">
            {dungeon.keystone_upgrades.map((upgrade) => (
              <span key={upgrade} className="rounded bg-gold/10 px-2 py-0.5 text-[11px] text-gold">
                +{upgrade}
              </span>
            ))}
          </div>
        </div>
      )}

      {dungeon.encounters && dungeon.encounters.length > 0 && (
        <div className="mb-2">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Encounters ({dungeon.num_bosses})</p>
          <ul className="space-y-1 text-xs text-zinc-300">
            {dungeon.encounters.map((encounter) => (
              <li key={encounter}>{encounter}</li>
            ))}
          </ul>
        </div>
      )}

      {rawPayload && (
        <details className="mt-2 rounded-md border border-white/10 bg-black/20 p-2">
          <summary className="cursor-pointer text-xs font-semibold text-zinc-400">Blizzard API Raw Data</summary>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-[10px] leading-4 text-zinc-400">
            {rawPayload}
          </pre>
        </details>
      )}
    </div>
  );
}

export default function DungeonsPage() {
  const [data] = useState<DungeonSeasonData | null>(null);
  const [loading] = useState(true);
  const [error] = useState<string | null>(null);
  const hasDungeons = (data?.rotation_dungeons?.length ?? 0) > 0;

  useWowheadTooltips([data?.current_affixes, data?.rotation_dungeons]);

  if (loading) {
    return (
      <div className="flex h-96 flex-col items-center justify-center gap-4">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-zinc-800 border-t-gold" />
        <p className="text-sm font-medium text-zinc-500">Loading dungeon data...</p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="mx-auto max-w-lg py-20 text-center">
        <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-red-500/10 text-red-500">
          <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h2 className="mb-2 text-xl font-bold text-zinc-200">Failed to Load Data</h2>
        <p className="mb-6 text-zinc-500">{error}</p>
        <button onClick={() => window.location.reload()} className="rounded-lg bg-gold px-4 py-2 text-sm font-bold text-black">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-100">Mythic+ Dungeons</h1>
          <p className="mt-1 text-sm font-medium text-zinc-500">
            {data?.season_name || 'Current Season'}
          </p>
        </div>
      </div>

      {data && (
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Season</p>
            <p className="mt-1 text-lg font-bold text-zinc-100">{data.season_name}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Dungeons</p>
            <p className="mt-1 text-lg font-bold text-zinc-100">{data.rotation_dungeons.length}</p>
            <p className="text-sm text-zinc-500">Currently in rotation</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Affixes</p>
            <p className="mt-1 text-lg font-bold text-zinc-100">{data.current_affixes.length}</p>
            <p className="text-sm text-zinc-500">Active this week</p>
          </div>
        </section>
      )}

      {data?.current_affixes && data.current_affixes.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-500">This Week&apos;s Affixes</h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {data.current_affixes.map((affix) => (
              <AffixCard key={affix.id} affix={affix} />
            ))}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-500">
          Season Dungeons ({data?.rotation_dungeons?.length || 0})
        </h2>
        {hasDungeons &&
          !(data?.rotation_dungeons?.some((d) => d.blizzard_href || d.blizzard_api_data) ?? false) && (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              Blizzard dungeon detail payload is missing in local runtime cache. Showing best available fallback data from instances.
            </div>
          )}
        {data?.rotation_dungeons && data.rotation_dungeons.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.rotation_dungeons.map((dungeon) => (
              <DungeonCard key={dungeon.id} dungeon={dungeon} seasonName={data.season_name} />
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-white/8 bg-white/[0.02] px-4 py-6 text-center">
            <p className="text-sm text-zinc-500">No dungeons available</p>
            <p className="mt-2 text-xs text-zinc-600">Dungeon data is currently unavailable.</p>
          </div>
        )}
      </section>

    </div>
  );
}
