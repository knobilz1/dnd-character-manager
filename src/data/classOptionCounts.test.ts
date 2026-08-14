import { describe, it, expect } from 'vitest';
import {
  warlockInvocationsKnown,
  sorcererMetamagicKnown,
  battleMasterManeuversKnown,
  artificerInfusionsKnown,
} from './mechanics';

/**
 * These four counts were written out twice — creator and level-up — and the
 * copies disagreed, so the numbers themselves are the thing worth pinning.
 * Every expectation below is transcribed from a class table, not from the
 * previous implementation, which is how the drift went unnoticed.
 */

describe('warlock invocations known', () => {
  // 2024 PHB Warlock features table, Invocations column, levels 1-20.
  const TABLE_2024 = [1, 3, 3, 3, 5, 5, 6, 6, 7, 7, 7, 8, 8, 8, 9, 9, 9, 10, 10, 10];
  it('matches the 2024 table at every level', () => {
    expect(TABLE_2024.map((_, i) => warlockInvocationsKnown('warlock-2024', i + 1))).toEqual(TABLE_2024);
  });

  // 2014 PHB: none until 2, then 2/3/4/5/6/7/8 at 2/5/7/9/12/15/18.
  const TABLE_2014 = [0, 2, 2, 2, 3, 3, 4, 4, 5, 5, 5, 6, 6, 6, 7, 7, 7, 8, 8, 8];
  it('matches the 2014 table at every level', () => {
    expect(TABLE_2014.map((_, i) => warlockInvocationsKnown('warlock', i + 1))).toEqual(TABLE_2014);
  });

  /** The bug: a 2024 warlock is a caster with an invocation from level 1, and
   *  the creator was giving it none because it used the 2014 ladder. */
  it('gives a 2024 warlock an invocation at level 1, unlike 2014', () => {
    expect(warlockInvocationsKnown('warlock-2024', 1)).toBe(1);
    expect(warlockInvocationsKnown('warlock', 1)).toBe(0);
  });
});

describe('sorcerer metamagic known', () => {
  /** 2024 PHB, Sorcerer level 2: "Gain 2 options ... Gain 2 more at level 10,
   *  2 more at level 17" — 2/4/6. Both old copies had the 2014 counts (2/3/4),
   *  leaving a level-20 2024 sorcerer two metamagics short. */
  it('grants two at a time in 2024', () => {
    expect(sorcererMetamagicKnown('sorcerer-2024', 1)).toBe(0);
    expect(sorcererMetamagicKnown('sorcerer-2024', 2)).toBe(2);
    expect(sorcererMetamagicKnown('sorcerer-2024', 9)).toBe(2);
    expect(sorcererMetamagicKnown('sorcerer-2024', 10)).toBe(4);
    expect(sorcererMetamagicKnown('sorcerer-2024', 16)).toBe(4);
    expect(sorcererMetamagicKnown('sorcerer-2024', 17)).toBe(6);
    expect(sorcererMetamagicKnown('sorcerer-2024', 20)).toBe(6);
  });

  it('grants one at a time from level 3 in 2014', () => {
    expect(sorcererMetamagicKnown('sorcerer', 2)).toBe(0);
    expect(sorcererMetamagicKnown('sorcerer', 3)).toBe(2);
    expect(sorcererMetamagicKnown('sorcerer', 10)).toBe(3);
    expect(sorcererMetamagicKnown('sorcerer', 17)).toBe(4);
    expect(sorcererMetamagicKnown('sorcerer', 20)).toBe(4);
  });
});

describe('battle master maneuvers known', () => {
  /** 2024: "Learn 3 maneuvers; add 2 more at levels 7, 10, 15" — same as 2014,
   *  which is why this one is not edition-keyed. */
  it('is 3/5/7/9 at 3/7/10/15', () => {
    expect([3, 7, 10, 15].map(battleMasterManeuversKnown)).toEqual([3, 5, 7, 9]);
  });

  /** Must be 0 below 3: the grant is a delta, so a non-zero answer here makes
   *  level 3 compute 3 − 3 = 0 and the first three maneuvers never appear. */
  it('is zero before the subclass exists', () => {
    expect(battleMasterManeuversKnown(1)).toBe(0);
    expect(battleMasterManeuversKnown(2)).toBe(0);
  });
});

describe('artificer infusions known', () => {
  it('is 0 below 2, then 4/6/8/10/12', () => {
    expect([1, 2, 6, 10, 14, 18].map(artificerInfusionsKnown)).toEqual([0, 4, 6, 8, 10, 12]);
  });
});

/** The whole point of moving these into mechanics.ts: one answer per question. */
describe('counts never decrease with level', () => {
  const fns = [
    ['warlock-2024', warlockInvocationsKnown],
    ['warlock', warlockInvocationsKnown],
    ['sorcerer-2024', sorcererMetamagicKnown],
    ['sorcerer', sorcererMetamagicKnown],
  ] as const;
  it.each(fns)('%s', (classId, fn) => {
    for (let lv = 2; lv <= 20; lv++) {
      expect(fn(classId, lv)).toBeGreaterThanOrEqual(fn(classId, lv - 1));
    }
  });
});
