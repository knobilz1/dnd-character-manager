import type { Character, Companion, CompanionDerived } from '../types';
import { resolveCreatureForm } from '../data/summonOptions';
import { PROFICIENCY_BONUS, totalCharacterLevel } from '../data/mechanics';
import { classLevel } from '../data/classes';
import { STEEL_DEFENDER, DRAKE_COMPANION } from '../data/companionForms';
import { computeCharacterDerived } from '../hooks/useCharacterDerived';

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
 * All four kinds are implemented. `beast-master` and `familiar` read a beast stat block;
 * `steel-defender` and `drakewarden` are not beasts and carry their own, in
 * data/companionForms.ts.
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

/**
 * The owner's FINAL Intelligence modifier — racial bonus, ASIs and feats included, because a Steel
 * Defender's hit points are built on it and a Gnome artificer's +2 is not optional.
 *
 * Guarded, and not defensively for its own sake: computeCharacterDerived reads fields like
 * `selectedFeats` without a null check, so a partially-hydrated character — the pop-out companion
 * window rehydrating from storage, an older save missing a field — would THROW here. Every other
 * branch in this file degrades to `null` and renders "stat block unavailable"; this one would take
 * the whole sheet down. The fallback is the base score, which is right for a character with no INT
 * bonuses and never worse than a crash.
 */
function ownerIntMod(character: Character): number {
  try {
    return computeCharacterDerived(character).mods.int;
  } catch {
    return Math.floor(((character.baseAbilityScores?.int ?? 10) - 10) / 2);
  }
}

/** The live numbers for a companion, with its owner's scaling already applied. */
export function computeCompanionDerived(
  character: Character,
  companion: Companion,
): CompanionDerived | null {
  const ownerLevel = classLevel(character.classes, companion.classId);
  const profBonus = PROFICIENCY_BONUS[Math.min(totalCharacterLevel(character.classes), 20)] ?? 2;

  // The two non-beast kinds are resolved BEFORE the beast lookup. They carry no `beastId`, so
  // leaving them below the `if (!beast) return null` guard is why they returned nothing.
  if (companion.kind === 'steel-defender') {
    const f = STEEL_DEFENDER;
    // TCE: "Hit Points 2 + your Intelligence modifier + five times your artificer level."
    // The INT modifier has to be the FINAL one — a Gnome artificer's racial +2 is part of it —
    // so this reads the character's own derived mods rather than the base score.
    const intMod = ownerIntMod(character);
    return {
      beastName: f.name,
      size: f.size,
      cr: '—',
      maxHP: Math.max(1, 2 + intMod + 5 * ownerLevel),
      ac: f.baseAC,
      speed: f.speed,
      profBonusApplied: profBonus,
      attacksPerAction: 1,
      attacks: [{
        name: 'Force-Empowered Rend',
        // TCE gives the attack as "your spell attack modifier to hit" — for an artificer that is
        // Intelligence + proficiency.
        toHit: intMod + profBonus,
        damage: `1d8+${profBonus}`,
        damageType: 'force',
        reach: 5,
      }],
      specialAbilities: f.specialAbilities,
    };
  }

  if (companion.kind === 'drakewarden') {
    const f = DRAKE_COMPANION;
    // FToD: "Armor Class 14 + PB", "Hit Points 5 + five times your ranger level",
    // "Bite. +3 plus PB to hit ... 1d6 plus PB piercing damage."
    return {
      beastName: f.name,
      size: f.size,
      cr: '—',
      maxHP: Math.max(1, 5 + 5 * ownerLevel),
      ac: f.baseAC + profBonus,
      speed: f.speed,
      profBonusApplied: profBonus,
      attacksPerAction: 1,
      attacks: [{
        name: 'Bite',
        toHit: 3 + profBonus,
        damage: `1d6+${profBonus}`,
        damageType: 'piercing',
        reach: 5,
        notes: 'Plus 1d6 of the drake’s essence type once Infused Strikes is used.',
      }],
      specialAbilities: f.specialAbilities,
    };
  }

  // Both pools. Summoned creatures live in their own array so they never leak into Wild Shape,
  // but a companion can point at either one.
  const beast = resolveCreatureForm(companion.beastId ?? '');
  if (!beast) return null;

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

  if (companion.kind === 'familiar' || companion.kind === 'summoned') {
    // Neither kind takes owner scaling. PHB p.240 on a familiar: it "uses the chosen form's
    // statistics" — the summoner's proficiency bonus is not added and its hit points are not
    // floored, which is exactly why an owl familiar dies to a stiff breeze. A conjured steed,
    // figurine creature or commanded elemental is the same: the stat block as printed.
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
