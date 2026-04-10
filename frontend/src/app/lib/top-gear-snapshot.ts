export const TOP_GEAR_SNAPSHOT_KEY = 'whylowdps_top_gear_snapshot_v1';

export interface TopGearSnapshot {
  simcInput: string;
  selectedUids: Record<string, string[]>;
  localItems: { slot: string; simc_string: string; origin: string }[];
  maxUpgrade: boolean;
  copyEnchants: boolean;
  catalyst: boolean;
  catalystCharges: number | null;
  savedAt: number;
}

export function saveTopGearSnapshot(snapshot: TopGearSnapshot): void {
  if (typeof window === 'undefined') return;
  sessionStorage.setItem(TOP_GEAR_SNAPSHOT_KEY, JSON.stringify(snapshot));
}

export function loadTopGearSnapshot(): TopGearSnapshot | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(TOP_GEAR_SNAPSHOT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as TopGearSnapshot;
  } catch {
    return null;
  }
}
