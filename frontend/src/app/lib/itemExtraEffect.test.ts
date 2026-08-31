import { describe, expect, it } from 'vitest';
import { getItemExtraEffects } from './itemExtraEffect';

describe('getItemExtraEffects', () => {
  it('uses the item bonus IDs before cached item metadata', () => {
    expect(
      getItemExtraEffects({
        item_id: 123,
        bonus_ids: [41],
        extra_effects: ['Avoidance'],
      })
    ).toEqual(['Leech']);
  });
});
