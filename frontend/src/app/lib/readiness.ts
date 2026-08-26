import { API_URL, fetchJson } from './api';

export type ReadinessLevel = 'ready' | 'degraded' | 'attention' | 'blocked' | 'checking';

export type ReadinessCheckId = 'account' | 'data' | 'simulation';

export type ReadinessSnapshot = {
  status: ReadinessLevel;
  app: {
    mode: 'desktop' | 'hosted' | 'web';
    version: string;
    revision: string;
  };
  credentials: {
    configured: boolean;
  };
  data: {
    status: 'ready' | 'degraded' | 'syncing' | 'needs_credentials' | 'error' | 'blocked';
    message: string;
    degraded: boolean;
    last_sync: string | null;
    required_missing: number;
    optional_missing: number;
    available: boolean;
  };
  simulation: {
    available: boolean;
  };
};

export type ReadinessCheck = {
  id: ReadinessCheckId;
  label: string;
  status: ReadinessLevel;
  message: string;
  href: string;
};

export async function fetchReadiness(): Promise<ReadinessSnapshot> {
  return fetchJson<ReadinessSnapshot>(`${API_URL}/api/readiness`);
}

export function readinessDataMessage(
  status: unknown,
  degraded = false,
  fallback = 'Game data refresh needs attention.'
): string {
  if (degraded || status === 'degraded') return 'Using the last validated game-data snapshot.';
  switch (status) {
    case 'ready':
      return 'Game data is ready.';
    case 'syncing':
      return 'Refreshing game data.';
    case 'needs_credentials':
      return 'Blizzard credentials are required to refresh game data.';
    case 'blocked':
      return 'Required game data files are missing.';
    default:
      return fallback;
  }
}

export function buildReadinessChecks(
  snapshot: ReadinessSnapshot,
  options: { authenticated: boolean; lightMode: boolean }
): ReadinessCheck[] {
  const accountCheck: ReadinessCheck = options.lightMode
    ? {
        id: 'account',
        label: 'Account access',
        status: 'ready',
        message: 'Light mode is active. Battle.net features are optional.',
        href: '/quick-sim',
      }
    : options.authenticated
      ? {
          id: 'account',
          label: 'Account access',
          status: 'ready',
          message: 'Battle.net session is active.',
          href: '/characters',
        }
      : {
          id: 'account',
          label: 'Account access',
          status: snapshot.credentials.configured ? 'attention' : 'blocked',
          message: snapshot.credentials.configured
            ? 'Sign in with Battle.net to use account features.'
            : 'Configure Blizzard credentials before signing in.',
          href: snapshot.credentials.configured ? '/' : '/settings?tab=integrations',
        };

  const dataStatus: ReadinessLevel =
    snapshot.data.status === 'ready'
      ? 'ready'
      : snapshot.data.status === 'degraded'
        ? 'degraded'
        : snapshot.data.status === 'syncing'
          ? 'checking'
          : snapshot.data.status === 'blocked'
            ? 'blocked'
            : 'attention';

  return [
    accountCheck,
    {
      id: 'data',
      label: 'Game data',
      status: dataStatus,
      message:
        snapshot.data.required_missing > 0
          ? `${snapshot.data.required_missing} required file${snapshot.data.required_missing === 1 ? '' : 's'} missing.`
          : snapshot.data.message,
      href: '/settings?tab=data',
    },
    {
      id: 'simulation',
      label: 'SimulationCraft runtime',
      status: snapshot.simulation.available ? 'ready' : 'blocked',
      message: snapshot.simulation.available
        ? 'Simulation runtime is available.'
        : 'SimulationCraft is unavailable. Check runtime updates.',
      href: '/settings?tab=updates',
    },
  ];
}

export function formatReadinessTimestamp(value: string | null): string {
  if (!value) return 'Not available';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not available';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function readinessStatusLabel(status: ReadinessLevel): string {
  switch (status) {
    case 'ready':
      return 'Ready';
    case 'degraded':
      return 'Degraded';
    case 'checking':
      return 'Checking';
    case 'blocked':
      return 'Blocked';
    default:
      return 'Needs attention';
  }
}

export function readinessStatusClass(status: ReadinessLevel): string {
  switch (status) {
    case 'ready':
      return 'border-emerald-400/30 bg-emerald-500/10 text-emerald-300';
    case 'degraded':
      return 'border-amber-400/30 bg-amber-500/10 text-amber-300';
    case 'checking':
      return 'border-sky-400/30 bg-sky-500/10 text-sky-300';
    case 'blocked':
      return 'border-red-400/30 bg-red-500/10 text-red-300';
    default:
      return 'border-amber-400/30 bg-amber-500/10 text-amber-300';
  }
}
