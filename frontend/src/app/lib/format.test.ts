import { describe, expect, it } from 'vitest';
import {
  formatBytesDecimal,
  formatElapsedCompact,
  formatEta,
  formatMegabytes,
  formatTransferSpeed,
} from './format';

describe('format helpers', () => {
  it('formats byte values with explicit empty and byte handling', () => {
    expect(formatBytesDecimal(null)).toBe('--');
    expect(formatBytesDecimal(Number.NaN, { empty: 'n/a' })).toBe('n/a');
    expect(formatBytesDecimal(512, { includeBytes: true })).toBe('512 B');
    expect(formatBytesDecimal(1536)).toBe('1.5 KB');
    expect(formatBytesDecimal(5 * 1024 * 1024)).toBe('5.00 MB');
    expect(formatBytesDecimal(3 * 1024 * 1024 * 1024, { gbDigits: 1 })).toBe('3.0 GB');
  });

  it('formats megabytes, eta, elapsed time, and transfer speed', () => {
    expect(formatMegabytes(undefined)).toBe('0 MB');
    expect(formatMegabytes(2.5 * 1024 * 1024, { digits: 2 })).toBe('2.50 MB');
    expect(formatEta(0)).toBe('--');
    expect(formatEta(75)).toBe('1m 15s');
    expect(formatElapsedCompact(3661.9)).toBe('1h 1m 1s');
    expect(formatTransferSpeed(1536)).toBe('1.5 KB/s');
    expect(formatTransferSpeed(3 * 1024 * 1024)).toBe('3.00 MB/s');
  });
});

