import { describe, expect, it } from 'vitest';
import { formatUpgradePreviewLabel } from './upgrade-preview';

describe('formatUpgradePreviewLabel', () => {
  it('keeps the equipped tier before the selected tier', () => {
    expect(
      formatUpgradePreviewLabel({
        upgradeLabel: 'Champion 2/6',
        equippedUpgradeLabel: 'Adventurer 6/6',
      })
    ).toBe('Adventurer 6/6 -> Champion 2/6');
  });

  it('keeps inferred same-track levels in equipped-to-selected order', () => {
    expect(
      formatUpgradePreviewLabel({
        upgradeLabel: 'Hero 3/6',
        equippedIlevel: 295,
        itemIlevel: 302,
      })
    ).toBe('Hero 1/6 -> Hero 3/6');
  });
});
