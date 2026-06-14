import { describe, expect, it } from 'vitest';
import { calculateAverageIlevel } from './ilevel';

describe('calculateAverageIlevel', () => {
  it('returns zero for missing gear', () => {
    expect(calculateAverageIlevel({})).toBe(0);
  });

  it('averages standard slots and counts a two-handed main hand twice when off hand is empty', () => {
    const gear = {
      head: { slot: 'head', ilevel: 640 },
      chest: { slot: 'chest', ilevel: 632 },
      main_hand: { slot: 'main_hand', ilevel: 650 },
    };

    expect(calculateAverageIlevel(gear)).toBe((640 + 632 + 650 + 650) / 16);
  });

  it('does not double-count main hand when an off hand is equipped', () => {
    const gear = {
      main_hand: { slot: 'main_hand', ilevel: 650 },
      off_hand: { slot: 'off_hand', ilevel: 640 },
    };

    expect(calculateAverageIlevel(gear)).toBe((650 + 640) / 16);
  });
});

