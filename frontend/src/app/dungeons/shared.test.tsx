import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DungeonCard, fallbackUpgradeTimers } from './shared';
import type { DungeonInfo } from '../lib/api';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

describe('dungeon card timer fallbacks', () => {
  it('derives upgrade timer chips from a base timer', () => {
    expect(fallbackUpgradeTimers(1_980_000, [1, 2, 3])).toEqual([
      { upgrade_level: 1, qualifying_duration: 1_980_000 },
      { upgrade_level: 2, qualifying_duration: 1_584_000 },
      { upgrade_level: 3, qualifying_duration: 1_188_000 },
    ]);
  });

  it('renders Warcraft Logs guide links for supported raid bosses', () => {
    const raid: DungeonInfo = {
      id: 1,
      name: 'Current Raid',
      zone: 'Raid',
      wowhead_id: null,
      num_bosses: 3,
      expansion: 11,
      encounters: ["Belo'ren, Child of Al'ar", 'Imperator Averzian', 'Unknown Boss'],
    };

    render(<DungeonCard dungeon={raid} mplusDetail={null} detailsBasePath="/raids/details" />);

    expect(
      screen.getByRole('link', { name: /warcraft logs guide for belo'ren, child of al'ar/i }),
    ).toHaveAttribute('href', 'https://www.warcraftlogs.com/guide/beloren-child-of-alar');
    expect(
      screen.getByRole('link', { name: /warcraft logs guide for imperator averzian/i }),
    ).toHaveAttribute('href', 'https://www.warcraftlogs.com/guide/imperator-averzian');
    expect(screen.queryByRole('link', { name: /warcraft logs guide for unknown boss/i })).not.toBeInTheDocument();
  });
});
