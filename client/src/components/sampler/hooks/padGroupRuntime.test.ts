import { describe, expect, it } from 'vitest';
import { normalizePadGroupValue, resolvePadGroupStopMode, shouldStopPadForGroup } from './padGroupRuntime';

describe('padGroupRuntime', () => {
  it('normalizes only positive whole-number groups', () => {
    expect(normalizePadGroupValue(undefined)).toBeNull();
    expect(normalizePadGroupValue(0)).toBeNull();
    expect(normalizePadGroupValue(-4)).toBeNull();
    expect(normalizePadGroupValue(3.9)).toBe(3);
  });

  it('stops only same-bank pads for local groups', () => {
    const target = { bankId: 'bank-a', padGroup: 2, padGroupUniversal: false };
    expect(
      shouldStopPadForGroup('pad-1', target, 'pad-2', { bankId: 'bank-a', padGroup: 2, padGroupUniversal: false })
    ).toBe(true);
    expect(
      shouldStopPadForGroup('pad-1', target, 'pad-3', { bankId: 'bank-b', padGroup: 2, padGroupUniversal: false })
    ).toBe(false);
  });

  it('stops cross-bank pads when the target group is universal', () => {
    const target = { bankId: 'bank-a', padGroup: 7, padGroupUniversal: true };
    expect(
      shouldStopPadForGroup('pad-1', target, 'pad-2', { bankId: 'bank-b', padGroup: 7, padGroupUniversal: false })
    ).toBe(true);
    expect(
      shouldStopPadForGroup('pad-1', target, 'pad-1', { bankId: 'bank-a', padGroup: 7, padGroupUniversal: true })
    ).toBe(false);
  });

  it('normalizes group stop mode to supported stop effects only', () => {
    expect(resolvePadGroupStopMode('fadeout')).toBe('fadeout');
    expect(resolvePadGroupStopMode('filter')).toBe('filter');
    expect(resolvePadGroupStopMode('unsupported')).toBe('instant');
    expect(resolvePadGroupStopMode(undefined)).toBe('instant');
  });
});
