import { APP_VERSION } from './version';
import { classifyReleaseChannel, type UpdateChannel } from './update-channel';

const UPDATER_MANIFEST_URL =
  'https://github.com/JosephLteif/simcraft/releases/latest/download/latest.json';
const GITHUB_RELEASES_API = 'https://api.github.com/repos/JosephLteif/simcraft/releases?per_page=100';

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

type GitHubRelease = {
  tag_name?: unknown;
  name?: unknown;
  draft?: unknown;
  prerelease?: unknown;
  body?: unknown;
  assets?: Array<{ browser_download_url?: unknown; name?: unknown }>;
};

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

  const semverComparison = compareVersions(currentVersion, remoteVersion);
  if (selectedChannel === 'stable') {
    return semverComparison === -1;
  }

  const baseComparison = compareBaseVersions(currentVersion, remoteVersion);
  if (baseComparison === -1) return true;
  if (baseComparison === 1) return false;

  const currentChannel = classifyReleaseChannel(currentVersion);
  const remoteChannel = classifyReleaseChannel(remoteVersion);
  if (remoteChannel !== selectedChannel) return false;
  if (currentChannel !== selectedChannel) return true;
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

function pickWindowsAssetUrl(
  assets: Array<{ browser_download_url?: unknown; name?: unknown }>,
): string | undefined {
  const urls = (assets || [])
    .map((asset) => ({
      url: typeof asset.browser_download_url === 'string' ? asset.browser_download_url : '',
      name: typeof asset.name === 'string' ? asset.name : '',
    }))
    .filter((asset) => asset.url.length > 0);
  if (urls.length === 0) return undefined;
  const preferred =
    urls.find((asset) => /windows|win64|x64|setup|nsis/i.test(asset.name || asset.url)) ||
    urls.find((asset) => /\.(exe|msi|zip)$/i.test(asset.name || asset.url)) ||
    urls[0];
  return preferred.url;
}

async function fetchManifestVersionFromLatestJson(): Promise<RemoteReleaseInfo | null> {
  try {
    const response = await fetch(UPDATER_MANIFEST_URL, { cache: 'no-store' });
    if (!response.ok) return null;
    const raw = await response.text();
    let payload: {
      version?: unknown;
      notes?: unknown;
      platforms?: Record<string, { url?: unknown }>;
    };
    try {
      payload = JSON.parse(raw);
    } catch {
      return null;
    }

    const version = typeof payload.version === 'string' ? payload.version : '';
    if (!version) return null;

    const platforms = payload.platforms || {};
    const preferredKeys = ['windows-x86_64', 'windows-x86_64-nsis'];
    const preferredUrl =
      preferredKeys
        .map((key) => platforms[key]?.url)
        .find((url) => typeof url === 'string' && url.length > 0) ||
      Object.values(platforms)
        .map((platform) => platform?.url)
        .find((url) => typeof url === 'string' && url.length > 0);

    return {
      version,
      notes: typeof payload.notes === 'string' ? payload.notes : undefined,
      downloadUrl: typeof preferredUrl === 'string' ? preferredUrl : undefined,
    };
  } catch {
    return null;
  }
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

    const payload = (await response.json()) as GitHubRelease[];
    const match = (payload || []).find((entry) => {
      if (entry?.draft) return false;
      const tagRaw =
        typeof entry.tag_name === 'string'
          ? entry.tag_name
          : typeof entry.name === 'string'
            ? entry.name
            : '';
      if (!tagRaw) return false;
      const releaseChannel = classifyReleaseChannel(tagRaw);
      if (releaseChannel !== channel) return false;
      if (channel === 'stable' && entry?.prerelease) return false;
      return true;
    });
    if (!match) return null;

    const versionRaw =
      typeof match.tag_name === 'string'
        ? match.tag_name
        : typeof match.name === 'string'
          ? match.name
          : '';
    const version = normalizeVersion(versionRaw);
    if (!version) return null;

    return {
      version,
      notes: typeof match.body === 'string' ? match.body : undefined,
      downloadUrl: pickWindowsAssetUrl(match.assets || []),
    };
  } catch {
    return null;
  }
}

export async function fetchManifestVersion(channel: UpdateChannel): Promise<RemoteReleaseInfo | null> {
  if (channel === 'stable') {
    const fromLatestJson = await fetchManifestVersionFromLatestJson();
    if (fromLatestJson) return fromLatestJson;
  }
  return fetchManifestVersionFromGitHubApi(channel);
}
