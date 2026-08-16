import { describe, expect, it } from 'vitest';
import { extractLatestPhaseRemainingSeconds, parseLatestPhaseLog } from './SimStatus';

describe('extractLatestPhaseRemainingSeconds', () => {
  it('extracts the latest remaining time from a phase log line', () => {
    expect(
      extractLatestPhaseRemainingSeconds([
        'Generating Profileset: Heatmap Tier 22 | 3p 6/32 813/813 Mean=102753 Error=-0.194% 877msec (22s)',
      ])
    ).toBe(22);
  });

  it('extracts the current profileset and simulation details', () => {
    expect(
      parseLatestPhaseLog([
        'Generating Profileset: Heatmap Tier 19 | 3p 24/32 [======>...........] 6151/11857 94.868 Mean=102226 Error=-0.070% 6sec (1m, 39s)',
      ])
    ).toMatchObject({
      phase: 'Profileset',
      name: 'Heatmap Tier 19',
      profilesetCompleted: 24,
      profilesetTotal: 32,
      simulationCompleted: 6151,
      simulationTotal: 11857,
      simulationPercent: 94.868,
      mean: 102226,
      errorPercent: -0.07,
      remainingSeconds: 99,
    });
  });

  it('supports minute values and ignores unrelated log lines', () => {
    expect(
      extractLatestPhaseRemainingSeconds([
        'Generating Profileset: Combo 1 813/813 (1m 5s)',
        'Implementation Not Yet Verified: Emberwing Feather',
      ])
    ).toBe(65);
    expect(extractLatestPhaseRemainingSeconds(['Simulating... 50% (12s)'])).toBeNull();
  });
});
