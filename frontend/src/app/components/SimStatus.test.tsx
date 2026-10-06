import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  extractLatestPhaseRemainingSeconds,
  parseLatestPhaseLog,
  parseLiveSimulationLogs,
} from './SimStatus';
import SimStatus from './SimStatus';

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api');
  return {
    ...actual,
    pauseSim: vi.fn(),
    resumeSim: vi.fn(),
    setSimCores: vi.fn(),
  };
});

import { pauseSim, resumeSim, setSimCores } from '../lib/api';

describe('extractLatestPhaseRemainingSeconds', () => {
  it('extracts the latest remaining time from a phase log line', () => {
    expect(
      extractLatestPhaseRemainingSeconds([
        'Generating Profileset: Heatmap Tier 22 | 3p 6/32 813/813 Mean=102753 Error=-0.194% 877msec (22s)',
      ])
    ).toBe(22);
  });

  it('extracts the current profileset and simulation details', () => {
    expect(
      parseLatestPhaseLog([
        'Generating Profileset: Heatmap Tier 19 | 3p 24/32 [======>...........] 6151/11857 94.868 Mean=102226 Error=-0.070% 6sec (1m, 39s)',
      ])
    ).toMatchObject({
      phase: 'Profileset',
      name: 'Heatmap Tier 19',
      profilesetCompleted: 24,
      profilesetTotal: 32,
      simulationCompleted: 6151,
      simulationTotal: 11857,
      simulationPercent: (6151 / 11857) * 100,
      iterationsPerSecond: 94.868,
      mean: 102226,
      errorPercent: -0.07,
      remainingSeconds: 99,
    });
  });

  it('supports minute values and ignores unrelated log lines', () => {
    expect(
      extractLatestPhaseRemainingSeconds([
        'Generating Profileset: Combo 1 813/813 (1m 5s)',
        'Implementation Not Yet Verified: Emberwing Feather',
      ])
    ).toBe(65);
    expect(extractLatestPhaseRemainingSeconds(['Simulating... 50% (12s)'])).toBeNull();
  });
});

describe('live simulation telemetry', () => {
  const baseline =
    'Generating Baseline: 1/1 [====================] 1000/1000 95.3 Mean=211691 Error=0.050% 2sec';
  const finished =
    'Generating Profileset: Combo 2 | 3p 1/13 1000/1000 Mean=211733 Error=-0.050% 877msec (22s)';
  const current =
    'Generating Profileset: Combo 5 | 3p 4/13 [====>.....] 700/1000 94.868 Mean=211850 Error=0.057% 6sec (20s)';

  it('parses native baseline output and completed parallel profilesets without a throughput field', () => {
    expect(parseLatestPhaseLog([baseline])).toMatchObject({
      phase: 'Baseline',
      name: 'Baseline',
      mean: 211691,
      simulationPercent: 100,
    });
    expect(parseLatestPhaseLog([finished])).toMatchObject({
      name: 'Combo 2',
      mean: 211733,
      simulationPercent: 100,
      errorPercent: -0.05,
    });
    expect(parseLatestPhaseLog([current])?.simulationPercent).toBe(70);
    expect(parseLatestPhaseLog([baseline])?.profilesetTotal).toBeUndefined();
    expect(
      parseLatestPhaseLog(['Generating Baseline: 1/1 1000/1000 877msec'])?.iterationsPerSecond
    ).toBeUndefined();
  });

  it('only ranks completed estimates, deduplicates notes, and collects the current phase samples', () => {
    const warning = 'Implementation Not Yet Verified: Rune of Unleashed Fire';
    const data = parseLiveSimulationLogs([
      'Simulating... (target_error=0.050)',
      baseline,
      finished,
      finished,
      warning,
      warning,
      current.replace('Mean=211850', 'Mean=211800'),
      current,
    ]);
    expect(data.completed.map((phase) => phase.name)).toEqual(['Combo 2', 'Baseline']);
    expect(data.samples).toEqual([211800, 211850]);
    expect(data.notes).toEqual([{ text: 'Rune of Unleashed Fire', count: 2 }]);
    expect(data.targetError).toBe(0.05);
  });

  it('resets comparisons at a new staged run and handles output without mean or error', () => {
    const data = parseLiveSimulationLogs([
      baseline,
      finished,
      'Simulating... (iterations=10000)',
      'Generating Baseline: 1/1 [==>.......] 300/1000 90.0 6sec (10s)',
    ]);
    expect(data.completed).toEqual([]);
    expect(data.samples).toEqual([]);
    expect(data.latest).toMatchObject({ simulationCompleted: 300, simulationPercent: 30 });
    expect(data.latest?.mean).toBeUndefined();
    expect(data.targetError).toBeUndefined();
  });

  it('keeps telemetry visible with logs collapsed and labels the chart and provisional results', () => {
    render(
      <SimStatus
        status="running"
        progress={40}
        logLines={[baseline, finished, current.replace('Mean=211850', 'Mean=211800'), current]}
        showLogs={false}
      />
    );
    expect(screen.getByText('Live estimate')).toBeInTheDocument();
    expect(screen.getByText('+159 vs baseline')).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: 'Live estimate over the last 2 updates' })
    ).toBeInTheDocument();
    expect(screen.getByRole('table')).toHaveTextContent('Combo 2');
    expect(screen.queryByText('SimC Output')).not.toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '40');
  });

  it('filters repeated progress and notes in key output and can reveal everything', () => {
    const warning = 'Implementation Not Yet Verified: Rune of Unleashed Fire';
    const earlier = current.replace('Mean=211850', 'Mean=211800');
    render(
      <SimStatus
        status="running"
        progress={40}
        logLines={[earlier, current, warning, warning]}
        showLogs
      />
    );
    expect(screen.queryByText(earlier)).not.toBeInTheDocument();
    expect(screen.getAllByText(warning)).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Everything' }));
    expect(screen.getByText(earlier)).toBeInTheDocument();
    expect(screen.getAllByText(warning)).toHaveLength(2);
  });

  it('does not show stale live data while a simulation is queued', () => {
    render(<SimStatus status="pending" progress={0} logLines={[baseline, finished, current]} />);
    expect(screen.queryByText('Live estimate')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('keeps stage history and simulation controls in the sticky progress bar', () => {
    render(
      <SimStatus
        status="running"
        progress={90}
        progressStage="Stage 3 of 3"
        progressDetail="High"
        stagesCompleted={['Low', 'Medium']}
        stageTimings={[
          { name: 'Low', elapsed: 35 },
          { name: 'Medium', elapsed: 80 },
        ]}
        jobId="sticky-stage-job"
        cpuCores={10}
        maxCpuCores={10}
        coresAvailable
      />
    );

    const bar = screen.getByRole('list', { name: 'Simulation stages' }).closest('.sticky');
    expect(bar).toBeInTheDocument();
    expect(bar).toHaveClass('sticky');
    expect(bar).toContainElement(screen.getByText('Low'));
    expect(bar).toContainElement(screen.getByText('Medium'));
    expect(bar).toContainElement(screen.getByText('High'));
    expect(screen.getByRole('listitem', { current: 'step' })).toHaveTextContent('Stage 3 of 3');
    expect(bar).toContainElement(screen.getByRole('button', { name: 'Pause Sim' }));
    expect(bar).toContainElement(screen.getByRole('button', { name: 'Cancel Sim' }));
    expect(bar).toContainElement(
      screen.getByRole('combobox', { name: 'CPU cores used by this simulation' })
    );
  });

  it('updates estimates when new output arrives and resets the chart for a different profileset', () => {
    const { rerender } = render(
      <SimStatus status="running" progress={40} logLines={[baseline, current]} />
    );
    const next = current.replace('Mean=211850', 'Mean=212000');
    rerender(<SimStatus status="running" progress={41} logLines={[baseline, current, next]} />);
    expect(screen.getByText('+309 vs baseline')).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: 'Live estimate over the last 2 updates' })
    ).toBeInTheDocument();
    rerender(
      <SimStatus
        status="running"
        progress={42}
        logLines={[baseline, current, next, next.replace('Combo 5', 'Combo 6')]}
      />
    );
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('Collecting live estimate samples…')).toBeInTheDocument();
  });
});

