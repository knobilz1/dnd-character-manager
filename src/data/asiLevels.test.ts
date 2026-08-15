import { describe, it, expect } from 'vitest';
import { asiLevelsFor, asiSlotsAt, ASI_LEVELS } from './mechanics';
import { ALL_CLASSES } from './classes';

/**
 * ASI_LEVELS is keyed by base class id. Three places indexed it with the raw class id,
 * and two of them got `undefined` for every PHB 2024 class: the creator's Feats step
 * told a level-20 2024 fighter they had no ASI slots yet, and the draft sanitizer
 * trimmed their feats to zero on the way past. Nothing in the app may index the map
 * directly any more — everything goes through these two helpers.
 */
describe('asiLevelsFor', () => {
  it('gives every class in the registry a ladder — both editions', () => {
    const missing = ALL_CLASSES.filter((c) => asiLevelsFor(c.id).length === 0).map((c) => c.id);
    expect(missing).toEqual([]);
  });

  it('resolves 2024 ids to their base ladder', () => {
    expect(asiLevelsFor('fighter-2024')).toEqual(ASI_LEVELS.fighter);
    expect(asiLevelsFor('rogue-2024')).toEqual(ASI_LEVELS.rogue);
    expect(asiLevelsFor('wizard-2024')).toEqual(ASI_LEVELS.wizard);
  });

  it('keeps the fighter and rogue exceptions to the 4/8/12/16/19 pattern', () => {
    expect(asiLevelsFor('fighter')).toEqual([4, 6, 8, 12, 14, 16, 19]);
    expect(asiLevelsFor('rogue')).toEqual([4, 8, 10, 12, 16, 19]);
  });

  it('returns an empty ladder for something that is not a class', () => {
    expect(asiLevelsFor('not-a-class')).toEqual([]);
    expect(asiSlotsAt('not-a-class', 20)).toBe(0);
  });
});

describe('asiSlotsAt', () => {
  it('counts the slots earned by a given level', () => {
    expect(asiSlotsAt('wizard', 1)).toBe(0);
    expect(asiSlotsAt('wizard', 4)).toBe(1);
    expect(asiSlotsAt('wizard', 12)).toBe(3);
    expect(asiSlotsAt('fighter', 6)).toBe(2); // 4 and 6
  });

  /** The reported bug, stated as a test: a 2024 character must earn feats. */
  it('gives a 2024 class the same slots as its 2014 twin, at every level', () => {
    for (let level = 1; level <= 20; level++) {
      for (const base of ['fighter', 'rogue', 'wizard', 'barbarian', 'paladin']) {
        expect(asiSlotsAt(`${base}-2024`, level), `${base}-2024 at ${level}`)
          .toBe(asiSlotsAt(base, level));
      }
    }
    expect(asiSlotsAt('fighter-2024', 6)).toBe(2); // not 0, which is what the creator saw
  });
});
