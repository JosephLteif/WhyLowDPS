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
  it('paginates results without rendering the full result set', () => {
    renderResults(buildResults(28));

    expect(screen.getAllByTestId('result-row')).toHaveLength(10);
    expect(screen.getByText('Showing 1-10 of 28 results')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument();
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Show all/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getAllByTestId('result-row')).toHaveLength(10);
    expect(screen.getByText('Showing 11-20 of 28 results')).toBeInTheDocument();
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getAllByTestId('result-row')).toHaveLength(8);
    expect(screen.getByText('Showing 21-28 of 28 results')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('resets to the first page when the filtered result set changes', () => {
    const { rerender } = renderResults(buildResults(20));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Showing 11-20 of 20 results')).toBeInTheDocument();

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

    expect(screen.getAllByTestId('result-row')).toHaveLength(10);
    expect(screen.getByText('Showing 1-10 of 12 results')).toBeInTheDocument();
  });
});
