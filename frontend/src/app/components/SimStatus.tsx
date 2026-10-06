'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Check,
  Clock3,
  ListOrdered,
  Pause,
  Play,
  ScrollText,
  TriangleAlert,
} from 'lucide-react';
import { API_URL, pauseSim, resumeSim, setSimCores } from '../lib/api';
import { formatElapsedCompact, formatEta, formatMegabytes } from '../lib/format';

interface StageTiming {
  name: string;
  elapsed: number;
}

interface SimStatusProps {
  status: string;
  progress: number;
  queuePosition?: number | null;
  progressStage?: string;
  progressDetail?: string;
  createdAt?: string;
  stagesCompleted?: string[];
  stageTimings?: StageTiming[];
  activeStageElapsed?: number;
  jobId?: string;
  onCancelled?: () => void;
  onStatusChange?: (status: 'pending' | 'running' | 'paused') => void;
  resumeAvailable?: boolean;
  onRerun?: () => void;
  rerunning?: boolean;
  logLines?: string[];
  showLogs?: boolean;
  onToggleLogs?: () => void;
  profilesetsCompleted?: number;
  profilesetsTotal?: number;
  cpuPct?: number;
  memBytes?: number;
  cpuCores?: number;
  maxCpuCores?: number;
  coresAvailable?: boolean;
  iterations?: number;
  iterationsCompleted?: number;
  fightStyle?: string;
}

export interface PhaseLogInfo {
  phase: 'Profileset' | 'Baseline';
  name: string;
  profilesetCompleted?: number;
  profilesetTotal?: number;
  simulationCompleted?: number;
  simulationTotal?: number;
  simulationPercent?: number;
  iterationsPerSecond?: number;
  mean?: number;
  errorPercent?: number;
  remainingSeconds: number | null;
}

function useSmoothedProgress(serverProgress: number): number {
  const [display, setDisplay] = useState(serverProgress);

  useEffect(() => {
    setDisplay((prev) => Math.max(prev, serverProgress));
  }, [serverProgress]);

  return Math.round(display);
}

function classifyLine(line: string): string {
  if (line.startsWith('SimulationCraft ')) return 'text-gold';
  if (line.startsWith('Simulating...')) return 'text-zinc-300';
  if (line.startsWith('Generating Baseline:') || line.startsWith('Generating Profileset:'))
    return 'text-zinc-300';
  if (line.startsWith('Implementation Not Yet Verified')) return 'text-amber-400 italic';
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

export function parseLatestPhaseLog(lines: string[] = []): PhaseLogInfo | null {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    const header = line.match(/^Generating (Profileset|Baseline):\s*(.*)/);
    if (!header) continue;

    const remainingMatch = line.match(/\((?:(\d+)m\s*,?\s*)?(\d+(?:\.\d+)?)s\)\s*$/i);
    const progress = header[2].match(
      /^(.*?)\s*(\d+)\/(\d+)\s+(?:\[[^\]]*\]\s+)?(\d+)\/(\d+)(?:\s+([\d.]+)(?=\s|$))?(?:\s+Mean=([-+\d.]+)\s+Error=([-+\d.]+)%)?/
    );
    // The value after the iteration counts is throughput, not a percentage.

    const remainingSeconds = remainingMatch
      ? Number(remainingMatch[1] || 0) * 60 + Number(remainingMatch[2])
      : null;

    return {
      phase: header[1] as PhaseLogInfo['phase'],
      name: (progress?.[1] ?? header[2].split(/\s+\d+\/\d+/)[0]).split('|')[0].trim() || header[1],
      ...(progress
        ? {
            ...(header[1] === 'Profileset'
              ? { profilesetCompleted: Number(progress[2]), profilesetTotal: Number(progress[3]) }
              : {}),
            simulationCompleted: Number(progress[4]),
            simulationTotal: Number(progress[5]),
            simulationPercent:
              Number(progress[5]) > 0
                ? Math.min(100, (Number(progress[4]) / Number(progress[5])) * 100)
                : 0,
            ...(progress[6] ? { iterationsPerSecond: Number(progress[6]) } : {}),
            ...(progress[7]
              ? { mean: Number(progress[7]), errorPercent: Number(progress[8]) }
              : {}),
          }
        : {}),
      remainingSeconds: Number.isFinite(remainingSeconds) ? remainingSeconds : null,
    };
  }

  return null;
}

