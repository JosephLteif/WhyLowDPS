'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import ErrorAlert from '../components/ErrorAlert';
import { useSimContext } from '../components/SimContext';
import { useSimSubmit } from '../lib/useSimSubmit';

export default function QuickSimPage() {
  const { simcInput } = useSimContext();
  const inlineSubmitRef = useRef<HTMLDivElement | null>(null);
  const [showFloatingSubmit, setShowFloatingSubmit] = useState(false);
  const canSubmit = simcInput.trim().length >= 10;

  const buildPayload = useCallback(
    () => ({
      simc_input: simcInput,
      sim_type: 'quick',
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

  useEffect(() => {
    const inlineSubmit = inlineSubmitRef.current;
    if (!inlineSubmit) return;

    let inlineVisible = false;
    let hasScrolled = window.scrollY > 80;

    const sync = () => {
      setShowFloatingSubmit(hasScrolled && !inlineVisible && canSubmit);
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        inlineVisible = entry?.isIntersecting ?? false;
        sync();
      },
      { threshold: 0.1 }
    );

    const onScroll = () => {
      hasScrolled = window.scrollY > 80;
      sync();
    };

    observer.observe(inlineSubmit);
    window.addEventListener('scroll', onScroll, { passive: true });
    sync();

    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', onScroll);
    };
  }, [canSubmit]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="space-y-6 pb-6"
    >
      <ErrorAlert message={error} />

      {showFloatingSubmit ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 ml-[var(--sidebar-width)] px-3 pb-4 pt-6 transition-[margin-left] duration-200 md:px-4 xl:px-10 2xl:px-16">
          <div
            className="mx-auto w-full min-w-0"
            style={{
              maxWidth: 'min(2200px, calc(100vw - var(--sidebar-width) - 1.5rem))',
            }}
          >
            <div className="pointer-events-auto bg-gradient-to-t from-[#111] via-[#111] to-transparent pt-6">
              <button
                type="submit"
                disabled={submitting || !canSubmit}
                className="btn-primary w-full py-3 text-sm"
              >
                {submitting ? 'Running...' : buttonLabel('Run Simulation')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div ref={inlineSubmitRef}>
        <button
          type="submit"
          disabled={submitting || !canSubmit}
          className="btn-primary w-full py-3 text-sm"
        >
          {submitting ? 'Running...' : buttonLabel('Run Simulation')}
        </button>
      </div>
    </form>
  );
}
