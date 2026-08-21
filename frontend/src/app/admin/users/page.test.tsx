import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  user: {
    id: 'current-user',
    battletag: 'Admin#1234',
    role: 'admin' as const,
    guest: false,
  },
  listHostedUsers: vi.fn(),
  createHostedUser: vi.fn(),
  updateHostedUser: vi.fn(),
}));

vi.mock('../../components/AuthContext', () => ({
  useAuth: () => ({ user: mocks.user, loading: false }),
}));

vi.mock('../../lib/api', () => ({
  createHostedUser: mocks.createHostedUser,
  listHostedUsers: mocks.listHostedUsers,
  updateHostedUser: mocks.updateHostedUser,
}));

import UsersAdminPage from './page';

describe('UsersAdminPage', () => {
  beforeEach(() => {
    mocks.listHostedUsers.mockReset().mockResolvedValue([
      {
        id: 'current-user',
        provider_subject: 'provider-current',
        battletag: 'Admin#1234',
        role: 'admin',
        enabled: true,
        created_at: '2026-08-20T12:00:00Z',
        last_login_at: '2026-08-20T12:00:00Z',
      },
      {
        id: 'other-user',
        provider_subject: null,
        battletag: 'Member#5678',
        role: 'member',
        enabled: true,
        created_at: '2026-08-20T12:00:00Z',
        last_login_at: null,
      },
    ]);
  });

  it('protects the current account from admin actions', async () => {
    render(<UsersAdminPage />);

    expect(await screen.findByText('Current account protected')).toBeInTheDocument();
    expect(screen.getAllByRole('combobox')).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Disable' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Sign out' })).toHaveLength(1);
  });
});
