import { describe, expect, it } from 'vitest';
import {
  normalizeClipboardTextPayload,
  splitSimcProfiles,
  validateChecksum,
} from './simc-input-utils';

describe('simc input utilities', () => {
  it('validates valid and invalid checksum blocks', () => {
    const body = 'warrior="Test"\nlevel=80\n';
    expect(validateChecksum(`${body}# Checksum: 6e0007f9`)).toBe('valid');
    expect(validateChecksum(`${body}# Checksum: deadbeef`)).toBe('invalid');
    expect(validateChecksum(body)).toBeNull();
  });

  it('splits clipboard text into recognizable SimC profiles only', () => {
    const input = [
      'warrior="One"',
      'level=80',
      '# Checksum: deadbeef',
      'not a profile',
      'mage="Two"',
      'talents=abc',
    ].join('\n');

    expect(splitSimcProfiles(input)).toEqual([
      'warrior="One"\nlevel=80\n# Checksum: deadbeef',
      'not a profile\nmage="Two"\ntalents=abc',
    ]);
  });

  it('normalizes clipboard payload variants', () => {
    expect(normalizeClipboardTextPayload('raw')).toBe('raw');
    expect(normalizeClipboardTextPayload({ text: 'wrapped' })).toBe('wrapped');
    expect(normalizeClipboardTextPayload({ text: 123 })).toBe('');
    expect(normalizeClipboardTextPayload(null)).toBe('');
  });
});
