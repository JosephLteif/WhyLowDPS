export type RaidExpansionFilterRaid = {
  id: number;
  name: string;
  expansion?: number | null;
};

export type RaidExpansionOption = {
  id: number;
  name: string;
};

export function getCurrentSeasonExpansionId(
  seasons: Array<{ expansionId?: number; startDate?: string; endDate?: string }>,
  now: Date = new Date(),
): number | null {
  const today = now.toISOString().slice(0, 10);
  const active = [...seasons]
    .sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''))
    .reverse()
    .find(
      (season) =>
        (!season.startDate || season.startDate <= today) &&
        (!season.endDate || season.endDate >= today),
    );
  return typeof active?.expansionId === 'number' ? active.expansionId : null;
}

export function listRaidExpansionOptions(
  raids: RaidExpansionFilterRaid[],
  expansions: RaidExpansionOption[],
): RaidExpansionOption[] {
  const raidExpansionIds = new Set(
    raids
      .map((raid) => raid.expansion)
      .filter((id): id is number => typeof id === 'number' && Number.isFinite(id)),
  );
  const expansionNames = new Map(expansions.map((expansion) => [expansion.id, expansion.name]));

  return Array.from(raidExpansionIds)
    .sort((a, b) => b - a)
    .map((id) => ({ id, name: expansionNames.get(id) || `Expansion ${id}` }));
}

export function filterRaidsByExpansion<T extends RaidExpansionFilterRaid>(
  raids: T[],
  expansionId: number | null,
): T[] {
  if (expansionId == null) return raids;
  return raids.filter((raid) => raid.expansion === expansionId);
}
