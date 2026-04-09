const isDesktop =
  typeof window !== 'undefined' &&
  (window.location.protocol === 'tauri:' ||
    window.location.protocol === 'asset:' ||
    (window as any).__TAURI_METADATA__ ||
    process.env.DESKTOP_BUILD);
export const API_URL = isDesktop ? 'http://localhost:17384' : '';

/** Fetch JSON with consistent error handling. Throws on non-ok responses. */
export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const finalInit = { ...init, credentials: 'include' as RequestCredentials };
  const res = await fetch(url, finalInit);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || `Server error ${res.status}`);
  }
  return res.json();
}

export async function deleteSim(id: string): Promise<void> {
  await fetch(`${API_URL}/api/sim/${id}`, {
    method: 'DELETE',
    credentials: 'include' as RequestCredentials,
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
  await fetch(`${API_URL}/api/history/clear`, {
    method: 'POST',
    credentials: 'include' as RequestCredentials,
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
  await fetch(`${API_URL}/api/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
    credentials: 'include' as RequestCredentials,
  });
}
