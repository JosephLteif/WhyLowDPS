import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SimulationLaunchButton from './SimulationLaunchButton';

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

describe('SimulationLaunchButton', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('launches with the default when the main button is clicked', () => {
    const onSubmit = vi.fn();
    render(<SimulationLaunchButton onSubmit={onSubmit}>Run Simulation</SimulationLaunchButton>);

    fireEvent.click(screen.getByRole('button', { name: 'Run Simulation' }));

    expect(onSubmit).toHaveBeenCalledWith();
  });

  it('launches with a selected performance preset as a one-time override', async () => {
    const onSubmit = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ threads: 10 })));
    render(<SimulationLaunchButton onSubmit={onSubmit}>Run Simulation</SimulationLaunchButton>);

    fireEvent.click(screen.getByRole('button', { name: 'Choose simulation performance' }));
    await waitFor(() =>
      expect(screen.getByRole('menuitem', { name: /Maximum/ })).toBeInTheDocument()
    );
    fireEvent.click(screen.getByRole('menuitem', { name: /Maximum/ }));

    expect(onSubmit).toHaveBeenCalledWith(9);
  });
});
