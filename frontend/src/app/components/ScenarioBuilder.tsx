'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useSimContext } from './SimContext';
import { formatScenarioLabel } from '../lib/scenario-siblings';
import { API_URL } from '../lib/api';

export default function ScenarioBuilder() {
  const { scenarios, addScenario, removeScenario, clearScenarios } = useSimContext();
  const [maxScenarios, setMaxScenarios] = useState(0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch(`${API_URL}/api/config`, { credentials: 'include' })
      .then((r) => r.json())
      .then((data) => setMaxScenarios(data.max_scenarios ?? 10))
      .catch(() => setMaxScenarios(10))
      .finally(() => setLoaded(true));
  }, []);

  if (!loaded || maxScenarios === 0) return null;

  return (
    <div className="space-y-3 border-t border-border pt-2">
      <div className="flex items-center justify-between">
        <label className="label-text">Scenarios</label>
        {scenarios.length > 0 && (
          <button
            type="button"
            onClick={clearScenarios}
            className="text-sm text-zinc-300 transition-colors hover:text-zinc-100"
          >
            Clear all
          </button>
        )}
      </div>

      {scenarios.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {scenarios.map((s) => (
            <div
              key={s.id}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-3 py-2 text-[13px] text-zinc-200"
            >
              <span>{formatScenarioLabel(s)}</span>
              <button
                type="button"
                onClick={() => removeScenario(s.id)}
                className="ml-0.5 text-zinc-300 transition-colors hover:text-white"
              >
                <X className="h-3 w-3" strokeWidth={2} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={addScenario}
          disabled={scenarios.length >= maxScenarios}
          className="rounded-md border border-gold/40 bg-gold/15 px-3 py-1.5 text-[13px] font-semibold text-gold transition-colors hover:bg-gold/25 disabled:cursor-not-allowed disabled:border-zinc-700 disabled:bg-zinc-900 disabled:text-zinc-400"
        >
          + Add this setup
        </button>
        <p className="text-sm text-zinc-300">
          Save the current fight setup, then compare multiple scenario variants in one run.
        </p>
      </div>
    </div>
  );
}
