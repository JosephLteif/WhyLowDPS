import { describe, expect, it } from 'vitest';
import { buildReadinessChecks, readinessStatusLabel, type ReadinessSnapshot } from './readiness';

const baseSnapshot: ReadinessSnapshot = {
  status: 'ready',
  app: { mode: 'web', version: '4.0.0', revision: 'test' },
  credentials: { configured: true },
  data: {
    status: 'ready',
    message: 'Game data is ready.',
    degraded: false,
    last_sync: null,
    required_missing: 0,
    optional_missing: 0,
    available: true,
  },
  simulation: { available: true },
};

describe('readiness model', () => {
  it('maps every backend data state to a user-facing check state', () => {
    const statuses = [
      ['ready', 'ready'],
      ['degraded', 'degraded'],
      ['syncing', 'checking'],
      ['needs_credentials', 'attention'],
      ['error', 'attention'],
      ['blocked', 'blocked'],
    ] as const;

    for (const [dataStatus, expected] of statuses) {
      const checks = buildReadinessChecks(
        { ...baseSnapshot, data: { ...baseSnapshot.data, status: dataStatus } },
        { authenticated: true, lightMode: false }
      );
      expect(checks.find((check) => check.id === 'data')?.status).toBe(expected);
    }
  });

  it('keeps account access optional in Light mode and blocks missing SimC', () => {
    const checks = buildReadinessChecks(
      { ...baseSnapshot, simulation: { available: false } },
      { authenticated: false, lightMode: true }
    );

    expect(checks.find((check) => check.id === 'account')).toMatchObject({ status: 'ready' });
    expect(checks.find((check) => check.id === 'simulation')).toMatchObject({ status: 'blocked' });
  });

  it('labels readiness states consistently', () => {
    expect(readinessStatusLabel('ready')).toBe('Ready');
    expect(readinessStatusLabel('degraded')).toBe('Degraded');
    expect(readinessStatusLabel('attention')).toBe('Needs attention');
    expect(readinessStatusLabel('blocked')).toBe('Blocked');
    expect(readinessStatusLabel('checking')).toBe('Checking');
  });
});
