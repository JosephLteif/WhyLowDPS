import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { TopGearResult } from '../../lib/types';
import RankedResults, { type ResultListProps } from './RankedResults';

vi.mock('./RankingsHeader', () => ({
  default: () => <div data-testid="rankings-header" />,
}));

vi.mock('./ResultRow', () => ({
  default: ({ result, rank }: { result: TopGearResult; rank?: number }) => (
    <div data-testid="result-row">
      {rank ? `${rank}: ` : ''}
      {result.name}
    </div>
  ),
}));

function buildResults(count: number): TopGearResult[] {
  return Array.from({ length: count }, (_, index) => ({
    name: `Combination ${index + 1}`,
    dps: 1000 - index,
    delta: 10 - index,
    items: [],
  }));
}

function renderResults(results: TopGearResult[]) {
  const props: ResultListProps = {
    results,
    maxDps: 1000,
    baseDps: 990,
    baseAvgIlevel: 0,
    itemInfoMap: {},
    enchantInfoMap: {},
    gemInfoMap: {},
    selectedResultName: null,
    onSelectResult: vi.fn(),
  };
  return render(<RankedResults {...props} />);
}

describe('ranked result disclosure', () => {
  it('reveals results in batches and keeps show-all explicit', () => {
    renderResults(buildResults(28));

    expect(screen.getAllByTestId('result-row')).toHaveLength(8);
    expect(screen.getByText('Showing 8 of 28 results')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show next 10' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show all 28' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show next 10' }));
    expect(screen.getAllByTestId('result-row')).toHaveLength(18);
    expect(screen.getByText('Showing 18 of 28 results')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show fewer' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show all 28' }));
    expect(screen.getAllByTestId('result-row')).toHaveLength(28);
    expect(screen.getByRole('button', { name: 'Show fewer' })).toBeInTheDocument();
  });

  it('resets the visible window when the filtered result set changes', () => {
    const { rerender } = renderResults(buildResults(20));
    fireEvent.click(screen.getByRole('button', { name: 'Show next 10' }));
    expect(screen.getAllByTestId('result-row')).toHaveLength(18);

    const nextResults = buildResults(12);
    rerender(
      <RankedResults
        results={nextResults}
        maxDps={1000}
        baseDps={990}
        baseAvgIlevel={0}
        itemInfoMap={{}}
        enchantInfoMap={{}}
        gemInfoMap={{}}
        selectedResultName={null}
        onSelectResult={vi.fn()}
      />
    );

    expect(screen.getAllByTestId('result-row')).toHaveLength(8);
  });
});
