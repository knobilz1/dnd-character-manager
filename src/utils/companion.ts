import type { Character, Companion, CompanionDerived } from '../types';
import { ALL_BEAST_FORMS } from '../data/beastForms';
import { PROFICIENCY_BONUS, totalCharacterLevel } from '../data/mechanics';
import { classLevel } from '../data/classes';

/**
 * A companion is a creature the character CONTROLS but is not — a Beast Master's beast, a Steel
 * Defender, a drake, a familiar. Distinct from Wild Shape, which is a transformation of the
 * character rather than a second creature.
 *
 * The thing that makes this more than "store which stat block": **the scaling differs per
 * feature**. Beast Master grafts the RANGER's proficiency bonus onto an ordinary beast's stat
 * block and floors its HP at 4 x ranger level; a Steel Defender and a Drakewarden's drake have
 * their own progressions and ignore the beast table entirely. So a companion records the feature
 * that granted it and the class that owns it, not just an id — otherwise it would be right for
 * one subclass and quietly wrong for the others.
 *
 * `beast-master` and `familiar` are implemented; `steel-defender` and `drakewarden` are named in
 * the type so adding one is a new branch here rather than a reshape of stored data.
 */

/** Add a flat bonus to a damage expression: "1d6+2" +2 -> "1d6+4", and "1" +2 -> "3". */
export function addDamageBonus(damage: string, bonus: number): string {
  if (!damage) return damage;
  if (!damage.includes('d')) {
    // Flat damage, e.g. the Poisonous Snake's bite (1 piercing). Still gets the bonus.
    const n = parseInt(damage, 10);
    return Number.isNaN(n) ? damage : String(n + bonus);
  }
  const m = /^(\d*d\d+)\s*([+-]\s*\d+)?$/.exec(damage.replace(/\s+/g, ''));
  if (!m) return damage;                       // unrecognised shape — leave it alone
  const base = (m[2] ? parseInt(m[2].replace(/\s+/g, ''), 10) : 0) + bonus;
  return base === 0 ? m[1] : `${m[1]}${base > 0 ? '+' : ''}${base}`;
}

/** The live numbers for a companion, with its owner's scaling already applied. */
export function computeCompanionDerived(
  character: Character,
  companion: Companion,
): CompanionDerived | null {
  const beast = ALL_BEAST_FORMS.find(b => b.id === companion.beastId);
  if (!beast) return null;

  const ownerLevel = classLevel(character.classes, companion.classId);
  const profBonus = PROFICIENCY_BONUS[Math.min(totalCharacterLevel(character.classes), 20)] ?? 2;

  if (companion.kind === 'beast-master') {
    // PHB p.93: "Add your proficiency bonus to the beast's AC, attack rolls, and damage rolls, as
    // well as to any saving throws and skills it is proficient in. Its hit point maximum equals
    // its normal maximum or four times your ranger level, whichever is higher."
    const maxHP = Math.max(beast.hp, 4 * ownerLevel);
    return {
      beastName: beast.name,
      size: beast.size,
      cr: String(beast.cr),
      maxHP,
      ac: beast.ac + profBonus,
      speed: beast.speed,
      profBonusApplied: profBonus,
      // Bestial Fury (11th): "the beast can make two attacks when you command it to use the
      // Attack action."
      attacksPerAction: ownerLevel >= 11 ? 2 : 1,
      attacks: beast.attacks.map(a => ({
        ...a,
        toHit: a.toHit + profBonus,
        damage: addDamageBonus(a.damage, profBonus),
      })),
      specialAbilities: beast.specialAbilities ?? [],
    };
  }

  if (companion.kind === 'familiar') {
    // A familiar is the ONLY kind that takes no owner scaling. PHB p.240: it "uses the chosen
    // form's statistics" — the summoner's proficiency bonus is not added and its hit points are
    // not floored, which is exactly why an owl familiar dies to a stiff breeze. Returning the
    // stat block unchanged is the rule, not a stub.
    return {
      beastName: beast.name,
      size: beast.size,
      cr: String(beast.cr),
      maxHP: beast.hp,
      ac: beast.ac,
      speed: beast.speed,
      profBonusApplied: 0,
      attacksPerAction: 1,
      attacks: beast.attacks,
      specialAbilities: beast.specialAbilities ?? [],
    };
  }

  return null;
}

/** Companions that are currently out — what the DM needs to place on a map and track. */
export function activeCompanions(character: Character): Companion[] {
  return (character.companions ?? []).filter(c => c.active);
}
