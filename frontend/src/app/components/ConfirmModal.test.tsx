import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import ConfirmModal from './ConfirmModal';

describe('ConfirmModal', () => {
  it('does not render when closed', () => {
    const { container } = render(
      <ConfirmModal isOpen={false} onClose={vi.fn()} onConfirm={vi.fn()} title="Delete" message="Confirm?" />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('calls close from cancel/backdrop and closes after confirm resolves', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <ConfirmModal
        isOpen
        onClose={onClose}
        onConfirm={onConfirm}
        title="Delete sim"
        message="This cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Keep"
      />
    );

    expect(screen.getByText('Delete sim')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Keep' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(
      <ConfirmModal
        isOpen
        onClose={onClose}
        onConfirm={onConfirm}
        title="Delete sim"
        message="This cannot be undone."
        confirmLabel="Delete"
      />
    );
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

