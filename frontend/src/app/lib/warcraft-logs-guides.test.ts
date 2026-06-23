import { describe, expect, it } from 'vitest';
import { getWarcraftLogsGuideUrl } from './warcraft-logs-guides';

describe('warcraft logs guides', () => {
  it('uses and for ampersands in guide slugs', () => {
    expect(getWarcraftLogsGuideUrl('Vaelgor & Ezzorak')).toBe(
      'https://www.warcraftlogs.com/guide/vaelgor-and-ezzorak',
    );
  });

  it('supports backend-owned alias names for current-season bosses', () => {
    expect(getWarcraftLogsGuideUrl('Vaelgor')).toBe(
      'https://www.warcraftlogs.com/guide/vaelgor-and-ezzorak',
    );
    expect(getWarcraftLogsGuideUrl('War Chaplain Senn')).toBe(
      'https://www.warcraftlogs.com/guide/lightblinded-vanguard',
    );
    expect(getWarcraftLogsGuideUrl('Alleria Windrunner')).toBe(
      'https://www.warcraftlogs.com/guide/crown-of-the-cosmos',
    );
  });
});
