import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/useGameContext', () => ({
  useGameContext: () => null,
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('CharacterInfoBar', () => {
  it('uses the desktop-safe character route for its Profile link', async () => {
    vi.stubEnv('DESKTOP_BUILD', 'true');
    vi.resetModules();
    const { CharacterInfoBar } = await import('./SimSharedConfigSections');

    render(
      <CharacterInfoBar
        info={{
          className: 'monk',
          name: 'Sylph',
          spec: 'windwalker',
          level: '98',
          race: 'Night Elf',
          region: 'EU',
          server: 'Azjolnerub',
          role: 'attack',
          professions: null,
          lootSpec: 'mistweaver',
          addonVersion: null,
          wowVersion: null,
          requiresVersion: null,
          talentsCount: 0,
          savedLoadouts: 0,
          checksum: null,
        }}
      />
    );

    expect(screen.getByRole('link', { name: 'Profile' })).toHaveAttribute(
      'href',
      '/character/us/realm/name?region=eu&realm=azjolnerub&name=sylph'
    );
  });
});
