import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  deleteCharacterProfile: vi.fn(),
  listCharacterProfiles: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  deleteCharacterProfile: mocks.deleteCharacterProfile,
  listCharacterProfiles: mocks.listCharacterProfiles,
}));

import { useSimcProfileSelector } from './useSimcProfileSelector';

const simcInput = `# Manaia - Arcane - 2026-08-27 10:58 - EU/Turalyon
Mage="Manaia"
level=90
race=nightborne
spec=arcane
server=turalyon
region=eu
role=spell
loot_spec=arcane
${'talents=1\n'.repeat(8)}`;

describe('useSimcProfileSelector', () => {
  beforeEach(() => {
    mocks.deleteCharacterProfile.mockReset();
    mocks.listCharacterProfiles.mockReset();
  });

  it('selects SimC restored through the shared input as a recent profile', async () => {
    mocks.listCharacterProfiles.mockResolvedValue([]);
    const setSimcInput = vi.fn();

    const { result } = renderHook(() => useSimcProfileSelector({ simcInput, setSimcInput }));

    await waitFor(() => expect(result.current.selectedHistoryIdx).toBe(0));

    expect(result.current.selectedSavedId).toBeNull();
    expect(result.current.selectedProfileMeta?.combinedLabel).toBe('Manaia - Arcane Mage');
    expect(result.current.simcInputHistory).toEqual([simcInput]);
  });

  it('selects the matching saved profile when restored SimC belongs to one', async () => {
    mocks.listCharacterProfiles.mockResolvedValue([
      {
        id: 'saved-1',
        name: 'Manaia',
        realm: 'turalyon',
        region: 'eu',
        class: 'mage',
        spec: 'arcane',
        simc_input: simcInput,
        created_at: '2026-08-27T10:58:00.000Z',
      },
    ]);
    const { result } = renderHook(() =>
      useSimcProfileSelector({ simcInput, setSimcInput: vi.fn() })
    );

    await waitFor(() => expect(result.current.selectedSavedId).toBe('saved-1'));

    expect(result.current.selectedHistoryIdx).toBeNull();
    expect(result.current.selectedProfileMeta?.combinedLabel).toBe('Manaia - Arcane Mage');
  });
});
