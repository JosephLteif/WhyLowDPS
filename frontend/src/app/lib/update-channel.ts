export type UpdateChannel = 'stable' | 'weekly' | 'nightly';

export const UPDATE_CHANNEL_STORAGE_KEY = 'whylowdps_update_channel';

export const UPDATE_CHANNEL_OPTIONS: Array<{ id: UpdateChannel; label: string }> = [
  { id: 'stable', label: 'Stable' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'nightly', label: 'Nightly' },
];

export function isValidUpdateChannel(value: string): value is UpdateChannel {
  return value === 'stable' || value === 'weekly' || value === 'nightly';
}

export function classifyReleaseChannel(tagOrVersion: string): UpdateChannel {
  const value = String(tagOrVersion || '').toLowerCase();
  // Match channel markers after x.y.z, e.g. 1.2.3-nightly.20260423, 1.2.3-nightly, 1.2.3+nightly
  if (/\d+\.\d+\.\d+[-+][^ ]*nightly/.test(value)) return 'nightly';
  if (/\d+\.\d+\.\d+[-+][^ ]*weekly/.test(value)) return 'weekly';
  if (value.includes('-nightly.')) return 'nightly';
  if (value.includes('-weekly.')) return 'weekly';
  return 'stable';
}

export function detectVersionChannel(version: string | null | undefined): UpdateChannel {
  if (!version) return 'stable';
  return classifyReleaseChannel(version);
}

export function readStoredUpdateChannel(
  fallbackVersion: string | null | undefined = null,
): UpdateChannel {
  if (typeof window === 'undefined') {
    return detectVersionChannel(fallbackVersion);
  }

  const raw = window.localStorage.getItem(UPDATE_CHANNEL_STORAGE_KEY)?.toLowerCase() || '';
  if (isValidUpdateChannel(raw)) {
    return raw;
  }
  return detectVersionChannel(fallbackVersion);
}
