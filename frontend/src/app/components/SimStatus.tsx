'use client';

import { useEffect, useRef, useState } from 'react';
import { API_URL } from '../lib/api';

interface SimStatusProps {
  status: string;
  progress: number;
  progressStage?: string;
  progressDetail?: string;
  stagesCompleted?: string[];
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

/**
 * Tracks server-reported progress. Only advances when the backend
 * reports a higher value (i.e. a profileset or stage actually completed).
 * The CSS transition on the bar handles visual smoothing.
 */
function useSmoothedProgress(serverProgress: number): number {
  const [display, setDisplay] = useState(serverProgress);

  useEffect(() => {
    setDisplay((prev) => Math.max(prev, serverProgress));
  }, [serverProgress]);

  return Math.round(display);
}

function formatBytes(bytes: number) {
  if (!bytes) return '0 MB';
  const mb = bytes / 1024 / 1024;
  return `${mb.toFixed(1)} MB`;
}



function classifyLine(line: string): string {
  if (line.startsWith('SimulationCraft ')) return 'text-gold/70';
  if (line.startsWith('Simulating...')) return 'text-gray-500';
  if (line.startsWith('Generating Baseline:') || line.startsWith('Generating Profileset:'))
    return 'text-gray-500';
  if (line.startsWith('Implementation Not Yet Verified')) return 'text-amber-500/60 italic';
  if (
    line.startsWith('Generating reports') ||
    line.startsWith('DPS Ranking:') ||
    line.startsWith('Profilesets (') ||
    line.startsWith('HPS Ranking:') ||
    line.startsWith('Baseline Performance:')
  )
    return 'text-gray-300';
  if (/^\s+\d+\.\d+\s*:\s*Combo\s/.test(line)) return 'text-gray-500';
  return 'text-gray-500';
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
          <span className="text-[12px] font-medium uppercase tracking-wider text-gray-500">
            SimC Output
          </span>
        </div>
        <span className="font-mono text-[12px] tabular-nums text-gray-600">
          {lines.length} lines
        </span>
      </div>
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="max-h-[320px] overflow-y-auto rounded-b-lg border border-border bg-[#0c0c0e] p-3 font-mono text-[13px] leading-[1.7]"
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
  stagesCompleted,
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
  const displayProgress = useSmoothedProgress(progress);
  const title = progressStage || (isPending ? 'Queued' : 'Simulating');
  const hasStages = stagesCompleted && stagesCompleted.length > 0;

  async function handleCancel() {
    if (!jobId || cancelling) return;
    setCancelling(true);
    try {
      await fetch(`${API_URL}/api/sim/${jobId}/cancel`, { method: 'POST' });
      onCancelled?.();
    } catch {
      // ignore
    } finally {
      setCancelling(false);
    }
  }

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
        {progressDetail && <p className="mt-1 text-[13px] text-zinc-500">{progressDetail}</p>}
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
              <span className="text-zinc-200 font-medium">{profilesetsCompleted || 0}</span> / {profilesetsTotal} combos
            </p>
          ) : iterations && iterationsCompleted !== undefined ? (
            <p className="text-[12px] text-zinc-400">
              <span className="text-zinc-200 font-medium">{iterationsCompleted}</span> / {iterations} iterations
            </p>
          ) : null}
        </div>
      </div>

      {isRunning && (
        <div className="flex w-80 flex-wrap justify-center gap-x-6 gap-y-3 rounded-xl border border-border bg-surface p-4 shadow-sm">
          {cpuPct !== undefined && cpuPct > 0 && (
            <div className="flex flex-col items-center">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">CPU Usage</span>
              <span className="mt-1 font-mono text-[13px] text-zinc-200">{cpuPct.toFixed(1)}%</span>
            </div>
          )}
          {cpuCores !== undefined && cpuCores > 0 && (
            <div className="flex flex-col items-center">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Cores</span>
              <span className="mt-1 font-mono text-[13px] text-zinc-200">{cpuCores}</span>
            </div>
          )}
          {memBytes !== undefined && memBytes > 0 && (
            <div className="flex flex-col items-center">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Memory</span>
              <span className="mt-1 font-mono text-[13px] text-zinc-200">{formatBytes(memBytes)}</span>
            </div>
          )}
          {iterations && (
            <div className="flex flex-col items-center">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Iterations</span>
              <span className="mt-1 font-mono text-[13px] text-zinc-200">{(iterations / 1000).toFixed(0)}k</span>
            </div>
          )}
          {fightStyle && (
            <div className="flex flex-col items-center">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Style</span>
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
            className="rounded-lg px-3 py-1 text-[14px] text-gray-500 transition-colors hover:bg-red-500/10 hover:text-red-400"
          >
            {cancelling ? 'Cancelling...' : 'Cancel Sim'}
          </button>
          {onToggleLogs && (
            <button
              onClick={onToggleLogs}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1 text-[14px] text-gray-500 transition-colors hover:bg-white/5 hover:text-gray-300"
            >
              <svg
                className="h-3.5 w-3.5"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="2" y="3" width="12" height="10" rx="1.5" />
                <path d="M5 7l2 2 2-2" />
              </svg>
              {showLogs ? 'Hide Logs' : 'Show Logs'}
            </button>
          )}
        </div>
      )}

      {hasStages && (
        <div className="w-72 space-y-1 pt-2">
          {stagesCompleted!.map((stage, i) => (
            <div key={i} className="flex items-center gap-2">
              <svg
                className="h-3 w-3 shrink-0 text-emerald-500"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 5L6.5 10.5L4 8" />
              </svg>
              <span className="text-[13px] text-gray-400">{stage}</span>
            </div>
          ))}
          {progressStage && (
            <div className="flex items-center gap-2">
              <div className="flex h-3 w-3 shrink-0 items-center justify-center">
                <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-gold" />
              </div>
              <span className="text-[13px] text-gray-400">
                {progressStage}
                {progressDetail && <span className="text-gray-500"> · {progressDetail}</span>}
              </span>
            </div>
          )}
        </div>
      )}

      {showLogs && logLines && logLines.length > 0 && <LogConsole lines={logLines} />}
    </div>
  );
}
