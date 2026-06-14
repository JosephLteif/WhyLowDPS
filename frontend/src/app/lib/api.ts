import { SavedRoute, SimSummary, SystemStats } from './types';
import { Instance } from '../drop-finder/types';

export function isDesktopRuntime(): boolean {
  const desktopBuild =
    process.env.DESKTOP_BUILD === 'true' || process.env.NEXT_PUBLIC_DESKTOP_BUILD === 'true';
  if (desktopBuild) return true;
  if (typeof window === 'undefined') return false;
  const isDesktopDevFrontend =
    window.location.protocol === 'http:' &&
    (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost') &&
    window.location.port === '1420';
  return (
    isDesktopDevFrontend ||
    window.location.protocol === 'tauri:' ||
    window.location.protocol === 'asset:' ||
    window.location.protocol === 'file:' ||
    window.location.hostname === 'tauri.localhost' ||
    !!(window as any).__TAURI__ ||
    !!(window as any).__TAURI_METADATA__ ||
    !!(window as any).__TAURI_INTERNALS__ ||
    !!(window as any).__TAURI_IPC__
  );
}

export const isDesktop = isDesktopRuntime();

if (typeof window !== 'undefined') {
  console.log('[WhyLowDps] Mode:', isDesktop ? 'Desktop' : 'Web');
  if (!isDesktop) {
    console.log('[WhyLowDps] Protocol:', window.location.protocol);
    console.log('[WhyLowDps] Hostname:', window.location.hostname);
  }
}

export const API_URL = isDesktop ? 'http://localhost:17384' : '';

export const TOKEN_KEY = 'whylowdps_auth_token';
const DEFAULT_FETCH_TIMEOUT_MS = 8000;
const GET_RETRY_ATTEMPTS = 2;
const GET_RETRY_DELAY_MS = 300;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(init: RequestInit | undefined, timeoutMs: number): RequestInit {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const nextInit = { ...(init || {}), signal: controller.signal };
  // Clear timeout once caller awaits fetch resolution.
  (nextInit as any).__clearTimeout = () => clearTimeout(timer);
  return nextInit;
}

export function isNetworkUnavailableError(err: any): boolean {
  return err?.status === 0 || err?.name === 'AbortError' || err?.code === 'NETWORK_UNAVAILABLE';
}

/** Fetch JSON with consistent error handling. Throws on non-ok responses. */
export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = { ...init?.headers } as Record<string, string>;

  if (typeof window !== 'undefined') {
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  }

  // Default to application/json for POST/PUT if not specified
  if (init?.method === 'POST' || init?.method === 'PUT') {
    if (!headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
  }

  const finalInit = {
    ...init,
    headers,
    credentials: 'include' as RequestCredentials,
  };
  const method = (finalInit.method || 'GET').toUpperCase();
  const retries = method === 'GET' ? GET_RETRY_ATTEMPTS : 0;
  let lastErr: any;
  let res: Response | null = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const timedInit = withTimeout(finalInit, DEFAULT_FETCH_TIMEOUT_MS);
    const clearTimer = (timedInit as any).__clearTimeout as (() => void) | undefined;
    delete (timedInit as any).__clearTimeout;
    try {
      res = await fetch(url, timedInit);
      clearTimer?.();
      break;
    } catch (err: any) {
      clearTimer?.();
      lastErr = err;
      if (attempt < retries) {
        await sleep(GET_RETRY_DELAY_MS * (attempt + 1));

      }
    }
  }

  if (!res) {
    const error = new Error('Backend not reachable') as any;
    error.status = 0;
    error.code = 'NETWORK_UNAVAILABLE';
    error.cause = lastErr;
    throw error;
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const error = new Error(data.detail || `Server error ${res.status}`) as any;
    error.status = res.status;
    error.detail = data.detail;
    throw error;
  }
  const text = await res.text();
  if (!text) {
    return undefined as T;
  }
  return JSON.parse(text) as T;
}

/** Cache for generic API requests */
const memoryCache: Record<string, { data: any; expiry: number }> = {};
const inflightCache: Record<string, Promise<any> | undefined> = {};

/**
 * Fetches JSON and caches it in memory or localStorage.
 * Only caches GET requests.
 */
