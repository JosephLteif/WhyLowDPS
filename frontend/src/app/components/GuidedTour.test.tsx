import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GuidedTourProvider, useGuidedTour } from './GuidedTour';

const pathnameState = vi.hoisted(() => ({ value: '/' }));

vi.mock('next/navigation', () => ({
  usePathname: () => pathnameState.value,
}));

function TourLauncher() {
  const { startCurrentTour } = useGuidedTour();
  return (
    <button type="button" onClick={startCurrentTour}>
      Start tour
    </button>
  );
}

describe('GuidedTourProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    pathnameState.value = '/';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('auto-starts the current page tour when its first target is ready', async () => {
    vi.useFakeTimers();
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      top: 20,
      left: 20,
      right: 300,
      bottom: 60,
      width: 280,
      height: 40,
      x: 20,
      y: 20,
      toJSON: () => ({}),
    });

    render(
      <GuidedTourProvider>
        <div data-tour="dashboard-heading" />
      </GuidedTourProvider>
    );

    await act(async () => {
      vi.advanceTimersByTime(900);
    });

    expect(screen.getByRole('dialog', { name: /welcome to whylowdps/i })).toBeInTheDocument();
  });

  it('starts the current page tour on demand and remembers dismissal', async () => {
    const user = userEvent.setup();
    render(
      <GuidedTourProvider>
        <TourLauncher />
      </GuidedTourProvider>
    );

    await user.click(screen.getByRole('button', { name: 'Start tour' }));
    expect(screen.getByRole('dialog', { name: /welcome to whylowdps/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Skip tour' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(localStorage.getItem('whylowdps_guided_tours_v1')).toContain('app-overview');
  });

  it('scrolls an off-screen step target before measuring the spotlight', async () => {
    const user = userEvent.setup();
    const scrollIntoView = vi.fn();
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement
    ) {
      if (this.dataset.tour === 'dashboard-heading') {
        return {
          top: window.innerHeight + 100,
          left: 20,
          right: 300,
          bottom: window.innerHeight + 140,
          width: 280,
          height: 40,
          x: 20,
          y: window.innerHeight + 100,
          toJSON: () => ({}),
        };
      }
      return {
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: 0,
        height: 0,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      };
    });

    render(
      <GuidedTourProvider>
        <TourLauncher />
        <div data-tour="dashboard-heading" />
      </GuidedTourProvider>
    );

    await user.click(screen.getByRole('button', { name: 'Start tour' }));
    await waitFor(() => {
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'auto' });
    });

    if (originalScrollIntoView) {
      Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
        configurable: true,
        value: originalScrollIntoView,
      });
    } else {
      delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  it('waits for a Crest Upgrades profile before showing dependent steps', async () => {
    pathnameState.value = '/upgrade-compare';
    const user = userEvent.setup();
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      top: 20,
      left: 20,
      right: 300,
      bottom: 60,
      width: 280,
      height: 40,
      x: 20,
      y: 20,
      toJSON: () => ({}),
    });

    render(
      <GuidedTourProvider>
        <TourLauncher />
        <div data-tour="simc-input" />
        <textarea data-tour="simc-input-field" />
        <div data-tour="fight-setup" />
        <div data-tour="upgrade-mode" />
      </GuidedTourProvider>
    );

    await user.click(screen.getByRole('button', { name: 'Start tour' }));
    expect(screen.getByText('Paste a SimC export to continue')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();

    await user.type(screen.getByRole('textbox'), 'profile-data');
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /set up the fight/i })).toBeInTheDocument();
    });
  });

  it('keeps Top Gear profile-dependent steps behind SimC input', async () => {
    pathnameState.value = '/top-gear';
    const user = userEvent.setup();

    render(
      <GuidedTourProvider>
        <TourLauncher />
        <div data-tour="simc-input" />
        <textarea data-tour="simc-input-field" />
        <div data-tour="fight-setup" />
        <div data-tour="loot-browser-trigger" />
      </GuidedTourProvider>
    );

    await user.click(screen.getByRole('button', { name: 'Start tour' }));

    expect(screen.getByText('Paste a SimC export to continue')).toBeInTheDocument();
    expect(
      screen.queryByRole('dialog', { name: /open the loot browser/i })
    ).not.toBeInTheDocument();
  });
});
