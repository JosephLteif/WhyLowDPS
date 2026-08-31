import { describe, expect, it } from 'vitest';
import type { ResolvedItem, ResolveGearResponse } from '../../lib/types';
import { getUpgradeDiscountIlevel } from './topGearItemUtils';

function item(slot: string, ilevel: number): ResolvedItem {
  return { slot, ilevel } as ResolvedItem;
}

describe('getUpgradeDiscountIlevel', () => {
  it('uses a higher same-slot alternative for the discount', () => {
    const resolved = {
      slots: {
        legs: {
          equipped: null,
          alternatives: [item('legs', 282), item('legs', 295)],
        },
      },
    } satisfies Pick<ResolveGearResponse, 'slots'>;

    expect(getUpgradeDiscountIlevel(item('legs', 282), resolved)).toBe(295);
  });
});
