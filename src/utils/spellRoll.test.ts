import { describe, it, expect } from 'vitest';
import { spellRoll, spellAttackKind, cantripTier, formatSpellRoll } from './spellRoll';
import { ALL_SPELLS, getSpell } from '../data/spells';
import { VALID_DAMAGE_DICE } from './damageDice';
import type { Spell } from '../types';

/** Every expected number below is the book's, typed out here rather than
 *  recomputed from the data the parser reads — a test that re-derives its
 *  expectation from the same string proves only that the regex ran. */
function s(id: string): Spell {
  const sp = getSpell(id);
  if (!sp) throw new Error(`fixture missing: ${id}`);
  return sp;
}

const at = (id: string, charLevel: number, slotLevel?: number, spellMod?: number) =>
  spellRoll(s(id), { charLevel, slotLevel, spellMod });

describe('spell attack rolls', () => {
  it.each([
    ['fire-bolt', 'ranged'],
    ['ray-of-frost', 'ranged'],
    ['shocking-grasp', 'melee'],
    ['inflict-wounds', 'melee'],
    ['spiritual-weapon', 'melee'],
  ] as const)('%s is a %s spell attack', (id, kind) => {
    expect(spellAttackKind(s(id))).toBe(kind);
  });

  /** Saving-throw spells must NOT offer an attack button — Fireball has never
   *  been rolled to hit, and a button implying otherwise teaches the rule wrong. */
  it.each(['fireball', 'sacred-flame', 'cure-wounds', 'shield'])('%s needs no attack roll', (id) => {
    expect(spellAttackKind(s(id))).toBeNull();
  });
});

describe('cantrip scaling', () => {
  // PHB p.201 — the ladder is character level, and it is the same for every cantrip.
  it.each([[1, 1], [4, 1], [5, 2], [10, 2], [11, 3], [16, 3], [17, 4], [20, 4]])(
    'level %i rolls %i dice', (charLevel, tier) => {
      expect(cantripTier(charLevel)).toBe(tier);
      expect(at('fire-bolt', charLevel)!.dice).toEqual({ count: tier, sides: 10 });
    });

  /** Eldritch Blast gains BEAMS, not dice. Scaling it would quadruple a warlock's
   *  cantrip damage — the single worst number this parser could produce. */
  it('Eldritch Blast stays 1d10 at every level', () => {
    for (const lvl of [1, 5, 11, 17, 20]) {
      expect(at('eldritch-blast', lvl)!.dice).toEqual({ count: 1, sides: 10 });
    }
  });

  /** TCE p.116 words the same ladder as "at 5th, 11th, and 17th level", where
   *  only the last ordinal carries the word "level". */
  it('Sword Burst scales despite the shorter wording', () => {
    expect(at('sword-burst', 1)!.dice).toEqual({ count: 1, sides: 6 });
    expect(at('sword-burst', 17)!.dice).toEqual({ count: 4, sides: 6 });
  });

  it('a slot level cannot scale a cantrip', () => {
    expect(at('fire-bolt', 1, 9)!.dice).toEqual({ count: 1, sides: 10 });
  });
});

describe('upcasting', () => {
  it('Fireball is 8d6, and 10d6 from a 5th-level slot', () => {
    expect(at('fireball', 5)!.dice).toEqual({ count: 8, sides: 6 });
    expect(at('fireball', 5, 3)!.dice).toEqual({ count: 8, sides: 6 });
    expect(at('fireball', 5, 5)!.dice).toEqual({ count: 10, sides: 6 });
    expect(at('fireball', 5, 9)!.dice).toEqual({ count: 14, sides: 6 });
  });

  /** PHB: "+1d8 per TWO slot levels above 2nd" — reading that as a per-level
   *  rate would double the weapon's damage a level early. */
  it('Spiritual Weapon upcasts at half rate', () => {
    expect(at('spiritual-weapon', 5, 2)!.dice).toEqual({ count: 1, sides: 8 });
    expect(at('spiritual-weapon', 5, 3)!.dice).toEqual({ count: 1, sides: 8 });
    expect(at('spiritual-weapon', 5, 4)!.dice).toEqual({ count: 2, sides: 8 });
    expect(at('spiritual-weapon', 5, 6)!.dice).toEqual({ count: 3, sides: 8 });
  });

  /** XGtE p.68 says +1d8; the data said +1d6 until this test was written. */
  it('Mind Spike upcasts by 1d8', () => {
    expect(at('mind-spike', 5, 4)!.dice).toEqual({ count: 5, sides: 8 });
  });

  /** Extra rays, darts and bolts are not extra dice on one roll. Flagging is the
   *  point: the caller must not present a base-level number as the final one. */
  it.each(['scorching-ray', 'magic-missile', 'chain-lightning'])(
    '%s reports that its upcast could not be read', (id) => {
      const sp = s(id);
      expect(spellRoll(sp, { charLevel: 9, slotLevel: sp.level + 1 })!.unscaled).toBe(true);
    });

  it('a spell cast at its own level is never flagged', () => {
    expect(at('scorching-ray', 9, 2)!.unscaled).toBeUndefined();
    expect(at('fireball', 9, 5)!.unscaled).toBeUndefined();
  });
});