describe('SimStatus pause and resume controls', () => {
  beforeEach(() => {
    vi.mocked(pauseSim).mockReset();
    vi.mocked(resumeSim).mockReset();
    vi.mocked(setSimCores).mockReset();
  });

  it('shows Resume for a paused simulation and reports the resumed status', async () => {
    vi.mocked(resumeSim).mockResolvedValue({ status: 'running' });
    const onStatusChange = vi.fn();

    render(
      <SimStatus status="paused" progress={40} jobId="paused-job" onStatusChange={onStatusChange} />
    );

    expect(screen.getByText('Paused')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Resume Sim' }));

    await waitFor(() => expect(onStatusChange).toHaveBeenCalledWith('running'));
    expect(resumeSim).toHaveBeenCalledWith('paused-job');
  });

  it('shows Pause for a running simulation and reports the paused status', async () => {
    vi.mocked(pauseSim).mockResolvedValue({ status: 'paused' });
    const onStatusChange = vi.fn();

    render(
      <SimStatus
        status="running"
        progress={40}
        jobId="running-job"
        onStatusChange={onStatusChange}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Pause Sim' }));

    await waitFor(() => expect(onStatusChange).toHaveBeenCalledWith('paused'));
    expect(pauseSim).toHaveBeenCalledWith('running-job');
  });

  it('shows a pause failure without changing the displayed status', async () => {
    vi.mocked(pauseSim).mockRejectedValue(new Error('pause failed'));
    const onStatusChange = vi.fn();

    render(
      <SimStatus
        status="running"
        progress={40}
        jobId="failed-pause-job"
        onStatusChange={onStatusChange}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Pause Sim' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('pause failed');
    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it('changes the CPU cores used by a running simulation', async () => {
    vi.mocked(setSimCores).mockResolvedValue({ status: 'running', cores: 2, max_cores: 4 });

    render(
      <SimStatus
        status="running"
        progress={40}
        jobId="cores-job"
        cpuCores={4}
        maxCpuCores={4}
        coresAvailable
      />
    );

    fireEvent.change(screen.getByRole('combobox', { name: 'CPU cores used by this simulation' }), {
      target: { value: '2' },
    });

    await waitFor(() => expect(setSimCores).toHaveBeenCalledWith('cores-job', 2));
  });

  it('offers rerun when a paused job has no live resume control', () => {
    const onRerun = vi.fn();

    render(
      <SimStatus
        status="paused"
        progress={40}
        jobId="unavailable-job"
        resumeAvailable={false}
        onRerun={onRerun}
      />
    );

    expect(screen.getByRole('button', { name: 'Resume Unavailable' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Rerun Input' }));
    expect(onRerun).toHaveBeenCalledOnce();
  });
});

describe('SimStatus queued treatment', () => {
  it('explains that a pending simulation has not started and shows its queue position', () => {
    render(
      <SimStatus
        status="pending"
        progress={0}
        queuePosition={3}
        jobId="queued-job"
        iterations={10000}
      />
    );

    expect(screen.getByText('Queued for simulation')).toBeInTheDocument();
    expect(screen.getByText('Waiting for an available SimC slot')).toBeInTheDocument();
    expect(screen.getByText('Queue position #3')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Manage queue' })).toHaveAttribute('href', '/queue');
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
  });
});