export function parseLiveSimulationLogs(lines: string[] = []) {
  let latest: PhaseLogInfo | null = null;
  let samples: number[] = [];
  const completed = new Map<string, PhaseLogInfo>();
  const notes = new Map<string, number>();
  let targetError: number | undefined;
  let version: string | undefined;

  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('SimulationCraft ')) version = line;
    if (line.startsWith('Simulating...')) {
      // A staged simulation starts a new comparison; never rank across stages.
      completed.clear();
      samples = [];
      latest = null;
      const target = line.match(/target_error=([\d.]+)/);
      targetError = target ? Number(target[1]) : undefined;
    }
    if (line.startsWith('Implementation Not Yet Verified')) {
      const note = line.replace(/^Implementation Not Yet Verified:\s*/, '');
      notes.set(note, (notes.get(note) ?? 0) + 1);
    }
    const phase = parseLatestPhaseLog([line]);
    if (!phase) continue;
    if (phase.phase !== latest?.phase || phase.name !== latest?.name) samples = [];
    latest = phase;
    if (phase.mean !== undefined && Number.isFinite(phase.mean)) {
      samples.push(phase.mean);
      if (samples.length > 80) samples.shift();
      if (phase.simulationTotal && phase.simulationCompleted === phase.simulationTotal) {
        completed.set(`${phase.phase}:${phase.name}`, phase);
      }
    }
  }

  return {
    latest,
    samples,
    completed: [...completed.values()].sort((a, b) => (b.mean ?? 0) - (a.mean ?? 0)),
    notes: [...notes].map(([text, count]) => ({ text, count })),
    targetError,
    version,
  };
}

export function extractLatestPhaseRemainingSeconds(lines: string[] = []): number | null {
  return parseLatestPhaseLog(lines)?.remainingSeconds ?? null;
}