describe('the modifier the text asks for', () => {
  it('Cure Wounds adds the spellcasting modifier, at every slot', () => {
    expect(at('cure-wounds', 5, 1, 4)).toMatchObject({ dice: { count: 1, sides: 8 }, modifier: 4, kind: 'healing' });
    expect(at('cure-wounds', 5, 3, 4)).toMatchObject({ dice: { count: 3, sides: 8 }, modifier: 4 });
  });

  it('Spiritual Weapon reads its dice from "damage equal to 1d8 + ..."', () => {
    expect(at('spiritual-weapon', 5, 2, 3)).toMatchObject({ dice: { count: 1, sides: 8 }, modifier: 3, kind: 'damage' });
  });

  /** Magic Missile's +1 is a flat bonus on the dart, not anybody's modifier —
   *  a 20-Wisdom cleric must not turn it into +5. */
  it('Magic Missile takes the flat +1 and nothing else', () => {
    expect(at('magic-missile', 5, 1, 5)).toMatchObject({ dice: { count: 1, sides: 4 }, modifier: 1 });
  });

  it('Fireball adds no modifier however high the caster', () => {
    expect(at('fireball', 20, 3, 5)!.modifier).toBe(0);
  });
});

describe('spells with no readable roll', () => {
  /** Guidance's "roll a d4" is the target's, not damage — and it has no
   *  damageType, which is what keeps the parser out of it. */
  it.each(['guidance', 'shield', 'mage-armor', 'mage-hand'])('%s offers no roll', (id) => {
    expect(at(id, 5)).toBeNull();
  });

  /** These deal nothing below 5th level and then climb two separate ladders. */
  it.each(['booming-blade', 'green-flame-blade'])('%s is excluded by hand', (id) => {
    expect(at(id, 11)).toBeNull();
  });
});

describe('over the whole spell list', () => {
  it('never produces dice the roller cannot render', () => {
    for (const sp of ALL_SPELLS) {
      const r = spellRoll(sp, { charLevel: 20, slotLevel: 9, spellMod: 5 });
      if (!r) continue;
      expect(VALID_DAMAGE_DICE, sp.name).toContain(r.dice.sides);
      expect(r.dice.count, sp.name).toBeGreaterThanOrEqual(1);
      // 20d6 (Meteor Swarm) is the largest in the books; anything past that is a
      // parse that ran away, not a spell.
      expect(r.dice.count, sp.name).toBeLessThanOrEqual(40);
      expect(Number.isFinite(r.modifier), sp.name).toBe(true);
    }
  });

  it('is stable — the same spell and options give the same dice', () => {
    const twice = [at('fireball', 5, 5), at('fireball', 5, 5)];
    expect(twice[0]).toEqual(twice[1]);
  });

  /** Guards the coverage this shipped with: a data edit that quietly stops a
   *  hundred spells from rolling should fail here, not go unnoticed. */
  it('reads a roll for most damaging spells', () => {
    const damaging = ALL_SPELLS.filter(sp => sp.damageType);
    const rollable = damaging.filter(sp => spellRoll(sp, { charLevel: 1 }));
    expect(rollable.length / damaging.length).toBeGreaterThan(0.95);
  });
});

describe('formatSpellRoll', () => {
  it.each([
    [{ dice: { count: 8, sides: 6 as const }, modifier: 0, kind: 'damage' as const }, '8d6'],
    [{ dice: { count: 1, sides: 4 as const }, modifier: 1, kind: 'damage' as const }, '1d4 + 1'],
    [{ dice: { count: 1, sides: 8 as const }, modifier: -1, kind: 'healing' as const }, '1d8 − 1'],
  ])('renders %j as %s', (roll, text) => {
    expect(formatSpellRoll(roll)).toBe(text);
  });
});
