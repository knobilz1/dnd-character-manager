import type { BeastFormSpeed } from '../types';

/**
 * Stat blocks for companions that are NOT beasts, so they cannot live in beastForms.ts.
 *
 * A Steel Defender is a construct and a Drake Companion is a dragon; neither appears on the beast
 * table and neither takes Beast Master's scaling. The `Companion` type has always named these two
 * kinds — the comment on `beastId` says "other kinds carry their own" — but nothing carried them,
 * so they could not be created and their sheets would have rendered empty.
 *
 * Only the FIXED parts live here. Everything that depends on the owner (hit points, proficiency
 * bonus, attack bonus) is applied in utils/companion.ts, because that is where the per-kind
 * scaling belongs and where it can be read next to the other kinds.
 *
 * Every number below was read out of the book rather than recalled:
 *   Steel Defender   TCE — Medium construct, AC 15 (natural armor),
 *                    HP 2 + INT modifier + five times artificer level.
 *   Drake Companion  FToD — Small dragon, AC 14 + PB (natural armor),
 *                    HP 5 + five times ranger level.
 *   Homunculus Servant TCE — Tiny construct, AC 13 (natural armor),
 *                    HP 1 + INT modifier + artificer level, speed 20 ft / fly 30 ft.
 * The Drake's line reads "hit points 5 vetimes your ranger level" in the extracted text because
 * FToD encodes the fi-ligature as a NUL byte, which eats the "fi" of "five" — see bookquality.py.
 */
export interface CompanionForm {
  name: string;
  size: 'Tiny' | 'Small' | 'Medium' | 'Large' | 'Huge';
  /** Creature type, for the sheet header — these are not beasts. */
  creatureType: string;
  /** Before any proficiency bonus the kind adds. */
  baseAC: number;
  speed: BeastFormSpeed;
  abilities: { str: number; dex: number; con: number; int: number; wis: number; cha: number };
  specialAbilities: string[];
}

export const STEEL_DEFENDER: CompanionForm = {
  name: 'Steel Defender',
  size: 'Medium',
  creatureType: 'construct',
  baseAC: 15,
  speed: { walk: 40 },
  abilities: { str: 14, dex: 12, con: 14, int: 4, wis: 10, cha: 6 },
  specialAbilities: [
    'Vigilant. The defender can’t be surprised.',
    'Damage Immunities: poison. Condition Immunities: charmed, exhaustion, poisoned.',
    'Senses: darkvision 60 ft.',
    'Deflect Attack (reaction). Imposes disadvantage on an attack roll against a creature other than itself within 5 feet.',
    'Repair (action). Restores 2d8 + PB hit points to itself or one construct or object within 5 feet.',
  ],
};

export const HOMUNCULUS_SERVANT: CompanionForm = {
  name: 'Homunculus Servant',
  size: 'Tiny',
  creatureType: 'construct',
  baseAC: 13,
  speed: { walk: 20, fly: 30 },
  abilities: { str: 4, dex: 15, con: 12, int: 10, wis: 10, cha: 7 },
  specialAbilities: [
    'Evasion. Takes no damage on a successful Dexterity save against an area effect, and half on a failure.',
    'Senses: darkvision 60 ft.',
    'Channel Magic (reaction). Delivers a spell you cast that has a range of touch.',
    'Its hit dice are d4s equal to your artificer level.',
  ],
};

export const DRAKE_COMPANION: CompanionForm = {
  name: 'Drake Companion',
  size: 'Small',
  creatureType: 'dragon',
  baseAC: 14,
  speed: { walk: 40 },
  abilities: { str: 16, dex: 12, con: 15, int: 8, wis: 14, cha: 8 },
  specialAbilities: [
    'Damage immunity is whichever type you chose for the drake’s Draconic Essence.',
    'Senses: darkvision 60 ft.',
    'Infused Strikes (reaction). When another creature within 30 feet hits with an attack, the drake adds 1d6 damage of its essence type.',
    'Drake’s Breath (7th level). Exhales a 30-foot cone; each creature makes a Dexterity save, taking 8d6 damage of the essence type on a failure, half on a success.',
  ],
};
