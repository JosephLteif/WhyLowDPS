import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSimSubmit } from './useSimSubmit';

const { notifyMock, pushMock, simContextMock } = vi.hoisted(() => ({
  notifyMock: vi.fn(),
  pushMock: vi.fn(),
  simContextMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock('../components/AuthContext', () => ({
  useAuth: () => ({ lightMode: true }),
}));

vi.mock('../components/shared/NotificationSystem', () => ({
  useNotifications: () => ({ notify: notifyMock }),
}));

vi.mock('../components/SimContext', () => ({
  useSimContext: simContextMock,
}));

const baseSimContext = {
  simcInput: 'mage="Alice"\nserver=Illidan\nregion=us\n',
  fightStyle: 'Patchwerk',
  threads: 1,
  simTimeoutSeconds: 7200,
  simIdleTimeoutSeconds: 600,
  selectedTalent: '',
  targetCount: 1,
  fightLength: 300,
  customApl: '',
  simcChannel: 'bundled',
  includeTimeline: false,
  externalBuffChaosBrand: false,
  externalBuffMysticTouch: false,
  externalBuffSkyfury: false,
  externalBuffPowerInfusion: false,
  externalBuffBlessingOfBronze: false,
  externalBuffAugmentation: false,
  raidBuffBloodlust: true,
  raidBuffArcaneIntellect: true,
  raidBuffPowerWordFortitude: true,
  raidBuffMarkOfTheWild: true,
  raidBuffBattleShout: true,
  raidBuffHuntersMark: true,
  raidBuffBleeding: true,
  consumableFlask: '',
  consumableFood: '',
  consumablePotion: '',
  consumableAugmentation: '',
  consumableTemporaryEnchant: '',
  simcHeader: '',
  simcBasePlayer: '',
  simcRaidActors: '',
  simcPostCombos: '',
  simcFooter: '',
  scenarios: [],
  addScenario: vi.fn(),
  removeScenario: vi.fn(),
  clearScenarios: vi.fn(),
};

const jsonResponse = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });

describe('useSimSubmit light mode', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
    pushMock.mockClear();
    notifyMock.mockClear();
    simContextMock.mockReset();
    simContextMock.mockReturnValue(baseSimContext);
  });

  it('submits a sim without calling Battle.net or Blizzard character APIs in light mode', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/sim') return Promise.resolve(jsonResponse({ id: 'sim-1' }));
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() =>
      useSimSubmit({
        endpoint: '/api/sim',
        buildPayload: () => ({ sim_type: 'quick', simc_input: 'mage="Alice"' }),
      })
    );

    await act(async () => {
      await result.current.submit();
    });

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/sim/sim-1'));
    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls).toContain('/api/sim');
    expect(urls.some((url) => url.includes('/api/bnet/'))).toBe(false);
    expect(urls.some((url) => url.includes('/api/blizzard/'))).toBe(false);
  });

  it('uses a one-time thread override without changing the saved default', async () => {
    let submittedBody: Record<string, unknown> | undefined;
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/sim') {
        submittedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return Promise.resolve(jsonResponse({ id: 'sim-override' }));
      }
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() =>
      useSimSubmit({
        endpoint: '/api/sim',
        buildPayload: () => ({ sim_type: 'quick', simc_input: 'mage="Alice"' }),
      })
    );

    await act(async () => {
      await result.current.submit({ threadsOverride: 4 });
    });

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/sim/sim-override'));
    expect(submittedBody?.threads).toBe(4);
    expect(submittedBody?.sim_timeout_seconds).toBe(7200);
    expect(submittedBody?.sim_idle_timeout_seconds).toBe(600);
  });

  it('keeps successful scenario jobs and reports failed definitions for retry', async () => {
    const scenarios = [
      { id: 'scenario-1', fightStyle: 'Patchwerk', targetCount: 1, fightLength: 300 },
      { id: 'scenario-2', fightStyle: 'LightMovement', targetCount: 1, fightLength: 300 },
      { id: 'scenario-3', fightStyle: 'HecticAddCleave', targetCount: 3, fightLength: 300 },
    ];
    const removeScenario = vi.fn();
    const clearScenarios = vi.fn();
    const fetchMock = vi.fn((url: string) => {
      if (url !== '/api/sim') return Promise.resolve(jsonResponse({}));
      const requestNumber = fetchMock.mock.calls.length;
      if (requestNumber === 1) return Promise.resolve(jsonResponse({ id: 'sim-1' }));
      if (requestNumber === 2) return Promise.reject(new Error('queue is full'));
      return Promise.resolve(jsonResponse({ id: 'sim-3' }));
    });
    vi.stubGlobal('fetch', fetchMock);

    simContextMock.mockReturnValue({
      ...baseSimContext,
      scenarios,
      removeScenario,
      clearScenarios,
    });
    const { result } = renderHook(() =>
      useSimSubmit({
        endpoint: '/api/sim',
        buildPayload: () => ({ sim_type: 'quick', simc_input: 'mage="Alice"' }),
      })
    );

    await act(async () => {
      await result.current.submit();
    });

    expect(removeScenario).toHaveBeenCalledWith('scenario-1');
    expect(removeScenario).toHaveBeenCalledWith('scenario-3');
    expect(removeScenario).not.toHaveBeenCalledWith('scenario-2');
    expect(clearScenarios).not.toHaveBeenCalled();
    expect(result.current.submissionStatus).toMatchObject({
      submitted: [
        { id: 'sim-1', fightStyle: 'Patchwerk' },
        { id: 'sim-3', fightStyle: 'HecticAddCleave' },
      ],
      failed: [{ scenario: { id: 'scenario-2' }, error: 'Backend not reachable' }],
    });
    expect(notifyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '1 scenario failed to submit',
        action: expect.objectContaining({ label: 'Retry failed' }),
      })
    );
    expect(pushMock).toHaveBeenCalledWith('/sim/sim-1');

    const notification = notifyMock.mock.calls[0]?.[0];
    await notification?.action?.onClick();
    expect(pushMock).toHaveBeenLastCalledWith('/');
  });

  it('keeps every scenario definition when the whole batch fails', async () => {
    const scenarios = [
      { id: 'scenario-1', fightStyle: 'Patchwerk', targetCount: 1, fightLength: 300 },
      { id: 'scenario-2', fightStyle: 'LightMovement', targetCount: 1, fightLength: 300 },
    ];
    const removeScenario = vi.fn();
    const clearScenarios = vi.fn();
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/sim') return Promise.reject(new Error('offline'));
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);

    simContextMock.mockReturnValue({
      ...baseSimContext,
      scenarios,
      removeScenario,
      clearScenarios,
    });

    const { result } = renderHook(() =>
      useSimSubmit({
        endpoint: '/api/sim',
        buildPayload: () => ({ sim_type: 'quick', simc_input: 'mage="Alice"' }),
      })
    );
    await act(async () => {
      await result.current.submit();
    });

    expect(removeScenario).not.toHaveBeenCalled();
    expect(clearScenarios).not.toHaveBeenCalled();
    expect(result.current.submissionStatus).toMatchObject({
      submitted: [],
      failed: [
        { scenario: { id: 'scenario-1' }, error: 'Backend not reachable' },
        { scenario: { id: 'scenario-2' }, error: 'Backend not reachable' },
      ],
    });
    expect(result.current.error).toBe(
      'All 2 scenario submissions failed: Backend not reachable · Backend not reachable'
    );
    expect(pushMock).not.toHaveBeenCalled();
  });
});
