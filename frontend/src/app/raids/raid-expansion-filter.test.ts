import { describe, expect, it } from 'vitest';
import {
  filterRaidsByExpansion,
  getCurrentSeasonExpansionId,
  listRaidExpansionOptions,
  type RaidExpansionFilterRaid,
} from './raid-expansion-filter';

const raids: RaidExpansionFilterRaid[] = [
  { id: 1296, name: 'Liberation of Undermine', expansion: 514 },
  { id: 1302, name: 'Manaforge Omega', expansion: 514 },
  { id: 1207, name: "Amirdrassil, the Dream's Hope", expansion: 503 },
];

describe('raid expansion filtering', () => {
  it('defaults to the current season expansion', () => {
    expect(getCurrentSeasonExpansionId([{ expansionId: 514 }])).toBe(514);
  });

  it('lists only expansions that have raids', () => {
    expect(
      listRaidExpansionOptions(raids, [
        { id: 503, name: 'Dragonflight' },
        { id: 514, name: 'The War Within' },
        { id: 516, name: 'Midnight' },
      ]),
    ).toEqual([
      { id: 514, name: 'The War Within' },
      { id: 503, name: 'Dragonflight' },
    ]);
  });

  it('filters raids by selected expansion', () => {
    expect(filterRaidsByExpansion(raids, 514).map((raid) => raid.name)).toEqual([
      'Liberation of Undermine',
      'Manaforge Omega',
    ]);
  });
});
