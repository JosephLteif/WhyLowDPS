import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SimulationActivity from './SimulationActivity';
import { trackSimulations } from '../lib/sim-tracking';

const mocks = vi.hoisted(() => ({
  fetchJson: vi.fn(),
  notify: vi.fn(),
  pathname: '/history',
  push: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock('../lib/api', () => ({
  API_URL: '',
  fetchJson: mocks.fetchJson,
}));

vi.mock('./shared/NotificationSystem', () => ({
  useNotifications: () => ({ notify: mocks.notify }),
}));

describe('SimulationActivity', () => {
  beforeEach(() => {
    vi.useRealTimers();
    window.sessionStorage.clear();
    mocks.fetchJson.mockReset();
    mocks.notify.mockReset();
    mocks.pathname = '/history';
    mocks.push.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('hides the global activity card on the simulation result and shows it after navigating away', async () => {
    mocks.fetchJson.mockResolvedValue({
      id: 'sim-1',
      status: 'running',
      sim_type: 'quick',
      simc_input: 'mage="Alice"\nserver=Illidan\nregion=us\n',
      progress: 40,
      progress_stage: 'Simulating',
      progress_detail: '4/10 iterations',
    });

    mocks.pathname = '/sim/_/';
    const view = render(<SimulationActivity />);
    trackSimulations([{ id: 'sim-1', simType: 'quick', playerName: 'Alice' }]);
    await Promise.resolve();
    expect(screen.queryByRole('region', { name: 'Simulation progress' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Show 1 active simulation' })
    ).not.toBeInTheDocument();

    view.unmount();
    mocks.pathname = '/history';
    render(<SimulationActivity />);
    expect(screen.getByRole('region', { name: 'Simulation progress' })).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(await screen.findByText('40%')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Minimize simulation progress' }));
    expect(screen.getByRole('button', { name: 'Show 1 active simulation' })).toBeInTheDocument();
  });

  it('notifies when the tracked simulation reaches a terminal status', async () => {
    vi.useFakeTimers();
    mocks.fetchJson
      .mockResolvedValueOnce({
        id: 'sim-1',
        status: 'running',
        sim_type: 'quick',
        simc_input: 'mage="Alice"\nserver=Illidan\nregion=us\n',
        progress: 40,
      })
      .mockResolvedValueOnce({
        id: 'sim-1',
        status: 'done',
        sim_type: 'quick',
        simc_input: 'mage="Alice"\nserver=Illidan\nregion=us\n',
        progress: 100,
      });

    render(<SimulationActivity />);
    trackSimulations([{ id: 'sim-1', simType: 'quick', playerName: 'Alice' }]);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(mocks.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Simulation finished',
        description: 'Alice · Quick Sim',
        href: '/sim/sim-1',
        dedupeKey: 'simulation:sim-1',
      })
    );
  });
});
