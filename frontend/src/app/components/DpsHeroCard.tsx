import { useEffect, useState } from 'react';
import Link from 'next/link';
import { API_URL, fetchJson } from '../lib/api';
import { useSimContext } from './SimContext';
import { characterHref } from '../lib/routes';

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

function useFaction(
  realm: string | undefined,
  name: string | undefined,
  region: string | undefined
): string | null {
  const [faction, setFaction] = useState<string | null>(null);

  useEffect(() => {
    if (!realm || !name) return;
    let cancelled = false;
    (async () => {
      try {
        const url = new URL(
          `${API_URL}/api/blizzard/character/${encodeURIComponent(realm.toLowerCase())}/${encodeURIComponent(name.toLowerCase())}/profile`,
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

  const insetUrl =
    playerRealm && playerName
      ? `${API_URL}/api/blizzard/character/${encodeURIComponent(playerRealm.toLowerCase())}/${encodeURIComponent(playerName.toLowerCase())}/media/inset${playerRegion ? `?region=${playerRegion.toLowerCase()}` : ''}`
      : null;

  return (
    <div className="card overflow-hidden">
      <div className="relative overflow-hidden px-8 pb-6 pt-8 text-center">
        {faction && (faction === 'horde' || faction === 'alliance') && (
          <div
            className={`pointer-events-none absolute inset-0 ${
              faction === 'horde' ? 'bg-red-950/50' : 'bg-blue-950/50'
            }`}
            style={{
              maskImage: 'linear-gradient(to left, black 20%, transparent 60%)',
              WebkitMaskImage: 'linear-gradient(to left, black 20%, transparent 60%)',
            }}
          />
        )}
        {faction && FACTION_BGS[faction] && (
          <img
            src={`${API_URL}${FACTION_BGS[faction]}`}
            alt=""
            className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-20"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
        )}
        {insetUrl && (
          <img
            src={insetUrl}
            alt=""
            className="pointer-events-none absolute bottom-0 left-0 h-[130%] w-auto -translate-x-1/4 object-contain opacity-50"
            style={{
              maskImage: 'linear-gradient(to right, black 50%, transparent 95%)',
              WebkitMaskImage: 'linear-gradient(to right, black 50%, transparent 95%)',
            }}
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
        )}
        {faction && FACTION_ICONS[faction] && (
          <img
            src={`${API_URL}${FACTION_ICONS[faction]}`}
            alt=""
            className="pointer-events-none absolute bottom-0 right-[5%] top-[0%] h-[100%] w-auto object-contain opacity-20"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
        )}
        <div className="relative">
          {playerRealm ? (
            <Link
              href={characterHref(playerRegion || 'us', playerRealm, playerName)}
              className="text-2xl font-bold tracking-tight text-white transition-colors hover:text-gold"
            >
              {playerName}
            </Link>
          ) : (
            <p className="text-2xl font-bold tracking-tight text-white">{playerName}</p>
          )}
          <p className="mt-0.5 text-sm font-medium text-gold/70">{playerClass}</p>
          <p className="mt-4 text-5xl font-bold tabular-nums tracking-tight text-white">
            {Math.round(dps).toLocaleString()}
          </p>
          <p className="mt-1.5 text-sm font-medium uppercase tracking-widest text-zinc-200">
            Damage Per Second
          </p>
          {children}
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
