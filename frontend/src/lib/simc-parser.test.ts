import { describe, expect, it } from 'vitest';
import { isOlderWowVersion, normalizeWowVersion, parseCharacterInfo } from './simc-parser';

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

describe('isOlderWowVersion', () => {
  it('detects an older patch while ignoring the WoW build number', () => {
    expect(isOlderWowVersion('11.2.0.63163, TOC 110200', '12.0.0')).toBe(true);
    expect(isOlderWowVersion('12.0.0.65832, TOC 120000', '12.0.0')).toBe(false);
    expect(isOlderWowVersion('12.0.1.66263, TOC 120001', '12.0.0')).toBe(false);
    expect(isOlderWowVersion('12.0.5.67314, TOC 120005', '12.1.0.69382')).toBe(true);
  });

  it('normalizes dotted WoW builds and Raidbots TOC builds', () => {
    expect(normalizeWowVersion('12.1.0.69382')).toBe('12.1.0');
    expect(normalizeWowVersion(120007)).toBe('12.0.7');
  });

  it('does not warn when either version is unavailable or unparseable', () => {
    expect(isOlderWowVersion(null, '12.0.0')).toBe(false);
    expect(isOlderWowVersion('unknown', '12.0.0')).toBe(false);
    expect(isOlderWowVersion('11.2.0', null)).toBe(false);
  });
});
