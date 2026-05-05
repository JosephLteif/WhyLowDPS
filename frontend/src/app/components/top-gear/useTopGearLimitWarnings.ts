import { useCallback, useState } from 'react';

export function useTopGearLimitWarnings() {
  const [limitWarningOrder, setLimitWarningOrder] = useState<string[]>([]);
  const [knownEmbellishedUids, setKnownEmbellishedUids] = useState<Set<string>>(() => new Set());
  const [immediateLimitWarningUids, setImmediateLimitWarningUids] = useState<Set<string>>(() => new Set());
  const [confirmedLimitWarningUids, setConfirmedLimitWarningUids] = useState<Set<string>>(() => new Set());

  const rememberLimitWarningCandidate = useCallback((uid: string | null, embellished = false) => {
    if (!uid) return;
    setLimitWarningOrder((prev) => [...prev.filter((existing) => existing !== uid), uid]);
    if (embellished) {
      setKnownEmbellishedUids((prev) => {
        if (prev.has(uid)) return prev;
        const next = new Set(prev);
        next.add(uid);
        return next;
      });
    }
  }, []);

  const forgetLimitWarningCandidate = useCallback((uid: string | null) => {
    if (!uid) return;
    setLimitWarningOrder((prev) => prev.filter((existing) => existing !== uid));
    setKnownEmbellishedUids((prev) => {
      if (!prev.has(uid)) return prev;
      const next = new Set(prev);
      next.delete(uid);
      return next;
    });
    setConfirmedLimitWarningUids((prev) => {
      if (!prev.has(uid)) return prev;
      const next = new Set(prev);
      next.delete(uid);
      return next;
    });
  }, []);

  return {
    limitWarningOrder,
    knownEmbellishedUids,
    immediateLimitWarningUids,
    confirmedLimitWarningUids,
    setLimitWarningOrder,
    setKnownEmbellishedUids,
    setImmediateLimitWarningUids,
    setConfirmedLimitWarningUids,
    rememberLimitWarningCandidate,
    forgetLimitWarningCandidate,
  };
}
