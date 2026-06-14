import { describe, expect, it } from 'vitest';
import { UNIT_TO_MINUTES, chooseBestRefreshUnit } from './refreshInterval';

describe('refresh interval helpers', () => {
  it('chooses the largest exact unit and falls back to minutes', () => {
    expect(chooseBestRefreshUnit(0)).toEqual({ value: 0, unit: 'minutes' });
    expect(chooseBestRefreshUnit(45)).toEqual({ value: 45, unit: 'minutes' });
    expect(chooseBestRefreshUnit(120)).toEqual({ value: 2, unit: 'hours' });
    expect(chooseBestRefreshUnit(60 * 24 * 3)).toEqual({ value: 3, unit: 'days' });
    expect(chooseBestRefreshUnit(60 * 24 * 14)).toEqual({ value: 2, unit: 'weeks' });
    expect(UNIT_TO_MINUTES.days).toBe(1440);
  });
});

