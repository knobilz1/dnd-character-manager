import { describe, it, expect } from 'vitest';
import { castingForSpell } from './perSpellCasting';
import { getSpell } from '../data/spells';
import type { Character } from '../types';

/**
 * PHB p.164: a spell uses the ability of the class it came from. The sheet had one
 * character-wide DC taken from the first class that casts, so on a cleric/wizard every
 * wizard spell rolled off Wisdom — wrong by two or three, on every spell, silently.
 */
const MODS = { str: 10, dex: 12, con: 14, int: 18, wis: 12, cha: 8 };
const FALLBACK = { ability: 'wis' as const, saveDC: 99, attackBonus: 99 };
const ctx = { mods: MODS, profBonus: 3, fallback: FALLBACK };

const chr = (...classes: Array<{ classId: string; level: number; subclassId?: string }>) =>
  ({ classes: classes.map((c) => ({ ...c, hitPointsRolled: [] })) }) as unknown as Character;

it('the fixture spells belong to the lists these tests assume', () => {
  expect(getSpell('fireball')!.classes).toContain('wizard');
  expect(getSpell('cure-wounds')!.classes).toContain('cleric');
  expect(getSpell('fireball')!.classes).not.toContain('cleric');
});

describe('a multiclass caster', () => {
  const clericWizard = chr({ classId: 'cleric', level: 5 }, { classId: 'wizard', level: 5 });

  it('casts a wizard spell off Intelligence', () => {
    const c = castingForSpell(clericWizard, getSpell('fireball')!, ctx);
    expect(c.ability).toBe('int');
    expect(c.saveDC).toBe(8 + 3 + MODS.int);      // 15
    expect(c.attackBonus).toBe(3 + MODS.int);
  });

  it('casts a cleric spell off Wisdom, from the same sheet', () => {
    const c = castingForSpell(clericWizard, getSpell('cure-wounds')!, ctx);
    expect(c.ability).toBe('wis');
    expect(c.saveDC).toBe(8 + 3 + MODS.wis);      // 12 — three lower than the wizard's
  });
});

describe('single-class sheets are unchanged', () => {
  it('a wizard uses Intelligence for a wizard spell', () => {
    const c = castingForSpell(chr({ classId: 'wizard', level: 5 }), getSpell('fireball')!, ctx);
    expect(c.ability).toBe('int');
  });

  it('an unclaimed spell falls back to the character-wide numbers', () => {
    // A fighter claims nothing, so the racial/feat-granted path keeps its own ability.
    const c = castingForSpell(chr({ classId: 'fighter', level: 5 }), getSpell('fireball')!, ctx);
    expect(c.saveDC).toBe(FALLBACK.saveDC);
    expect(c.ability).toBe(FALLBACK.ability);
  });
});

describe('third-caster subclasses', () => {
  it('an Eldritch Knight casts from the wizard list with Intelligence', () => {
    const ek = chr({ classId: 'fighter', level: 7, subclassId: 'eldritch-knight' });
    const c = castingForSpell(ek, getSpell('fireball')!, ctx);
    expect(c.ability).toBe('int');
    expect(c.saveDC).toBe(8 + 3 + MODS.int);
  });

  it('a plain fighter of the same level claims nothing', () => {
    const c = castingForSpell(chr({ classId: 'fighter', level: 7 }), getSpell('fireball')!, ctx);
    expect(c.saveDC).toBe(FALLBACK.saveDC);
  });
});
