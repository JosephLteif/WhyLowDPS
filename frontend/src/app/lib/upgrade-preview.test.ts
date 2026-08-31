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

  it('corrects a reversed same-track label using item levels', () => {
    expect(
      formatUpgradePreviewLabel({
        upgradeLabel: 'Champion 6/6 -> Champion 3/6',
        equippedUpgradeLabel: 'Champion 3/6',
        equippedIlevel: 298,
        itemIlevel: 308,
      })
    ).toBe('Champion 3/6 -> Champion 6/6');

    expect(
      formatUpgradePreviewLabel({
        upgradeLabel: 'Hero 6/6 -> Hero 3/6',
        equippedIlevel: 311,
        itemIlevel: 321,
      })
    ).toBe('Hero 3/6 -> Hero 6/6');
  });
});
