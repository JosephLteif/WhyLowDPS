// API URL detection: desktop app uses a fixed local server port
// Use 127.0.0.1 (not localhost) to match the backend bind address and avoid
// IPv6 resolution issues on Windows where localhost may resolve to ::1
export const API_URL =
  typeof window !== 'undefined' && window.electronAPI
    ? 'http://127.0.0.1:17384'
    : (process.env.NEXT_PUBLIC_API_URL ?? '');

/** Fetch JSON with consistent error handling. Throws on non-ok responses. */
export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || `Server error ${res.status}`);
  }
  return res.json();
}

export async function deleteSim(id: string): Promise<void> {
  await fetch(`${API_URL}/api/sim/${id}`, { method: 'DELETE' });
}

export interface HistoryStats {
  size_bytes: number;
  count: number;
}

export async function getHistoryStats(): Promise<HistoryStats> {
  return fetchJson<HistoryStats>(`${API_URL}/api/history/stats`);
}

export async function clearHistory(): Promise<void> {
  await fetch(`${API_URL}/api/history/clear`, { method: 'POST' });
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
  });
}
