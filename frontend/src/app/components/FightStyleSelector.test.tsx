import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import FightStyleSelector from './FightStyleSelector';

describe('FightStyleSelector', () => {
  it('shows the active style and restricts available choices', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <FightStyleSelector
        value="Patchwerk"
        onChange={onChange}
        allowedValues={['Patchwerk', 'DungeonSlice']}
      />
    );

    expect(screen.getByRole('button', { name: /patchwerk/i })).toBeInTheDocument();
    expect(screen.getByText('Pure single-target with no movement.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /patchwerk/i }));
    expect(screen.getByRole('button', { name: /dungeon slice/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /heavy movement/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /dungeon slice/i }));
    expect(onChange).toHaveBeenCalledWith('DungeonSlice');
  });

  it('dismisses the open menu on escape', async () => {
    const user = userEvent.setup();
    render(<FightStyleSelector value="Patchwerk" onChange={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /patchwerk/i }));
    expect(screen.getByRole('button', { name: /heavy movement/i })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('button', { name: /heavy movement/i })).not.toBeInTheDocument();
  });
});

