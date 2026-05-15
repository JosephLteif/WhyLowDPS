'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, ScrollText } from 'lucide-react';
import { API_URL } from '../lib/api';
import { formatElapsedCompact, formatMegabytes } from '../lib/format';

interface StageTiming {
  name: string;
  elapsed: number;
}

interface SimStatusProps {
  status: string;
  progress: number;
  progressStage?: string;
  progressDetail?: string;
  createdAt?: string;
  stagesCompleted?: string[];
  stageTimings?: StageTiming[];
  activeStageElapsed?: number;
  jobId?: string;
  onCancelled?: () => void;
  logLines?: string[];
  showLogs?: boolean;
  onToggleLogs?: () => void;
  profilesetsCompleted?: number;
  profilesetsTotal?: number;
  cpuPct?: number;
  memBytes?: number;
  cpuCores?: number;
  iterations?: number;
  iterationsCompleted?: number;
  fightStyle?: string;
}

function useSmoothedProgress(serverProgress: number): number {
  const [display, setDisplay] = useState(serverProgress);

  useEffect(() => {
    setDisplay((prev) => Math.max(prev, serverProgress));
  }, [serverProgress]);

  return Math.round(display);
}

function classifyLine(line: string): string {
  if (line.startsWith('SimulationCraft ')) return 'text-gold/70';
  if (line.startsWith('Simulating...')) return 'text-zinc-300';
  if (line.startsWith('Generating Baseline:') || line.startsWith('Generating Profileset:'))
    return 'text-zinc-300';
  if (line.startsWith('Implementation Not Yet Verified')) return 'text-amber-500/60 italic';
  if (
    line.startsWith('Generating reports') ||
    line.startsWith('DPS Ranking:') ||
    line.startsWith('Profilesets (') ||
    line.startsWith('HPS Ranking:') ||
    line.startsWith('Baseline Performance:')
  )
    return 'text-gray-300';
  if (/^\s+\d+\.\d+\s*:\s*Combo\s/.test(line)) return 'text-zinc-300';
  return 'text-zinc-300';
}

