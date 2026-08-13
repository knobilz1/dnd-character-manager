import { describe, it, expect } from 'vitest';
import { parseDamageDice, formatDamageDice } from './damageDice';

describe('parseDamageDice', () => {
  /** The bug this parser exists to fix: the old helper kept only the die SIZE,
   *  so a greatsword button labelled "2d6+3" rolled a single d6. If this test
   *  ever reads `count: 1` for "2d6" again, the table is getting wrong numbers. */
  it('keeps the dice count, not just the die size', () => {
    expect(parseDamageDice('2d6')).toEqual({ count: 2, sides: 6 });
    expect(parseDamageDice('1d8')).toEqual({ count: 1, sides: 8 });
    expect(parseDamageDice('4d10')).toEqual({ count: 4, sides: 10 });
  });

  it('treats a bare die as one die', () => {
    expect(parseDamageDice('d4')).toEqual({ count: 1, sides: 4 });
  });

  it('ignores trailing modifiers and damage type', () => {
    expect(parseDamageDice('1d12 slashing')).toEqual({ count: 1, sides: 12 });
    expect(parseDamageDice('2d6+3')).toEqual({ count: 2, sides: 6 });
  });

  it('returns null for the sheet placeholder and for unrollable dice', () => {
    expect(parseDamageDice('—')).toBeNull();
    expect(parseDamageDice('')).toBeNull();
    expect(parseDamageDice('special')).toBeNull();
    // No d3/d7 face exists in the roller — better no button than a wrong roll.
    expect(parseDamageDice('1d3')).toBeNull();
    expect(parseDamageDice('1d7')).toBeNull();
  });

  it('rejects absurd counts rather than locking up the roller', () => {
    expect(parseDamageDice('0d6')).toBeNull();
    expect(parseDamageDice('9999d6')).toBeNull();
  });

  it('round-trips through formatDamageDice', () => {
    for (const s of ['1d8', '2d6', '4d10', 'd4']) {
      const parsed = parseDamageDice(s)!;
      expect(parseDamageDice(formatDamageDice(parsed))).toEqual(parsed);
    }
  });
});
