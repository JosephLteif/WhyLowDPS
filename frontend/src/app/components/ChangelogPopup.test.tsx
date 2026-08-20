import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import ChangelogPopup, { CHANGELOG_CONTENT_REVISION, CHANGELOG_OPEN_EVENT } from './ChangelogPopup';
import { APP_VERSION } from '../lib/version';

const seenKey = `whylowdps_changelog_seen_${APP_VERSION}_${CHANGELOG_CONTENT_REVISION}`;

describe('ChangelogPopup', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('shows the current version changelog once and records dismissal', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<ChangelogPopup />);

    const dialog = await screen.findByRole('dialog', { name: /what's new/i });
    expect(dialog).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {
        level: 3,
        name: 'Get Discord notifications for finished sims',
      })
    ).toBeInTheDocument();
    expect(screen.getByText(/desktop app and Docker-hosted mode/)).toBeInTheDocument();
    expect(dialog.querySelector('article p, article ul')).not.toBeNull();
    expect(screen.getByRole('button', { name: /^Show changelog item 11$/ })).toBeInTheDocument();

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

  it('pages through changelog items with bottom progress dots', async () => {
    const user = userEvent.setup();
    render(<ChangelogPopup />);

    await screen.findByRole('dialog', { name: /what's new/i });

    const firstHeading = screen.getByRole('heading', { level: 3 }).textContent;
    expect(firstHeading).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Show changelog item 1$/ })).toHaveAttribute(
      'aria-current',
      'true'
    );
    expect(screen.getByRole('button', { name: /^Show changelog item 2$/ })).toHaveAttribute(
      'aria-current',
      'false'
    );
    expect(
      screen.queryByRole('heading', { level: 3, name: 'Pause and resume simulations' })
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /next changelog item/i }));

    expect(screen.getByRole('heading', { level: 3 }).textContent).not.toBe(firstHeading);
    expect(screen.getByRole('button', { name: /^Show changelog item 1$/ })).toHaveAttribute(
      'aria-current',
      'false'
    );
    expect(screen.getByRole('button', { name: /^Show changelog item 2$/ })).toHaveAttribute(
      'aria-current',
      'true'
    );
  });

  it('renders detailed changelog content as rich text', async () => {
    const user = userEvent.setup();
    render(<ChangelogPopup />);

    await screen.findByRole('dialog', { name: /what's new/i });
    await user.click(screen.getByRole('button', { name: /^Show changelog item 3$/ }));

    expect(screen.getByRole('heading', { level: 3 })).toBeInTheDocument();
    expect(document.querySelector('article p, article ul')).not.toBeNull();
  });

  it('includes the new hosted and dungeon improvements', async () => {
    const user = userEvent.setup();
    render(<ChangelogPopup />);

    await screen.findByRole('dialog', { name: /what's new/i });
    await user.click(screen.getByRole('button', { name: /^Show changelog item 4$/ }));
    expect(
      screen.getByRole('heading', { level: 3, name: 'Use hosted Light mode without signing in' })
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Show changelog item 9$/ }));
    expect(
      screen.getByRole('heading', { level: 3, name: 'Safer season rollovers' })
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Show changelog item 11$/ }));
    expect(
      screen.getByRole('heading', { level: 3, name: 'Dungeon routes stay on the dungeon flow' })
    ).toBeInTheDocument();
  });

  it('includes the Discord webhook integration', async () => {
    const user = userEvent.setup();
    render(<ChangelogPopup />);

    await screen.findByRole('dialog', { name: /what's new/i });
    expect(
      screen.getByRole('heading', {
        level: 3,
        name: 'Get Discord notifications for finished sims',
      })
    ).toBeInTheDocument();
    expect(screen.getByText(/desktop app and Docker-hosted mode/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /next changelog item/i }));
    expect(
      screen.queryByRole('heading', {
        level: 3,
        name: 'Get Discord notifications for finished sims',
      })
    ).not.toBeInTheDocument();
  });
});