function LogConsole({ lines }: { lines: string[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isAutoScroll = useRef(true);

  useEffect(() => {
    if (isAutoScroll.current && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [lines]);

  function handleScroll() {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    isAutoScroll.current = scrollHeight - scrollTop - clientHeight < 30;
  }

  return (
    <div className="w-full">
      <div className="flex items-center justify-between rounded-t-lg border border-b-0 border-border bg-surface px-3 py-1.5">
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-gold/60" />
          <span className="text-sm font-medium uppercase tracking-wider text-zinc-200">
            SimC Output
          </span>
        </div>
        <span className="font-mono text-sm tabular-nums text-zinc-300">{lines.length} lines</span>
      </div>
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="max-h-[320px] overflow-y-auto rounded-b-lg border border-border bg-[#0c0c0e] p-3 font-mono text-sm leading-[1.7]"
      >
        {lines.map((line, i) => (
          <div key={i} className={`whitespace-pre-wrap break-all ${classifyLine(line)}`}>
            {line || '\u00A0'}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function SimStatus({
  status,
  progress,
  progressStage,
  progressDetail,
  createdAt,
  stagesCompleted,
  stageTimings = [],
  activeStageElapsed,
  jobId,
  onCancelled,
  logLines,
  showLogs,
  onToggleLogs,
  profilesetsCompleted,
  profilesetsTotal,
  cpuPct,
  memBytes,
  cpuCores,
  iterations,
  iterationsCompleted,
  fightStyle,
}: SimStatusProps) {
  const isRunning = status === 'running';
  const isPending = status === 'pending';
  const [cancelling, setCancelling] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const displayProgress = useSmoothedProgress(progress);
  const title = progressStage || (isPending ? 'Queued' : 'Simulating');
  const hasStages = stagesCompleted && stagesCompleted.length > 0;

  useEffect(() => {
    if (!createdAt || !isRunning) {
      setElapsedSeconds(0);
      return;
    }

    const started = new Date(createdAt).getTime();
    if (!Number.isFinite(started)) {
      setElapsedSeconds(0);
      return;
    }

    const update = () => setElapsedSeconds((Date.now() - started) / 1000);
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [createdAt, isRunning]);

  async function handleCancel() {
    if (!jobId || cancelling) return;
    setCancelling(true);
    try {
      await fetch(`${API_URL}/api/sim/${jobId}/cancel`, { method: 'POST', credentials: 'include' });
      onCancelled?.();
    } catch {
      // ignore
    } finally {
      setCancelling(false);
    }
  }

  const runningStageElapsed =
    activeStageElapsed != null ? Math.max(0, activeStageElapsed) : elapsedSeconds;

  return (
    <div className="flex flex-col items-center justify-center space-y-6 py-16">
      <div className="relative">
        <div className="h-12 w-12 animate-spin rounded-full border-2 border-zinc-800 border-t-gold" />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="h-2 w-2 animate-pulse rounded-full bg-gold/60" />
        </div>
      </div>

      <div className="text-center">
        <p className="text-sm font-semibold text-zinc-100">{title}</p>
        {progressDetail && <p className="mt-1 text-sm text-zinc-300">{progressDetail}</p>}
      </div>

      <div className="w-80">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
          <div
            className="h-full rounded-full bg-gradient-to-r from-gold-dark to-gold transition-all duration-700"
            style={{ width: `${Math.max(displayProgress, status === 'pending' ? 2 : 5)}%` }}
          />
        </div>
        <div className="mt-3 flex items-center justify-between">
          <p className="font-mono text-[13px] font-medium text-gold">{displayProgress}%</p>
          {profilesetsTotal ? (
            <p className="text-[12px] text-zinc-400">
              <span className="font-medium text-zinc-200">{profilesetsCompleted || 0}</span> /{' '}
              {profilesetsTotal} combos
            </p>
          ) : iterations && iterationsCompleted !== undefined ? (
            <p className="text-[12px] text-zinc-400">
              <span className="font-medium text-zinc-200">{iterationsCompleted}</span> /{' '}
              {iterations} iterations
            </p>
          ) : null}
        </div>
      </div>

      {isRunning && (
        <div className="flex w-80 flex-wrap justify-center gap-x-6 gap-y-3 rounded-xl border border-border bg-surface p-4 shadow-sm">
          <div className="flex flex-col items-center">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
              Elapsed
            </span>
            <span className="mt-1 font-mono text-[13px] text-zinc-200">
              {formatElapsedCompact(elapsedSeconds)}
            </span>
          </div>
          {cpuPct !== undefined && cpuPct > 0 && (
            <div className="flex flex-col items-center">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                CPU Usage
              </span>
              <span className="mt-1 font-mono text-[13px] text-zinc-200">{cpuPct.toFixed(1)}%</span>
            </div>
          )}
          {cpuCores !== undefined && cpuCores > 0 && (
            <div className="flex flex-col items-center">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                Cores
              </span>
              <span className="mt-1 font-mono text-[13px] text-zinc-200">{cpuCores}</span>
            </div>
          )}
          {memBytes !== undefined && memBytes > 0 && (
            <div className="flex flex-col items-center">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                Memory
              </span>
              <span className="mt-1 font-mono text-[13px] text-zinc-200">
                {formatMegabytes(memBytes)}
              </span>
            </div>
          )}
          {iterations && (
            <div className="flex flex-col items-center">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                Iterations
              </span>
              <span className="mt-1 font-mono text-[13px] text-zinc-200">
                {(iterations / 1000).toFixed(0)}k
              </span>
            </div>
          )}
          {fightStyle && (
            <div className="flex flex-col items-center">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                Style
              </span>
              <span className="mt-1 text-[13px] text-zinc-200">{fightStyle}</span>
            </div>
          )}
        </div>
      )}

      {jobId && (isRunning || isPending) && (
        <div className="flex items-center gap-3">
          <button
            onClick={handleCancel}
            disabled={cancelling}
            className="rounded-md border border-red-500/30 bg-red-500/[0.08] px-2.5 py-1 text-[12px] font-semibold text-red-200 transition-all hover:border-red-400/40 hover:bg-red-500/[0.14] hover:text-red-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {cancelling ? 'Cancelling...' : 'Cancel Sim'}
          </button>
          {onToggleLogs && (
            <button
              onClick={onToggleLogs}
              className="flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[12px] font-semibold text-zinc-300 transition-all hover:border-white/20 hover:bg-white/10 hover:text-white"
            >
              <ScrollText className="h-3.5 w-3.5" strokeWidth={1.5} />
              {showLogs ? 'Hide Logs' : 'Show Logs'}
            </button>
          )}
        </div>
      )}

      {hasStages && (
        <div className="w-72 space-y-1 pt-2">
          {stagesCompleted!.map((stage, i) => (
            <div key={i} className="flex items-center gap-2">
              <Check className="h-3 w-3 shrink-0 text-emerald-500" strokeWidth={2.5} />
              <span className="text-sm text-zinc-300">
                {stage}
                {stageTimings[i] && (
                  <span className="text-gray-500">
                    {' '}
                    took {formatElapsedCompact(stageTimings[i].elapsed)}
                  </span>
                )}
              </span>
            </div>
          ))}
          {progressStage && (
            <div className="flex items-center gap-2">
              <div className="flex h-3 w-3 shrink-0 items-center justify-center">
                <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-gold" />
              </div>
              <span className="text-sm text-zinc-300">
                {progressStage}
                <span className="text-gray-500"> - {formatElapsedCompact(runningStageElapsed)}</span>
                {progressDetail && <span className="text-zinc-300"> - {progressDetail}</span>}
              </span>
            </div>
          )}
        </div>
      )}

      {showLogs && logLines && logLines.length > 0 && <LogConsole lines={logLines} />}
    </div>
  );
}
