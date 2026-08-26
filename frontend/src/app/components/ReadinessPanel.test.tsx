import type { ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ReadinessPanel from './ReadinessPanel';
import type { ReadinessSnapshot } from '../lib/readiness';

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const snapshot: ReadinessSnapshot = {
  status: 'blocked',
  app: { mode: 'desktop', version: '4.0.0', revision: 'abc123' },
  credentials: { configured: false },
  data: {
    status: 'blocked',
    message: 'Required game data files are missing.',
    degraded: false,
    last_sync: null,
    required_missing: 2,
    optional_missing: 1,
    available: true,
  },
  simulation: { available: false },
};

describe('ReadinessPanel', () => {
  it('shows blocked checks and invokes repair actions', () => {
    const onRepairData = vi.fn();
    const onRefresh = vi.fn();

    render(
      <ReadinessPanel
        variant="details"
        snapshot={snapshot}
        onRepairData={onRepairData}
        onRefresh={onRefresh}
      />
    );

    expect(screen.getAllByText('Blocked').length).toBeGreaterThan(0);
    expect(screen.getByText('2 required files missing.')).toBeInTheDocument();
    expect(
      screen.getByText('SimulationCraft is unavailable. Check runtime updates.')
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Repair missing files' }));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh health' }));
    expect(onRepairData).toHaveBeenCalledOnce();
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('keeps account access optional in Light mode', () => {
    render(
      <ReadinessPanel snapshot={{ ...snapshot, status: 'attention' }} lightMode variant="summary" />
    );

    expect(
      screen.getByText('Light mode is active. Battle.net features are optional.')
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open health details' })).toHaveAttribute(
      'href',
      '/settings?tab=health'
    );
  });
});
