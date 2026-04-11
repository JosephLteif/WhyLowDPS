'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import DpsHeroCard from '../../components/DpsHeroCard';
import GearOverview from '../../components/GearOverview';
import type { GearItem } from '../../components/GearOverview';
import ResultsChart from '../../components/ResultsChart';
import SimStatus from '../../components/SimStatus';
import StatPlotChart from '../../components/StatPlotChart';
import StatWeightsTable from '../../components/StatWeightsTable';
import TopGearResults from '../../components/TopGearResults';
import SimResultTalentsCard from '../../components/SimResultTalentsCard';
import { calculateAverageIlevel } from '../../lib/ilevel';
import CharacterLinkButton from '../../components/CharacterLinkButton';
import type { ResultItem, TopGearResult } from '../../lib/types';

import { API_URL, fetchJson } from '../../lib/api';
import { useSimContext } from '../../components/SimContext';
import {
  getScenarioSiblings,
  formatScenarioLabel,
  type ScenarioSibling,
} from '../../lib/scenario-siblings';
import { simResultHref } from '../../lib/routes';

interface JobData {
  id: string;
  status: string;
  sim_type?: string;
  progress: number;
  progress_stage?: string;
  progress_detail?: string;
  stages_completed?: string[];
  result: Record<string, unknown> | null;
  error: string | null;
  profilesets_completed?: number;
  profilesets_total?: number;
  cpu_pct?: number;
  mem_bytes?: number;
  cpu_cores?: number;
  iterations?: number;
  iterations_completed?: number;
  fight_style?: string;
  region?: string;
  linked_region?: string;
  linked_realm?: string;
  linked_name?: string;
}

