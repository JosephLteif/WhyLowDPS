export type SimcUpdateChannel = 'weekly' | 'nightly';

const SIMC_RELEASE_API_BASE =
  'https://api.github.com/repos/JosephLteif/whylowdps-simc-runtime/releases/tags';
const SIMC_RUNTIME_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

type SimcManifest = {
  channel?: unknown;
  version?: unknown;
  published_at?: unknown;
  assets?: Array<{ platform?: unknown; url?: unknown; sha256?: unknown }>;
};

type SimcRelease = {
  updated_at?: unknown;
  published_at?: unknown;
  assets?: Array<{ name?: unknown; url?: unknown; browser_download_url?: unknown; size?: unknown }>;
};

export type SimcRuntimeInfo = {
  channel: SimcUpdateChannel;
  version: string;
  publishedAt?: string;
  assetName?: string;
  assetSizeBytes?: number;
  downloadUrl?: string;
  metadataStatus?: 'available' | 'rate_limited' | 'unavailable';
};

type CachedSimcRuntimeInfo = {
  cachedAt?: unknown;
  info?: unknown;
};

type FetchSimcRuntimeInfoOptions = {
  forceRefresh?: boolean;
};

function cacheKey(channel: SimcUpdateChannel): string {
  return `whylowdps_simc_runtime_info_${channel}`;
}

function isSimcRuntimeInfo(value: unknown, channel: SimcUpdateChannel): value is SimcRuntimeInfo {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<SimcRuntimeInfo>;
  return candidate.channel === channel && typeof candidate.version === 'string';
}

function readCachedSimcRuntimeInfo(channel: SimcUpdateChannel): SimcRuntimeInfo | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(cacheKey(channel));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedSimcRuntimeInfo;
    if (typeof parsed.cachedAt !== 'number') return null;
    if (Date.now() - parsed.cachedAt > SIMC_RUNTIME_CACHE_TTL_MS) return null;
    return isSimcRuntimeInfo(parsed.info, channel) ? parsed.info : null;
  } catch {
    return null;
  }
}

function writeCachedSimcRuntimeInfo(info: SimcRuntimeInfo | null) {
  if (typeof window === 'undefined' || !info || info.metadataStatus !== 'available') return;
  try {
    window.localStorage.setItem(
      cacheKey(info.channel),
      JSON.stringify({
        cachedAt: Date.now(),
        info,
      }),
    );
  } catch {}
}

export function currentSimcPlatform(): string {
  if (typeof navigator !== 'undefined' && /mac/i.test(navigator.platform)) return 'macos';
  if (typeof navigator !== 'undefined' && /linux/i.test(navigator.platform)) return 'linux-x64';
  return 'win64';
}

export function buildSimcRuntimeInfo(
  channel: SimcUpdateChannel,
  manifest: SimcManifest,
  release: SimcRelease,
  platform = currentSimcPlatform(),
): SimcRuntimeInfo | null {
  const version = typeof manifest.version === 'string' ? manifest.version : '';
  if (!version) return null;

  const manifestAsset = (manifest.assets || []).find((asset) => asset.platform === platform);
  const downloadUrl = typeof manifestAsset?.url === 'string' ? manifestAsset.url : undefined;
  const releaseAsset = (release.assets || []).find((asset) => {
    const url = typeof asset.browser_download_url === 'string' ? asset.browser_download_url : '';
    const name = typeof asset.name === 'string' ? asset.name : '';
    return (downloadUrl && url === downloadUrl) || name.toLowerCase().includes(platform.toLowerCase());
  });

  return {
    channel,
    version,
    publishedAt: typeof manifest.published_at === 'string' ? manifest.published_at : undefined,
    assetName: typeof releaseAsset?.name === 'string' ? releaseAsset.name : undefined,
    assetSizeBytes:
      typeof releaseAsset?.size === 'number' && Number.isFinite(releaseAsset.size)
        ? releaseAsset.size
        : undefined,
    downloadUrl,
    metadataStatus: 'available',
  };
}

function versionFromReleaseTimestamp(channel: SimcUpdateChannel, value: unknown): string {
  if (typeof value !== 'string') return channel;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return channel;
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${channel}-${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}`;
}

function buildSimcRuntimeInfoFromRelease(
  channel: SimcUpdateChannel,
  release: SimcRelease,
  platform = currentSimcPlatform(),
): SimcRuntimeInfo {
  const releaseAsset = (release.assets || []).find((asset) => {
    const name = typeof asset.name === 'string' ? asset.name : '';
    return name.toLowerCase().includes(platform.toLowerCase());
  });

  return {
    channel,
    version: versionFromReleaseTimestamp(channel, release.updated_at || release.published_at),
    publishedAt: typeof release.updated_at === 'string' ? release.updated_at : undefined,
    assetName: typeof releaseAsset?.name === 'string' ? releaseAsset.name : undefined,
    assetSizeBytes:
      typeof releaseAsset?.size === 'number' && Number.isFinite(releaseAsset.size)
        ? releaseAsset.size
        : undefined,
    downloadUrl:
      typeof releaseAsset?.browser_download_url === 'string'
        ? releaseAsset.browser_download_url
        : undefined,
    metadataStatus: 'available',
  };
}

export async function fetchSimcRuntimeInfo(
  channel: SimcUpdateChannel,
  options: FetchSimcRuntimeInfoOptions = {},
): Promise<SimcRuntimeInfo | null> {
  if (!options.forceRefresh) {
    const cached = readCachedSimcRuntimeInfo(channel);
    if (cached) return cached;
  }

  try {
    const releaseResponse = await fetch(`${SIMC_RELEASE_API_BASE}/${channel}`, {
      cache: 'no-store',
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (releaseResponse.status === 403 || releaseResponse.status === 429) {
      return { channel, version: '', metadataStatus: 'rate_limited' };
    }
    if (!releaseResponse.ok) return { channel, version: '', metadataStatus: 'unavailable' };
    const release = (await releaseResponse.json()) as SimcRelease;
    const manifestAsset = (release.assets || []).find((asset) => asset.name === 'manifest.json');
    const manifestUrl =
      typeof manifestAsset?.url === 'string'
        ? manifestAsset.url
        : typeof manifestAsset?.browser_download_url === 'string'
          ? manifestAsset.browser_download_url
          : '';
    if (!manifestUrl) {
      const info = buildSimcRuntimeInfoFromRelease(channel, release);
      writeCachedSimcRuntimeInfo(info);
      return info;
    }
    const manifestResponse = await fetch(manifestUrl, {
      cache: 'no-store',
      headers: { Accept: 'application/octet-stream' },
    });
    if (!manifestResponse.ok) {
      const info = buildSimcRuntimeInfoFromRelease(channel, release);
      writeCachedSimcRuntimeInfo(info);
      return info;
    }
    const manifest = (await manifestResponse.json()) as SimcManifest;
    const info = buildSimcRuntimeInfo(channel, manifest, release);
    writeCachedSimcRuntimeInfo(info);
    return info;
  } catch {
    return null;
  }
}
