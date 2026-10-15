import { describe, expect, it } from 'vitest';
import { notTextNotice } from './notTextNotice';

describe('notTextNotice', () => {
  it('gives the reason of the backend after the file name', () => {
    expect(notTextNotice('core.bin', 'not a text file: a NUL byte in its first 8 KiB')).toBe(
      'Cannot open core.bin: not a text file: a NUL byte in its first 8 KiB',
    );
  });

  it.each([null, undefined, ''])('calls the file binary for the reason %j', (reason) => {
    expect(notTextNotice('core.bin', reason)).toBe('Cannot open binary file: core.bin');
  });
});
