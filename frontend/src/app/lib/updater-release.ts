import { APP_VERSION } from './version';
import { classifyReleaseChannel, type UpdateChannel } from './update-channel';

const GITHUB_RELEASES_API = 'https://api.github.com/repos/JosephLteif/simcraft/releases?per_page=100';
const APP_RELEASES_CACHE_KEY = 'whylowdps_app_releases_stable';
const APP_RELEASES_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

type ParsedSemver = {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
};

export type RemoteReleaseInfo = {
  version: string;
  notes?: string;
  downloadUrl?: string;
};

export type AppReleaseInfo = RemoteReleaseInfo & {
  assetName?: string;
  assetSizeBytes?: number;
  publishedAt?: string;
};

export type AppReleaseListResult = {
  releases: AppReleaseInfo[];
  metadataStatus: 'available' | 'rate_limited' | 'unavailable';
};

type CachedAppReleaseListResult = {
  cachedAt?: unknown;
  result?: unknown;
};

type FetchStableAppReleasesOptions = {
  forceRefresh?: boolean;
};

type GitHubRelease = {
  tag_name?: unknown;
  name?: unknown;
  draft?: unknown;
  prerelease?: unknown;
  published_at?: unknown;
  body?: unknown;
  assets?: Array<{ browser_download_url?: unknown; name?: unknown; size?: unknown }>;
};

function isAppReleaseListResult(value: unknown): value is AppReleaseListResult {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<AppReleaseListResult>;
  return (
    Array.isArray(candidate.releases) &&
    (candidate.metadataStatus === 'available' ||
      candidate.metadataStatus === 'rate_limited' ||
      candidate.metadataStatus === 'unavailable')
  );
}

function readCachedAppReleases(): AppReleaseListResult | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(APP_RELEASES_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedAppReleaseListResult;
    if (typeof parsed.cachedAt !== 'number') return null;
    if (Date.now() - parsed.cachedAt > APP_RELEASES_CACHE_TTL_MS) return null;
    return isAppReleaseListResult(parsed.result) ? parsed.result : null;
  } catch {
    return null;
  }
}

function writeCachedAppReleases(result: AppReleaseListResult) {
  if (typeof window === 'undefined' || result.metadataStatus !== 'available') return;
  try {
    window.localStorage.setItem(
      APP_RELEASES_CACHE_KEY,
      JSON.stringify({
        cachedAt: Date.now(),
        result,
      }),
    );
  } catch {}
}

export function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/i, '');
}

function parseVersion(value: string): ParsedSemver | null {
  const raw = normalizeVersion(value);
  const match = raw.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/);
  if (!match) return null;
  const major = Number.parseInt(match[1], 10);
  const minor = Number.parseInt(match[2], 10);
  const patch = Number.parseInt(match[3], 10);
  if ([major, minor, patch].some((part) => Number.isNaN(part))) return null;
  const prerelease = match[4] ? match[4].split('.').filter(Boolean) : [];
  return { major, minor, patch, prerelease };
}

function comparePrerelease(left: string[], right: string[]): number {
  if (left.length === 0 && right.length === 0) return 0;
  if (left.length === 0) return 1;
  if (right.length === 0) return -1;

  const maxLen = Math.max(left.length, right.length);
  for (let i = 0; i < maxLen; i += 1) {
    const l = left[i];
    const r = right[i];
    if (l == null) return -1;
    if (r == null) return 1;

    const lNum = /^\d+$/.test(l) ? Number.parseInt(l, 10) : null;
    const rNum = /^\d+$/.test(r) ? Number.parseInt(r, 10) : null;
    if (lNum != null && rNum != null) {
      if (lNum < rNum) return -1;
      if (lNum > rNum) return 1;
      continue;
    }
    if (lNum != null) return -1;
    if (rNum != null) return 1;
    if (l < r) return -1;
    if (l > r) return 1;
  }

  return 0;
}

export function compareVersions(a: string, b: string): number | null {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return null;

  if (left.major < right.major) return -1;
  if (left.major > right.major) return 1;
  if (left.minor < right.minor) return -1;
  if (left.minor > right.minor) return 1;
  if (left.patch < right.patch) return -1;
  if (left.patch > right.patch) return 1;

  return comparePrerelease(left.prerelease, right.prerelease);
}

function compareBaseVersions(a: string, b: string): number | null {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return null;
  if (left.major < right.major) return -1;
  if (left.major > right.major) return 1;
  if (left.minor < right.minor) return -1;
  if (left.minor > right.minor) return 1;
  if (left.patch < right.patch) return -1;
  if (left.patch > right.patch) return 1;
  return 0;
}