function LogConsole({ lines }: { lines: string[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isAutoScroll = useRef(true);
  const [keyOnly, setKeyOnly] = useState(true);
  const visibleLines = useMemo(() => {
    if (!keyOnly) return lines;
    const keyLines = new Map<string, number>();
    lines.forEach((line, index) => {
      const phase = parseLatestPhaseLog([line]);
      if (phase) {
        const key = `${phase.phase}:${phase.name}`;
        keyLines.set(key, index);
      } else if (
        /^(SimulationCraft |Simulating\.\.\.|Implementation Not Yet Verified|Generating reports|DPS Ranking:|HPS Ranking:|Baseline Performance:|\s+\d+\.\d+\s*:)|\b(error|warning|failed)\b/i.test(
          line
        )
      ) {
        if (!keyLines.has(line)) keyLines.set(line, index);
      }
    });
    return [...keyLines.values()].sort((a, b) => a - b).map((index) => lines[index]);
  }, [keyOnly, lines]);

  useEffect(() => {
    if (isAutoScroll.current && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [visibleLines]);

  function handleScroll() {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    isAutoScroll.current = scrollHeight - scrollTop - clientHeight < 30;
  }

  return (
    <div className="w-full">
      <div className="border-border bg-surface flex flex-wrap items-center justify-between gap-2 rounded-t-lg border border-b-0 px-3 py-1.5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium tracking-wider text-zinc-200 uppercase">
            SimC Output
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1" aria-label="Log detail">
            {[true, false].map((keys) => (
              <button
                key={String(keys)}
                type="button"
                aria-pressed={keyOnly === keys}
                onClick={() => setKeyOnly(keys)}
                className={`focus-visible:ring-gold min-h-9 rounded-md px-2 text-xs font-medium focus-visible:ring-2 ${keyOnly === keys ? 'bg-gold/10 text-gold' : 'text-zinc-400 hover:text-zinc-100'}`}
              >
                {keys ? 'Key lines' : 'Everything'}
              </button>
            ))}
          </div>
          <span className="text-xs text-zinc-400 tabular-nums">{lines.length} lines</span>
        </div>
      </div>
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="border-border max-h-[320px] overflow-y-auto rounded-b-lg border bg-[#0c0c0e] p-3 font-mono text-sm leading-[1.7]"
      >
        {visibleLines.length === 0 && <p className="text-zinc-400">Waiting for key output…</p>}
        {visibleLines.map((line, i) => (
          <div key={i} className={`break-all whitespace-pre-wrap ${classifyLine(line)}`}>
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
  queuePosition,
  progressStage,
  progressDetail,
  createdAt,
  stagesCompleted,
  stageTimings = [],
  activeStageElapsed,
  jobId,
  onCancelled,
  onStatusChange,
  resumeAvailable = true,
  onRerun,
  rerunning = false,
  logLines,
  showLogs,
  onToggleLogs,
  profilesetsCompleted,
  profilesetsTotal,
  cpuPct,
  memBytes,
  cpuCores,
  maxCpuCores,
  coresAvailable,
  iterations,
  iterationsCompleted,
  fightStyle,
}: SimStatusProps) {
  const isRunning = status === 'running';
  const isPending = status === 'pending';
  const isPaused = status === 'paused';
  const [cancelling, setCancelling] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [updatingCores, setUpdatingCores] = useState(false);
  const [selectedCores, setSelectedCores] = useState<number | null>(null);
  const [actionError, setActionError] = useState('');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [displayedStageElapsed, setDisplayedStageElapsed] = useState(activeStageElapsed ?? 0);
  const previousStageRef = useRef(progressStage);
  const displayProgress = useSmoothedProgress(progress);
  const title = isPaused
    ? 'Paused'
    : progressStage || (isPending ? 'Queued for simulation' : 'Simulating');
  const hasStages = !!stagesCompleted?.length || !!progressStage;
  const live = useMemo(() => parseLiveSimulationLogs(logLines), [logLines]);
  const phaseLogInfo = isPending ? null : live.latest;
  const baseline = live.completed.find((phase) => phase.phase === 'Baseline')?.mean;
  const meanDelta =
    phaseLogInfo?.mean !== undefined && baseline !== undefined
      ? phaseLogInfo.mean - baseline
      : undefined;
  const chartMin = Math.min(...live.samples, ...(baseline !== undefined ? [baseline] : []));
  const chartMax = Math.max(...live.samples, ...(baseline !== undefined ? [baseline] : []));
  const chartRange = Math.max(chartMax - chartMin, Math.abs(chartMax) * 0.002, 1);
  const chartY = (value: number) => 112 - ((value - chartMin) / chartRange) * 88;
  const chartPoints = live.samples
    .map(
      (mean, index) =>
        `${12 + (index / Math.max(live.samples.length - 1, 1)) * 576},${chartY(mean)}`
    )
    .join(' ');
  const remainingSeconds = phaseLogInfo?.remainingSeconds ?? null;
  const hasServerProfilesetProgress = (profilesetsTotal ?? 0) > 0;
  const displayedProfilesetsCompleted = hasServerProfilesetProgress
    ? profilesetsCompleted
    : phaseLogInfo?.profilesetCompleted;
  const displayedProfilesetsTotal = hasServerProfilesetProgress
    ? profilesetsTotal
    : phaseLogInfo?.profilesetTotal;
  const displayedIterationsCompleted = phaseLogInfo?.simulationCompleted ?? iterationsCompleted;
  const displayedIterationsTotal = phaseLogInfo?.simulationTotal ?? iterations;
  const parsedProfilesetProgress =
    phaseLogInfo?.profilesetCompleted !== undefined && phaseLogInfo.profilesetTotal !== undefined
      ? `${phaseLogInfo.profilesetCompleted}/${phaseLogInfo.profilesetTotal} profilesets`
      : null;
  const displayedProgressDetail = parsedProfilesetProgress
    ? progressDetail?.includes('·')
      ? progressDetail.split('·').slice(1).join('·').trim() || undefined
      : progressDetail
    : progressDetail;
  const displayedCores = selectedCores ?? cpuCores;
  const maxCores = Math.max(maxCpuCores ?? 0, cpuCores ?? 0, displayedCores ?? 0);
  const canChangeCores =
    !!jobId &&
    (isRunning || isPaused) &&
    coresAvailable !== false &&
    displayedCores !== undefined &&
    displayedCores > 0 &&
    maxCores > 0;

  useEffect(() => {
    setSelectedCores(null);
  }, [cpuCores]);

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

  useEffect(() => {
    const serverElapsed = activeStageElapsed ?? 0;
    const stageChanged = previousStageRef.current !== progressStage;
    previousStageRef.current = progressStage;
    setDisplayedStageElapsed((previous) =>
      stageChanged ? Math.max(0, serverElapsed) : Math.max(previous, serverElapsed)
    );

    if (!isRunning || activeStageElapsed == null) return;
    const timer = window.setInterval(() => {
      setDisplayedStageElapsed((previous) => previous + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [activeStageElapsed, isRunning, progressStage]);

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

  async function handlePause() {
    if (!jobId || transitioning || !resumeAvailable) return;
    setActionError('');
    setTransitioning(true);
    try {
      await pauseSim(jobId);
      onStatusChange?.('paused');
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Unable to pause simulation');
    } finally {
      setTransitioning(false);
    }
  }

  async function handleResume() {
    if (!jobId || transitioning || !resumeAvailable) return;
    setActionError('');
    setTransitioning(true);
    try {
      const response = await resumeSim(jobId);
      onStatusChange?.(response.status);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Unable to resume simulation');
    } finally {
      setTransitioning(false);
    }
  }

  async function handleCoresChange(nextCores: number) {
    if (!jobId || updatingCores || !Number.isInteger(nextCores) || nextCores < 1) return;
    setActionError('');
    setSelectedCores(nextCores);
    setUpdatingCores(true);
    try {
      const response = await setSimCores(jobId, nextCores);
      setSelectedCores(response.cores);
    } catch (error) {
      setSelectedCores(null);
      setActionError(error instanceof Error ? error.message : 'Unable to change simulation cores');
    } finally {
      setUpdatingCores(false);
    }
  }

  const runningStageElapsed = activeStageElapsed != null ? displayedStageElapsed : elapsedSeconds;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 py-6 sm:py-8">
      <div className="border-border bg-surface sticky top-[calc(var(--app-header-height)+3rem)] z-40 rounded-xl border p-4 sm:p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            {isPaused ? (
              <Pause className="text-gold mt-1 h-5 w-5 shrink-0" />
            ) : isPending ? (
              <Clock3 className="text-gold mt-1 h-5 w-5 shrink-0" />
            ) : (
              <Activity className="text-gold mt-1 h-5 w-5 shrink-0" />
            )}
            <div className="min-w-0">
              <h2 className="text-xl font-semibold text-zinc-100 sm:text-2xl">{title}</h2>
              {phaseLogInfo && (
                <p className="mt-1 text-sm break-words text-zinc-300">
                  {phaseLogInfo.name}
                  {phaseLogInfo.phase === 'Profileset' && displayedProfilesetsTotal ? (
                    <span className="text-zinc-400">
                      {' '}
                      · {displayedProfilesetsCompleted ?? 0} / {displayedProfilesetsTotal}{' '}
                      profilesets
                    </span>
                  ) : null}
                </p>
              )}
              {!isPending && displayedProgressDetail && (
                <p className="mt-1 text-sm text-zinc-300">{displayedProgressDetail}</p>
              )}
            </div>
          </div>
          {!isPending && remainingSeconds !== null && (
            <div className="shrink-0 text-right">
              <p className="text-xs text-zinc-400">
                {isPaused ? 'Last time estimate' : 'Estimated time left'}
              </p>
              <p className="mt-1 text-2xl font-semibold text-zinc-100 tabular-nums">
                {formatEta(remainingSeconds)}
              </p>
            </div>
          )}
        </div>
        {hasStages && !isPending && (
          <ol
            aria-label="Simulation stages"
            className="border-border mt-4 flex min-w-0 items-center gap-2 overflow-x-auto border-t pt-3 pb-1"
          >
            {stagesCompleted?.map((stage, index) => (
              <li key={`${stage}-${index}`} className="flex shrink-0 items-center gap-2">
                {index > 0 && (
                  <span className="text-zinc-500" aria-hidden="true">
                    ›
                  </span>
                )}
                <Check
                  className="h-3.5 w-3.5 shrink-0 text-emerald-400"
                  strokeWidth={2.5}
                  aria-hidden="true"
                />
                <span className="max-w-32 truncate text-xs text-zinc-300" title={stage}>
                  {stage}
                </span>
                {stageTimings[index] && (
                  <span className="text-xs text-zinc-400">
                    {formatElapsedCompact(stageTimings[index].elapsed)}
                  </span>
                )}
              </li>
            ))}
            {progressStage && (
              <li
                className="flex shrink-0 items-center gap-2"
                aria-current={isRunning || isPaused ? 'step' : undefined}
              >
                {stagesCompleted?.length ? (
                  <span className="text-zinc-500" aria-hidden="true">
                    ›
                  </span>
                ) : null}
                <span
                  className={`bg-gold h-2 w-2 shrink-0 rounded-full ${isPaused ? '' : 'animate-pulse'}`}
                  aria-hidden="true"
                />
                <span
                  className="max-w-40 truncate text-xs font-medium text-zinc-100"
                  title={progressStage}
                >
                  {progressStage}
                </span>
                {!isPaused && (
                  <span className="text-xs text-zinc-400">
                    {formatElapsedCompact(runningStageElapsed)}
                  </span>
                )}
              </li>
            )}
          </ol>
        )}
        {!isPending && (
          <div className="mt-5">
            <div
              role="progressbar"
              aria-label="Overall simulation progress"
              aria-valuenow={displayProgress}
              aria-valuemin={0}
              aria-valuemax={100}
              className="bg-surface-2 h-1.5 overflow-hidden rounded-full"
            >
              <div
                className="bg-gold h-full rounded-full transition-[width] duration-700 motion-reduce:transition-none"
                style={{ width: `${displayProgress}%` }}
              />
            </div>
            <div className="mt-2 flex justify-between gap-3 text-xs text-zinc-400">
              <span className="text-gold tabular-nums">{displayProgress}% overall</span>
              {displayedProfilesetsTotal ? (
                <span className="tabular-nums">
                  {displayedProfilesetsCompleted ?? 0} / {displayedProfilesetsTotal} profilesets
                </span>
              ) : (
                <span>Updates from SimulationCraft</span>
              )}
            </div>
          </div>
        )}
        {jobId && (isRunning || isPending || isPaused) && (
          <div
            className="border-border mt-4 flex flex-wrap items-center gap-2 border-t pt-3"
            aria-label="Simulation controls"
          >
            {cpuCores !== undefined && cpuCores > 0 && canChangeCores && (
              <label className="flex items-center gap-2 text-xs text-zinc-400">
                Cores
                <select
                  aria-label="CPU cores used by this simulation"
                  className="bg-surface border-border focus:border-gold/60 focus-visible:ring-gold min-h-9 rounded border px-2 font-mono text-sm text-zinc-200 outline-none focus-visible:ring-2 disabled:cursor-wait disabled:opacity-60"
                  value={displayedCores}
                  disabled={updatingCores}
                  onChange={(event) => void handleCoresChange(Number(event.target.value))}
                  title="Change the CPU cores allocated to this running simulation"
                >
                  {Array.from({ length: maxCores }, (_, index) => index + 1).map((cores) => (
                    <option key={cores} value={cores}>
                      {cores}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {isPaused ? (
              <button
                onClick={handleResume}
                disabled={transitioning || !resumeAvailable}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-emerald-400/30 bg-emerald-500/[0.08] px-3 text-xs font-semibold text-emerald-200 transition-all hover:border-emerald-300/50 hover:bg-emerald-500/[0.14] disabled:cursor-not-allowed disabled:opacity-60"
                title={
                  resumeAvailable
                    ? 'Resume this simulation'
                    : 'Resume unavailable after backend restart'
                }
              >
                <Play className="h-3.5 w-3.5" />
                {transitioning
                  ? 'Resuming...'
                  : resumeAvailable
                    ? 'Resume Sim'
                    : 'Resume Unavailable'}
              </button>
            ) : (
              <button
                onClick={handlePause}
                disabled={transitioning || !resumeAvailable}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-sky-400/30 bg-sky-500/[0.08] px-3 text-xs font-semibold text-sky-200 transition-all hover:border-sky-300/50 hover:bg-sky-500/[0.14] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Pause className="h-3.5 w-3.5" />
                {transitioning ? 'Pausing...' : 'Pause Sim'}
              </button>
            )}
            {isPaused && !resumeAvailable && onRerun && (
              <button
                onClick={onRerun}
                disabled={rerunning}
                className="min-h-9 rounded-md border border-white/10 bg-white/5 px-3 text-xs font-semibold text-zinc-300 transition-all hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {rerunning ? 'Rerunning...' : 'Rerun Input'}
              </button>
            )}
            <button
              onClick={handleCancel}
              disabled={cancelling}
              className="min-h-9 rounded-md border border-red-500/30 bg-red-500/[0.08] px-3 text-xs font-semibold text-red-200 transition-all hover:border-red-400/40 hover:bg-red-500/[0.14] hover:text-red-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {cancelling ? 'Cancelling...' : 'Cancel Sim'}
            </button>
            {onToggleLogs && (
              <button
                onClick={onToggleLogs}
                className="flex min-h-9 items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-3 text-xs font-semibold text-zinc-300 transition-all hover:border-white/20 hover:bg-white/10 hover:text-white"
              >
                <ScrollText className="h-3.5 w-3.5" strokeWidth={1.5} />
                {showLogs ? 'Hide Logs' : 'Show Logs'}
              </button>
            )}
            {actionError && (
              <p className="text-xs text-red-300" role="alert">
                {actionError}
              </p>
            )}
          </div>
        )}
        {live.version && !isPending && (
          <p className="mt-4 truncate text-xs text-zinc-400" title={live.version}>
            {live.version}
          </p>
        )}
      </div>

      {isPending ? (
        <div
          className="border-gold/25 bg-gold/[0.06] w-full max-w-2xl rounded-2xl border px-4 py-4 sm:px-5"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-start gap-3">
            <span className="border-gold/25 bg-gold/10 text-gold mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border">
              <ListOrdered className="h-4 w-4" strokeWidth={2} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-zinc-100">
                Waiting for an available SimC slot
              </p>
              <p className="mt-1 text-xs leading-5 text-zinc-400">
                The simulation has not started yet and will begin automatically when its turn
                arrives.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
                <span className="text-gold font-mono font-semibold">
                  {queuePosition ? `Queue position #${queuePosition}` : 'Queue position pending'}
                </span>
                <span className="text-zinc-600">·</span>
                <Link href="/queue" className="text-gold font-semibold hover:underline">
                  Manage queue
                </Link>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid w-full gap-4 lg:grid-cols-2">
        {phaseLogInfo && (
          <section
            className="border-border bg-surface min-w-0 rounded-xl border p-4 sm:p-5"
            aria-label="Current simulation"
          >
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-zinc-200">
                {isPaused ? 'Paused on' : 'Now simming'}
              </h3>
              <span
                className="truncate text-right text-[13px] text-zinc-200"
                title={phaseLogInfo.name}
              >
                {phaseLogInfo.name}
              </span>
            </div>
            <dl className="border-border mt-4 grid grid-cols-2 gap-4 border-t pt-4 sm:grid-cols-3">
              {phaseLogInfo.mean !== undefined && (
                <div>
                  <dt
                    className="text-xs text-zinc-400"
                    title="The current mean of SimC's configured performance metric"
                  >
                    Live estimate
                  </dt>
                  <dd className="mt-1 text-2xl font-semibold text-zinc-100 tabular-nums">
                    {Math.round(phaseLogInfo.mean).toLocaleString()}
                  </dd>
                  {meanDelta !== undefined && phaseLogInfo.phase !== 'Baseline' && (
                    <p
                      className={`mt-1 text-xs tabular-nums ${meanDelta >= 0 ? 'text-emerald-400' : 'text-red-400'}`}
                    >
                      {meanDelta > 0 ? '+' : ''}
                      {Math.round(meanDelta).toLocaleString()} vs baseline
                    </p>
                  )}
                </div>
              )}
              {phaseLogInfo.errorPercent !== undefined && (
                <div>
                  <dt className="text-xs text-zinc-400">Error</dt>
                  <dd className="mt-1 text-lg font-semibold text-zinc-100 tabular-nums">
                    {Math.abs(phaseLogInfo.errorPercent).toFixed(3)}%
                  </dd>
                  {live.targetError !== undefined && (
                    <p className="mt-1 text-xs text-zinc-400">
                      target {live.targetError.toFixed(3)}%
                    </p>
                  )}
                </div>
              )}
              {displayedIterationsCompleted !== undefined && (
                <div>
                  <dt className="text-xs text-zinc-400">Iterations</dt>
                  <dd className="mt-1 text-lg font-semibold text-zinc-100 tabular-nums">
                    {displayedIterationsCompleted.toLocaleString()}
                  </dd>
                  {displayedIterationsTotal !== undefined && (
                    <p className="mt-1 text-xs text-zinc-400 tabular-nums">
                      of ~{displayedIterationsTotal.toLocaleString()}
                    </p>
                  )}
                </div>
              )}
            </dl>
            {live.samples.length > 1 ? (
              <div className="mt-5">
                <svg
                  viewBox="0 0 600 132"
                  preserveAspectRatio="none"
                  className="text-gold h-36 w-full"
                  role="img"
                  aria-label={`Live estimate over the last ${live.samples.length} updates`}
                >
                  {baseline !== undefined && (
                    <line
                      x1="12"
                      x2="588"
                      y1={chartY(baseline)}
                      y2={chartY(baseline)}
                      stroke="currentColor"
                      strokeOpacity="0.4"
                      strokeDasharray="4 5"
                    />
                  )}
                  <polygon
                    points={`12,124 ${chartPoints} 588,124`}
                    fill="currentColor"
                    fillOpacity="0.08"
                  />
                  <polyline
                    points={chartPoints}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    vectorEffect="non-scaling-stroke"
                    strokeLinejoin="round"
                  />
                </svg>
                <div className="flex flex-wrap justify-between gap-2 text-xs text-zinc-400 tabular-nums">
                  <span>
                    Recent estimate · {Math.round(chartMin).toLocaleString()}–
                    {Math.round(chartMax).toLocaleString()}
                  </span>
                  {baseline !== undefined && (
                    <span>Baseline {Math.round(baseline).toLocaleString()}</span>
                  )}
                </div>
              </div>
            ) : (
              <p className="mt-6 text-sm text-zinc-400">
                {isPaused
                  ? 'Live updates will continue when resumed.'
                  : 'Collecting live estimate samples…'}
              </p>
            )}
            {phaseLogInfo.simulationPercent !== undefined && (
              <p className="mt-4 text-xs text-zinc-400 tabular-nums">
                {phaseLogInfo.simulationPercent.toFixed(1)}% of estimated iterations
                {phaseLogInfo.iterationsPerSecond !== undefined
                  ? ` · ${phaseLogInfo.iterationsPerSecond.toFixed(1)} iterations/s per thread`
                  : ''}
              </p>
            )}
          </section>
        )}

        {!isPending && (
          <section
            className={`border-border bg-surface min-w-0 rounded-xl border p-4 sm:p-5 ${phaseLogInfo ? '' : 'lg:col-span-2'}`}
            aria-label="Recent completed results"
          >
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-zinc-200">Finished so far</h3>
              <span className="text-xs text-zinc-400 tabular-nums">
                {live.completed.length} captured
              </span>
            </div>
            {live.completed.length > 0 ? (
              <div className="mt-4 max-h-64 overflow-auto">
                <table className="w-full text-sm tabular-nums">
                  <thead className="text-xs text-zinc-400">
                    <tr className="border-border border-b">
                      <th scope="col" className="pb-3 text-left font-medium">
                        Simulation
                      </th>
                      <th scope="col" className="pb-3 text-right font-medium">
                        Estimate
                      </th>
                      <th scope="col" className="pb-3 pl-3 text-right font-medium">
                        Δ baseline
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {live.completed.slice(0, 20).map((phase) => {
                      const delta = baseline !== undefined ? phase.mean! - baseline : undefined;
                      return (
                        <tr
                          key={`${phase.phase}:${phase.name}`}
                          className="border-border border-b last:border-0"
                        >
                          <td className="max-w-40 py-3 pr-3 break-words text-zinc-300">
                            {phase.name}
                          </td>
                          <td className="py-3 text-right font-semibold text-zinc-100">
                            {Math.round(phase.mean!).toLocaleString()}
                          </td>
                          <td
                            className={`py-3 pl-3 text-right ${delta === undefined || phase.phase === 'Baseline' ? 'text-zinc-400' : delta >= 0 ? 'text-emerald-400' : 'text-red-400'}`}
                          >
                            {delta === undefined || phase.phase === 'Baseline'
                              ? '—'
                              : `${delta > 0 ? '+' : ''}${Math.round(delta).toLocaleString()}`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="py-10 text-sm text-zinc-400">
                {isPaused
                  ? 'No completed estimates captured yet.'
                  : 'Completed estimates will appear when SimC reports them.'}
              </p>
            )}
            <p className="mt-4 text-xs leading-5 text-zinc-400">
              Early estimates from recent output. The final ranking appears when the simulation is
              done.
            </p>
          </section>
        )}

        {isRunning && (
          <div className="border-border flex w-full min-w-0 flex-wrap gap-x-6 gap-y-3 border-y px-1 py-4 lg:col-span-2">
            <div className="flex flex-col items-center">
              <span className="text-xs text-zinc-400">Elapsed</span>
              <span className="mt-1 font-mono text-[13px] text-zinc-200">
                {formatElapsedCompact(elapsedSeconds)}
              </span>
            </div>
            {cpuPct !== undefined && cpuPct > 0 && (
              <div className="flex flex-col items-center">
                <span className="text-xs text-zinc-400">CPU Usage</span>
                <span className="mt-1 font-mono text-[13px] text-zinc-200">
                  {cpuPct.toFixed(1)}%
                </span>
              </div>
            )}
            {cpuCores !== undefined && cpuCores > 0 && (
              <div className="flex flex-col items-center">
                <span className="text-xs text-zinc-400">Cores</span>
                <span className="mt-1 font-mono text-[13px] text-zinc-200">{displayedCores}</span>
              </div>
            )}
            {memBytes !== undefined && memBytes > 0 && (
              <div className="flex flex-col items-center">
                <span className="text-xs text-zinc-400">Memory</span>
                <span className="mt-1 font-mono text-[13px] text-zinc-200">
                  {formatMegabytes(memBytes)}
                </span>
              </div>
            )}
            {displayedIterationsTotal && (
              <div className="flex flex-col items-center">
                <span className="text-xs text-zinc-400">Iterations</span>
                <span className="mt-1 font-mono text-[13px] text-zinc-200">
                  {phaseLogInfo?.simulationTotal !== undefined
                    ? displayedIterationsTotal.toLocaleString()
                    : `${(displayedIterationsTotal / 1000).toFixed(0)}k`}
                </span>
              </div>
            )}
            {fightStyle && (
              <div className="flex flex-col items-center">
                <span className="text-xs text-zinc-400">Style</span>
                <span className="mt-1 text-[13px] text-zinc-200">{fightStyle}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {!isPending && live.notes.length > 0 && (
        <section
          className="border-border bg-surface rounded-xl border p-4 sm:p-5"
          aria-label="Simulation notes"
        >
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-zinc-200">Sim notes</h3>
            <span className="text-xs text-zinc-400">{live.notes.length} unique</span>
          </div>
          <ul className="mt-4 space-y-3">
            {live.notes.map((note) => (
              <li
                key={note.text}
                className="flex items-start gap-3 text-sm leading-6 text-zinc-300"
              >
                <TriangleAlert
                  className="mt-1 h-4 w-4 shrink-0 text-amber-400"
                  aria-hidden="true"
                />
                <p className="min-w-0 break-words">
                  {note.text}
                  {note.count > 1 && (
                    <span
                      className="bg-surface-2 ml-2 inline-block rounded px-1.5 text-xs text-zinc-400 tabular-nums"
                      aria-label={`Repeated ${note.count} times`}
                    >
                      ×{note.count}
                    </span>
                  )}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {showLogs && logLines && logLines.length > 0 && (
        <div className="w-full">
          <LogConsole lines={logLines} />
        </div>
      )}
    </div>
  );
}
