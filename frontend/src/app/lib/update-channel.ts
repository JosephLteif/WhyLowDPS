export type UpdateChannel = 'stable';

const UPDATE_CHANNEL_STORAGE_KEY = 'whylowdps_update_channel';

export function isValidUpdateChannel(value: string): value is UpdateChannel {
  return value === 'stable';
}

export function classifyReleaseChannel(tagOrVersion: string): UpdateChannel {
  void tagOrVersion;
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
  return 'stable';
}
