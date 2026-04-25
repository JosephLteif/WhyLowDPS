import { useEffect, useState } from 'react';
import Link from 'next/link';
import { API_URL, fetchJson } from '../lib/api';
import { useSimContext } from './SimContext';
import { characterHref } from '../lib/routes';
import { CLASS_COLORS } from '../lib/types';

interface DpsHeroCardProps {
  playerName: string;
  playerClass: string;
  playerRealm?: string;
  playerRegion?: string;
  dps: number;
  dpsError?: number;
  dpsErrorPct?: number;
  fightLength?: number;
  desiredTargets?: number;
  iterations?: number;
  targetError?: number;
  elapsedTime?: number;
  stageTimings?: Array<{ name: string; elapsed: number }>;
  avgIlevel?: number;
  avgIlevelGain?: number;
  /** Optional content rendered between the DPS number and the metadata bar */
  children?: React.ReactNode;
}

const FACTION_ICONS: Record<string, string> = {
  alliance: '/api/data/static/faction-alliance.png',
  horde: '/api/data/static/faction-horde.png',
};

const FACTION_BGS: Record<string, string> = {
  alliance: '/api/data/static/faction-bg-alliance.jpg',
  horde: '/api/data/static/faction-bg-horde.jpg',
};

function classColorFromLabel(label: string | undefined): string | undefined {
  if (!label) return undefined;
  const normalized = label.trim().toLowerCase().replace(/[_-]+/g, ' ');
  if (!normalized) return undefined;

  const classAliases: Array<[alias: string, classKey: string]> = [
    ['death knight', 'death_knight'],
    ['demon hunter', 'demon_hunter'],
    ['warrior', 'warrior'],
    ['paladin', 'paladin'],
    ['hunter', 'hunter'],
    ['rogue', 'rogue'],
    ['priest', 'priest'],
    ['shaman', 'shaman'],
    ['mage', 'mage'],
    ['warlock', 'warlock'],
    ['monk', 'monk'],
    ['druid', 'druid'],
    ['evoker', 'evoker'],
  ];

  for (const [alias, classKey] of classAliases) {
    if (normalized === alias || normalized.endsWith(` ${alias}`)) {
      return CLASS_COLORS[classKey];
    }
  }

  return undefined;
}

