import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isDesktopRuntime: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  isDesktopRuntime: mocks.isDesktopRuntime,
}));

import PwaInstallPrompt from './PwaInstallPrompt';

function dispatchInstallEvent(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
    prompt: ReturnType<typeof vi.fn>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  };
  event.preventDefault = vi.fn();
  event.prompt = vi.fn().mockResolvedValue(undefined);
  event.userChoice = Promise.resolve({ outcome, platform: 'web' });
  window.dispatchEvent(event);
  return event;
}

describe('PwaInstallPrompt', () => {
  beforeEach(() => {
    mocks.isDesktopRuntime.mockReset().mockReturnValue(false);
  });

  it('offers installation when the browser provides an install prompt', async () => {
    render(<PwaInstallPrompt />);
    const event = dispatchInstallEvent();

    expect(await screen.findByRole('dialog', { name: 'Install WhyLowDPS' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Install' }));

    await waitFor(() => expect(event.prompt).toHaveBeenCalledOnce());
    expect(screen.queryByRole('dialog', { name: 'Install WhyLowDPS' })).not.toBeInTheDocument();
  });

  it('does not offer installation in the desktop app', () => {
    mocks.isDesktopRuntime.mockReturnValue(true);
    render(<PwaInstallPrompt />);
    dispatchInstallEvent();

    expect(screen.queryByRole('dialog', { name: 'Install WhyLowDPS' })).not.toBeInTheDocument();
  });
});
