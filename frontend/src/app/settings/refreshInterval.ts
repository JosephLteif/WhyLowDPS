export type RefreshUnit = 'minutes' | 'hours' | 'days' | 'weeks';

export const UNIT_TO_MINUTES: Record<RefreshUnit, number> = {
  minutes: 1,
  hours: 60,
  days: 60 * 24,
  weeks: 60 * 24 * 7,
};

export const chooseBestRefreshUnit = (
  minutes: number
): { value: number; unit: RefreshUnit } => {
  if (minutes <= 0) return { value: 0, unit: 'minutes' };
  if (minutes % UNIT_TO_MINUTES.weeks === 0) {
    return { value: Math.floor(minutes / UNIT_TO_MINUTES.weeks), unit: 'weeks' };
  }
  if (minutes % UNIT_TO_MINUTES.days === 0) {
    return { value: Math.floor(minutes / UNIT_TO_MINUTES.days), unit: 'days' };
  }
  if (minutes % UNIT_TO_MINUTES.hours === 0) {
    return { value: Math.floor(minutes / UNIT_TO_MINUTES.hours), unit: 'hours' };
  }
  return { value: minutes, unit: 'minutes' };
};
