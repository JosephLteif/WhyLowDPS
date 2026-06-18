import { describe, expect, it } from 'vitest';
import {
  buildWowSeasonContent,
  getStaticWowSeasonContent,
  groupWowInstancesByExpansion,
  selectDefaultWowSeasonSlug,
  validateNoExternalLinkFields,
  type WowEncounter,
  type WowInstance,
} from './wow-season-content';

const instances: WowInstance[] = [
  { id: 1278, name: 'Liberation of Undermine', type: 'raid', expansionId: 10, encounterIds: [3009, 3010] },
  { id: 1267, name: 'Priory of the Sacred Flame', type: 'dungeon', expansionId: 10, mythicPlusDungeonId: 506, encounterIds: [2587] },
  { id: 1198, name: 'Operation: Floodgate', type: 'dungeon', expansionId: 10, mythicPlusDungeonId: 525, encounterIds: [] },
];

const encounters: WowEncounter[] = [
  { id: 3009, name: 'Vexie and the Geargrinders', instanceId: 1278 },
  { id: 3010, name: 'Cauldron of Carnage', instanceId: 1278 },
  { id: 2587, name: 'Captain Dailcry', instanceId: 1267 },
];

describe('wow season content normalization', () => {
  it('groups season raids and Mythic+ dungeons with encounter details', () => {
    const { content, warnings } = buildWowSeasonContent({
      seasons: [
        {
          slug: 'the-war-within-season-2',
          name: 'The War Within Season 2',
          expansionId: 10,
          patch: '11.1.0',
          raidInstanceIds: [1278],
          mythicPlusDungeonIds: [506, 525],
        },
      ],
      instances,
      encounters,
      mythicPlusDungeons: [
        { mythicPlusDungeonId: 506, journalInstanceId: 1267 },
        { mythicPlusDungeonId: 525, journalInstanceId: 1198 },
      ],
    });

    expect(warnings).toEqual([]);
    expect(content).toHaveLength(1);
    expect(content[0].season.slug).toBe('the-war-within-season-2');
    expect(content[0].raids.map((raid) => raid.name)).toEqual(['Liberation of Undermine']);
    expect(content[0].raids[0].encounters?.map((encounter) => encounter.name)).toEqual([
      'Vexie and the Geargrinders',
      'Cauldron of Carnage',
    ]);
    expect(content[0].dungeons.map((dungeon) => dungeon.id)).toEqual([1267, 1198]);
  });

  it('groups expansion instances into raids and dungeons', () => {
    const grouped = groupWowInstancesByExpansion(instances);

    expect(grouped[10].raids.map((raid) => raid.id)).toEqual([1278]);
    expect(grouped[10].dungeons.map((dungeon) => dungeon.id)).toEqual([1267, 1198]);
  });

  it('prefers embedded season instances and dungeons when present', () => {
    const { content, warnings } = buildWowSeasonContent({
      seasons: [
        {
          slug: 'embedded-season',
          name: 'Embedded Season',
          expansionId: 10,
          raidInstanceIds: [9999],
          mythicPlusDungeonIds: [404],
          raidInstances: [
            {
              id: 777,
              name: 'Embedded Raid',
              type: 'raid',
              expansionId: 10,
              encounters: [{ id: 9001, name: 'Embedded Boss', instanceId: 777 }],
            },
          ],
          mythicPlusDungeons: [
            {
              id: 778,
              name: 'Embedded Dungeon',
              type: 'dungeon',
              expansionId: 10,
              encounters: [{ id: 9002, name: 'Embedded Trash Boss', instanceId: 778 }],
            },
          ],
        },
      ],
      instances,
      encounters,
      mythicPlusDungeons: [],
    });

    expect(warnings).toEqual([]);
    expect(content[0].raids.map((raid) => raid.name)).toEqual(['Embedded Raid']);
    expect(content[0].dungeons.map((dungeon) => dungeon.name)).toEqual(['Embedded Dungeon']);
    expect(content[0].raids[0].encounters?.map((encounter) => encounter.name)).toEqual([
      'Embedded Boss',
    ]);
  });

  it('warns for missing season IDs and encounter IDs without crashing', () => {
    const { content, warnings } = buildWowSeasonContent({
      seasons: [
        {
          slug: 'bad-season',
          name: 'Bad Season',
          expansionId: 10,
          raidInstanceIds: [9999],
          mythicPlusDungeonIds: [404],
        },
      ],
      instances: [{ ...instances[0], encounterIds: [3009, 7777] }],
      encounters: [encounters[0]],
      mythicPlusDungeons: [],
    });

    expect(content[0].raids).toEqual([]);
    expect(content[0].dungeons).toEqual([]);
    expect(warnings).toEqual([
      'Season bad-season references missing raid instance id 9999',
      'Season bad-season references missing Mythic+ dungeon id 404',
      'Instance 1278 references missing encounter id 7777',
    ]);
  });

  it('detects duplicate IDs before joining data', () => {
    const { warnings } = buildWowSeasonContent({
      seasons: [
        {
          slug: 'dupe-season',
          name: 'Duplicate Season',
          expansionId: 10,
          raidInstanceIds: [],
          mythicPlusDungeonIds: [],
        },
        {
          slug: 'dupe-season',
          name: 'Duplicate Season Again',
          expansionId: 10,
          raidInstanceIds: [],
          mythicPlusDungeonIds: [],
        },
      ],
      instances: [instances[0], instances[0]],
      encounters: [encounters[0], encounters[0]],
      mythicPlusDungeons: [],
    });

    expect(warnings).toContain('Duplicate season slug dupe-season');
    expect(warnings).toContain('Duplicate instance id 1278');
    expect(warnings).toContain('Duplicate encounter id 3009');
  });

  it('rejects external link fields in normalized output', () => {
    const { content } = buildWowSeasonContent({
      seasons: [
        {
          slug: 'clean-season',
          name: 'Clean Season',
          expansionId: 10,
          raidInstanceIds: [1278],
          mythicPlusDungeonIds: [],
        },
      ],
      instances: [{ ...instances[0], wowheadUrl: 'https://example.invalid' } as unknown as WowInstance],
      encounters,
      mythicPlusDungeons: [],
    });

    expect(validateNoExternalLinkFields(content)).toEqual([
      'External link field found at root[0].raids[0].wowheadUrl',
    ]);
  });

  it('keeps bundled static content free of external link fields', () => {
    const { content, warnings } = getStaticWowSeasonContent();

    expect(warnings).toEqual([]);
    expect(validateNoExternalLinkFields(content)).toEqual([]);
  });

  it('uses Midnight Season 1 as the current static season with the full Mythic+ pool', () => {
    const { content } = getStaticWowSeasonContent();
    const defaultSlug = selectDefaultWowSeasonSlug(
      content.map((entry) => entry.season),
      new Date('2026-06-18T00:00:00Z'),
    );
    const current = content.find((entry) => entry.season.slug === defaultSlug);

    expect(defaultSlug).toBe('midnight-season-1');
    expect(current?.season.name).toBe('Midnight Season 1');
    expect(current?.dungeons.map((dungeon) => dungeon.id)).toEqual([
      1300,
      1315,
      1316,
      1299,
      1201,
      945,
      476,
      278,
    ]);
  });

  it('selects the active season by date instead of a future season', () => {
    const selected = selectDefaultWowSeasonSlug(
      [
        {
          slug: 'current-season',
          name: 'Current Season',
          expansionId: 10,
          startDate: '2026-01-01',
          endDate: '2026-12-31',
          raidInstanceIds: [],
          mythicPlusDungeonIds: [],
        },
        {
          slug: 'future-season',
          name: 'Future Season',
          expansionId: 11,
          startDate: '2027-01-01',
          raidInstanceIds: [],
          mythicPlusDungeonIds: [],
        },
      ],
      new Date('2026-06-18T00:00:00Z'),
    );

    expect(selected).toBe('current-season');
  });
});
