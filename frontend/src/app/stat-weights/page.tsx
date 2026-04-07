'use client';

import { useCallback } from 'react';
import ErrorAlert from '../components/ErrorAlert';
import { useSimContext } from '../components/SimContext';
import { useSimSubmit } from '../lib/useSimSubmit';

export default function StatWeightsPage() {
  const { simcInput } = useSimContext();

  const buildPayload = useCallback(
    () => ({
      simc_input: simcInput,
      sim_type: 'stat_weights',
    }),
    [simcInput]
  );

  const validate = useCallback(() => {
    if (simcInput.trim().length < 10) {
      return 'SimC input is too short. Paste your full addon export.';
    }
    return null;
  }, [simcInput]);

  const { submit, submitting, error, buttonLabel } = useSimSubmit({
    endpoint: '/api/sim',
    buildPayload,
    validate,
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-1">
         <h2 className="text-xl font-bold tracking-tight text-zinc-100">Stat Weights</h2>
         <p className="text-sm text-zinc-400">
           Calculates the marginal DPS value of 1 point of Haste, Crit, Mastery, and Versatility.
         </p>
      </div>
      
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="space-y-6"
      >
        <ErrorAlert message={error} />

        <button
          type="submit"
          disabled={submitting || simcInput.trim().length < 10}
          className="btn-primary w-full py-3 text-sm"
        >
          {submitting ? 'Running…' : buttonLabel('Run Stat Weights Simulation')}
        </button>
      </form>
    </div>
  );
}
