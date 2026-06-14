import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSimSubmit } from './useSimSubmit';

const pushMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock('../components/AuthContext', () => ({
  useAuth: () => ({ lightMode: true }),
}));

vi.mock('../components/SimContext', () => ({
  useSimContext: () => ({
    simcInput: 'mage="Alice"\nserver=Illidan\nregion=us\n',
    fightStyle: 'Patchwerk',
    threads: 1,
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
    clearScenarios: vi.fn(),
  }),
}));

const jsonResponse = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });

describe('useSimSubmit light mode', () => {
  beforeEach(() => {
    localStorage.clear();
    pushMock.mockClear();
    vi.restoreAllMocks();
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
});
