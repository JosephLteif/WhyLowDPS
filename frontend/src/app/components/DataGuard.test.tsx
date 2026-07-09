import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchJson: vi.fn(),
  useAuth: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  API_URL: 'http://localhost:17384',
  fetchJson: mocks.fetchJson,
  isDesktop: true,
  isNetworkUnavailableError: vi.fn(() => false),
}));

vi.mock('./AuthContext', () => ({
  useAuth: mocks.useAuth,
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('./SplashScreen', () => ({
  default: ({ status }: { status: string }) => <div data-testid="splash">{status}</div>,
}));

import DataGuard from './DataGuard';

describe('DataGuard auth gating', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    mocks.fetchJson.mockImplementation((url: string) => {
      if (url.endsWith('/api/data/status')) return Promise.resolve({ status: 'ready' });
      if (url.endsWith('/api/data/files')) return Promise.resolve({ files: [] });
      return Promise.resolve({});
    });
  });

  it('shows app content for an authenticated user even if credentials status is stale false', async () => {
    localStorage.setItem('whylowdps_data_ready', 'true');
    mocks.useAuth.mockReturnValue({
      user: { battletag: 'User#1234' },
      loading: false,
      lightMode: false,
      checkCredentialsStatus: vi.fn().mockResolvedValue({ globally_configured: false }),
    });

    render(
      <DataGuard>
        <div>App content</div>
      </DataGuard>
    );

    await waitFor(() => {
      expect(screen.getByText('App content')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('splash')).not.toBeInTheDocument();
  });

  it('prioritizes an available app update over missing required data', async () => {
    localStorage.setItem('whylowdps_data_ready', 'true');
    mocks.useAuth.mockReturnValue({
      user: { battletag: 'User#1234' },
      loading: false,
      lightMode: false,
      checkCredentialsStatus: vi.fn().mockResolvedValue({ globally_configured: true }),
    });
    mocks.fetchJson.mockImplementation((url: string) => {
      if (url.endsWith('/api/data/status')) return Promise.resolve({ status: 'ready' });
      if (url.endsWith('/api/data/files')) {
        return Promise.resolve({
          files: [{ required: true, exists: false, label: 'WoW Seasons' }],
        });
      }
      return Promise.resolve({});
    });

    render(
      <DataGuard>
        <div>App content</div>
      </DataGuard>
    );

    await waitFor(() => {
      expect(mocks.fetchJson).toHaveBeenCalledWith(
        expect.stringContaining('/api/data/files')
      );
    });
    expect(screen.queryByText('Critical data files are missing')).not.toBeInTheDocument();

    act(() => {
      window.dispatchEvent(
        new CustomEvent('whylowdps-updater-status', { detail: { status: 'available' } })
      );
    });
    expect(screen.queryByText('Critical data files are missing')).not.toBeInTheDocument();

    act(() => {
      window.dispatchEvent(
        new CustomEvent('whylowdps-updater-status', { detail: { status: 'none' } })
      );
    });
    await waitFor(() => {
      expect(screen.getByText('Critical data files are missing')).toBeInTheDocument();
    });
  });

  it('keeps the repair action hidden while a desktop update is available', async () => {
    localStorage.setItem('whylowdps_data_ready', 'true');
    mocks.useAuth.mockReturnValue({
      user: { battletag: 'User#1234' },
      loading: false,
      lightMode: false,
      checkCredentialsStatus: vi.fn().mockResolvedValue({ globally_configured: true }),
    });
    mocks.fetchJson.mockImplementation((url: string) => {
      if (url.endsWith('/api/data/status')) return Promise.resolve({ status: 'ready' });
      if (url.endsWith('/api/data/files')) {
        return Promise.resolve({
          files: [{ required: true, exists: false, label: 'WoW Seasons' }],
        });
      }
      return Promise.resolve({});
    });

    render(
      <DataGuard>
        <div>App content</div>
      </DataGuard>
    );
    act(() => {
      window.dispatchEvent(
        new CustomEvent('whylowdps-updater-status', { detail: { status: 'available' } })
      );
    });

    await waitFor(() => {
      expect(mocks.fetchJson).toHaveBeenCalledWith(expect.stringContaining('/api/data/files'));
    });
    expect(screen.queryByRole('button', { name: 'Repair Missing Files' })).not.toBeInTheDocument();
    act(() => {
      window.dispatchEvent(
        new CustomEvent('whylowdps-updater-status', { detail: { status: 'none' } })
      );
    });
    expect(await screen.findByRole('button', { name: 'Repair Missing Files' })).toBeInTheDocument();
  });

  it('shows recovery snapshot progress while repair is running', async () => {
    const user = userEvent.setup();
    localStorage.setItem('whylowdps_data_ready', 'true');
    mocks.useAuth.mockReturnValue({
      user: { battletag: 'User#1234' },
      loading: false,
      lightMode: false,
      checkCredentialsStatus: vi.fn().mockResolvedValue({ globally_configured: true }),
    });
    mocks.fetchJson.mockImplementation((url: string) => {
      if (url.endsWith('/api/data/status')) {
        return Promise.resolve({
          status: 'ready',
          progress: 'Repair:1:3:Downloading verified recovery snapshot:512:1024:1000:512',
        });
      }
      if (url.endsWith('/api/data/files')) {
        return Promise.resolve({ files: [{ required: true, exists: false, label: 'Items' }] });
      }
      if (url.endsWith('/api/data/files/missing/download')) return new Promise(() => {});
      return Promise.resolve({});
    });

    render(
      <DataGuard>
        <div>App content</div>
      </DataGuard>
    );

    await act(async () => {
      await Promise.resolve();
    });
    act(() => {
      window.dispatchEvent(
        new CustomEvent('whylowdps-updater-status', { detail: { status: 'none' } })
      );
    });
    await user.click(await screen.findByRole('button', { name: 'Repair Missing Files' }));

    expect(
      await screen.findByText('Downloading verified recovery snapshot', {}, { timeout: 3000 })
    ).toBeInTheDocument();
    expect(screen.getByText('Downloaded: 512 B / 1 KB')).toBeInTheDocument();
  });

  it('reports the recovery snapshot source without exposing a metadata link', async () => {
    localStorage.setItem('whylowdps_data_ready', 'true');
    mocks.useAuth.mockReturnValue({
      user: { battletag: 'User#1234' },
      loading: false,
      lightMode: false,
      checkCredentialsStatus: vi.fn().mockResolvedValue({ globally_configured: true }),
    });
    mocks.fetchJson.mockImplementation((url: string) => {
      if (url.endsWith('/api/data/status')) return Promise.resolve({ status: 'ready' });
      if (url.endsWith('/api/data/files')) {
        return Promise.resolve({ files: [{ required: true, exists: false, label: 'Items' }] });
      }
      if (url.endsWith('/api/data/files/missing/download')) {
        return Promise.resolve({
          sources: { bundled: [], recovery_snapshot: ['items'], raidbots: [] },
          failed: [],
        });
      }
      return Promise.resolve({});
    });

    render(
      <DataGuard>
        <div>App content</div>
      </DataGuard>
    );

    act(() => {
      window.dispatchEvent(
        new CustomEvent('whylowdps-updater-status', { detail: { status: 'none' } })
      );
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Repair Missing Files' }));

    expect(await screen.findByText(/Repaired from verified recovery snapshot/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'metadata.json' })).not.toBeInTheDocument();
  });
});
