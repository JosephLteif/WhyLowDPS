'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_URL, DungeonAffix, DungeonInfo, type MythicKeystoneDungeonDetail } from '../lib/api';
import type { Instance } from '../drop-finder/types';

const DUNGEON_PLACEHOLDERS: Record<string, { icon: string; zone: string }> = {
  'Siege of Boralus': { icon: 'https://wow.zamimages.com/logo/PoS.jpg', zone: 'Darkshore' },
  Atalzar: { icon: 'https://wow.zamimages.com/logo/Atalzar.jpg', zone: 'Nazmir' },
  Freehold: { icon: 'https://wow.zamimages.com/logo/Freehold.jpg', zone: 'Zuldazar' },
  'Kings Rest': { icon: 'https://wow.zamimages.com/logo/KingsRest.jpg', zone: 'Zuldazar' },
};

export type DisplayAffix = DungeonAffix & { wowhead_url?: string | null };
export type WowheadZoneIndexEntry = {
  id?: number; name?: string; is_raid?: boolean; expansion?: number | null; encounters?: Array<{ name?: string }>;
};
export type WowheadZonesIndexSummary = {
  zones?: Array<{ id?: number; name?: string }>;
  raids?: Array<{ id?: number; name?: string; expansion?: number | null; encounters?: string[] }>;
};

export function normalizeDungeonName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}
export function normalizeMplusName(name: string): string {
  return String(name || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}
export function normalizeAffixName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}
export function normalizeImageUrl(url?: string | null): string | undefined { return url ?? undefined; }
export function getLocalInstanceImageUrl(instanceId?: number | null): string | null {
  if (!instanceId || instanceId <= 0) return null;
  return `${API_URL}/api/data/images/instance/${instanceId}?v=bapi3`;
}
export function getRaidInstances(instances: Instance[]): Instance[] {
  return instances.filter((instance) => String(instance.type || '').toLowerCase() === 'raid');
}
export function getCurrentMplusDungeonIds(instances: Instance[]): Set<number> {
  const mplusBucket = instances.find((i) => i.type === 'mplus-chest') || instances.find((i) => i.name.toLowerCase() === 'mythic+ dungeons');
  if (!mplusBucket || !mplusBucket.encounters?.length) return new Set<number>();
  return new Set<number>(mplusBucket.encounters.map((encounter) => encounter.id));
}
export function mergeWithInstancesFallback(dungeons: DungeonInfo[], instances: Instance[]): DungeonInfo[] {
  if (!instances.length) return dungeons;
  const instancesById = new Map<number, Instance>();
  const instancesByName = new Map<string, Instance>();
  for (const instance of instances) {
    instancesById.set(instance.id, instance);
    instancesByName.set(normalizeDungeonName(instance.name), instance);
  }
  return dungeons.map((dungeon) => {
    const fallback = instancesById.get(dungeon.id) || instancesByName.get(normalizeDungeonName(dungeon.name));
    if (!fallback) return dungeon;
    const fallbackEncounterNames = (fallback.encounters ?? []).map((e) => e.name).filter((name): name is string => !!name);
    const mergedEncounters = (dungeon.encounters?.length ?? 0) > 0 ? (dungeon.encounters ?? []) : fallbackEncounterNames;
    return { ...dungeon, zone: dungeon.zone || fallback.zone || null, encounters: mergedEncounters, num_bosses: dungeon.num_bosses ?? (mergedEncounters.length || null) };
  });
}

function formatMs(ms?: number | null): string | null {
  if (!ms || ms <= 0) return null;
  const totalSeconds = Math.floor(ms / 1000);
  return `${Math.floor(totalSeconds / 60)}:${(totalSeconds % 60).toString().padStart(2, '0')}`;
}
export function fallbackUpgradeTimers(timerMs?: number | null, upgradeLevels?: number[]) {
  if (!timerMs || timerMs <= 0) return [];
  const levels = upgradeLevels?.length ? upgradeLevels : [1, 2, 3];
  return levels
    .map((level) => {
      const multiplier = level === 1 ? 1 : level === 2 ? 0.8 : level === 3 ? 0.6 : null;
      if (!multiplier) return null;
      return {
        upgrade_level: level,
        qualifying_duration: Math.floor(timerMs * multiplier),
      };
    })
    .filter((timer): timer is { upgrade_level: number; qualifying_duration: number } => !!timer);
}
function getDungeonPlaceholder(name: string) {
  const lower = name.toLowerCase();
  for (const [key, val] of Object.entries(DUNGEON_PLACEHOLDERS)) if (lower.includes(key.toLowerCase())) return val;
  return null;
}

