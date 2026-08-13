'use client';

import type { DungeonAffix, DungeonInfo, MythicKeystoneDungeonDetail } from '../lib/api';

export type DisplayAffix = DungeonAffix;

export function AffixCard({ affix }: { affix: DisplayAffix }) {
  const description = String(affix.description || '').trim();
  return (
    <div className="flex items-center gap-3 rounded-lg border border-white/15 bg-zinc-900/75 p-4">
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md border border-white/10 bg-zinc-800">
        {affix.icon ? (
          <img src={affix.icon} alt="" className="h-10 w-10 rounded object-cover" loading="lazy" />
        ) : (
          <span className="text-xl font-bold text-gold">{affix.name[0]}</span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="mb-1 text-lg font-bold text-zinc-100">{affix.name}</p>
        {description ? <p className="line-clamp-2 text-xs text-zinc-400">{description}</p> : null}
      </div>
    </div>
  );
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

export function DungeonCard({
  dungeon,
  mplusDetail,
  showDetails = true,
}: {
  dungeon: DungeonInfo;
  mplusDetail?: MythicKeystoneDungeonDetail | null;
  showDetails?: boolean;
}) {
  if (!showDetails) {
    return (
      <article className="rounded-xl border border-white/15 bg-zinc-900/80 p-4">
        <p className="truncate text-xl font-bold text-zinc-100 sm:text-2xl">{dungeon.name}</p>
      </article>
    );
  }

  const isMplusDetailLoading = mplusDetail === undefined;
  const detailUpgrades = (mplusDetail?.keystone_upgrades ?? [])
    .map((upgrade) => ({
      upgrade_level: Number(upgrade?.upgrade_level ?? 0),
      qualifying_duration: Number(upgrade?.qualifying_duration ?? 0),
    }))
    .filter((upgrade) => upgrade.upgrade_level > 0 && upgrade.qualifying_duration > 0);
  const dungeonUpgradeLevels = (dungeon.keystone_upgrades ?? [])
    .map((upgrade) => Number(upgrade))
    .filter((upgrade) => Number.isFinite(upgrade) && upgrade > 0)
    .sort((a, b) => a - b);
  const fallbackUpgrades = isMplusDetailLoading
    ? []
    : fallbackUpgradeTimers(dungeon.keystone_timer_ms, dungeonUpgradeLevels);
  const displayedUpgrades = detailUpgrades.length > 0 ? detailUpgrades : fallbackUpgrades;
  const encounterCount = dungeon.encounters?.length || dungeon.num_bosses || null;

  return (
    <article className="rounded-xl border border-white/15 bg-zinc-900/80 p-4">
      <div className="mb-3 min-w-0">
        <p className="truncate text-xl font-bold text-zinc-100 sm:text-2xl">{dungeon.name}</p>
        {dungeon.zone ? <p className="truncate text-sm text-zinc-300">{dungeon.zone}</p> : null}
      </div>

      {isMplusDetailLoading ? (
        <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Loading keystone timers">
          {[1, 2, 3].map((idx) => (
            <span
              key={`${dungeon.id}-timer-skeleton-${idx}`}
              className="h-5 w-20 animate-pulse rounded bg-white/10"
            />
          ))}
        </div>
      ) : displayedUpgrades.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Keystone score and timers">
          {displayedUpgrades.map((upgrade) => (
            <span
              key={`${dungeon.id}-${upgrade.upgrade_level}`}
              className="rounded bg-gold/10 px-2 py-0.5 text-[11px] text-gold"
            >
              Score +{upgrade.upgrade_level} ({formatMs(upgrade.qualifying_duration)})
            </span>
          ))}
        </div>
      ) : dungeon.keystone_timer_ms ? (
        <p className="mt-2 text-xs font-semibold text-gold">
          Timer: {formatMs(dungeon.keystone_timer_ms)}
        </p>
      ) : null}

      {dungeon.encounters && dungeon.encounters.length > 0 ? (
        <div className="mt-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">
            Encounters ({encounterCount})
          </p>
          <ul className="space-y-1 text-sm text-zinc-100">
            {dungeon.encounters.map((encounter, index) => (
              <li key={`${dungeon.id}-${index}-${encounter}`}>{encounter}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </article>
  );
}
