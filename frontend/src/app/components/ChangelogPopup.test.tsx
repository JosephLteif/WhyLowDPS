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
    expect(screen.getByText(/improvements/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /warcraft logs boss guides/i })).toBeInTheDocument();
    expect(
      screen.getByText(/current-season raid bosses now link directly to warcraft logs guides/i)
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

  it('pages through changelog items with bottom progress dots', async () => {
    const user = userEvent.setup();
    render(<ChangelogPopup />);

    expect(
      await screen.findByRole('heading', { name: /warcraft logs boss guides/i })
    ).toBeInTheDocument();
    expect(screen.queryByText(/1\s*\/\s*3/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /show changelog item 1/i })).toHaveAttribute(
      'aria-current',
      'true'
    );
    expect(screen.getByRole('button', { name: /show changelog item 2/i })).toHaveAttribute(
      'aria-current',
      'false'
    );

    await user.click(screen.getByRole('button', { name: /next changelog item/i }));

    expect(
      screen.getByRole('heading', { name: /simulation activity time grouping/i })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /show changelog item 1/i })).toHaveAttribute(
      'aria-current',
      'false'
    );
    expect(screen.getByRole('button', { name: /show changelog item 2/i })).toHaveAttribute(
      'aria-current',
      'true'
    );
  });

  it('renders detailed changelog content as rich text', async () => {
    const user = userEvent.setup();
    render(<ChangelogPopup />);

    await screen.findByRole('dialog', { name: /what's new/i });
    await user.click(screen.getByRole('button', { name: /show changelog item 3/i }));

    expect(
      screen.getByRole('heading', { name: /simc and app updates decoupling/i })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/app updates and simulationcraft updates are now managed separately/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/new simc versions can be delivered faster/i).closest('li')
    ).toBeInTheDocument();
    expect(
      screen.getByText(/app updates should now be less frequent/i).closest('li')
    ).toBeInTheDocument();
  });
});
