import { lookupWeapon, type WeaponData } from '../data/weapons';
import { activeFightingStyles } from '../data/fightingStyles';
import { isProficientWithWeapon } from './weaponProficiency';
import { classLevel } from '../data/classes';
import type { Character, InventoryItem } from '../types';

/**
 * Everything one equipped weapon contributes to an attack, computed once.
 *
 * The sheet's Weapon Attacks panel and the pinnable sidebar module each had their own
 * copy of this arithmetic, and they drifted: proficiency gating was fixed in one and not
 * the other, and BOTH were missing the rules below (found 2026-08-15). A fighter with
 * Archery saw a bare DEX+prof on their longbow; a level-5 monk with an 18 DEX and a
 * quarterstaff was shown +3 to hit for 1d6+0 instead of +7 for 1d6+4; a "+1 Longsword"
 * rolled exactly like a plain one. One function, two renderers.
 *
 * Deliberately out of scope, because none of them is a flat number this layer can add:
 * Great Weapon Fighting (a reroll rule), Two-Weapon Fighting (belongs to the off-hand
 * attack, which the panel does not model separately), Thrown Weapon Fighting (+2 only
 * when the weapon is actually thrown, which the sheet cannot know), and the 2024 monk's
 * wider weapon list (simple melee plus any Light martial weapon — the 2014 rule below is
 * a subset, so a 2024 monk is never shown MORE than they have).
 */
export interface WeaponAttackLine {
  weapon: WeaponData | undefined;
  proficient: boolean;
  /** d20 modifier: ability + proficiency (if any) + magic + Archery. */
  toHit: number;
  /** Damage dice actually rolled — a monk's Martial Arts die when it beats the weapon's own. */
  damageDice: string;
  /** Two-handed damage for a versatile weapon, or undefined. */
  versatileDice?: string;
  /** Flat damage modifier: ability + magic + Dueling. */
  damageBonus: number;
  damageType: string;
  /** Reasons the numbers differ from the bare weapon, for the tooltip. Empty when nothing applies. */
  notes: string[];
}

/** A "+1 Longsword" / "Longsword +2" enchantment, as a number. Weapons are matched by
 *  substring (see lookupWeapon), so the bonus has always been visible in the item name and
 *  simply never read — a magic weapon rolled exactly like its mundane twin. */
export function magicBonusFromName(itemName: string): number {
  const m = itemName.match(/(?:^|\s)([+-]\d+)(?=\s|$)/);
  return m ? Number(m[1]) : 0;
}

/** PHB Martial Arts: "a Simple Melee weapon or a Shortsword that has neither the
 *  Two-Handed nor the Heavy property". Every Heavy melee weapon in WEAPON_TABLE is also
 *  Two-Handed, so the one flag decides both. */
export function isMonkWeapon(w: WeaponData | undefined): boolean {
  if (!w) return false;
  if (w.category === 'unarmed') return true;
  if (w.name === 'shortsword') return true;
  return w.category === 'simple' && !w.ranged && !w.twoHanded;
}

/** Sides of a single-die expression ("1d6" → 6). 0 for flat or unrollable damage. */
function dieSides(dice: string): number {
  const m = dice.match(/^(\d*)d(\d+)$/);
  return m && (m[1] === '' || m[1] === '1') ? Number(m[2]) : 0;
}

export function weaponAttackLine(
  character: Character,
  item: Pick<InventoryItem, 'name'>,
  ctx: { mods: Record<string, number>; profBonus: number; martialArtsDie: number },
): WeaponAttackLine {
  const w = lookupWeapon(item.name);
  const { mods, profBonus, martialArtsDie } = ctx;
  const notes: string[] = [];

  const styles = activeFightingStyles(character);
  const monkLevel = classLevel(character.classes ?? [], 'monk');
  const monkWeapon = martialArtsDie > 0 && monkLevel > 0 && isMonkWeapon(w);

  // Ability: a monk may use DEX with monk weapons, which is the same "better of the two"
  // choice finesse already offers.
  let abilityMod: number;
  if (!w) abilityMod = mods.str;
  else if (w.ability === 'finesse' || monkWeapon) abilityMod = Math.max(mods.str, mods.dex);
  else if (w.ability === 'dex' || w.ranged) abilityMod = mods.dex;
  else abilityMod = mods.str;
  if (monkWeapon && mods.dex > mods.str && w?.ability !== 'finesse') notes.push('Martial Arts (DEX)');

  const magic = magicBonusFromName(item.name);
  if (magic) notes.push(`Magic weapon ${magic >= 0 ? '+' : ''}${magic}`);

  const proficient = isProficientWithWeapon(character, item.name);
  const archery = styles.includes('archery') && w?.ranged ? 2 : 0;
  if (archery) notes.push('Archery +2 to hit');

  // Dueling: "a melee weapon in one hand and no other weapons". A two-handed weapon can't
  // qualify, and a second equipped weapon means they aren't duelling with this one.
  const equippedWeapons = (character.inventory ?? []).filter(
    (i) => i.equipped && i.category === 'weapon',
  ).length;
  const dueling =
    styles.includes('dueling') && !!w && !w.ranged && !w.twoHanded && equippedWeapons <= 1 ? 2 : 0;
  if (dueling) notes.push('Dueling +2 damage');

  // Martial Arts die replaces the weapon's own when it is larger (monk 11 with a d6
  // quarterstaff rolls d8). Only for single-die weapons, which every monk weapon is.
  let damageDice = w?.damageDice ?? '1d6';
  if (monkWeapon && martialArtsDie > dieSides(damageDice)) {
    damageDice = `1d${martialArtsDie}`;
    notes.push(`Martial Arts die d${martialArtsDie}`);
  }

  return {
    weapon: w,
    proficient,
    toHit: abilityMod + (proficient ? profBonus : 0) + magic + archery,
    damageDice,
    versatileDice: w?.versatile,
    damageBonus: abilityMod + magic + dueling,
    damageType: w?.damageType ?? '—',
    notes,
  };
}
