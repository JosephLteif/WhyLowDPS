import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import DungeonPageClient from './DungeonPageClient';

const mocks = vi.hoisted(() => ({
  fetchJsonCached: vi.fn(),
  getDungeonDataCached: vi.fn(),
}));

vi.mock('../../lib/api', () => ({
  API_URL: '',
  fetchJsonCached: mocks.fetchJsonCached,
  getDungeonDataCached: mocks.getDungeonDataCached,
}));

vi.mock('../../lib/useWowheadTooltips', () => ({
  useWowheadTooltips: vi.fn(),
}));

vi.mock('../../components/AuthContext', () => ({
  useAuth: () => ({ lightMode: true }),
}));

describe('DungeonPageClient', () => {
  it('shows Wowhead and Warcraft Logs guide buttons for backend-mapped raid encounter aliases', async () => {
    mocks.getDungeonDataCached.mockResolvedValue({ rotation_dungeons: [] });
    mocks.fetchJsonCached
      .mockResolvedValueOnce([
        {
          id: 900,
          name: 'The Voidspire',
          type: 'raid',
          zone: 'Raid',
          encounters: [{ id: 1, name: 'Vaelgor & Ezzorak' }],
        },
      ])
      .mockResolvedValueOnce({
        zone: {
          id: 9000,
          name: 'The Voidspire',
          url: 'https://www.wowhead.com/zone=9000',
          encounters: [{ npc_id: 1, name: 'War Chaplain Senn' }],
        },
      });

    render(<DungeonPageClient id="900" kind="raid" />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /the voidspire/i })).toBeInTheDocument();
    });

    expect(screen.getAllByRole('link', { name: /^wowhead$/i })[0]).toHaveAttribute(
      'href',
      'https://www.wowhead.com/zone=9000',
    );
    expect(screen.getAllByRole('link', { name: /^guide$/i })[0]).toHaveAttribute(
      'href',
      'https://www.warcraftlogs.com/guide/lightblinded-vanguard',
    );
  });
});