export function isRemoteNewerForSelectedChannel(
  currentVersion: string | null | undefined,
  remoteVersion: string,
  selectedChannel: UpdateChannel,
): boolean {
  if (!currentVersion) return true;

  const currentChannel = classifyReleaseChannel(currentVersion);
  const remoteChannel = classifyReleaseChannel(remoteVersion);

  const semverComparison = compareVersions(currentVersion, remoteVersion);
  if (selectedChannel === 'stable') {
    return semverComparison === -1;
  }

  if (remoteChannel !== selectedChannel) return false;
  // Switching channels should still surface the selected channel build even if its base
  // semver is lower than the currently installed channel.
  if (currentChannel !== selectedChannel) return true;

  const baseComparison = compareBaseVersions(currentVersion, remoteVersion);
  if (baseComparison === -1) return true;
  if (baseComparison === 1) return false;

  return semverComparison === -1;
}

export function resolveCurrentVersion(tauriVersion: string | null): string | null {
  const frontendVersion = APP_VERSION || null;
  if (!tauriVersion) return frontendVersion;
  if (!frontendVersion) return tauriVersion;

  const comparison = compareVersions(frontendVersion, tauriVersion);
  if (comparison === null) return tauriVersion;
  if (comparison === 0) return tauriVersion;

  return comparison === -1 ? frontendVersion : tauriVersion;
}

function isStableVersion(value: string): boolean {
  const parsed = parseVersion(value);
  return Boolean(parsed && parsed.prerelease.length === 0);
}

function pickWindowsAsset(
  assets: Array<{ browser_download_url?: unknown; name?: unknown; size?: unknown }>,
): { url: string; name?: string; size?: number } | undefined {
  const urls = (assets || [])
    .map((asset) => ({
      url: typeof asset.browser_download_url === 'string' ? asset.browser_download_url : '',
      name: typeof asset.name === 'string' ? asset.name : '',
      size: typeof asset.size === 'number' && Number.isFinite(asset.size) ? asset.size : undefined,
    }))
    .filter((asset) => asset.url.length > 0);
  if (urls.length === 0) return undefined;
  return (
    urls.find((asset) => /windows|win64|x64|setup|nsis/i.test(asset.name || asset.url)) ||
    urls.find((asset) => /\.(exe|msi|zip)$/i.test(asset.name || asset.url)) ||
    urls[0]
  );
}

export function parseStableAppReleases(payload: GitHubRelease[]): AppReleaseInfo[] {
  return (payload || [])
    .flatMap((entry) => {
      if (entry?.draft || entry?.prerelease) return [];
      const tagRaw =
        typeof entry.tag_name === 'string'
          ? entry.tag_name
          : typeof entry.name === 'string'
            ? entry.name
            : '';
      if (!tagRaw || !isStableVersion(tagRaw)) return [];
      const asset = pickWindowsAsset(entry.assets || []);
      if (!asset?.url) return [];
      return [
        {
          version: normalizeVersion(tagRaw),
          notes: typeof entry.body === 'string' ? entry.body : undefined,
          downloadUrl: asset.url,
          assetName: asset.name || undefined,
          assetSizeBytes: asset.size,
          publishedAt: typeof entry.published_at === 'string' ? entry.published_at : undefined,
        },
      ];
    })
    .sort((a, b) => {
      const comparison = compareVersions(a.version, b.version);
      if (comparison != null && comparison !== 0) return -comparison;
      return String(b.publishedAt || '').localeCompare(String(a.publishedAt || ''));
    });
}

async function fetchManifestVersionFromGitHubApi(channel: UpdateChannel): Promise<RemoteReleaseInfo | null> {
  try {
    const response = await fetch(GITHUB_RELEASES_API, {
      cache: 'no-store',
      headers: {
        Accept: 'application/vnd.github+json',
      },
    });
    if (!response.ok) return null;

    const releases = parseStableAppReleases((await response.json()) as GitHubRelease[]);
    const match = releases.find((release) => classifyReleaseChannel(release.version) === channel);
    if (!match) return null;

    return {
      version: match.version,
      notes: match.notes,
      downloadUrl: match.downloadUrl,
    };
  } catch {
    return null;
  }
}

export async function fetchManifestVersion(channel: UpdateChannel): Promise<RemoteReleaseInfo | null> {
  return fetchManifestVersionFromGitHubApi(channel);
}

export async function fetchStableAppReleases(
  options: FetchStableAppReleasesOptions = {},
): Promise<AppReleaseListResult> {
  if (!options.forceRefresh) {
    const cached = readCachedAppReleases();
    if (cached) return cached;
  }

  try {
    const response = await fetch(GITHUB_RELEASES_API, {
      cache: 'no-store',
      headers: {
        Accept: 'application/vnd.github+json',
      },
    });
    if (response.status === 403 || response.status === 429) {
      return { releases: [], metadataStatus: 'rate_limited' };
    }
    if (!response.ok) return { releases: [], metadataStatus: 'unavailable' };
    const result = {
      releases: parseStableAppReleases((await response.json()) as GitHubRelease[]),
      metadataStatus: 'available' as const,
    };
    writeCachedAppReleases(result);
    return result;
  } catch {
    return { releases: [], metadataStatus: 'unavailable' };
  }
}
