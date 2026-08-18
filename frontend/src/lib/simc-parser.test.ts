import { describe, expect, it } from 'vitest';
import { parseCharacterInfo } from './simc-parser';

describe('parseCharacterInfo', () => {
  it('parses saved DungeonRoute data before generic quoted assignments', () => {
    const routeData = [
      'fight_style=DungeonRoute',
      'enemy="Mists of Tirna Scithe Route"',
      'dungeon="Mists of Tirna Scithe"',
      'keystone_level=10',
      'raid_events+=/pull,pull=1,bloodlust=1,enemies="Ingra Maloch":1',
    ].join('\n');

    expect(parseCharacterInfo(routeData)).toMatchObject({
      kind: 'dungeon',
      title: 'Mists of Tirna Scithe',
      dungeon: 'Mists of Tirna Scithe',
      level: '10',
      pullCount: 1,
    });
  });
});