function CollapsibleSection({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between border-b border-border/60 bg-white/[0.01] px-5 py-3.5 text-left transition-colors hover:bg-white/[0.03]"
      >
        <span className="text-xs font-medium uppercase tracking-widest text-muted">{title}</span>
        <svg
          className={`h-3.5 w-3.5 text-zinc-500 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>
      {open && <div className="p-5">{children}</div>}
    </div>
  );
}

export default function SimResultClient() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const paramId = params.id as string;
  const queryId = (searchParams.get('id') || '').trim();

  // Robust ID resolution from params or URL
  let id = queryId || paramId;
  if ((!paramId || paramId === '_') && typeof window !== 'undefined') {
    const query = new URLSearchParams(window.location.search);
    const queryIdFromUrl = (query.get('id') || '').trim();
    if (queryIdFromUrl) {
      id = queryIdFromUrl;
    }

    const parts = window.location.pathname.split('/');
    // Sims IDs are uuid or nanoid and are generally 20+ chars
    const foundId = parts.find((p) => p.length > 20 && (p.includes('-') || /^[a-f0-9]+$/i.test(p)));
    if (foundId) {
      id = foundId;
    }
  }

  const [job, setJob] = useState<JobData | null>(null);
  const [fetchError, setFetchError] = useState('');
  const [logLines, setLogLines] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(true);
  const logCursorRef = useRef(0);
  const [siblings, setSiblings] = useState<ScenarioSibling[] | null>(null);
  const [siblingStatuses, setSiblingStatuses] = useState<Record<string, string>>({});

  useEffect(() => {
    setSiblings(getScenarioSiblings());
  }, []);

  useEffect(() => {
    if (!siblings || siblings.length === 0) return;
    const siblingList = siblings;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;

    async function pollSiblingStatuses() {
      const statuses: Record<string, string> = {};
      for (const s of siblingList) {
        try {
          const data = await fetchJson<JobData>(`${API_URL}/api/sim/${s.id}`);
          statuses[s.id] = data.status || 'pending';
        } catch {
          statuses[s.id] = 'pending';
        }
      }
      if (!active) return;
      if (id && job?.status) statuses[id] = job.status;
      setSiblingStatuses(statuses);

      const shouldContinue = Object.values(statuses).some(
        (status) => status === 'pending' || status === 'running'
      );
      if (shouldContinue) timer = setTimeout(pollSiblingStatuses, 2000);
    }

    pollSiblingStatuses();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [siblings, id, job?.status]);

  useEffect(() => {
    console.log('[SimResult] Initializing with ID:', id);
    if (!id || id === '_') return;
    setJob(null); // Reset when ID changes
    setFetchError('');
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const data = await fetchJson<JobData>(`${API_URL}/api/sim/${id}`);
        if (active) setJob(data);
        if (active && (data.status === 'pending' || data.status === 'running')) {
          timer = setTimeout(poll, 2000);
        }
      } catch (err) {
        if (active) setFetchError(err instanceof Error ? err.message : 'Failed to fetch status');
      }
    }
    poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [id]);

  // Poll logs only when the log console is expanded and the sim is active
  useEffect(() => {
    if (!showLogs || !id || id === '_') return;
    if (job?.status !== 'pending' && job?.status !== 'running') return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function pollLogs() {
      try {
        const data = await fetchJson<any>(
          `${API_URL}/api/sim/${id}/logs?after=${logCursorRef.current}`
        );
        if (!active) return;
        if (data.lines.length > 0) {
          setLogLines((prev) => {
            const merged = [...prev, ...data.lines];
            return merged.length > 1000 ? merged.slice(-1000) : merged;
          });
          logCursorRef.current = data.next;
        }
      } catch {
        /* ignore */
      }
      if (active) timer = setTimeout(pollLogs, 1000);
    }
    pollLogs();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [showLogs, id, job?.status]);

  const handleToggleLogs = useCallback(() => setShowLogs((v) => !v), []);
  const navigateToScenario = useCallback(
    (scenarioId: string) => {
      if (!scenarioId || scenarioId === id) return;
      router.push(simResultHref(scenarioId), { scroll: false });
    },
    [id, router]
  );

  const scenarioStatusTone = useCallback((status: string, isCurrent: boolean): string => {
    if (isCurrent) return 'text-gold';
    if (status === 'running') return 'text-blue-300';
    if (status === 'pending') return 'text-zinc-300';
    if (status === 'done') return 'text-emerald-300';
    if (status === 'failed' || status === 'cancelled') return 'text-red-300';
    return 'text-zinc-300';
  }, []);

  if (fetchError) {
    return (
      <div className="card border-red-500/20 bg-red-500/[0.03] p-6">
        <p className="mb-1 text-sm font-semibold text-red-400">Error</p>
        <p className="text-sm text-red-400/60">{fetchError}</p>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-zinc-800 border-t-gold" />
      </div>
    );
  }

  if (job.status === 'cancelled') {
    return (
      <div className="card border-amber-500/20 bg-amber-500/[0.03] p-6 text-center">
        <p className="text-sm font-semibold text-amber-400">Simulation Cancelled</p>
      </div>
    );
  }

  if (job.status === 'failed') {
    return (
      <div className="card border-red-500/20 bg-red-500/[0.03] p-6">
        <p className="mb-2 text-sm font-semibold text-red-400">Simulation Failed</p>
        <p className="whitespace-pre-wrap font-mono text-[13px] leading-relaxed text-red-400/60">
          {job.error || 'Unknown error'}
        </p>
      </div>
    );
  }

  if (job.status === 'pending' || job.status === 'running') {
    return (
      <SimStatus
        status={job.status}
        progress={job.progress}
        progressStage={job.progress_stage}
        progressDetail={job.progress_detail}
        stagesCompleted={job.stages_completed}
        jobId={id}
        onCancelled={() => setJob({ ...job, status: 'cancelled' })}
        logLines={logLines}
        showLogs={showLogs}
        onToggleLogs={handleToggleLogs}
        profilesetsCompleted={job.profilesets_completed}
        profilesetsTotal={job.profilesets_total}
        cpuPct={job.cpu_pct}
        memBytes={job.mem_bytes}
        cpuCores={job.cpu_cores}
        iterations={job.iterations}
        iterationsCompleted={job.iterations_completed}
        fightStyle={job.fight_style}
      />
    );
  }

  if (!job.result) {
    return <p className="text-sm text-muted">No result data available.</p>;
  }

  const r = job.result;
  const isTopGear = r.type === 'top_gear';
  const isStatWeights =
    job.sim_type === 'stat_weights' ||
    job.sim_type === 'stat-weights' ||
    job.sim_type === 'stat_plot';

  const equippedGear = r.equipped_gear as any;
  const avgIlevel = equippedGear ? calculateAverageIlevel(equippedGear) : undefined;

  return (
    <div className="space-y-6">
      <div className="sticky top-16 z-40 flex flex-wrap items-center justify-between gap-4 py-2">
        {siblings && siblings.length > 1 ? (
          <div className="rounded-xl border border-border/70 bg-surface/90 p-3 shadow-lg backdrop-blur">
            <div className="flex flex-wrap items-center gap-2">
              <span className="shrink-0 text-[13px] uppercase tracking-wider text-muted">
                Scenarios
              </span>
              <span className="h-4 w-px shrink-0 bg-border" />
              {siblings.map((s) => {
                const isCurrent = s.id === id;
                const status = siblingStatuses[s.id] || (isCurrent ? job.status : 'pending');
                return (
                  <button
                    key={s.id}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      navigateToScenario(s.id);
                    }}
                    onClick={(e) => {
                      e.preventDefault();
                      navigateToScenario(s.id);
                    }}
                    className={`rounded-lg border px-2.5 py-1 text-[14px] font-medium transition-all ${
                      isCurrent
                        ? 'border-gold/40 bg-gold/[0.08] text-gold'
                        : 'border-border bg-surface-2 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300'
                    }`}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <span>{formatScenarioLabel(s)}</span>
                      <span className={`text-[11px] ${scenarioStatusTone(status, isCurrent)}`}>
                        {status === 'running'
                          ? 'In Progress'
                          : status === 'pending'
                            ? 'Pending'
                            : status === 'done'
                              ? 'Done'
                              : status === 'failed'
                                ? 'Failed'
                                : status === 'cancelled'
                                  ? 'Cancelled'
                                  : ''}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div />
        )}
        <div className="flex items-center gap-3">
          {isTopGear && (
            <Link
              href="/top-gear"
              className="rounded-md border border-white/15 bg-white/[0.04] px-3 py-1.5 text-[12px] font-semibold text-zinc-200 transition-colors hover:bg-white/[0.08] hover:text-white"
            >
              Sim Again
            </Link>
          )}
          <CharacterLinkButton
            jobId={id}
            currentLinkedName={job.linked_name}
            currentLinkedRealm={job.linked_realm}
            currentLinkedRegion={job.linked_region}
          />
        </div>
      </div>

      {isTopGear ? (
        <>
          <TopGearResults
            playerName={r.player_name as string}
            playerClass={r.player_class as string}
            playerRealm={r.realm as string | undefined}
            playerRegion={r.region as string | undefined}
            baseDps={r.base_dps as number}
            results={r.results as TopGearResult[]}
            equippedGear={r.equipped_gear as Record<string, ResultItem>}
            dpsError={r.dps_error as number | undefined}
            dpsErrorPct={r.dps_error_pct as number | undefined}
            fightLength={r.fight_length as number | undefined}
            desiredTargets={r.desired_targets as number | undefined}
            iterations={r.iterations as number | undefined}
            targetError={r.target_error as number | undefined}
            elapsedTime={r.elapsed_time_seconds as number | undefined}
            talentString={r.talent_string as string | undefined}
          />
        </>
      ) : isStatWeights ? (
        <>
          <div className="card border-gold/10 bg-gold/[0.02] p-6">
            <h2 className="mb-2 text-lg font-bold text-zinc-100">Stat Weights Generated</h2>
            <p className="text-sm text-zinc-400">
              Quick Weights gives immediate marginal values for the next stat point. Stat Plot shows
              the full DPS curve across a range so you can see diminishing returns directly.
            </p>
          </div>
          {r.stat_plots ? (
            <StatPlotChart
              statPlots={r.stat_plots as Record<string, Array<{ delta: number; dps: number }>>}
            />
          ) : null}
          {r.stat_weights ? (
            <StatWeightsTable statWeights={r.stat_weights as Record<string, number>} />
          ) : (
            !r.stat_plots && (
              <div className="card border-amber-500/20 bg-amber-500/[0.03] p-6 text-center">
                <p className="text-sm font-semibold text-amber-400">
                  No stat weight or plot data found in this simulation.
                </p>
              </div>
            )
          )}
        </>
      ) : (
        <>
          <DpsHeroCard
            playerName={r.player_name as string}
            playerClass={r.player_class as string}
            playerRealm={r.realm as string | undefined}
            playerRegion={r.region as string | undefined}
            dps={r.dps as number}
            dpsError={r.dps_error as number}
            dpsErrorPct={r.dps_error_pct as number | undefined}
            fightLength={r.fight_length as number}
            desiredTargets={r.desired_targets as number | undefined}
            iterations={r.iterations as number | undefined}
            targetError={r.target_error as number | undefined}
            elapsedTime={r.elapsed_time_seconds as number | undefined}
            avgIlevel={avgIlevel}
          />
          {r.equipped_gear &&
            Object.keys(r.equipped_gear as Record<string, unknown>).length > 0 && (
              <CollapsibleSection title="Character Panel">
                <GearOverview
                  gear={r.equipped_gear as Record<string, GearItem>}
                  characterRenderUrl={
                    r.realm && r.player_name
                      ? `${API_URL}/api/blizzard/character/${encodeURIComponent((r.realm as string).toLowerCase())}/${encodeURIComponent((r.player_name as string).toLowerCase())}/media/render${r.region ? `?region=${(r.region as string).toLowerCase()}` : ''}`
                      : null
                  }
                />
              </CollapsibleSection>
            )}
          {typeof r.talent_string === 'string' && r.talent_string && (
            <CollapsibleSection title="Talents" defaultOpen={false}>
              <SimResultTalentsCard talentString={r.talent_string as string} />
            </CollapsibleSection>
          )}
          <CollapsibleSection title="Damage Breakdown">
            <ResultsChart
              dps={r.dps as number}
              abilities={
                (r.abilities as Array<{
                  name: string;
                  portion_dps: number;
                  school: string;
                }>) || []
              }
            />
          </CollapsibleSection>
          {r.stat_weights && (
            <StatWeightsTable statWeights={r.stat_weights as Record<string, number>} />
          )}
        </>
      )}

      {/* Footer links */}
      <div className="flex items-center justify-center gap-3 pb-4 text-xs text-muted">
        {typeof r.simc_version === 'string' && (
          <>
            {typeof r.simc_git_revision === 'string' && r.simc_git_revision ? (
              <a
                href={`https://github.com/simulationcraft/simc/commit/${r.simc_git_revision}`}
                target="_blank"
                rel="noopener noreferrer"
                className="transition-colors hover:text-white"
              >
                {r.simc_version as string}
              </a>
            ) : (
              <span>{r.simc_version as string}</span>
            )}
            <span className="h-3 w-px bg-border" />
          </>
        )}
        <a
          href={`${API_URL}/api/sim/${id}/raw`}
          target="_blank"
          rel="noopener noreferrer"
          className="transition-colors hover:text-white"
        >
          Raw JSON
        </a>
        <span className="h-3 w-px bg-border" />
        <a
          href={`${API_URL}/api/sim/${id}/input`}
          target="_blank"
          rel="noopener noreferrer"
          className="transition-colors hover:text-white"
        >
          Raw Input
        </a>
        <span className="h-3 w-px bg-border" />
        <a
          href={`${API_URL}/api/sim/${id}/data.csv`}
          className="transition-colors hover:text-white"
        >
          CSV
        </a>
        <span className="h-3 w-px bg-border" />
        <a
          href={`${API_URL}/api/sim/${id}/html`}
          target="_blank"
          rel="noopener noreferrer"
          className="transition-colors hover:text-white"
        >
          HTML Report
        </a>
        <span className="h-3 w-px bg-border" />
        <a
          href={`${API_URL}/api/sim/${id}/output.txt`}
          target="_blank"
          rel="noopener noreferrer"
          className="transition-colors hover:text-white"
        >
          Text Output
        </a>
      </div>
    </div>
  );
}
