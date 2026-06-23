import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildSimcRuntimeInfo, fetchSimcRuntimeInfo } from './simc-runtime-release';

describe('buildSimcRuntimeInfo', () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('combines manifest version with the current platform asset size', () => {
    const info = buildSimcRuntimeInfo(
      'weekly',
      {
        channel: 'weekly',
        version: 'weekly-202606221954',
        published_at: '2026-06-22T19:54:00Z',
        assets: [
          { platform: 'linux-x64', url: 'https://example.test/linux.zip', sha256: 'linux' },
          { platform: 'win64', url: 'https://example.test/win.zip', sha256: 'win' },
        ],
      },
      {
        assets: [
          {
            name: 'simc-linux-x64.zip',
            browser_download_url: 'https://example.test/linux.zip',
            size: 10,
          },
          {
            name: 'simc-win64.zip',
            browser_download_url: 'https://example.test/win.zip',
            size: 20,
          },
        ],
      },
      'win64'
    );

    expect(info).toEqual({
      channel: 'weekly',
      version: 'weekly-202606221954',
      publishedAt: '2026-06-22T19:54:00Z',
      assetName: 'simc-win64.zip',
      assetSizeBytes: 20,
      downloadUrl: 'https://example.test/win.zip',
      metadataStatus: 'available',
    });
  });

  it('loads manifest content through the GitHub asset API', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/releases/tags/weekly')) {
        return new Response(
          JSON.stringify({
            assets: [
              {
                name: 'manifest.json',
                url: 'https://api.github.com/repos/acme/runtime/releases/assets/1',
                browser_download_url:
                  'https://github.com/acme/runtime/releases/download/weekly/manifest.json',
                size: 200,
              },
              {
                name: 'simc-win64.zip',
                browser_download_url:
                  'https://github.com/acme/runtime/releases/download/weekly/simc-win64.zip',
                size: 300,
              },
            ],
          }),
          { status: 200 }
        );
      }
      if (url === 'https://api.github.com/repos/acme/runtime/releases/assets/1') {
        return new Response(
          JSON.stringify({
            channel: 'weekly',
            version: 'weekly-202606221954',
            published_at: '2026-06-22T19:54:00Z',
            assets: [
              {
                platform: 'win64',
                url: 'https://github.com/acme/runtime/releases/download/weekly/simc-win64.zip',
                sha256: 'hash',
              },
            ],
          }),
          { status: 200 }
        );
      }
      return new Response('', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchSimcRuntimeInfo('weekly')).resolves.toMatchObject({
      version: 'weekly-202606221954',
      assetName: 'simc-win64.zip',
      assetSizeBytes: 300,
    });
    expect(fetchMock).not.toHaveBeenCalledWith(
      'https://github.com/JosephLteif/whylowdps-simc-runtime/releases/download/weekly/manifest.json',
      expect.anything()
    );
  });

  it('falls back to release metadata when manifest content is rate limited', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/releases/tags/nightly')) {
          return new Response(
            JSON.stringify({
              updated_at: '2026-06-23T05:09:50Z',
              assets: [
                {
                  name: 'manifest.json',
                  url: 'https://api.github.com/repos/acme/runtime/releases/assets/1',
                  browser_download_url:
                    'https://github.com/acme/runtime/releases/download/nightly/manifest.json',
                  size: 200,
                },
                {
                  name: 'simc-win64.zip',
                  browser_download_url:
                    'https://github.com/acme/runtime/releases/download/nightly/simc-win64.zip',
                  size: 300,
                },
              ],
            }),
            { status: 200 }
          );
        }
        return new Response(JSON.stringify({ message: 'rate limited' }), { status: 403 });
      })
    );

    await expect(fetchSimcRuntimeInfo('nightly')).resolves.toMatchObject({
      version: 'nightly-202606230509',
      assetName: 'simc-win64.zip',
      assetSizeBytes: 300,
    });
  });

  it('falls back to release metadata when manifest content cannot be fetched', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/releases/tags/nightly')) {
          return new Response(
            JSON.stringify({
              updated_at: '2026-06-23T05:09:50Z',
              assets: [
                {
                  name: 'manifest.json',
                  url: 'https://api.github.com/repos/acme/runtime/releases/assets/1',
                  browser_download_url:
                    'https://github.com/acme/runtime/releases/download/nightly/manifest.json',
                  size: 200,
                },
                {
                  name: 'simc-win64.zip',
                  browser_download_url:
                    'https://github.com/acme/runtime/releases/download/nightly/simc-win64.zip',
                  size: 15055959,
                },
              ],
            }),
            { status: 200 }
          );
        }
        throw new TypeError('Failed to fetch');
      })
    );

    await expect(fetchSimcRuntimeInfo('nightly')).resolves.toMatchObject({
      version: 'nightly-202606230509',
      assetName: 'simc-win64.zip',
      assetSizeBytes: 15055959,
      metadataStatus: 'available',
    });
  });

  it('reports GitHub rate limits when release metadata cannot be read', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ message: 'API rate limit exceeded' }), { status: 403 })
      )
    );

    await expect(fetchSimcRuntimeInfo('nightly')).resolves.toEqual({
      channel: 'nightly',
      version: '',
      metadataStatus: 'rate_limited',
    });
  });

  it('uses cached metadata by default to avoid GitHub requests', async () => {
    localStorage.setItem(
      'whylowdps_simc_runtime_info_weekly',
      JSON.stringify({
        cachedAt: Date.now(),
        info: {
          channel: 'weekly',
          version: 'weekly-cached',
          assetName: 'simc-win64.zip',
          assetSizeBytes: 123,
          metadataStatus: 'available',
        },
      })
    );
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchSimcRuntimeInfo('weekly')).resolves.toMatchObject({
      version: 'weekly-cached',
      assetSizeBytes: 123,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('bypasses cached metadata when force refresh is requested', async () => {
    localStorage.setItem(
      'whylowdps_simc_runtime_info_weekly',
      JSON.stringify({
        cachedAt: Date.now(),
        info: {
          channel: 'weekly',
          version: 'weekly-cached',
          metadataStatus: 'available',
        },
      })
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/releases/tags/weekly')) {
          return new Response(
            JSON.stringify({
              updated_at: '2026-06-23T05:09:50Z',
              assets: [
                {
                  name: 'simc-win64.zip',
                  browser_download_url:
                    'https://github.com/acme/runtime/releases/download/weekly/simc-win64.zip',
                  size: 300,
                },
              ],
            }),
            { status: 200 }
          );
        }
        return new Response('', { status: 404 });
      })
    );

    await expect(fetchSimcRuntimeInfo('weekly', { forceRefresh: true })).resolves.toMatchObject({
      version: 'weekly-202606230509',
      assetSizeBytes: 300,
    });
  });
});
