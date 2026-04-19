'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useSimContext } from './SimContext';
import { SavedRoute } from '../lib/types';
import { parseCharacterInfo } from '@/lib/simc-parser';
import { useWowheadTooltips } from '../lib/useWowheadTooltips';

interface RouteDetailsModalProps {
  route: SavedRoute;
  onClose: () => void;
  formatHealth?: (hp: number) => string;
  formatTime?: (s: number) => string;
}

export default function RouteDetailsModal({
  route,
  onClose,
  formatHealth: propFormatHealth,
  formatTime: propFormatTime,
}: RouteDetailsModalProps) {
  useWowheadTooltips();
  const { setSimcFooter } = useSimContext();
  const router = useRouter();
  const info = useMemo(() => parseCharacterInfo(route.route_data), [route.route_data]);

  const formatHealth =
    propFormatHealth ||
    ((hp: number) => {
      if (hp >= 1_000_000) return `${(hp / 1_000_000).toFixed(1)}M`;
      if (hp >= 1_000) return `${(hp / 1_000).toFixed(0)}K`;
      return hp.toString();
    });

  const formatTime =
    propFormatTime ||
    ((seconds: number) => {
      const mins = Math.floor(seconds / 60);
      const secs = seconds % 60;
      return `${mins}:${secs.toString().padStart(2, '0')}`;
    });

  if (info?.kind !== 'dungeon') {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-4 backdrop-blur-md">
        <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-zinc-950 p-8 text-center shadow-2xl">
          <p className="text-zinc-400">Failed to parse route data.</p>
          <button
            onClick={onClose}
            className="mt-4 rounded-xl bg-gold px-6 py-2 font-bold text-black"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  const totalDungeonHealth = info.pulls.reduce((sum, p) => sum + (p.totalHealth || 0), 0);
  const timerSeconds = route.timer_seconds || (info.maxTime ? Number(info.maxTime) : 0);

  const minGroupDps = timerSeconds > 0 ? totalDungeonHealth / timerSeconds : 0;
  // Assume Tank + Healer do 10% of total damage collectively.
  // Then 90% is done by the 3 DPS.
  const minPerDps = minGroupDps > 0 ? (minGroupDps * 0.9) / 3 : 0;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-4 backdrop-blur-md">
      <div className="flex h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-zinc-950 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/5 bg-white/[0.02] p-6">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gold/10 text-gold shadow-inner">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L16 4m0 13V4m0 0L9 7"
                />
              </svg>
            </div>
            <div>
              <h2 className="text-2xl font-black tracking-tight text-white">{route.name}</h2>
              <div className="flex items-center gap-3 text-sm font-medium text-zinc-500">
                <span>{route.dungeon}</span>
                <span className="h-1 w-1 rounded-full bg-zinc-800" />
                <span className="text-sky-400">+{route.level} Level</span>
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-xl bg-white/5 p-2 text-zinc-400 transition-all hover:bg-white/10 hover:text-white"
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Summary Stats */}
        <div className="grid grid-cols-6 gap-px bg-white/5">
          <div className="bg-zinc-950 p-4 text-center">
            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-600">
              Dungeon Timer
            </p>
            <p className="mt-1 text-xl font-bold text-amber-400">
              {timerSeconds > 0 ? formatTime(timerSeconds) : '-'}
            </p>
          </div>
          <div className="bg-zinc-950 p-4 text-center">
            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-600">
              Total Route HP
            </p>
            <p className="mt-1 text-xl font-bold text-emerald-400">
              {formatHealth(totalDungeonHealth)}
            </p>
          </div>
          <div className="bg-zinc-950 p-4 text-center">
            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-600">
              Total Pulls
            </p>
            <p className="mt-1 text-xl font-bold text-white">{info.pullCount}</p>
          </div>
          <div className="bg-zinc-950 p-4 text-center">
            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-600">
              Bloodlust Usage
            </p>
            <p className="mt-1 text-xl font-bold text-red-400">
              {info.pulls.filter((p) => p.bloodlust).length}x
            </p>
          </div>
          <div className="group relative cursor-help bg-zinc-950 p-4 text-center">
            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-600">
              Min. Group DPS
            </p>
            <p className="mt-1 text-xl font-bold text-sky-400">
              {minGroupDps > 0 ? Math.round(minGroupDps).toLocaleString() : '-'}
            </p>
            <div
              className="pointer-events-none absolute bottom-full left-1/2 z-[110] mb-2 w-48 -translate-x-1/2 rounded-lg bg-zinc-800 p-2 text-left text-[11px] font-medium text-zinc-200 opacity-0 shadow-xl transition-opacity group-hover:opacity-100">
              Calculated as:
              <br />
              <span className="text-emerald-400">
                Total HP ({formatHealth(totalDungeonHealth)})
              </span>{' '}
              / <span className="text-amber-400">Timer ({timerSeconds}s)</span>
            </div>
          </div>
          <div className="group relative cursor-help bg-zinc-950 p-4 text-center">
            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-600">
              Min. Per DPS (3)
            </p>
            <p className="mt-1 text-xl font-bold text-amber-400">
              {minPerDps > 0 ? Math.round(minPerDps).toLocaleString() : '-'}
            </p>
            <div
              className="pointer-events-none absolute bottom-full left-1/2 z-[110] mb-2 w-56 -translate-x-1/2 rounded-lg bg-zinc-800 p-2 text-left text-[11px] font-medium text-zinc-200 opacity-0 shadow-xl transition-opacity group-hover:opacity-100">
              Assumes 3 DPS players contribute <span className="text-gold">90%</span> of the
              required group damage ({Math.round(minGroupDps * 0.9).toLocaleString()} DPS total),
              while Tank/Healer provide the remaining 10%.
            </div>
          </div>
        </div>

        {/* Pull List */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="space-y-4">
            {info.pulls.map((pull, idx) => {
              const hasBoss = pull.enemies.some((e) => e.name.toLowerCase().includes('boss'));
              return (
                <div
                  key={idx}
                  className={`group relative flex overflow-hidden rounded-2xl border transition-all hover:shadow-xl ${hasBoss ? 'border-amber-500/30 bg-amber-500/[0.02]' : 'border-white/5 bg-white/[0.01]'}`}
                >
                  {/* Left Rail (PNum + Lust) */}
                  <div
                    className={`flex w-16 shrink-0 flex-col items-center justify-center border-r p-2 ${hasBoss ? 'border-amber-500/20 bg-amber-500/5' : 'border-white/5 bg-black/20'}`}
                  >
                    <span className="text-xl font-black text-zinc-600">
                      {pull.pull || String(idx + 1).padStart(2, '0')}
                    </span>
                    {pull.bloodlust && (
                      <div
                        className="mt-2 rounded bg-red-500 px-1.5 py-0.5 text-[9px] font-black text-white shadow-lg shadow-red-500/20">
                        LUST
                      </div>
                    )}
                  </div>

                  {/* Body */}
                  <div className="flex flex-1 flex-col p-4 sm:flex-row sm:items-center">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h4
                          className={`text-[15px] font-bold ${hasBoss ? 'text-amber-400' : 'text-white'}`}
                        >
                          {pull.name || `Pull ${pull.pull || idx + 1}`}
                        </h4>
                        {hasBoss && (
                          <span
                            className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[9px] font-black text-amber-500">
                            BOSS
                          </span>
                        )}
                      </div>

                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                        {pull.enemies.map((e, eIdx) => (
                          <div key={eIdx} className="flex items-center gap-1.5 text-[13px]">
                            <span className="font-black text-sky-400">{e.count}x</span>
                            <span className="font-medium text-zinc-300">{e.name}</span>
                            {e.health && (
                              <span className="text-[11px] text-zinc-600">
                                ({formatHealth(e.health)})
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Stats Right */}
                    <div className="mt-4 flex shrink-0 items-center gap-6 border-t border-white/5 pt-4 sm:mt-0 sm:border-0 sm:pt-0">
                      {pull.delay !== null && (
                        <div className="text-right">
                          <p className="text-[9px] font-black uppercase tracking-widest text-zinc-600">
                            Wait/Travel
                          </p>
                          <p className="font-mono text-sm font-bold text-zinc-400">{pull.delay}s</p>
                        </div>
                      )}
                      <div className="text-right">
                        <p className="text-[9px] font-black uppercase tracking-widest text-zinc-600">
                          Pull HP
                        </p>
                        <p className="font-mono text-[15px] font-black text-emerald-400">
                          {formatHealth(pull.totalHealth || 0)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-[9px] font-black uppercase tracking-widest text-zinc-600">
                          Progress
                        </p>
                        <p className="font-mono text-[15px] font-black text-sky-400">
                          {pull.progress ? `${pull.progress}%` : '-'}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between border-t border-white/5 bg-black/40 p-6">
          <div className="flex items-center gap-4 text-xs font-medium text-zinc-500">
            <div className="flex items-center gap-2">
              <div className="h-3 w-3 rounded-full border border-amber-500/40 bg-amber-500/20" />
              <span>Boss Encounter</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-3 w-3 rounded bg-red-500 shadow-sm" />
              <span>Bloodlust Target</span>
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => {
                navigator.clipboard.writeText(route.route_data);
                alert('Copied!');
              }}
              className="rounded-xl border border-white/10 bg-white/5 px-6 py-2.5 text-sm font-bold text-zinc-300 transition-all hover:bg-white/10 hover:text-white"
            >
              Copy SimC Data
            </button>
            <button
              onClick={() => {
                setSimcFooter(route.route_data);
                router.push('/quick-sim');
              }}
              className="rounded-xl bg-gold px-8 py-2.5 text-sm font-bold text-black transition-all hover:bg-gold/90 hover:shadow-lg hover:shadow-gold/20"
            >
              Load into Simulator
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
