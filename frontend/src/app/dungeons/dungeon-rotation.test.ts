import { describe, expect, it } from 'vitest';
import {
  filterCurrentSeasonDungeons,
  listDungeonExpansionOptions,
  listDungeonSeasonOptions,
  seasonContentDungeonsToDungeonInfo,
  selectSeasonSlugForExpansion,
} from './dungeon-rotation';
import type { DungeonInfo } from '../lib/api';
import type { Instance } from '../drop-finder/types';

const fallbackInstances: Instance[] = [
  {
    id: 1267,
    name: 'Priory of the Sacred Flame',
    type: 'dungeon',
    expansion: 514,
    encounters: [{ id: 2571, name: 'Captain Dailcry' }],
  },
  {
    id: 1298,
    name: 'Operation: Floodgate',
    type: 'dungeon',
    expansion: 514,
    encounters: [{ id: 2648, name: 'Big M.O.M.M.A.' }],
  },
  {
    id: -1,
    name: 'Mythic+ Dungeons',
    type: 'mplus-chest',
    encounters: [
      { id: 1267, name: 'Priory of the Sacred Flame' },
      { id: 1298, name: 'Operation: Floodgate' },
    ],
  },
];

const rotationWithMismatchedIds: DungeonInfo[] = [
  {
    id: 506,
    name: 'Priory of the Sacred Flame',
    zone: null,
    wowhead_id: null,
    num_bosses: null,
    expansion: null,
    current_affixes: undefined,
    encounters: [],
  } as unknown as DungeonInfo,
  {
    id: 525,
    name: 'Operation: Floodgate',
    zone: null,
    wowhead_id: null,
    num_bosses: null,
    expansion: null,
    encounters: [],
  } as unknown as DungeonInfo,
];

describe('dungeon rotation filtering', () => {
  it('falls back to current Mythic+ bucket instances when rotation IDs do not match journal IDs', () => {
    const result = filterCurrentSeasonDungeons(rotationWithMismatchedIds, fallbackInstances, new Set());

    expect(result.map((dungeon) => dungeon.id)).toEqual([1267, 1298]);
    expect(result.map((dungeon) => dungeon.name)).toEqual([
      'Priory of the Sacred Flame',
      'Operation: Floodgate',
    ]);
    expect(result[0].encounters).toEqual(['Captain Dailcry']);
  });

  it('keeps enriched dungeons when IDs already match the Mythic+ bucket', () => {
    const enriched = [{ ...rotationWithMismatchedIds[0], id: 1267, encounters: ['Existing'] }];

    const result = filterCurrentSeasonDungeons(enriched, fallbackInstances, new Set());

    expect(result).toEqual(enriched);
  });

  it('converts static season content dungeons for dungeon cards', () => {
    const result = seasonContentDungeonsToDungeonInfo({
      season: {
        slug: 'the-war-within-season-2',
        name: 'The War Within Season 2',
        expansionId: 514,
        raidInstanceIds: [],
        mythicPlusDungeonIds: [506],
      },
      raids: [],
      dungeons: [
        {
          id: 1267,
          name: 'Priory of the Sacred Flame',
          type: 'dungeon',
          expansionId: 514,
          mythicPlusDungeonId: 506,
          imageUrl: '/api/instances/1267/media',
          encounters: [{ id: 2571, name: 'Captain Dailcry', instanceId: 1267 }],
        },
      ],
    });

    expect(result).toEqual([
      expect.objectContaining({
        id: 1267,
        name: 'Priory of the Sacred Flame',
        expansion: 514,
        challenge_mode_id: 506,
        keystone_timer_ms: 1950000,
        keystone_upgrades: [1, 2, 3],
        encounters: ['Captain Dailcry'],
        image_url: '/api/instances/1267/media',
      }),
    ]);
  });

  it('lists dungeon expansion and season options separately', () => {
    const contents = [
      {
        season: {
          slug: 'the-war-within-season-2',
          name: 'The War Within Season 2',
          expansionId: 514,
          raidInstanceIds: [],
          mythicPlusDungeonIds: [],
        },
        raids: [],
        dungeons: [],
      },
      {
        season: {
          slug: 'midnight-season-1',
          name: 'Midnight Season 1',
          expansionId: 516,
          raidInstanceIds: [],
          mythicPlusDungeonIds: [],
        },
        raids: [],
        dungeons: [],
      },
    ];

    expect(
      listDungeonExpansionOptions(contents, [
        { id: 516, name: 'Midnight' },
        { id: 514, name: 'The War Within' },
      ]),
    ).toEqual([
      { id: 516, name: 'Midnight' },
      { id: 514, name: 'The War Within' },
    ]);
    expect(listDungeonSeasonOptions(contents, 516).map((content) => content.season.slug)).toEqual([
      'midnight-season-1',
    ]);
    expect(selectSeasonSlugForExpansion(contents, 514, 'midnight-season-1')).toBe(
      'the-war-within-season-2',
    );
  });
});
