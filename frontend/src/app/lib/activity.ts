import type { SimSummary } from './types';

export type ActivityPeriod = 'day' | 'week' | 'month' | 'year';

export type ActivityPoint = {
  date: string;
  count: number;
};

const ACTIVITY_PERIOD_COUNTS: Record<ActivityPeriod, number> = {
  day: 14,
  week: 12,
  month: 12,
  year: 5,
};

const ACTIVITY_PERIOD_TITLES: Record<ActivityPeriod, string> = {
  day: 'Last 14 Days',
  week: 'Last 12 Weeks',
  month: 'Last 12 Months',
  year: 'Last 5 Years',
};

export function getActivityPeriodTitle(period: ActivityPeriod): string {
  return ACTIVITY_PERIOD_TITLES[period];
}

export function buildActivityData(
  sims: SimSummary[],
  period: ActivityPeriod = 'day',
  now = new Date()
): ActivityPoint[] {
  const bucketCount = ACTIVITY_PERIOD_COUNTS[period];
  const currentStart = getBucketStart(now, period);
  const buckets = Array.from({ length: bucketCount }, (_, index) => {
    const start = addPeriods(currentStart, period, index - (bucketCount - 1));
    return {
      key: getBucketKey(start, period),
      label: getBucketLabel(start, period),
      count: 0,
    };
  });
  const byKey = new Map(buckets.map((bucket) => [bucket.key, bucket]));

  for (const sim of sims) {
    const created = new Date(sim.created_at);
    if (!Number.isFinite(created.getTime())) continue;
    const key = getBucketKey(created, period);
    const bucket = byKey.get(key);
    if (!bucket) continue;
    bucket.count += 1;
  }

  return buckets.map(({ label, count }) => ({ date: label, count }));
}

function getBucketStart(date: Date, period: ActivityPeriod): Date {
  const value = new Date(date);
  if (period === 'day') {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  if (period === 'week') {
    const day = value.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    return new Date(value.getFullYear(), value.getMonth(), value.getDate() + diff);
  }
  if (period === 'month') {
    return new Date(value.getFullYear(), value.getMonth(), 1);
  }
  return new Date(value.getFullYear(), 0, 1);
}

function addPeriods(date: Date, period: ActivityPeriod, amount: number): Date {
  if (period === 'day') {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount);
  }
  if (period === 'week') {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount * 7);
  }
  if (period === 'month') {
    return new Date(date.getFullYear(), date.getMonth() + amount, 1);
  }
  return new Date(date.getFullYear() + amount, 0, 1);
}

function getBucketKey(date: Date, period: ActivityPeriod): string {
  if (period === 'day') {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }
  if (period === 'week') {
    const { year, week } = getIsoWeek(date);
    return `${year}-W${pad(week)}`;
  }
  if (period === 'month') {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
  }
  return String(date.getFullYear());
}

function getBucketLabel(date: Date, period: ActivityPeriod): string {
  if (period === 'day') {
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  if (period === 'week') {
    return `Week ${getIsoWeek(date).week}`;
  }
  if (period === 'month') {
    return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  }
  return String(date.getFullYear());
}

function getIsoWeek(date: Date): { year: number; week: number } {
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((utc.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return { year: utc.getUTCFullYear(), week };
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