export async function fetchJsonCached<T>(
  url: string,
  options?: {
    ttl?: number;
    usePersistentCache?: boolean;
    init?: RequestInit;
  }
): Promise<T> {
  const { ttl = 300000, usePersistentCache = false, init } = options || {};

  if (init?.method && init.method !== 'GET') {
    return fetchJson<T>(url, init);
  }

  const cacheKey = `api_cache_${url}`;
  const now = Date.now();

  // 1. Check Memory Cache
  if (memoryCache[cacheKey] && memoryCache[cacheKey].expiry > now) {
    return memoryCache[cacheKey].data as T;
  }

  // 2. Check Persistent Cache (localStorage)
  if (usePersistentCache && typeof window !== 'undefined') {
    const item = localStorage.getItem(cacheKey);
    if (item) {
      try {
        const parsed = JSON.parse(item);
        if (parsed.expiry > now) {
          // Warm up memory cache
          memoryCache[cacheKey] = parsed;
          return parsed.data as T;
        }
      } catch (e) {
        console.log(e);
        localStorage.removeItem(cacheKey);
      }
    }
  }

  // 3. Fetch Fresh
  if (inflightCache[cacheKey]) {
    return inflightCache[cacheKey] as Promise<T>;
  }
  inflightCache[cacheKey] = (async () => {
    try {
      const data = await fetchJson<T>(url, init);

      // 4. Update Caches
      const cacheEntry = { data, expiry: now + ttl };
      memoryCache[cacheKey] = cacheEntry;
      if (usePersistentCache && typeof window !== 'undefined') {
        localStorage.setItem(cacheKey, JSON.stringify(cacheEntry));
      }
      return data;
    } finally {
      delete inflightCache[cacheKey];
    }
  })();

  return inflightCache[cacheKey] as Promise<T>;
}

export async function deleteSim(id: string): Promise<void> {
  await fetchJson(`${API_URL}/api/sim/${id}`, {
    method: 'DELETE',
  });
}

export async function setSimPinned(id: string, pinned: boolean): Promise<void> {
  await fetchJson(`${API_URL}/api/sim/${id}/pin`, {
    method: 'POST',
    body: JSON.stringify({ pinned }),
  });
}

export interface HistoryStats {
  size_bytes: number;
  count: number;
}

export async function getHistoryStats(): Promise<HistoryStats> {
  return fetchJson<HistoryStats>(`${API_URL}/api/history/stats`);
}

/** List simulations with optional filters */
export async function listSims(params?: {
  player?: string;
  realm?: string;
  linked_only?: boolean;
  unlinked_only?: boolean;
  pinned_only?: boolean;
}): Promise<SimSummary[]> {
  const query = new URLSearchParams();
  if (params?.player) query.set('player', params.player);
  if (params?.realm) query.set('realm', params.realm);
  if (params?.linked_only) query.set('linked_only', 'true');
  if (params?.unlinked_only) query.set('unlinked_only', 'true');
  if (params?.pinned_only) query.set('pinned_only', 'true');
  const qs = query.toString();
  return fetchJson<SimSummary[]>(`${API_URL}/api/sims${qs ? '?' + qs : ''}`);
}

/** Get current system CPU usage (Desktop only) */
export async function getSystemStats(): Promise<SystemStats> {
  return fetchJson<SystemStats>(`${API_URL}/api/system-stats`);
}

export async function clearHistory(): Promise<void> {
  await fetchJson(`${API_URL}/api/history/clear`, {
    method: 'POST',
  });
}

export interface AppConfig {
  max_scenarios: number;
  max_jobs: number;
}

export async function getConfig(): Promise<AppConfig> {
  return fetchJson<AppConfig>(`${API_URL}/api/config`);
}

