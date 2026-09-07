import { describe, expect, it } from 'vitest';
import { getChangelogReleasesToShow, type ChangelogRelease } from './changelog';

const release = (version: string): ChangelogRelease => ({
  version,
  date: '',
  title: version,
  entries: [{ category: 'feature', title: version, summary: version }],
});

describe('changelog release selection', () => {
  const releases = [
    release('7.0.0'),
    release('6.5.0'),
    release('6.4.2'),
    release('6.0.0'),
    release('5.0.1'),
  ];

  it('shows every current-major release through the installed version', () => {
    expect(getChangelogReleasesToShow(releases, '6.5.0').map(({ version }) => version)).toEqual([
      '6.5.0',
      '6.4.2',
      '6.0.0',
    ]);
  });

  it('does not show another major release or future releases', () => {
    expect(getChangelogReleasesToShow(releases, '6.4.2').map(({ version }) => version)).toEqual([
      '6.4.2',
      '6.0.0',
    ]);
    expect(getChangelogReleasesToShow(releases, '7.0.0').map(({ version }) => version)).toEqual([
      '7.0.0',
    ]);
  });

  it('keeps unreleased notes ahead of versioned releases', () => {
    const withUnreleased = [release('Unreleased'), ...releases];
    expect(
      getChangelogReleasesToShow(withUnreleased, '6.5.0').map(({ version }) => version)
    ).toEqual(['Unreleased', '6.5.0', '6.4.2', '6.0.0']);
  });
});