export function AffixCard({ affix }: { affix: DisplayAffix }) {
  const iconUrl = affix.icon || null;
  const description = String(affix.description || '').trim();
  return (
    <div className="flex items-center gap-3 rounded-lg border border-white/15 bg-zinc-900/75 p-4">
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md border border-white/10 bg-zinc-800">
        {iconUrl ? <img src={iconUrl} alt="" className="h-10 w-10 rounded object-cover" loading="lazy" /> : <span className="text-xl font-bold text-gold">{affix.name[0]}</span>}
      </div>
      <div className="min-w-0 flex-1">
        <p className="mb-1 text-lg font-bold text-zinc-100">{affix.name}</p>
        {description ? (
          <p className="line-clamp-2 text-xs text-zinc-400">{description}</p>
        ) : null}
      </div>
    </div>
  );
}

export function DungeonCard({ dungeon, mplusDetail, detailsBasePath }: { dungeon: DungeonInfo; mplusDetail?: MythicKeystoneDungeonDetail | null; detailsBasePath: '/dungeons/details' | '/raids/details' }) {
  const router = useRouter();
  const detailsHref = `${detailsBasePath}/?id=${encodeURIComponent(String(dungeon.id))}`;
  const placeholder = !dungeon.image_url ? getDungeonPlaceholder(dungeon.name) : null;
  const imageUrl = getLocalInstanceImageUrl(dungeon.id) || dungeon.image_url || placeholder?.icon;
  const [imageFailed, setImageFailed] = useState(false);
  const isMplusDetailLoading = mplusDetail === undefined;
  const detailUpgrades = (mplusDetail?.keystone_upgrades ?? []).map((u) => ({ upgrade_level: Number(u?.upgrade_level ?? 0), qualifying_duration: Number(u?.qualifying_duration ?? 0) })).filter((u) => u.upgrade_level > 0 && u.qualifying_duration > 0);
  const dungeonUpgradeLevels = (dungeon.keystone_upgrades ?? [])
    .map((upgrade) => Number(upgrade))
    .filter((upgrade) => Number.isFinite(upgrade) && upgrade > 0)
    .sort((a, b) => a - b);
  const fallbackUpgrades = isMplusDetailLoading
    ? []
    : fallbackUpgradeTimers(dungeon.keystone_timer_ms, dungeonUpgradeLevels);
  const displayedUpgrades = detailUpgrades.length > 0 ? detailUpgrades : fallbackUpgrades;
  const encounterCount = dungeon.encounters?.length || dungeon.num_bosses || null;
  const wowheadZoneUrl = dungeon.wowhead_id && dungeon.wowhead_id > 0 ? `https://www.wowhead.com/zone=${dungeon.wowhead_id}` : null;
  return (
    <article role="button" tabIndex={0} onClick={() => router.push(detailsHref)} className="group block rounded-xl border border-white/15 bg-zinc-900/80 p-4 transition-all hover:border-gold/50 hover:bg-zinc-900">
      {imageUrl && !imageFailed ? <div className="relative mb-3 h-28 w-full overflow-hidden rounded-lg border border-white/10 bg-zinc-900"><img src={imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" onError={() => setImageFailed(true)} /></div> : null}
      <div className="mb-3 min-w-0">
        <p className="truncate text-xl font-bold text-zinc-100 sm:text-2xl">{dungeon.name}</p>
        {dungeon.zone ? <p className="truncate text-sm text-zinc-300">{dungeon.zone}</p> : null}
        {wowheadZoneUrl ? (
          <div className="mt-2">
            <a href={wowheadZoneUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center rounded-md border border-gold/35 bg-gold/10 px-2 py-1 text-xs font-semibold text-gold transition-colors hover:bg-gold/20">
              View on Wowhead
            </a>
          </div>
        ) : null}
      </div>
      {isMplusDetailLoading ? (
        <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Loading keystone timers">
          {[1, 2, 3].map((idx) => (
            <span
              key={`${dungeon.id}-timer-skeleton-${idx}`}
              className="h-5 w-16 animate-pulse rounded bg-white/10"
            />
          ))}
        </div>
      ) : displayedUpgrades.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">{displayedUpgrades.map((u) => <span key={`${dungeon.id}-${u.upgrade_level}`} className="rounded bg-gold/10 px-2 py-0.5 text-[11px] text-gold">+{u.upgrade_level} ({formatMs(u.qualifying_duration)})</span>)}</div>
      ) : dungeonUpgradeLevels.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {dungeonUpgradeLevels.map((upgrade) => (
            <span key={`${dungeon.id}-upgrade-${upgrade}`} className="rounded bg-gold/10 px-2 py-0.5 text-[11px] text-gold">+{upgrade}</span>
          ))}
        </div>
      ) : null}
      {dungeon.encounters && dungeon.encounters.length > 0 ? (
        <div className="mt-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">Encounters ({encounterCount})</p>
          <ul className="space-y-1 text-sm text-zinc-100">
            {dungeon.encounters.map((encounter) => <li key={`${dungeon.id}-${encounter}`}>{encounter}</li>)}
          </ul>
        </div>
      ) : null}
    </article>
  );
}
