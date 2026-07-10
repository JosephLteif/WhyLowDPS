import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchJson: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  API_URL: 'http://localhost:17384',
  fetchJson: mocks.fetchJson,
  isDesktop: true,
}));

import { useDataFileStateManager } from './useDataFileStateManager';

describe('useDataFileStateManager', () => {
  it('allows Download All Missing to wait for recovery snapshot repair', async () => {
    mocks.fetchJson
      .mockResolvedValueOnce({ downloaded_keys: ['items'], failed: [] })
      .mockResolvedValueOnce({ base_path: 'C:/data', available: true, files: [] });
    const { result } = renderHook(() => useDataFileStateManager());

    await act(async () => {
      await result.current.downloadAllMissingFiles();
    });

    expect(mocks.fetchJson).toHaveBeenCalledWith(
      'http://localhost:17384/api/data/files/missing/download',
      { method: 'POST', timeoutMs: 120_000 },
    );
  });
});
