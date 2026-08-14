import { describe, it, expect } from 'vitest';
import { describeRollForDM } from './DiceRoller';

/**
 * Rider dice — Bless and Guidance (+1d4), Bardic Inspiration (+1d6..1d12), and on
 * the damage side Hex, Hunter's Mark and Divine Favor. All the same mechanic: a
 * second die added to the roll's total.
 *
 * The line this builds is what the DM sees. A total here that disagrees with the
 * one on the player's screen is worse than no message at all — the table acts on
 * the DM's number, so the two must never drift.
 */

const base = { die: 20 as const, label: 'Athletics Check', mode: 'normal' as const, two: null };

describe('the roll line sent to the DM', () => {
  it('reports a plain roll unchanged', () => {
    expect(describeRollForDM({ ...base, modifier: 5, result: 13 }))
      .toBe('Athletics Check: d20 → 13 + 5 = 18');
  });

  it('adds a rider to the total and names the die it came from', () => {
    expect(describeRollForDM({ ...base, modifier: 5, result: 13, rider: { die: 4, value: 3 } }))
      .toBe('Athletics Check: d20 → 13 + 5 + 3 (1d4) = 21');
  });

  /** A manual click carries no modifier. The rider still has to produce a total,
   *  or the DM reads the bare die and is short by the rider. */
  it('produces a total from a rider alone, with no modifier', () => {
    expect(describeRollForDM({ ...base, label: null, modifier: null, result: 13, rider: { die: 4, value: 2 } }))
      .toBe('Rolled d20 → 13 + 2 (1d4) = 15');
  });

  it('leaves an unmodified, unridden roll with no total at all', () => {
    expect(describeRollForDM({ ...base, label: null, modifier: null, result: 13 }))
      .toBe('Rolled d20 → 13');
  });

  /** Bless applies to attack rolls, which is exactly where advantage shows up. */
  it('keeps both dice visible when a rider lands on an advantage roll', () => {
    expect(describeRollForDM({
      ...base, label: 'Longsword Attack', mode: 'advantage', modifier: 7, result: 18,
      two: { v1: 11, v2: 18, winner: 2 }, rider: { die: 4, value: 4 },
    })).toBe('Longsword Attack: d20 (advantage) — rolled 11 and 18, took 18 + 7 + 4 (1d4) = 29');
  });

  /** Hex and Hunter's Mark ride damage, which is the only multi-die roll here. */
  it('rides a damage roll', () => {
    expect(describeRollForDM({
      ...base, die: 6, count: 2, label: 'Greatsword Damage', modifier: 3, result: 8,
      rider: { die: 6, value: 5 },
    })).toBe('Greatsword Damage: 2d6 → 8 + 3 + 5 (1d6) = 16');
  });

  it('treats an absent rider the same as an explicitly null one', () => {
    const withNull = describeRollForDM({ ...base, modifier: 2, result: 9, rider: null });
    const without = describeRollForDM({ ...base, modifier: 2, result: 9 });
    expect(withNull).toBe(without);
  });

  /** A negative modifier plus a rider is the fiddliest arithmetic on this line. */
  it('gets the total right when the modifier is negative', () => {
    expect(describeRollForDM({ ...base, modifier: -1, result: 10, rider: { die: 4, value: 3 } }))
      .toBe('Athletics Check: d20 → 10 + -1 + 3 (1d4) = 12');
  });
});
