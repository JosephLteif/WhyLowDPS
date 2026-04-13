export const isDesktop =
  typeof window !== 'undefined' &&
  (window.location.protocol === 'tauri:' ||
    window.location.protocol === 'asset:' ||
    window.location.hostname === 'tauri.localhost' ||
    (window as any).__TAURI__ ||
    (window as any).__TAURI_METADATA__ ||
    (window as any).__TAURI_INTERNALS__ ||
    process.env.DESKTOP_BUILD ||
    process.env.NEXT_PUBLIC_DESKTOP_BUILD);
export const API_URL = isDesktop ? 'http://localhost:17384' : '';

export const TOKEN_KEY = 'whylowdps_auth_token';

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

  const res = await fetch(url, finalInit);
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
        localStorage.removeItem(cacheKey);
      }
    }
  }

  // 3. Fetch Fresh
  const data = await fetchJson<T>(url, init);

  // 4. Update Caches
  const cacheEntry = { data, expiry: now + ttl };
  memoryCache[cacheKey] = cacheEntry;
  if (usePersistentCache && typeof window !== 'undefined') {
    localStorage.setItem(cacheKey, JSON.stringify(cacheEntry));
  }

  return data;
}

export async function deleteSim(id: string): Promise<void> {
  await fetchJson(`${API_URL}/api/sim/${id}`, {
    method: 'DELETE',
  });
}

export interface HistoryStats {
  size_bytes: number;
  count: number;
}

export async function getHistoryStats(): Promise<HistoryStats> {
  return fetchJson<HistoryStats>(`${API_URL}/api/history/stats`);
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

export interface SimcStatus {
  channel: string;
  channel_path?: string;
  installed_path: string;
  installed_exists: boolean;
  installed_version: string | null;
  installed_date?: string | null;
  installed_channel?: string | null;
  latest_version: string | null;
  latest_download: string | null;
  available_versions?: Record<string, string | null>;
  available_downloads?: Record<string, string | null>;
  update_available: boolean;
  checking_failed: boolean;
  detail: string | null;
  is_updating: boolean;
  download_progress?: {
    channel: string;
    phase: string;
    unit: 'bytes' | 'files';
    bytes_downloaded: number;
    bytes_total: number | null;
    speed_bps: number | null;
    percent: number | null;
    eta_seconds: number | null;
    elapsed_seconds: number;
  } | null;
}

export async function getSimcStatus(channel?: string): Promise<SimcStatus> {
  const suffix = channel ? `?channel=${encodeURIComponent(channel)}` : '';
  return fetchJson<SimcStatus>(`${API_URL}/api/system/simc/status${suffix}`);
}

export async function downloadLatestSimc(channel?: string): Promise<SimcStatus> {
  const suffix = channel ? `?channel=${encodeURIComponent(channel)}` : '';
  return fetchJson<SimcStatus>(`${API_URL}/api/system/simc/download-latest${suffix}`, {
    method: 'POST',
  });
}

export async function removeSimcChannel(channel: string): Promise<SimcStatus> {
  const suffix = `?channel=${encodeURIComponent(channel)}`;
  return fetchJson<SimcStatus>(`${API_URL}/api/system/simc/remove${suffix}`, {
    method: 'POST',
  });
}
