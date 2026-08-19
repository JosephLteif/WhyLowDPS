import { describe, expect, it } from 'vitest';
import { pairingConsumeUrlFromValue } from './LanPairingScanner';

describe('pairingConsumeUrlFromValue', () => {
  it('converts a pairing QR URL into the one-time consume URL', () => {
    expect(
      pairingConsumeUrlFromValue('http://192.168.1.20:17384/api/lan/pair?token=abc')
    ).toBe('http://192.168.1.20:17384/api/lan/pair/consume?token=abc');
  });

  it('rejects non-pairing URLs', () => {
    expect(pairingConsumeUrlFromValue('http://192.168.1.20:17384/')).toBeNull();
  });
});
