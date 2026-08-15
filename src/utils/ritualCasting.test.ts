import { describe, it, expect } from 'vitest';
import { canRitualCast } from './ritualCasting';
import type { Character } from '../types';

/**
 * The Ritual button was shown for any ritual-tagged spell, to anyone. A 2014 sorcerer
 * has no Ritual Casting feature at all, and a cleric must have the spell prepared —
 * only a wizard reads rituals straight out of the book.
 */
const c = (classId: string, extra: Partial<Character> = {}): Character => ({
  classes: [{ classId, level: 5, hitPointsRolled: [] }],
  selectedFeats: [],
  ...extra,
} as unknown as Character);

describe('who has ritual casting at all', () => {
  it.each(['bard', 'cleric', 'druid', 'wizard', 'artificer'])('%s does', (id) => {
    expect(canRitualCast(c(id), true)).toBe(true);
  });

  it.each(['sorcerer', 'paladin', 'ranger', 'warlock', 'fighter', 'rogue', 'barbarian', 'monk'])(
    '%s does not', (id) => {
      expect(canRitualCast(c(id), true)).toBe(false);
    });

  it('recognises the 2024 class ids too', () => {
    expect(canRitualCast(c('wizard-2024'), true)).toBe(true);
    expect(canRitualCast(c('cleric-2024'), true)).toBe(true);
    expect(canRitualCast(c('sorcerer-2024'), true)).toBe(false);
  });
});

describe('preparation', () => {
  it('a cleric must have the spell prepared', () => {
    expect(canRitualCast(c('cleric'), true)).toBe(true);
    expect(canRitualCast(c('cleric'), false)).toBe(false);
  });

  it('a wizard rituals from the spellbook, prepared or not', () => {
    expect(canRitualCast(c('wizard'), false)).toBe(true);
  });

  it('a wizard multiclass keeps the spellbook exemption', () => {
    const gish = {
      classes: [
        { classId: 'fighter', level: 3, hitPointsRolled: [] },
        { classId: 'wizard', level: 2, hitPointsRolled: [] },
      ],
      selectedFeats: [],
    } as unknown as Character;
    expect(canRitualCast(gish, false)).toBe(true);
  });
});

describe('grants from outside the class', () => {
  it('the Ritual Caster feat gives it to anyone, from its own book', () => {
    expect(canRitualCast(c('fighter', { selectedFeats: ['ritual-caster'] }), false)).toBe(true);
    expect(canRitualCast(c('fighter', { selectedFeats: ['ritual-caster-2024'] }), false)).toBe(true);
  });

  it("Book of Ancient Secrets gives it to a warlock", () => {
    const tome = c('warlock', {
      classOptions: { fightingStyles: [], invocations: ['book-of-ancient-secrets'], metamagic: [], maneuvers: [], infusions: [], optionalFeatures: [] },
    } as Partial<Character>);
    expect(canRitualCast(tome, false)).toBe(true);
    // …and a warlock without it still has nothing.
    expect(canRitualCast(c('warlock'), true)).toBe(false);
  });
});
