export type UpdateChannel = 'stable' | 'dev';

const UPDATE_CHANNEL_STORAGE_KEY = 'whylowdps_update_channel';

export function isValidUpdateChannel(value: string): value is UpdateChannel {
  return value === 'stable' || value === 'dev';
}

export function classifyReleaseChannel(tagOrVersion: string): UpdateChannel {
  const normalized = tagOrVersion.trim().replace(/^v/i, '').toLowerCase();
  return /(?:^|-)dev(?:[.-]|$)/.test(normalized) ? 'dev' : 'stable';
}

export function detectVersionChannel(version: string | null | undefined): UpdateChannel {
  if (!version) return 'stable';
  return classifyReleaseChannel(version);
}

export function readStoredUpdateChannel(
  fallbackVersion: string | null | undefined = null
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
