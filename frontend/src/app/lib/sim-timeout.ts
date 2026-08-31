export const DEFAULT_SIM_TIMEOUT_SECONDS = 2 * 60 * 60;
export const DEFAULT_SIM_IDLE_TIMEOUT_SECONDS = 10 * 60;

export const MIN_SIM_TIMEOUT_SECONDS = 15 * 60;
export const MAX_SIM_TIMEOUT_SECONDS = 24 * 60 * 60;
export const MIN_SIM_IDLE_TIMEOUT_SECONDS = 60;
export const MAX_SIM_IDLE_TIMEOUT_SECONDS = 60 * 60;

export function clampSimTimeoutSeconds(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SIM_TIMEOUT_SECONDS;
  return Math.min(MAX_SIM_TIMEOUT_SECONDS, Math.max(MIN_SIM_TIMEOUT_SECONDS, Math.round(value)));
}

export function clampSimIdleTimeoutSeconds(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SIM_IDLE_TIMEOUT_SECONDS;
  return Math.min(
    MAX_SIM_IDLE_TIMEOUT_SECONDS,
    Math.max(MIN_SIM_IDLE_TIMEOUT_SECONDS, Math.round(value))
  );
}
