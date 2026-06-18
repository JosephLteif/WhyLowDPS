import { describe, expect, it } from 'vitest';
import { fallbackUpgradeTimers } from './shared';

describe('dungeon card timer fallbacks', () => {
  it('derives upgrade timer chips from a base timer', () => {
    expect(fallbackUpgradeTimers(1_980_000, [1, 2, 3])).toEqual([
      { upgrade_level: 1, qualifying_duration: 1_980_000 },
      { upgrade_level: 2, qualifying_duration: 1_584_000 },
      { upgrade_level: 3, qualifying_duration: 1_188_000 },
    ]);
  });
});
