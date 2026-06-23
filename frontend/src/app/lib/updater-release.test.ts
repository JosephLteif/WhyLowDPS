import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchStableAppReleases, parseStableAppReleases } from './updater-release';

describe('parseStableAppReleases', () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('returns installable stable GitHub releases sorted newest first', () => {
    const releases = parseStableAppReleases([
      {
        tag_name: 'v3.3.0',
        draft: false,
        prerelease: false,
        published_at: '2026-06-20T00:00:00Z',
        assets: [{ name: 'WhyLowDPS_3.3.0_x64-setup.exe', browser_download_url: 'https://example.test/330.exe', size: 10 }],
      },
      {
        tag_name: 'v3.4.0-beta.1',
        draft: false,
        prerelease: false,
        assets: [{ name: 'WhyLowDPS_3.4.0_x64-setup.exe', browser_download_url: 'https://example.test/beta.exe', size: 20 }],
      },
      {
        tag_name: 'v3.3.1',
        draft: false,
        prerelease: false,
        published_at: '2026-06-21T00:00:00Z',
        assets: [{ name: 'WhyLowDPS_3.3.1_x64-setup.exe', browser_download_url: 'https://example.test/331.exe', size: 30 }],
      },
    ]);

    expect(releases).toEqual([
      {
        version: '3.3.1',
        notes: undefined,
        downloadUrl: 'https://example.test/331.exe',
        assetName: 'WhyLowDPS_3.3.1_x64-setup.exe',
        assetSizeBytes: 30,
        publishedAt: '2026-06-21T00:00:00Z',
      },
      {
        version: '3.3.0',
        notes: undefined,
        downloadUrl: 'https://example.test/330.exe',
        assetName: 'WhyLowDPS_3.3.0_x64-setup.exe',
        assetSizeBytes: 10,
        publishedAt: '2026-06-20T00:00:00Z',
      },
    ]);
  });

  it('uses cached app releases by default to avoid GitHub requests', async () => {
    localStorage.setItem(
      'whylowdps_app_releases_stable',
      JSON.stringify({
        cachedAt: Date.now(),
        result: {
          metadataStatus: 'available',
          releases: [
            {
              version: '3.3.1',
              downloadUrl: 'https://example.test/331.exe',
              assetName: 'WhyLowDPS_3.3.1_x64-setup.exe',
              assetSizeBytes: 30,
            },
          ],
        },
      }),
    );
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchStableAppReleases()).resolves.toMatchObject({
      metadataStatus: 'available',
      releases: [{ version: '3.3.1', assetSizeBytes: 30 }],
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports GitHub rate limits when app releases cannot be read', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ message: 'API rate limit exceeded' }), { status: 403 })),
    );

    await expect(fetchStableAppReleases({ forceRefresh: true })).resolves.toEqual({
      metadataStatus: 'rate_limited',
      releases: [],
    });
  });
});
