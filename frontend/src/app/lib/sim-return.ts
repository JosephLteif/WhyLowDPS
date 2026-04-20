const TARGETS_STORAGE_KEY = 'whylowdps_sim_return_targets_v1';
const RESTORE_PREFIX = 'whylowdps_sim_restore_state_v1:';
const MAX_TARGETS = 200;

export interface SimReturnTarget {
  returnUrl: string;
  pageKey?: string;
  state?: unknown;
  createdAt: number;
}

export interface SimReturnRegistration {
  returnUrl: string;
  pageKey?: string;
  state?: unknown;
}

function readTargets(): Record<string, SimReturnTarget> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = sessionStorage.getItem(TARGETS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as Record<string, SimReturnTarget>;
  } catch {
    return {};
  }
}

function writeTargets(targets: Record<string, SimReturnTarget>): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(TARGETS_STORAGE_KEY, JSON.stringify(targets));
  } catch {}
}

function pruneTargets(
  targets: Record<string, SimReturnTarget>,
  limit = MAX_TARGETS
): Record<string, SimReturnTarget> {
  const entries = Object.entries(targets);
  if (entries.length <= limit) return targets;
  const sorted = entries.sort((a, b) => (a[1]?.createdAt || 0) - (b[1]?.createdAt || 0));
  const keep = sorted.slice(sorted.length - limit);
  return Object.fromEntries(keep);
}

export function buildCurrentReturnUrl(): string {
  if (typeof window === 'undefined') return '/';
  return `${window.location.pathname}${window.location.search || ''}`;
}

export function registerSimReturnTarget(simId: string, target: SimReturnRegistration): void {
  const id = (simId || '').trim();
  const returnUrl = (target.returnUrl || '').trim();
  if (!id || !returnUrl || typeof window === 'undefined') return;

  const targets = readTargets();
  targets[id] = {
    returnUrl,
    ...(target.pageKey ? { pageKey: target.pageKey } : {}),
    ...(target.state !== undefined ? { state: target.state } : {}),
    createdAt: Date.now(),
  };
  writeTargets(pruneTargets(targets));
}

export function registerSimReturnTargets(simIds: string[], target: SimReturnRegistration): void {
  for (const simId of simIds) {
    registerSimReturnTarget(simId, target);
  }
}

export function getSimReturnTarget(simId: string): SimReturnTarget | null {
  const id = (simId || '').trim();
  if (!id) return null;
  const target = readTargets()[id];
  if (!target || typeof target.returnUrl !== 'string' || target.returnUrl.trim().length === 0) {
    return null;
  }
  return target;
}

export function resolveSimAgainNavigation(simId: string): string | null {
  const target = getSimReturnTarget(simId);
  if (!target || typeof window === 'undefined') return null;

  if (target.pageKey) {
    const storageKey = `${RESTORE_PREFIX}${target.pageKey}`;
    try {
      if (target.state === undefined) {
        sessionStorage.removeItem(storageKey);
      } else {
        sessionStorage.setItem(storageKey, JSON.stringify(target.state));
      }
    } catch {}
  }

  return target.returnUrl;
}

export function consumeSimAgainState<T>(pageKey: string): T | null {
  const key = (pageKey || '').trim();
  if (!key || typeof window === 'undefined') return null;
  const storageKey = `${RESTORE_PREFIX}${key}`;
  try {
    const raw = sessionStorage.getItem(storageKey);
    sessionStorage.removeItem(storageKey);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
