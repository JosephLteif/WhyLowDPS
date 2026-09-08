import { describe, expect, it } from 'vitest';
import {
  getStatusRetryDelay,
  isTransientPollingError,
  mapCompactSimulationStatuses,
  parseCompactSimulationStatuses,
  shouldContinueScenarioPolling,
} from './SimResultClient';

describe('simulation result polling helpers', () => {
  it('parses compact status arrays and normalizes status values', () => {
    expect(
      parseCompactSimulationStatuses([
        { id: 'sim-1', status: 'RUNNING', progress: 42 },
        { id: 'sim-2', status: 'done' },
        { status: 'pending' },
        null,
      ])
    ).toMatchObject([
      { id: 'sim-1', status: 'running', progress: 42 },
      { id: 'sim-2', status: 'done' },
    ]);
  });

  it('marks requested IDs missing from a compact response as unavailable', () => {
    expect(
      mapCompactSimulationStatuses(['sim-1', 'sim-2'], {
        jobs: [{ id: 'sim-1', status: 'pending' }],
      })
    ).toEqual({ 'sim-1': 'pending', 'sim-2': 'unavailable' });
  });

  it('continues sibling polling when any tracked scenario remains active', () => {
    expect(shouldContinueScenarioPolling({ current: 'done', sibling: 'running' })).toBe(true);
    expect(shouldContinueScenarioPolling({ current: 'done', sibling: 'unavailable' })).toBe(false);
  });

  it('recognizes retryable status failures and caps retry delay', () => {
    expect(isTransientPollingError({ status: 503 })).toBe(true);
    expect(isTransientPollingError({ status: 404 })).toBe(false);
    expect(isTransientPollingError({ status: 401 })).toBe(false);
    expect(isTransientPollingError({ code: 'NETWORK_UNAVAILABLE' })).toBe(true);
    expect(getStatusRetryDelay(1)).toBe(2000);
    expect(getStatusRetryDelay(6)).toBe(15000);
    expect(getStatusRetryDelay(99)).toBe(15000);
  });
});
