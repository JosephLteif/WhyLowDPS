import { describe, expect, it } from 'vitest';
import {
  characterKey,
  normalizeActiveCharacter,
  readStoredActiveCharacter,
} from './active-character';

describe('active character state', () => {
  it('normalizes imported character metadata and produces a stable key', () => {
    const character = normalizeActiveCharacter({
      region: 'EU',
      server: 'Silvermoon',
      name: 'Jaina',
      level: '90',
    });

    expect(character).toEqual({
      region: 'EU',
      realm: 'Silvermoon',
      name: 'Jaina',
      level: 90,
    });
    expect(characterKey(character!)).toBe('eu|silvermoon|jaina');
  });

  it('migrates the existing main-character preference', () => {
    window.localStorage.setItem('whylowdps_main_character', 'us|Illidan|Thrall');

    expect(readStoredActiveCharacter(window.localStorage)).toEqual({
      region: 'us',
      realm: 'Illidan',
      name: 'Thrall',
    });
  });
});
