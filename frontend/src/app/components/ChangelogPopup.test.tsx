import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import ChangelogPopup, { CHANGELOG_CONTENT_REVISION, CHANGELOG_OPEN_EVENT } from './ChangelogPopup';
import { APP_VERSION, APP_VERSION_WITH_PREFIX } from '../lib/version';

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
        level: 4,
        name: 'Get Discord notifications for finished sims',
      })
    ).toBeInTheDocument();
    expect(screen.getByText(APP_VERSION_WITH_PREFIX)).toBeInTheDocument();
    expect(screen.getByText(/desktop app and Docker-hosted mode/)).toBeInTheDocument();
    expect(dialog.querySelector('article p, article ul')).not.toBeNull();
    expect(screen.getByRole('heading', { level: 3, name: 'New features' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Improvements' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 3, name: 'Bug fixes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 3, name: 'Highlights' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 4 })).toHaveLength(5);
    expect(
      screen.queryByRole('button', { name: /changelog item|changelog page/i })
    ).not.toBeInTheDocument();

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

  it('renders every release note in one categorized scrollable page', async () => {
    render(<ChangelogPopup />);

    const dialog = await screen.findByRole('dialog', { name: /what's new/i });

    expect(dialog.querySelector('header')).toHaveClass('shrink-0', 'bg-[#111218]');
    expect(dialog.querySelector('article')).toHaveClass('overflow-y-auto');
    expect(
      screen.getByRole('heading', { level: 4, name: 'Use separate accounts by default' })
    ).toBeInTheDocument();
    const improvements = document.querySelector('section[aria-labelledby="changelog-improvement"]');
    expect(improvements).not.toBeNull();
    expect(
      within(improvements as HTMLElement).getByRole('heading', {
        level: 4,
        name: 'Small improvements and fixes',
      })
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /next changelog item/i })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /previous changelog item/i })
    ).not.toBeInTheDocument();
  });

  it('renders detailed changelog content as rich text', async () => {
    render(<ChangelogPopup />);

    await screen.findByRole('dialog', { name: /what's new/i });

    expect(screen.getAllByRole('heading', { level: 4 })).toHaveLength(5);
    expect(document.querySelector('article p, article ul')).not.toBeNull();
  });

  it('includes the new hosted and dungeon improvements', async () => {
    render(<ChangelogPopup />);

    await screen.findByRole('dialog', { name: /what's new/i });
    expect(
      screen.getByRole('heading', { level: 4, name: 'Small improvements and fixes' })
    ).toBeInTheDocument();
    expect(screen.getByText(/season rollovers/i)).toBeInTheDocument();
    expect(screen.getByText(/route imports/i)).toBeInTheDocument();
  });

  it('includes the Discord webhook integration', async () => {
    render(<ChangelogPopup />);

    await screen.findByRole('dialog', { name: /what's new/i });
    expect(
      screen.getByRole('heading', {
        level: 4,
        name: 'Get Discord notifications for finished sims',
      })
    ).toBeInTheDocument();
    expect(screen.getByText(/desktop app and Docker-hosted mode/)).toBeInTheDocument();
    expect(screen.getByText(/Enable hosted Light mode for shared simulations/)).toBeInTheDocument();
    expect(screen.getByText(/Install the hosted web app as a PWA/)).toBeInTheDocument();
  });
});
