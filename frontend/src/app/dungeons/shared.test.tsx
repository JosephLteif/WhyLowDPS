import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DungeonCard, fallbackUpgradeTimers } from './shared';
import type { DungeonInfo } from '../lib/api';

describe('dungeon card timer fallbacks', () => {
  it('derives upgrade timer chips from a base timer', () => {
    expect(fallbackUpgradeTimers(1_980_000, [1, 2, 3])).toEqual([
      { upgrade_level: 1, qualifying_duration: 1_980_000 },
      { upgrade_level: 2, qualifying_duration: 1_584_000 },
      { upgrade_level: 3, qualifying_duration: 1_188_000 },
    ]);
  });

  it('renders current dungeon score timers and encounters', () => {
    const dungeon: DungeonInfo = {
      id: 1,
      name: 'Current Dungeon',
      zone: 'Current Zone',
      wowhead_id: null,
      num_bosses: 2,
      expansion: null,
      keystone_timer_ms: 1_980_000,
      keystone_upgrades: [1, 2, 3],
      encounters: ['First Boss', 'Final Boss'],
      image_url: 'https://example.com/current-dungeon.jpg',
    };

    render(<DungeonCard dungeon={dungeon} mplusDetail={null} />);

    expect(screen.getByText('Score +1 (33:00)')).toBeInTheDocument();
    expect(screen.getByText('Score +2 (26:24)')).toBeInTheDocument();
    expect(screen.getByText('Score +3 (19:48)')).toBeInTheDocument();
    expect(screen.getByText('First Boss')).toBeInTheDocument();
    expect(screen.getByText('Final Boss')).toBeInTheDocument();
    expect(document.querySelector('img')).toHaveAttribute(
      'src',
      'https://example.com/current-dungeon.jpg'
    );
  });
});
