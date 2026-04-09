export interface GearItem {
  ilevel: number;
  slot: string;
}

const ALL_SLOTS = [
  'head',
  'neck',
  'shoulder',
  'back',
  'chest',
  'wrist',
  'hands',
  'waist',
  'legs',
  'feet',
  'finger1',
  'finger2',
  'trinket1',
  'trinket2',
  'main_hand',
  'off_hand',
];

/**
 * Calculates the average item level of a character's gear set.
 * Uses the standard WoW 16-slot formula, including 2H weapon normalization.
 */
export function calculateAverageIlevel(gear: Record<string, GearItem>): number {
  if (!gear || Object.keys(gear).length === 0) return 0;

  let sum = 0;
  const mainHand = gear['main_hand'];
  const offHand = gear['off_hand'];

  // Calculate sum for all standard slots
  for (const slot of ALL_SLOTS) {
    const item = gear[slot];
    if (item && item.ilevel > 0) {
      sum += item.ilevel;
    }
  }

  // Handle 2H weapon logic: if 2H in Main Hand and Off Hand is empty, count MH twice.
  // This is a common heuristic for simc/wow average ilvl.
  // Note: This assumes 'off_hand' is explicitly missing or has ilevel 0 for 2H sets.
  if (mainHand && (!offHand || offHand.ilevel === 0)) {
    // Check if it's a 2H weapon (this is an approximation since we don't have item types here,
    // but in SimC results, a 2H user won't have an off_hand override).
    // Sum divided by 16 is the standard.
    // If the user has a 2H, we effectively want (Sum + MH_Ilevel) / 16 if MH was only counted once.
    // Wait, the standard Blizzard formula: Sum of 16 slots / 16.
    // If you have a 2H and no OH, you count the 2H ilevel twice in the sum.
    sum += mainHand.ilevel;
  }

  return sum / 16;
}
