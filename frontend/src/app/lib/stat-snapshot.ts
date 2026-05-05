import type { CharacterStatisticsPayload } from './character-domain-types';

type StatValue =
  | number
  | {
      effective?: number;
      value?: number;
      percent?: number;
      rating_bonus?: number;
      rating_normalized?: number;
      rating?: number;
    };

export type SnapshotPrimaryStat = {
  key: string;
  label: string;
  value: number;
};

export type SnapshotFlatStat = {
  value: number;
};

export type SnapshotSecondaryStat = {
  rating: number | null;
  percent: number | null;
};

export type StatSnapshot = {
  source?: string;
  primary: SnapshotPrimaryStat | null;
  stamina: SnapshotFlatStat | null;
  crit: SnapshotSecondaryStat | null;
  haste: SnapshotSecondaryStat | null;
  mastery: SnapshotSecondaryStat | null;
  versatility: SnapshotSecondaryStat | null;
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function getEffectiveNumber(stat?: StatValue): number | null {
  if (typeof stat === 'number' && Number.isFinite(stat)) return stat;
  const statObj = stat && typeof stat === 'object' ? stat : null;
  if (typeof statObj?.effective === 'number' && Number.isFinite(statObj.effective)) {
    return statObj.effective;
  }
  if (typeof statObj?.value === 'number' && Number.isFinite(statObj.value)) {
    return statObj.value;
  }
  return null;
}

function getSecondaryStat(stat?: StatValue, rating?: StatValue): SnapshotSecondaryStat | null {
  const statObj =
    stat && typeof stat === 'object' ? (stat as Exclude<StatValue, number>) : null;
  const ratingObj =
    rating && typeof rating === 'object' ? (rating as Exclude<StatValue, number>) : null;

  const percent =
    (typeof stat === 'number' && Number.isFinite(stat) ? stat : null) ??
    (typeof statObj?.value === 'number' && Number.isFinite(statObj.value) ? statObj.value : null) ??
    (typeof statObj?.percent === 'number' && Number.isFinite(statObj.percent)
      ? statObj.percent
      : null) ??
    (typeof statObj?.rating_bonus === 'number' && Number.isFinite(statObj.rating_bonus)
      ? statObj.rating_bonus
      : null);

  const statRating =
    (typeof ratingObj?.rating_normalized === 'number' && Number.isFinite(ratingObj.rating_normalized)
      ? ratingObj.rating_normalized
      : null) ??
    (typeof ratingObj?.rating === 'number' && Number.isFinite(ratingObj.rating)
      ? ratingObj.rating
      : null) ??
    (typeof rating === 'number' && Number.isFinite(rating) ? rating : null);

  if (percent == null && statRating == null) return null;

  return {
    rating: statRating == null ? null : Math.round(statRating),
    percent: percent == null ? null : round2(percent),
  };
}

export function normalizeLiveCharacterStats(
  statistics: CharacterStatisticsPayload | undefined
): StatSnapshot | null {
  if (!statistics || typeof statistics !== 'object') return null;
  const statsObj = statistics as Record<string, unknown>;

  const primaryCandidates: SnapshotPrimaryStat[] = [
    {
      key: 'strength',
      label: 'Strength',
      value: getEffectiveNumber(statsObj.strength as StatValue | undefined) ?? 0,
    },
    {
      key: 'agility',
      label: 'Agility',
      value: getEffectiveNumber(statsObj.agility as StatValue | undefined) ?? 0,
    },
    {
      key: 'intellect',
      label: 'Intellect',
      value: getEffectiveNumber(statsObj.intellect as StatValue | undefined) ?? 0,
    },
  ].filter((entry) => entry.value > 0);

  const primary =
    primaryCandidates.sort((a, b) => b.value - a.value)[0] ?? null;

  const crit =
    (statsObj.melee_crit as StatValue | undefined) ||
    (statsObj.spell_crit as StatValue | undefined) ||
    (statsObj.ranged_crit as StatValue | undefined) ||
    (statsObj.crit as StatValue | undefined);
  const haste =
    (statsObj.melee_haste as StatValue | undefined) ||
    (statsObj.spell_haste as StatValue | undefined) ||
    (statsObj.ranged_haste as StatValue | undefined) ||
    (statsObj.haste as StatValue | undefined);
  const mastery = statsObj.mastery as StatValue | undefined;
  const versatility =
    (statsObj.versatility_offensive_modifier as StatValue | undefined) ||
    (statsObj.versatility as StatValue | undefined);

  const staminaValue = getEffectiveNumber(statsObj.stamina as StatValue | undefined);

  const snapshot: StatSnapshot = {
    source: 'live',
    primary,
    stamina: staminaValue == null ? null : { value: Math.round(staminaValue) },
    crit: getSecondaryStat(crit, crit),
    haste: getSecondaryStat(haste, haste),
    mastery: getSecondaryStat(mastery, mastery),
    versatility: getSecondaryStat(
      versatility,
      statsObj.versatility as StatValue | undefined
    ),
  };

  const hasData =
    snapshot.primary ||
    snapshot.stamina ||
    snapshot.crit ||
    snapshot.haste ||
    snapshot.mastery ||
    snapshot.versatility;

  return hasData ? snapshot : null;
}
