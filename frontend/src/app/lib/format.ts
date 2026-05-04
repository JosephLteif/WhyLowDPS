export function formatBytesDecimal(
  bytes: number | undefined | null,
  options?: { empty?: string; includeBytes?: boolean; kbDigits?: number; mbDigits?: number; gbDigits?: number }
): string {
  const empty = options?.empty ?? '--';
  const value = Number(bytes ?? 0);
  if (!Number.isFinite(value) || value <= 0) return empty;
  if (options?.includeBytes && value < 1024) return `${Math.round(value)} B`;

  const kb = value / 1024;
  if (kb < 1024) return `${kb.toFixed(options?.kbDigits ?? 1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(options?.mbDigits ?? 2)} MB`;
  return `${(mb / 1024).toFixed(options?.gbDigits ?? 2)} GB`;
}

export function formatMegabytes(
  bytes: number | undefined | null,
  options?: { empty?: string; digits?: number }
): string {
  const empty = options?.empty ?? '0 MB';
  const value = Number(bytes ?? 0);
  if (!Number.isFinite(value) || value <= 0) return empty;
  const digits = Number.isFinite(options?.digits) ? Number(options?.digits) : 1;
  const mb = value / (1024 * 1024);
  return `${mb.toFixed(digits)} MB`;
}

export function formatEta(seconds?: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return '--';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}m ${secs}s`;
}

export function formatElapsedCompact(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  if (hours > 0) return `${hours}h ${mins}m ${secs}s`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

export function formatTransferSpeed(bytesPerSec?: number): string {
  if (!bytesPerSec || !Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return '--';
  const kb = bytesPerSec / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB/s`;
  return `${(kb / 1024).toFixed(2)} MB/s`;
}
