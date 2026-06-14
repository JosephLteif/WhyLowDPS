import { describe, expect, it } from 'vitest';
import {
  coerceDropsResponse,
  encodeInstanceSelectionIds,
  getDroptimizerCandidateSlots,
  getTrackLevels,
  getTrackMaxLevel,
  parseInstanceSelectionIds,
} from './utils';

describe('drop finder utilities', () => {
  it('matches track names case-insensitively and reports max level', () => {
    const tracks = {
      'Hero Track': [
        { level: 1, max_level: 6, ilvl: 610, bonus_id: 1, quality: 4 },
        { level: 2, max_level: 6, ilvl: 613, bonus_id: 2, quality: 4 },
      ],
    };

    expect(getTrackLevels(' hero   track ', tracks)).toEqual(tracks['Hero Track']);
    expect(getTrackMaxLevel('HERO TRACK', tracks)).toBe(6);
    expect(getTrackMaxLevel('missing', tracks)).toBe(0);
  });

  it('maps drop candidates to SimC slots', () => {
    expect(getDroptimizerCandidateSlots('finger1')).toEqual(['finger1']);
    expect(getDroptimizerCandidateSlots('unknown', 11)).toEqual(['finger1', 'finger2']);
    expect(getDroptimizerCandidateSlots('unknown', 12)).toEqual(['trinket1', 'trinket2']);
    expect(getDroptimizerCandidateSlots('unknown', 1)).toEqual(['head']);
    expect(getDroptimizerCandidateSlots('unknown')).toEqual([]);
  });

  it('coerces valid drop arrays and discards malformed entries', () => {
    expect(
      coerceDropsResponse({
        Head: [{ item_id: 1, name: 'Helm' }, { item_id: Number.NaN }, null],
        Empty: [],
        Bad: 'nope',
      })
    ).toEqual({ Head: [{ item_id: 1, name: 'Helm' }] });
    expect(coerceDropsResponse([])).toBeNull();
    expect(coerceDropsResponse({ Bad: [{ name: 'Missing id' }] })).toBeNull();
  });

  it('parses and encodes multi-instance selections with trim, dedupe, and numeric sort', () => {
    expect(parseInstanceSelectionIds('')).toEqual([]);
    expect(parseInstanceSelectionIds('42')).toEqual(['42']);
    expect(parseInstanceSelectionIds('ids:3, 2,3,,1')).toEqual(['3', '2', '1']);

    expect(encodeInstanceSelectionIds(['3', '1', '3', '2', ''])).toBe('ids:1,2,3');
    expect(encodeInstanceSelectionIds(['7'])).toBe('7');
    expect(encodeInstanceSelectionIds([])).toBe('');
  });
});
