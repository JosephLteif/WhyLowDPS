'use client';

import { useEffect, useMemo, useState } from 'react';

type SimulationPreset = {
  id: string;
  name: string;
  simcInput: string;
};

const STORAGE_KEY = 'whylowdps_simulation_presets_v1';

function readPresets(): SimulationPreset[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (value): value is SimulationPreset =>
        value && typeof value.id === 'string' && typeof value.name === 'string' && typeof value.simcInput === 'string'
    );
  } catch {
    return [];
  }
}

function writePresets(presets: SimulationPreset[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // Ignore unavailable browser storage.
  }
}

export default function SimulationPresetBar({
  simcInput,
  setSimcInput,
}: {
  simcInput: string;
  setSimcInput: (value: string) => void;
}) {
  const [presets, setPresets] = useState<SimulationPreset[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [name, setName] = useState('');

  useEffect(() => setPresets(readPresets()), []);

  const selectedPreset = useMemo(
    () => presets.find((preset) => preset.id === selectedId) || null,
    [presets, selectedId]
  );

  const savePreset = () => {
    const trimmedName = name.trim();
    if (!trimmedName || !simcInput.trim()) return;
    const next: SimulationPreset = {
      id: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}`,
      name: trimmedName,
      simcInput,
    };
    const nextPresets = [next, ...presets.filter((preset) => preset.name.toLowerCase() !== trimmedName.toLowerCase())];
    setPresets(nextPresets);
    writePresets(nextPresets);
    setSelectedId(next.id);
    setName('');
  };

  const loadPreset = (id: string) => {
    setSelectedId(id);
    const preset = presets.find((item) => item.id === id);
    if (preset) setSimcInput(preset.simcInput);
  };

  const deletePreset = () => {
    if (!selectedPreset) return;
    const nextPresets = presets.filter((preset) => preset.id !== selectedPreset.id);
    setPresets(nextPresets);
    writePresets(nextPresets);
    setSelectedId('');
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-surface-2/50 px-3 py-2">
      <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-500">Presets</span>
      <select
        value={selectedId}
        onChange={(event) => loadPreset(event.target.value)}
        className="min-w-40 flex-1 rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-zinc-200 focus:border-gold/50 focus:outline-none"
        aria-label="Saved simulation preset"
      >
        <option value="">Choose a saved setup</option>
        {presets.map((preset) => (
          <option key={preset.id} value={preset.id}>
            {preset.name}
          </option>
        ))}
      </select>
      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') savePreset();
        }}
        placeholder="Preset name"
        className="min-w-32 flex-1 rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-500 focus:border-gold/50 focus:outline-none"
        aria-label="New simulation preset name"
      />
      <button
        type="button"
        onClick={savePreset}
        disabled={!name.trim() || !simcInput.trim()}
        className="rounded-md border border-gold/30 bg-gold/10 px-2.5 py-1.5 text-xs font-semibold text-gold hover:bg-gold/20 disabled:opacity-40"
      >
        Save
      </button>
      {selectedPreset && (
        <button
          type="button"
          onClick={deletePreset}
          className="rounded-md border border-red-500/25 px-2.5 py-1.5 text-xs font-semibold text-red-300 hover:bg-red-500/10"
        >
          Delete
        </button>
      )}
    </div>
  );
}
