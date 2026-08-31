export interface TrackedSimulation {
  id: string;
  simType?: string;
  playerName?: string;
}

export const SIMULATION_TRACKED_EVENT = 'whylowdps-simulation-tracked';

const ACTIVE_SIMULATIONS_STORAGE_KEY = 'whylowdps_active_simulations';

function normalizeSimulations(sims: TrackedSimulation[]): TrackedSimulation[] {
  const merged = new Map<string, TrackedSimulation>();
  sims.forEach((sim) => {
    const id = sim.id.trim();
    if (!id) return;
    const previous = merged.get(id);
    merged.set(id, {
      ...previous,
      ...sim,
      id,
      ...(sim.simType ? { simType: sim.simType } : {}),
      ...(sim.playerName ? { playerName: sim.playerName } : {}),
    });
  });
  return [...merged.values()];
}

export function loadTrackedSimulations(): TrackedSimulation[] {
  if (typeof window === 'undefined') return [];

  try {
    const stored = JSON.parse(
      window.sessionStorage.getItem(ACTIVE_SIMULATIONS_STORAGE_KEY) || 'null'
    );
    if (!Array.isArray(stored)) return [];
    return normalizeSimulations(
      stored.filter(
        (sim): sim is TrackedSimulation =>
          sim && typeof sim === 'object' && typeof sim.id === 'string'
      )
    );
  } catch {
    return [];
  }
}

function saveTrackedSimulations(sims: TrackedSimulation[]): void {
  try {
    window.sessionStorage.setItem(ACTIVE_SIMULATIONS_STORAGE_KEY, JSON.stringify(sims));
  } catch {
    // Tracking remains available in memory when session storage is unavailable.
  }
}

export function trackSimulations(sims: TrackedSimulation[]): void {
  if (typeof window === 'undefined' || sims.length === 0) return;

  const tracked = normalizeSimulations([...loadTrackedSimulations(), ...sims]);
  saveTrackedSimulations(tracked);
  window.dispatchEvent(
    new CustomEvent<TrackedSimulation[]>(SIMULATION_TRACKED_EVENT, { detail: sims })
  );
}

export function saveTrackedSimulationState(sims: TrackedSimulation[]): void {
  if (typeof window === 'undefined') return;
  saveTrackedSimulations(normalizeSimulations(sims));
}
