export type RaidExpansionFilterRaid = {
  id: number;
  name: string;
  expansion?: number | null;
};

export type RaidExpansionOption = {
  id: number;
  name: string;
};

export function getCurrentSeasonExpansionId(seasons: Array<{ expansionId?: number }>): number | null {
  const active = seasons[seasons.length - 1];
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
