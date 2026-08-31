import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import ConsumableSelect from './ConsumableSelect';

describe('ConsumableSelect', () => {
  it('selects an option from its label while keeping Wowhead as a separate link', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <ConsumableSelect
        label="Potion"
        value=""
        onChange={onChange}
        options={[
          {
            key: 'potion_of_power',
            token: 'potion_of_power',
            label: 'Potion of Power',
            icon: 'inv_potion_169',
            itemId: 212967,
          },
        ]}
        qualityMaxByFamily={new Map()}
      />
    );

    await user.click(screen.getByRole('button', { name: /none/i }));
    expect(screen.getByRole('link', { name: 'View Potion of Power on Wowhead' })).toHaveAttribute(
      'href',
      'https://www.wowhead.com/item=212967'
    );

    const optionLabel = screen.getByText('Potion of Power');
    await user.click(optionLabel);

    expect(onChange).toHaveBeenCalledWith('potion_of_power');
  });
});
