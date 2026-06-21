import { describe, expect, it } from 'vitest';
import { buildActivityData } from './activity';
import type { SimSummary } from './types';

function makeSim(id: string, createdAt: string): SimSummary {
  return {
    id,
    status: 'done',
    sim_type: 'quick',
    created_at: createdAt,
    fight_style: 'Patchwerk',
    iterations: 1000,
    size_bytes: 128,
  };
}

describe('activity helpers', () => {
  const now = new Date('2026-08-07T12:00:00Z');
  const sims: SimSummary[] = [
    makeSim('day-1', '2026-08-07T10:00:00Z'),
    makeSim('day-2', '2026-08-07T14:00:00Z'),
    makeSim('week-1', '2026-08-05T12:00:00Z'),
    makeSim('week-2', '2026-07-29T12:00:00Z'),
    makeSim('month-1', '2026-07-15T12:00:00Z'),
    makeSim('year-1', '2025-03-03T12:00:00Z'),
    makeSim('old', '2020-01-01T12:00:00Z'),
    makeSim('invalid', 'not-a-date'),
  ];

  it('builds daily buckets for the last 14 days by default', () => {
    const activity = buildActivityData(sims, 'day', now);

    expect(activity).toHaveLength(14);
    expect(activity.at(-1)).toEqual({ date: 'Aug 7', count: 2 });
    expect(activity.at(-3)).toEqual({ date: 'Aug 5', count: 1 });
    expect(activity.some((point) => point.count > 2)).toBe(false);
  });

  it('builds weekly buckets with week-number labels', () => {
    const activity = buildActivityData(sims, 'week', now);

    expect(activity).toHaveLength(12);
    expect(activity.at(-1)).toEqual({ date: 'Week 32', count: 3 });
    expect(activity.at(-2)).toEqual({ date: 'Week 31', count: 1 });
  });

  it('builds monthly and yearly buckets', () => {
    const monthly = buildActivityData(sims, 'month', now);
    const yearly = buildActivityData(sims, 'year', now);

    expect(monthly).toHaveLength(12);
    expect(monthly.at(-1)).toEqual({ date: 'Aug 2026', count: 3 });
    expect(monthly.at(-2)).toEqual({ date: 'Jul 2026', count: 2 });

    expect(yearly).toHaveLength(5);
    expect(yearly.at(-2)).toEqual({ date: '2025', count: 1 });
    expect(yearly.at(-1)).toEqual({ date: '2026', count: 5 });
  });
});
