import { describe, it, expect, beforeEach } from 'vitest';
import { useCharacterStore } from './useCharacterStore';
import { computeCharacterDerived } from '../hooks/useCharacterDerived';
import type { Character } from '../types';

/**
 * `load()` is this app's schema migration — every character reaches the sheet
 * through it, from the creator, a JSON import, a Drive restore, a borrowed
 * sheet, or a localStorage record written by a much older build. Anything it
 * leaves undefined is read unguarded by ~5k lines of sheet, so a single missing
 * array is a whole-page crash behind the error boundary rather than a
 * degraded card.
 *
 * Observed live 2026-08-13: a character with no `classes` crashed SheetPage with
 * "Cannot read properties of undefined (reading 'find')". load() had defended
 * `c.classes ?? []` seven times INTERNALLY and then stored the raw value, so
 * every consumer downstream got the undefined it had just worked around.
 */

/** A complete, valid character — each test removes exactly one field from it,
 *  so a failure names the field rather than the fixture. */
function complete(): Character {
  return {
    id: 'test', createdAt: 0, updatedAt: 0,
    name: 'Test', playerName: '', alignment: 'True Neutral',
    enabledBooks: ['PHB'],
    raceId: 'human',
    backgroundId: 'sage',
    classes: [{ classId: 'wizard', level: 5, hitPointsRolled: [] }],
    abilityScoreMethod: 'pointbuy',
    baseAbilityScores: { str: 10, dex: 14, con: 14, int: 16, wis: 12, cha: 10 },
    selectedSkillProficiencies: [], selectedFeats: [],
    classOptions: { fightingStyles: [], invocations: [], metamagic: [], maneuvers: [], infusions: [], optionalFeatures: [] },
    inventory: [], hitDiceUsed: {}, spellbook: [],
    maxHP: 30, currentHP: 30, tempHP: 0,
    deathSaves: { successes: 0, failures: 0 },
    conditions: [], exhaustionLevel: 0,
    spellSlotsUsed: {} as Character['spellSlotsUsed'],
    resources: [], inspiration: false, experiencePoints: 0, notes: '',
    currencies: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
  } as Character;
}

/** Drop a field the way an older save file or a hand-edited JSON would: absent,
 *  not null. The type says these are required, which is exactly why nothing in
 *  the app checks them. */
function without(...fields: (keyof Character)[]): Character {
  const c = complete() as unknown as Record<string, unknown>;
  for (const f of fields) delete c[f];
  return c as unknown as Character;
}

const store = () => useCharacterStore.getState();

beforeEach(() => {
  useCharacterStore.setState({ character: null, concentrationCheck: null });
});

/** Fields the sheet iterates or searches without checking. `classes` is the one
 *  that actually crashed; the rest are the same shape and are pinned so they
 *  can't regress into it. */
const ARRAY_FIELDS: (keyof Character)[] = [
  'classes', 'resources', 'inventory', 'spellbook', 'conditions',
  'selectedFeats', 'selectedSkillProficiencies', 'enabledBooks',
];

describe('load() survives characters missing required fields', () => {
  it.each(ARRAY_FIELDS)('a character with no `%s` still loads', (field) => {
    expect(() => store().load(without(field))).not.toThrow();
    expect(store().character).not.toBeNull();
  });

  it.each(ARRAY_FIELDS)('`%s` is an array on the loaded character, not undefined', (field) => {
    store().load(without(field));
    expect(Array.isArray(store().character![field])).toBe(true);
  });

  /** The crash was in render, one layer past the derive, so asserting load()
   *  alone would have missed it — every consumer has to survive too. */
  it.each(ARRAY_FIELDS)('the derive runs on a character that arrived with no `%s`', (field) => {
    store().load(without(field));
    expect(() => computeCharacterDerived(store().character!)).not.toThrow();
  });

  /** A classless character is not hypothetical: it is what a half-written
   *  import or a truncated Drive record looks like. It should open, showing
   *  nothing, rather than take the page down. */
  it('a character with no classes at all derives to level 0', () => {
    store().load(without('classes'));
    const d = computeCharacterDerived(store().character!);
    expect(store().character!.classes).toEqual([]);
    expect(d.totalLevel).toBe(0);
  });

  it('several missing at once is still not a crash', () => {
    expect(() => store().load(without(...ARRAY_FIELDS))).not.toThrow();
    expect(() => computeCharacterDerived(store().character!)).not.toThrow();
  });
});

describe('load() does not damage a complete character', () => {
  it('keeps the classes it was given', () => {
    store().load(complete());
    expect(store().character!.classes).toEqual([{ classId: 'wizard', level: 5, hitPointsRolled: [] }]);
  });

  /** load() runs again on every navigation to the sheet, so a second pass must
   *  produce the same character — the resources migration has been bitten by
   *  exactly this before (see the aliasing comment in load()). */
  it('is idempotent', () => {
    store().load(complete());
    const first = store().character!;
    store().load(first);
    expect(store().character).toEqual(first);
  });
});
