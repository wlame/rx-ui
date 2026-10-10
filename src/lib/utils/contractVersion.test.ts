import { describe, expect, it } from 'vitest';

import { checkContractVersion, SUPPORTED_CONTRACT_MAJOR } from './contractVersion';

describe('checkContractVersion', () => {
  it('accepts the contract major this viewer was built against', () => {
    expect(checkContractVersion(`${SUPPORTED_CONTRACT_MAJOR}.0`)).toEqual({
      kind: 'ok',
      major: SUPPORTED_CONTRACT_MAJOR,
      minor: 0,
    });
  });

  it('accepts a higher minor, because additive changes do not break a client', () => {
    expect(checkContractVersion(`${SUPPORTED_CONTRACT_MAJOR}.7`)).toEqual({
      kind: 'ok',
      major: SUPPORTED_CONTRACT_MAJOR,
      minor: 7,
    });
  });

  it('refuses a newer major and says to update the viewer', () => {
    const result = checkContractVersion(`${SUPPORTED_CONTRACT_MAJOR + 1}.0`);

    expect(result.kind).toBe('incompatible');
    if (result.kind !== 'incompatible') return;
    expect(result.message).toContain('Update the viewer');
  });

  it('refuses an older major and says to update the backend', () => {
    const result = checkContractVersion('0.9');

    expect(result.kind).toBe('incompatible');
    if (result.kind !== 'incompatible') return;
    expect(result.message).toContain('Update the backend');
  });

  it('accepts a backend at contract 2.0', () => {
    expect(checkContractVersion('2.0')).toEqual({ kind: 'ok', major: 2, minor: 0 });
  });

  // Contract 2 removed the index analysis and its routes; a contract 1
  // backend (rx-python, rx-go before 0.8.0) would be misread.
  it('refuses a backend at 1.7 with the message that names both versions', () => {
    expect(checkContractVersion('1.7')).toEqual({
      kind: 'incompatible',
      major: 1,
      minor: 7,
      message:
        'This viewer speaks rx API contract 2.x, but the backend reports 1.7. ' +
        'Update the backend, or use a viewer release from its era.',
    });
  });

  it('treats a missing version as unknown, not incompatible', () => {
    // Nothing is known about such a backend's contract, as when /health
    // cannot be read; the viewer proceeds rather than block on a guess.
    expect(checkContractVersion(undefined)).toEqual({ kind: 'unknown' });
    expect(checkContractVersion(null)).toEqual({ kind: 'unknown' });
    expect(checkContractVersion('')).toEqual({ kind: 'unknown' });
  });

  it('treats an unparseable version as unknown', () => {
    for (const bad of ['1', '1.2.3', 'v1.0', 'one.zero', '1.x']) {
      expect(checkContractVersion(bad)).toEqual({ kind: 'unknown' });
    }
  });

  it('tolerates surrounding whitespace', () => {
    expect(checkContractVersion(` ${SUPPORTED_CONTRACT_MAJOR}.2 `).kind).toBe('ok');
  });
});
