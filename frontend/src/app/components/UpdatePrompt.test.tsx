import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isDesktopRuntime: vi.fn(),
  getVersion: vi.fn(),
  check: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  isDesktopRuntime: mocks.isDesktopRuntime,
}));

vi.mock('@tauri-apps/api/app', () => ({
  getVersion: mocks.getVersion,
}));

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: mocks.check,
}));

import UpdatePrompt from './UpdatePrompt';

describe('UpdatePrompt', () => {
  beforeEach(() => {
    mocks.isDesktopRuntime.mockReset();
    mocks.isDesktopRuntime.mockReturnValueOnce(true).mockReturnValue(false);
    mocks.getVersion.mockReset();
    mocks.getVersion.mockResolvedValue('3.4.2');
    mocks.check.mockReset();
    mocks.check.mockResolvedValue(null);
    window.electronAPI = {
      checkForUpdate: vi.fn().mockResolvedValue({ version: '3.4.3' }),
    } as any;
  });

  afterEach(() => {
    delete (window as any).electronAPI;
  });

  it('releases the data guard when an available update is dismissed', async () => {
    const statuses: string[] = [];
    window.addEventListener('whylowdps-updater-status', (event) => {
      statuses.push((event as CustomEvent<{ status: string }>).detail.status);
    });

    render(<UpdatePrompt />);

    await screen.findByText('App Update');
    await userEvent.click(screen.getByLabelText('Dismiss update prompt'));

    expect(statuses).toContain('none');
  });

  it('does not show an update when Electron reports the installed version', async () => {
    (window.electronAPI as NonNullable<typeof window.electronAPI>).checkForUpdate = vi
      .fn()
      .mockResolvedValue({ version: '3.4.2' });

    render(<UpdatePrompt />);

    await waitFor(() => {
      expect(window.electronAPI?.checkForUpdate).toHaveBeenCalled();
    });
    expect(screen.queryByText('App Update')).not.toBeInTheDocument();
  });

  it('does not show an update when the native updater reports the installed version', async () => {
    delete (window as any).electronAPI;
    mocks.check.mockResolvedValue({ version: '3.4.2' });

    render(<UpdatePrompt />);

    await waitFor(() => {
      expect(mocks.check).toHaveBeenCalled();
    });
    expect(screen.queryByText('App Update')).not.toBeInTheDocument();
  });
});
