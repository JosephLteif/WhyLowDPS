'use client';

import Link from 'next/link';
import { CheckCircle2, Circle, Database, KeyRound, Play, UserRound } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { listCharacterProfiles, listSims } from '../lib/api';
import { fetchReadiness } from '../lib/readiness';
import { useAuth } from './AuthContext';

type ChecklistState = {
  dataReady: boolean;
  credentialsReady: boolean;
  profileReady: boolean;
  simulationReady: boolean;
};

const EMPTY_STATE: ChecklistState = {
  dataReady: false,
  credentialsReady: false,
  profileReady: false,
  simulationReady: false,
};

export default function OnboardingChecklist() {
  const { lightMode } = useAuth();
  const [state, setState] = useState<ChecklistState>(EMPTY_STATE);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (lightMode) {
      setState({
        dataReady: true,
        credentialsReady: true,
        profileReady: false,
        simulationReady: false,
      });
      setLoading(false);
      return;
    }
    try {
      const [readiness, profiles, sims] = await Promise.all([
        fetchReadiness().catch(() => null),
        listCharacterProfiles().catch(() => []),
        listSims().catch(() => []),
      ]);
      setState({
        dataReady: Boolean(
          readiness &&
          readiness.data.required_missing === 0 &&
          ['ready', 'degraded'].includes(readiness.data.status)
        ),
        credentialsReady: Boolean(readiness?.credentials.configured),
        profileReady: profiles.length > 0,
        simulationReady: sims.length > 0,
      });
    } finally {
      setLoading(false);
    }
  }, [lightMode]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const completed = Object.values(state).filter(Boolean).length;
  if (loading || completed === 4) return null;

  const items = [
    {
      done: state.dataReady,
      label: 'Game data is ready',
      href: '/settings?tab=data',
      icon: Database,
    },
    {
      done: state.credentialsReady,
      label: 'Connect Blizzard for character data',
      href: '/settings?tab=integrations',
      icon: KeyRound,
    },
    {
      done: state.profileReady,
      label: 'Import a SimC character profile',
      href: '/quick-sim',
      icon: UserRound,
    },
    {
      done: state.simulationReady,
      label: 'Run your first simulation',
      href: '/quick-sim',
      icon: Play,
    },
  ];

  return (
    <section className="card border-gold/20 bg-gold/[0.03] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-gold">Getting started</p>
          <h2 className="mt-1 text-lg font-semibold text-zinc-100">Finish setting up WhyLowDPS</h2>
          <p className="mt-1 text-sm text-zinc-400">{completed} of 4 steps complete.</p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          className="text-xs font-semibold text-zinc-400 hover:text-white"
        >
          Refresh status
        </button>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {items.map(({ done, label, href, icon: Icon }) => (
          <Link
            key={label}
            href={href}
            className="flex items-center gap-2 rounded-lg border border-border bg-surface-2/70 px-3 py-2.5 text-sm transition-colors hover:border-gold/30 hover:bg-surface-2"
          >
            {done ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
            ) : (
              <Circle className="h-4 w-4 shrink-0 text-zinc-500" />
            )}
            <Icon className="h-4 w-4 shrink-0 text-zinc-400" strokeWidth={1.8} />
            <span className={done ? 'text-zinc-500 line-through' : 'text-zinc-200'}>{label}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
