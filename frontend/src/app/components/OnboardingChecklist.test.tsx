import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import OnboardingChecklist from './OnboardingChecklist';

const checkCredentialsStatusMock = vi.fn();
const apiMocks = vi.hoisted(() => ({
  fetchJson: vi.fn(),
  listCharacterProfiles: vi.fn(),
  listSims: vi.fn(),
}));

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('./AuthContext', () => ({
  useAuth: () => ({ lightMode: false, checkCredentialsStatus: checkCredentialsStatusMock }),
}));

vi.mock('../lib/api', () => ({
  API_URL: 'http://localhost:17384',
  fetchJson: apiMocks.fetchJson,
  listCharacterProfiles: apiMocks.listCharacterProfiles,
  listSims: apiMocks.listSims,
}));

describe('OnboardingChecklist', () => {
  beforeEach(() => {
    checkCredentialsStatusMock.mockReset();
    checkCredentialsStatusMock.mockResolvedValue({ globally_configured: false });
    apiMocks.fetchJson.mockReset();
    apiMocks.fetchJson.mockResolvedValue({ status: 'syncing' });
    apiMocks.listCharacterProfiles.mockReset();
    apiMocks.listCharacterProfiles.mockResolvedValue([]);
    apiMocks.listSims.mockReset();
    apiMocks.listSims.mockResolvedValue([]);
  });

  it('opens the relevant settings section for data and Blizzard setup', async () => {
    render(<OnboardingChecklist />);

    await waitFor(() =>
      expect(screen.getByText('Finish setting up WhyLowDPS')).toBeInTheDocument()
    );

    expect(screen.getByRole('link', { name: /game data is ready/i })).toHaveAttribute(
      'href',
      '/settings?tab=data'
    );
    expect(
      screen.getByRole('link', { name: /connect blizzard for character data/i })
    ).toHaveAttribute('href', '/settings?tab=integrations');
  });
});