function useFaction(
  realm: string | undefined,
  name: string | undefined,
  region: string | undefined
): string | null {
  const [faction, setFaction] = useState<string | null>(null);

  useEffect(() => {
    if (!realm || !name) return;
    const realmSlug = realm.toLowerCase().replace(/'/g, '').replace(/\s+/g, '-');
    let cancelled = false;
    (async () => {
      try {
        const url = new URL(
          `${API_URL}/api/blizzard/character/${encodeURIComponent(realmSlug)}/${encodeURIComponent(name.toLowerCase())}/profile`,
          window.location.origin
        );
        if (region) url.searchParams.set('region', region.toLowerCase());

        const data = await fetchJson<any>(url.toString());
        if (!cancelled && data.faction) {
          if (typeof data.faction === 'string') {
            setFaction(data.faction.toLowerCase());
          } else if (data.faction.type) {
            setFaction(data.faction.type.toLowerCase());
          }
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [realm, name, region]);

  return faction;
}

export default function DpsHeroCard({
  playerName,
  playerClass,
  playerRealm,
  playerRegion,
  dps,
  dpsError,
  dpsErrorPct,
  fightLength,
  iterations,
  targetError,
  desiredTargets,
  elapsedTime,
  stageTimings,
  avgIlevel,
  avgIlevelGain,
  children,
}: DpsHeroCardProps) {
  const hasMetadata =
    (dpsError != null && dpsError > 0) ||
    fightLength != null ||
    (iterations != null && iterations > 0) ||
    elapsedTime != null ||
    avgIlevel != null;

  const faction = useFaction(playerRealm, playerName, playerRegion);
  const playerClassColor = classColorFromLabel(playerClass);

  const [factionIconVisible, setFactionIconVisible] = useState(true);

  return (
    <div className="card overflow-hidden">
      <div className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-[#091022] via-[#101027] to-[#2a0a0f]" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_28%,rgba(118,88,255,0.26),transparent_38%),radial-gradient(circle_at_86%_32%,rgba(190,42,42,0.22),transparent_45%)]" />

        {faction && FACTION_BGS[faction] && (
          <img
            src={FACTION_BGS[faction]}
            alt=""
            className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-18"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
        )}

        <div className="relative flex min-h-[108px] items-center justify-center gap-3 px-5 py-3 sm:px-6">
          <div className="relative text-center">
            <div className="mb-0.5 flex items-center justify-center gap-2">
              {playerRealm ? (
                <Link
                  href={characterHref(playerRegion || 'us', playerRealm, playerName)}
                  className="text-[1.75rem] font-black leading-none tracking-tight text-white transition-colors hover:text-gold"
                >
                  {playerName}
                </Link>
              ) : (
                <p className="text-[1.75rem] font-black leading-none tracking-tight text-white">{playerName}</p>
              )}
              {faction && (
                <span className="rounded-md border border-white/20 bg-black/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-zinc-200">
                  {faction}
                </span>
              )}
            </div>
            <p className="text-[1rem] font-medium leading-tight" style={{ color: playerClassColor || undefined }}>
              {playerClass}
            </p>
            <p className="mt-1 text-[3.2rem] font-black tabular-nums leading-none tracking-tight text-white">
              {Math.round(dps).toLocaleString()}
            </p>
            <p className="mt-0.5 text-[0.66rem] font-semibold uppercase tracking-[0.18em] text-zinc-100">
              Damage Per Second
            </p>
            <div className="mt-1 flex justify-center">{children}</div>
          </div>

          {faction && FACTION_ICONS[faction] && factionIconVisible && (
            <div className="pointer-events-none absolute right-5 top-1/2 hidden -translate-y-1/2 md:block">
              <div
                className={`absolute inset-0 rounded-full blur-3xl ${
                  faction === 'horde' ? 'bg-red-600/20' : 'bg-blue-600/20'
                }`}
              />
              <img
                src={FACTION_ICONS[faction]}
                alt={faction}
                className="relative h-14 w-14 object-contain opacity-90"
                onError={() => setFactionIconVisible(false)}
              />
            </div>
          )}
        </div>
      </div>
      {hasMetadata && (
        <div className="flex items-center justify-center gap-px border-t border-border bg-surface-2">
          {avgIlevel != null && (
            <MetaStat
              label="Item Level"
              value={avgIlevel.toFixed(2)}
              note={
                avgIlevelGain != null && avgIlevelGain !== 0
                  ? `(${avgIlevelGain > 0 ? '+' : ''}${avgIlevelGain.toFixed(2)})`
                  : undefined
              }
              noteColor={
                avgIlevelGain != null && avgIlevelGain > 0
                  ? 'text-emerald-400'
                  : avgIlevelGain != null && avgIlevelGain < 0
                    ? 'text-red-400'
                    : undefined
              }
            />
          )}
          {dpsError != null && dpsError > 0 && (
            <MetaStat
              label="Margin of Error"
              value={`+/- ${Math.round(dpsError).toLocaleString()}`}
              note={dpsErrorPct != null ? `${dpsErrorPct}%` : undefined}
            />
          )}
          {fightLength != null && (
            <MetaStat label="Fight Length" value={formatDuration(fightLength)} />
          )}
          {desiredTargets != null && desiredTargets > 0 && (
            <MetaStat
              label="Targets"
              value={desiredTargets === 1 ? '1 Boss' : `${desiredTargets} Bosses`}
            />
          )}
          {iterations != null && iterations > 0 && (
            <MetaStat
              label="Iterations"
              value={iterations.toLocaleString()}
              note={targetError != null && targetError > 0 ? 'Smart Sim' : undefined}
            />
          )}
          {elapsedTime != null && (
            <MetaStat
              label="Time"
              value={formatElapsed(elapsedTime)}
              tooltip={
                stageTimings && stageTimings.length > 0
                  ? stageTimings.map((s) => `${s.name}: ${formatElapsed(s.elapsed)}`).join('\n')
                  : undefined
              }
            />
          )}
        </div>
      )}
    </div>
  );
}

function MetaStat({
  label,
  value,
  note,
  noteColor,
  tooltip,
}: {
  label: string;
  value: string;
  note?: string;
  noteColor?: string;
  tooltip?: string;
}) {
  const tooltipLines = tooltip
    ? tooltip
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
    : [];

  return (
    <div className="group relative flex-1 px-4 py-3 text-center">
      <p className="text-sm uppercase tracking-wider text-zinc-300">{label}</p>
      <p className="mt-0.5 text-sm font-medium tabular-nums text-zinc-100">
        {value}
        {note && (
          <span className={`ml-1 text-sm font-normal ${noteColor || 'text-zinc-300'}`}>{note}</span>
        )}
      </p>
      {tooltipLines.length > 0 && (
        <div className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 hidden w-max max-w-[320px] -translate-x-1/2 rounded-lg border border-border bg-surface px-3 py-2 text-left shadow-xl group-hover:block">
          <p className="mb-1 text-[10px] uppercase tracking-widest text-zinc-500">Stage Times</p>
          <div className="space-y-1">
            {tooltipLines.map((line, idx) => (
              <p key={idx} className="font-mono text-[12px] leading-tight text-zinc-200">
                {line}
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function formatDuration(seconds: number): string {
  const min = Math.floor(seconds / 60);
  const sec = String(Math.round(seconds % 60)).padStart(2, '0');
  return `${min}:${sec}`;
}

function formatElapsed(seconds: number): string {
  if (seconds >= 60) {
    const min = Math.floor(seconds / 60);
    const sec = String(Math.round(seconds % 60)).padStart(2, '0');
    return `${min}:${sec}`;
  }
  return `${seconds.toFixed(1)}s`;
}
