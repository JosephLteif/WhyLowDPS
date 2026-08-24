'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Cpu,
  Database,
  KeyRound,
  RefreshCw,
  Wrench,
} from 'lucide-react';
import {
  buildReadinessChecks,
  formatReadinessTimestamp,
  readinessStatusClass,
  readinessStatusLabel,
  type ReadinessCheck,
  type ReadinessLevel,
  type ReadinessSnapshot,
} from '../lib/readiness';

type ReadinessPanelProps = {
  snapshot: ReadinessSnapshot | null;
  loading?: boolean;
  error?: string | null;
  variant?: 'summary' | 'details';
  authenticated?: boolean;
  lightMode?: boolean;
  onRefresh?: () => void;
  onRetryData?: () => void;
  onRepairData?: () => void;
  onViewData?: () => void;
  actionBusy?: 'refresh' | 'retry' | 'repair' | null;
};

function StatusIcon({
  status,
  className = 'h-4 w-4',
}: {
  status: ReadinessLevel;
  className?: string;
}) {
  if (status === 'ready') return <CheckCircle2 className={`${className} text-emerald-400`} />;
  if (status === 'checking')
    return <CircleDashed className={`${className} animate-spin text-sky-400`} />;
  return (
    <AlertTriangle
      className={`${className} ${status === 'blocked' ? 'text-red-400' : 'text-amber-400'}`}
    />
  );
}

function CheckIcon({ id }: { id: ReadinessCheck['id'] }) {
  if (id === 'account') return <KeyRound className="h-4 w-4 text-zinc-400" />;
  if (id === 'data') return <Database className="h-4 w-4 text-zinc-400" />;
  return <Cpu className="h-4 w-4 text-zinc-400" />;
}

