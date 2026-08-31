export const SIMULATION_PERFORMANCE_PRESETS = [
  {
    label: 'Balanced',
    pct: 0.3,
    description: 'Use 30% of available CPU threads.',
  },
  {
    label: 'Performance',
    pct: 0.6,
    description: 'Use 60% of available CPU threads.',
  },
  {
    label: 'Maximum',
    pct: 0.9,
    description: 'Use 90% of available CPU threads.',
  },
] as const;

export function getPresetThreads(maxThreads: number, pct: number): number {
  return Math.max(1, Math.round(maxThreads * pct));
}
