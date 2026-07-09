import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isDesktopRuntime: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  isDesktopRuntime: mocks.isDesktopRuntime,
}));

import UpdatePrompt from './UpdatePrompt';

describe('UpdatePrompt', () => {
  beforeEach(() => {
    mocks.isDesktopRuntime.mockReset();
    mocks.isDesktopRuntime.mockReturnValueOnce(true).mockReturnValue(false);
    window.electronAPI = {
      checkForUpdate: vi.fn().mockResolvedValue({ version: '3.4.2' }),
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
});