function CheckRow({ check, compact }: { check: ReadinessCheck; compact?: boolean }) {
  return (
    <div
      className={`flex min-w-0 items-start gap-3 ${compact ? 'py-1' : 'rounded-lg border border-border/70 bg-surface-2/60 p-3'}`}
    >
      <StatusIcon status={check.status} className="mt-0.5 h-4 w-4 shrink-0" />
      <CheckIcon id={check.id} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-zinc-200">{check.label}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">{check.message}</p>
      </div>
      {!compact && (
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${readinessStatusClass(check.status)}`}
        >
          {readinessStatusLabel(check.status)}
        </span>
      )}
    </div>
  );
}

function ActionLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-zinc-200 transition-colors hover:border-gold/30 hover:bg-white/10 hover:text-white"
    >
      {children}
    </Link>
  );
}

export default function ReadinessPanel({
  snapshot,
  loading = false,
  error = null,
  variant = 'summary',
  authenticated = false,
  lightMode = false,
  onRefresh,
  onRetryData,
  onRepairData,
  onViewData,
  actionBusy = null,
}: ReadinessPanelProps) {
  const checks = snapshot ? buildReadinessChecks(snapshot, { authenticated, lightMode }) : [];

  if (variant === 'summary') {
    return (
      <section className="card border-border/70 bg-surface/40 p-4" aria-label="System health">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-gold">System health</p>
            <h2 className="mt-1 text-lg font-semibold text-zinc-100">
              {loading
                ? 'Checking WhyLowDPS…'
                : snapshot
                  ? 'Ready when you are'
                  : 'Health status unavailable'}
            </h2>
            <p className="mt-1 text-sm text-zinc-400">
              {error ||
                (snapshot
                  ? snapshot.data.message
                  : 'Refresh to check the app, data, and simulation runtime.')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {snapshot && (
              <span
                className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${readinessStatusClass(snapshot.status)}`}
              >
                {readinessStatusLabel(snapshot.status)}
              </span>
            )}
            {onRefresh && (
              <button
                type="button"
                onClick={onRefresh}
                disabled={loading || actionBusy !== null}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-xs font-semibold text-zinc-200 hover:border-gold/30 disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            )}
          </div>
        </div>
        {snapshot && (
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {checks.map((check) => (
              <CheckRow key={check.id} check={check} compact />
            ))}
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3">
          <span className="text-xs text-zinc-500">
            Last game-data sync: {formatReadinessTimestamp(snapshot?.data.last_sync || null)}
          </span>
          <ActionLink href="/settings?tab=health">Open health details</ActionLink>
        </div>
      </section>
    );
  }

  return (
    <section id="settings-panel-health" className="space-y-6" aria-labelledby="health-title">
      <div className="rounded-xl border border-border/50 bg-surface/30 p-6 backdrop-blur-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-gold">
              Readiness center
            </p>
            <h2 id="health-title" className="mt-1 text-xl font-semibold text-white">
              System health
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400">
              Check the app, account access, game data, and SimulationCraft runtime in one place.
              Repairs keep your existing data and credentials intact.
            </p>
          </div>
          {snapshot && (
            <span
              className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${readinessStatusClass(snapshot.status)}`}
            >
              {readinessStatusLabel(snapshot.status)}
            </span>
          )}
        </div>
        {loading && <p className="mt-5 text-sm text-zinc-400">Checking system health…</p>}
        {error && (
          <p className="mt-5 rounded-lg border border-red-400/20 bg-red-500/10 p-3 text-sm text-red-300">
            {error}
          </p>
        )}
        {snapshot && (
          <>
            <div className="mt-5 grid gap-3 lg:grid-cols-3">
              {checks.map((check) => (
                <CheckRow key={check.id} check={check} />
              ))}
            </div>
            <div className="mt-5 grid gap-3 text-xs text-zinc-400 sm:grid-cols-2">
              <div className="rounded-lg border border-border/60 bg-surface-2/50 p-3">
                <p className="font-semibold text-zinc-300">Game data</p>
                <p className="mt-1">
                  {snapshot.data.required_missing} required missing ·{' '}
                  {snapshot.data.optional_missing} optional missing
                </p>
                <p className="mt-1">
                  Last sync: {formatReadinessTimestamp(snapshot.data.last_sync)}
                </p>
              </div>
              <div className="rounded-lg border border-border/60 bg-surface-2/50 p-3">
                <p className="font-semibold text-zinc-300">Build</p>
                <p className="mt-1">
                  {snapshot.app.mode} · WhyLowDPS {snapshot.app.version}
                </p>
                <p className="mt-1">Revision: {snapshot.app.revision}</p>
              </div>
            </div>
          </>
        )}
        <div className="mt-5 flex flex-wrap gap-2">
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading || actionBusy !== null}
              className="inline-flex items-center gap-2 rounded-md bg-gold/15 px-3 py-2 text-xs font-semibold text-gold hover:bg-gold/25 disabled:opacity-50"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${actionBusy === 'refresh' ? 'animate-spin' : ''}`}
              />
              Refresh health
            </button>
          )}
          {onRetryData && (
            <button
              type="button"
              onClick={onRetryData}
              disabled={actionBusy !== null}
              className="inline-flex items-center gap-2 rounded-md border border-sky-400/25 bg-sky-500/10 px-3 py-2 text-xs font-semibold text-sky-300 hover:bg-sky-500/20 disabled:opacity-50"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${actionBusy === 'retry' ? 'animate-spin' : ''}`}
              />
              Retry data sync
            </button>
          )}
          {onRepairData && (
            <button
              type="button"
              onClick={onRepairData}
              disabled={actionBusy !== null}
              className="inline-flex items-center gap-2 rounded-md border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-300 hover:bg-amber-500/20 disabled:opacity-50"
            >
              <Wrench className="h-3.5 w-3.5" />
              {actionBusy === 'repair' ? 'Repairing…' : 'Repair missing files'}
            </button>
          )}
          {onViewData && (
            <button
              type="button"
              onClick={onViewData}
              disabled={actionBusy !== null}
              className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-zinc-200 hover:bg-white/10 disabled:opacity-50"
            >
              View data files
            </button>
          )}
          <ActionLink href="/settings?tab=integrations">Blizzard access</ActionLink>
          <ActionLink href="/settings?tab=updates">Runtime and updates</ActionLink>
        </div>
      </div>
    </section>
  );
}