export async function updateConfig(config: Partial<AppConfig>): Promise<void> {
  await fetchJson(`${API_URL}/api/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
}

export async function listSavedRoutes(): Promise<SavedRoute[]> {
  return fetchJson<SavedRoute[]>(`${API_URL}/api/routes`);
}

export async function saveRoute(route: {
  name: string;
  dungeon: string;
  level?: number;
  pull_count?: number;
  timer_seconds?: number;
  affixes?: string;
  route_data: string;
}): Promise<SavedRoute> {
  return fetchJson<SavedRoute>(`${API_URL}/api/routes`, {
    method: 'POST',
    body: JSON.stringify(route),
  });
}

export async function deleteSavedRoute(id: string): Promise<void> {
  await fetchJson(`${API_URL}/api/routes/${id}`, {
    method: 'DELETE',
  });
}

export interface SavedCharacterProfile {
  id: string;
  name: string;
  realm: string;
  region: string;
  class?: string;
  spec?: string;
  simc_input: string;
  created_at: string;
}

export async function listCharacterProfiles(options?: {
  name?: string;
  realm?: string;
  region?: string;
}): Promise<SavedCharacterProfile[]> {
  const params = new URLSearchParams();
  if (options?.name) params.set('name', options.name);
  if (options?.realm) params.set('realm', options.realm);
  if (options?.region) params.set('region', options.region);
  const query = params.toString();
  return fetchJson<SavedCharacterProfile[]>(
    `${API_URL}/api/character-profiles${query ? '?' + query : ''}`,
  );
}

export async function saveCharacterProfile(profile: {
  name: string;
  realm: string;
  region: string;
  class?: string;
  spec?: string;
  simc_input: string;
}): Promise<SavedCharacterProfile> {
  return fetchJson<SavedCharacterProfile>(`${API_URL}/api/character-profiles`, {
    method: 'POST',
    body: JSON.stringify(profile),
  });
}

export async function deleteCharacterProfile(id: string): Promise<void> {
  await fetchJson(`${API_URL}/api/character-profiles/${id}`, {
    method: 'DELETE',
  });
}

export async function listInstances(): Promise<Instance[]> {
  return fetchJson<Instance[]>(`${API_URL}/api/instances`);
}

export interface DungeonAffix {
  id: number;
  name: string;
  description: string;
  icon: string | null;
  wowhead_url?: string | null;
  spell_id: number | null;
}

export interface DungeonInfo {
  id: number;
  name: string;
  description?: string;
  zone: string | null;
  slug?: string | null;
  short_name?: string | null;
  wowhead_id: number | null;
  num_bosses: number | null;
  expansion: number | null;
  expansion_name?: string | null;
  map_id?: number | null;
  challenge_mode_id?: number | null;
  minimum_level?: number | null;
  keystone_timer_ms?: number | null;
  keystone_upgrades?: number[];
  encounters?: string[];
  blizzard_href?: string | null;
  image_url?: string;
  linked_code?: string;
  blizzard_api_data?: unknown;
}

export interface DungeonSeasonData {
  season_id: number;
  season_name: string;
  current_affixes: DungeonAffix[];
  rotation_dungeons: DungeonInfo[];
}

export interface MythicKeystoneDungeonIndexEntry {
  id: number;
  name: string;
  key?: { href?: string };
}

export interface MythicKeystoneDungeonIndexResponse {
  dungeons: MythicKeystoneDungeonIndexEntry[];
}

export interface MythicKeystoneUpgradeTimer {
  upgrade_level: number;
  qualifying_duration: number;
}

export interface MythicKeystoneDungeonDetail {
  id: number;
  name: string;
  map?: { id?: number; name?: string };
  zone?: { slug?: string };
  dungeon?: { id?: number; name?: string; key?: { href?: string } };
  keystone_upgrades?: MythicKeystoneUpgradeTimer[];
  is_tracked?: boolean;
}

export interface GameDataState {
  season_id: number;
  season_name: string;
  active_affixes: string[];
  mplus_rotation: number[];
  last_sync: string;
}

export async function getDungeonData(): Promise<DungeonSeasonData> {
  return fetchJson<DungeonSeasonData>(`${API_URL}/api/dungeons`);
}

export async function getDungeonDataCached(): Promise<DungeonSeasonData> {
  return fetchJsonCached<DungeonSeasonData>(`${API_URL}/api/dungeons`, {
    ttl: 5 * 60 * 1000,
    usePersistentCache: true,
  });
}

export async function getGameDataState(): Promise<GameDataState> {
  return fetchJson<GameDataState>(`${API_URL}/api/game-data/state`);
}

export async function getGameDataStateCached(): Promise<GameDataState> {
  return fetchJsonCached<GameDataState>(`${API_URL}/api/game-data/state`, {
    ttl: 5 * 60 * 1000,
    usePersistentCache: true,
  });
}

export async function triggerDungeonDataRefresh(force = false): Promise<void> {
  const query = force ? '?force=true' : '';
  await fetchJson(`${API_URL}/api/data/sync-dungeons${query}`, { method: 'POST' });
}

export async function getMythicKeystoneDungeonIndex(
  region = 'us',
): Promise<MythicKeystoneDungeonIndexResponse> {
  return fetchJson<MythicKeystoneDungeonIndexResponse>(
    `${API_URL}/api/blizzard/mythic-keystone/dungeon/index?region=${encodeURIComponent(region)}`,
  );
}

export async function getMythicKeystoneDungeonDetail(
  dungeonId: number,
  region = 'us',
): Promise<MythicKeystoneDungeonDetail> {
  return fetchJson<MythicKeystoneDungeonDetail>(
    `${API_URL}/api/blizzard/mythic-keystone/dungeon/${encodeURIComponent(String(dungeonId))}?region=${encodeURIComponent(region)}`,
  );
}
