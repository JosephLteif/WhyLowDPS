import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('characterHref', () => {
  it('uses the static placeholder route for desktop builds', async () => {
    vi.stubEnv('DESKTOP_BUILD', 'true');
    const { characterHref } = await import('./routes');

    expect(characterHref('EU', 'Aerie Peak', 'Sylph Prime')).toBe(
      '/character/us/realm/name/?region=eu&realm=aerie-peak&name=sylph+prime'
    );
  });

  it('uses the slug route for web builds', async () => {
    const { characterHref } = await import('./routes');

    expect(characterHref('EU', 'Aerie Peak', 'Sylph Prime')).toBe(
      '/character/eu/aerie-peak/sylph%20prime'
    );
  });
});
