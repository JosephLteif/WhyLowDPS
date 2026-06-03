import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useDismissOnOutside } from './useDismissOnOutside';

function Harness({ active, onDismiss }: { active: boolean; onDismiss: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useDismissOnOutside(ref, active, onDismiss);
  return (
    <>
      <div ref={ref}>
        <button type="button">Inside</button>
      </div>
      <button type="button">Outside</button>
    </>
  );
}

describe('useDismissOnOutside', () => {
  it('dismisses on outside pointer and escape only while active', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    const { rerender } = render(<Harness active={false} onDismiss={onDismiss} />);

    await user.click(screen.getByRole('button', { name: 'Outside' }));
    expect(onDismiss).not.toHaveBeenCalled();

    rerender(<Harness active onDismiss={onDismiss} />);
    await user.click(screen.getByRole('button', { name: 'Inside' }));
    expect(onDismiss).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Outside' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);

    await user.keyboard('{Escape}');
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });
});

