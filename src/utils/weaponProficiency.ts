import { getClass } from '../data/classes';
import { getRace } from '../data/races';
import { getSubclassOptions } from '../data/subclassOptions';
import { ALL_FEATS, resolvedFeatPicks } from '../data/feats';
import { lookupWeapon, WEAPON_NAMES } from '../data/weapons';
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
  // Feats, which this had never read — so PHB 2024's Martial Weapon Training granted nothing.
  // (Gunner's "firearms" and Tavern Brawler's "improvised weapons" are deliberately absent from
  // the data: the weapon catalog has neither, and an unknown weapon already counts as proficient
  // above, so adding those strings would change nothing in either direction.)
  for (const featId of character.selectedFeats ?? []) {
    grants.push(...(ALL_FEATS.find(f => f.id === featId)?.grantsProficiency ?? []));
  }
  // Weapon Master's four named picks, filtered to EXACT catalog names rather than passed through
  // as free text. `lookupWeapon` matches by substring, so a raw pick would let option ids from
  // other pools slip through: 'eldritch-spear' contains "spear", 'lance-of-lethargy' contains
  // "lance", 'unarmed-fighting' contains "unarmed". A warlock taking Eldritch Spear would have
  // gained spear proficiency, silently.
  const byExactName = new Set(WEAPON_NAMES.map(w => w.toLowerCase()));
  grants.push(...resolvedFeatPicks(character).filter(p => byExactName.has(p.toLowerCase())));

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
