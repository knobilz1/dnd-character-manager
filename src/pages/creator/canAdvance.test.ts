import { describe, it, expect } from 'vitest';
import { canAdvance } from './CreatorPage';

const assigned = { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 };

describe('canAdvance: ability-scores', () => {
  /** The actual bug: rolling zeroes all six so the player can assign the rolled
   *  values, and the old check was `!!draft.baseAbilityScores` — always true,
   *  since INITIAL_DRAFT seeds the object. A player who rolled and forgot to
   *  assign could walk to the end and create a character with 0 in every stat. */
  it('blocks a rolled-but-unassigned spread', () => {
    expect(canAdvance('ability-scores', {
      baseAbilityScores: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
    })).toBe(false);
  });

  it('blocks a partially assigned spread', () => {
    expect(canAdvance('ability-scores', {
      baseAbilityScores: { ...assigned, cha: 0 },
    })).toBe(false);
  });

  it('allows a fully assigned spread', () => {
    expect(canAdvance('ability-scores', { baseAbilityScores: assigned })).toBe(true);
  });

  /** 4d6-drop-lowest bottoms out at 3 and point buy at 8, so the floor must never
   *  reject a legal roll — only genuinely unassigned zeros. */
  it('allows the worst legal roll', () => {
    expect(canAdvance('ability-scores', {
      baseAbilityScores: { str: 3, dex: 3, con: 3, int: 3, wis: 3, cha: 3 },
    })).toBe(true);
  });

  it('blocks a missing or short scores object', () => {
    expect(canAdvance('ability-scores', {})).toBe(false);
    expect(canAdvance('ability-scores', { baseAbilityScores: { str: 15, dex: 14 } })).toBe(false);
  });
});

describe('canAdvance: other gates still behave', () => {
  it('books needs at least one enabled book', () => {
    expect(canAdvance('books', { enabledBooks: [] })).toBe(false);
    expect(canAdvance('books', { enabledBooks: ['PHB'] })).toBe(true);
  });

  it('class needs a class at level 1 or higher', () => {
    expect(canAdvance('class', { classes: [] })).toBe(false);
    expect(canAdvance('class', { classes: [{ classId: 'bard', level: 0 }] })).toBe(false);
    expect(canAdvance('class', { classes: [{ classId: 'bard', level: 1 }] })).toBe(true);
  });

  it('review needs a non-blank name', () => {
    expect(canAdvance('review', { name: '   ' })).toBe(false);
    expect(canAdvance('review', { name: 'Mira' })).toBe(true);
  });
});
