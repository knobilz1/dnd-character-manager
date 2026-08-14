import { describe, it, expect } from 'vitest';
import { rollMode } from './rollMode';

describe('rollMode', () => {
  it('returns the mode when only one side applies', () => {
    expect(rollMode(true, false)).toBe('advantage');
    expect(rollMode(false, true)).toBe('disadvantage');
  });

  /** PHB p.173: advantage and disadvantage never stack, and one of each cancels
   *  to a straight roll — which is the same answer as neither applying. */
  it('cancels to a straight roll when both or neither apply', () => {
    expect(rollMode(true, true)).toBeUndefined();
    expect(rollMode(false, false)).toBeUndefined();
  });
});
