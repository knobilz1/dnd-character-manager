import { getClass } from '../data/classes';
import { getRace } from '../data/races';
import { getSubclassOptions } from '../data/subclassOptions';
import { lookupWeapon } from '../data/weapons';
import type { Character } from '../types';

/**
 * Is the character proficient with this weapon?
 *
 * Before this existed, `WeaponAttacksPanel` added the proficiency bonus to every attack
 * unconditionally, so a wizard swinging a greataxe hit as well as a fighter — and the entire
 * weapon-proficiency layer (class lists, race lists) computed nothing at all. Those lists were read
 * only by the PDF and print exports.
 *
 * Proficiency strings come from the books in two shapes: category grants ("Simple weapons",
 * "Martial weapons") and named grants ("Longswords", "Hand crossbows", "Rapier"). Both are handled,
 * and named grants are matched through `lookupWeapon` so an entry that is not a weapon at all —
 * race proficiency arrays mix in skills like 'Perception' — simply never matches.
 */
export function isProficientWithWeapon(character: Character, weaponName: string): boolean {
  const weapon = lookupWeapon(weaponName);
  // An unknown weapon is not evidence of non-proficiency: the inventory accepts free text, and
  // silently docking the bonus for a homebrew or renamed item would be worse than granting it.
  if (!weapon) return true;
  // Everyone is proficient with unarmed strikes (PHB p.195).
  if (weapon.category === 'unarmed') return true;

  const grants: string[] = [];
  for (const cl of character.classes ?? []) {
    grants.push(...(getClass(cl.classId)?.weaponProficiencies ?? []));
    // Subclass option groups that confer weapon proficiency — Way of the Kensei picks its kensei
    // weapons and gains proficiency with them. Without this the choice would be recorded and then
    // ignored, which is exactly how subclass SKILL grants were prose-only until they were wired.
    for (const group of getSubclassOptions(cl.subclassId)) {
      if (group.grants !== 'weapon') continue;
      grants.push(...(character.subclassOptions?.[group.key] ?? []));
    }
  }
  grants.push(...(getRace(character.raceId)?.proficiencies ?? []));

  for (const raw of grants) {
    const g = raw.trim().toLowerCase();
    if (g === 'simple weapons') {
      if (weapon.category === 'simple') return true;
      continue;
    }
    if (g === 'martial weapons') {
      if (weapon.category === 'martial') return true;
      continue;
    }
    // named grant — books pluralise inconsistently ("Longswords" vs "Rapier"), so try both
    const singular = g.endsWith('es') && !g.endsWith('ses') ? g.slice(0, -2) : g.replace(/s$/, '');
    for (const probe of [g, singular]) {
      const named = lookupWeapon(probe);
      if (named && named.name === weapon.name) return true;
    }
  }
  return false;
}
