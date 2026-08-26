import { afterEach, describe, expect, it } from 'vitest';
import {
  classifyReleaseChannel,
  detectVersionChannel,
  readStoredUpdateChannel,
} from './update-channel';

describe('update channels', () => {
  afterEach(() => localStorage.clear());

  it('classifies dev prerelease versions separately from stable versions', () => {
    expect(classifyReleaseChannel('v4.1.1')).toBe('stable');
    expect(classifyReleaseChannel('4.1.1-dev.12.1')).toBe('dev');
    expect(classifyReleaseChannel('dev')).toBe('dev');
  });

  it('uses the installed prerelease channel when no preference is stored', () => {
    expect(detectVersionChannel('4.1.1-dev.12.1')).toBe('dev');
    expect(readStoredUpdateChannel('4.1.1-dev.12.1')).toBe('dev');
  });

  it('allows a stored channel to override the installed channel', () => {
    localStorage.setItem('whylowdps_update_channel', 'stable');
    expect(readStoredUpdateChannel('4.1.1-dev.12.1')).toBe('stable');
  });
});
