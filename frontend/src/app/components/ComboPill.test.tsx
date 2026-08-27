import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ComboPill from './ComboPill';

describe('ComboPill', () => {
  it('shows a computing state instead of a stale count', () => {
    render(<ComboPill comboCount={42} isComputing maxCombinations={500} />);

    expect(screen.getByText('Computing…')).toBeInTheDocument();
    expect(screen.queryByText('42 combo(s)')).not.toBeInTheDocument();
  });

  it('shows the exact over-limit count', () => {
    render(<ComboPill comboCount={501} limitReached maxCombinations={500} />);

    expect(screen.getByText('501 combo(s) (over limit)')).toBeInTheDocument();
    expect(screen.getByTitle(/Cannot start a simulation/)).toBeInTheDocument();
  });
});
