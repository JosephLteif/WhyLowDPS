import { render, screen, waitFor } from '@testing-library/react';
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
});
