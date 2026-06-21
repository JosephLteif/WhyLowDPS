import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import ChangelogPopup, { CHANGELOG_OPEN_EVENT } from './ChangelogPopup';
import { APP_VERSION } from '../lib/version';

const seenKey = `whylowdps_changelog_seen_${APP_VERSION}`;

describe('ChangelogPopup', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('shows the current version changelog once and records dismissal', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<ChangelogPopup />);

    expect(await screen.findByRole('dialog', { name: /what's new/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /improvements/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /simulation activity time grouping/i })).toBeInTheDocument();
    expect(
      screen.getByText(/daily, weekly, monthly, and yearly views/i)
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /got it/i }));
    expect(localStorage.getItem(seenKey)).toBe('1');
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /what's new/i })).not.toBeInTheDocument();
    });

    unmount();
    render(<ChangelogPopup />);

    expect(screen.queryByRole('dialog', { name: /what's new/i })).not.toBeInTheDocument();
  });

  it('opens on demand even after the current version was dismissed', async () => {
    localStorage.setItem(seenKey, '1');
    render(<ChangelogPopup />);

    expect(screen.queryByRole('dialog', { name: /what's new/i })).not.toBeInTheDocument();

    window.dispatchEvent(new Event(CHANGELOG_OPEN_EVENT));

    expect(await screen.findByRole('dialog', { name: /what's new/i })).toBeInTheDocument();
  });

  it('keeps the desktop header region uncovered while open', async () => {
    render(<ChangelogPopup />);

    const dialog = await screen.findByRole('dialog', { name: /what's new/i });
    const overlay = dialog.parentElement;

    expect(overlay).toHaveStyle({ top: 'var(--app-header-height)' });
  });
});
