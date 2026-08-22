import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import ChangelogPage from './page';

vi.mock('next/link', () => ({
  default: ({
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { children: ReactNode }) => (
    <a {...props}>{children}</a>
  ),
}));

describe('ChangelogPage', () => {
  it('shows the latest update and lets users filter the history', async () => {
    const user = userEvent.setup();
    render(<ChangelogPage />);

    expect(screen.getByRole('heading', { name: 'WhyLowDPS changelog' })).toBeInTheDocument();
    expect(screen.getByText('Make System Health an optional dashboard widget')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Browse version' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Documentation' }));

    expect(screen.getByText('Repository governance documentation')).toBeInTheDocument();
    expect(
      screen.queryByText('Make System Health an optional dashboard widget')
    ).not.toBeInTheDocument();
  });
});
