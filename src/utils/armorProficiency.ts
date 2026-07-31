import { getClass } from '../data/classes';
import { ARMOR_STATS } from '../data/items';
import type { Character } from '../types';

/**
 * Is the character proficient with the armor and shield they have equipped?
 *
 * The sibling of `isProficientWithWeapon`, and the same defect: `armorProficiencies` existed on
 * every class and was read only by the PDF and print exports, so wearing plate as a wizard cost
 * nothing at all. RAW (PHB p.144) it costs a great deal — see `armorPenalty` below.
 *
 * Proficiency is stated by CATEGORY ("Light armor", "Medium armor", "Heavy armor", "Shields"), and
 * unlike weapons there are no named grants to resolve, so this stays simple. Multiclassing unions
 * the grants, which is correct: PHB multiclass proficiency tables grant armor categories outright.
 */
function armorGrants(character: Character): Set<string> {
  const out = new Set<string>();
  for (const cl of character.classes ?? []) {
    for (const g of getClass(cl.classId)?.armorProficiencies ?? []) {
      out.add(g.trim().toLowerCase());
    }
  }
  return out;
}

export function isProficientWithArmor(character: Character, armorName: string): boolean {
  const stats = ARMOR_STATS[armorName];
  // Unknown armor is not evidence of non-proficiency — the inventory takes free text, and a
  // homebrew or renamed piece should not silently saddle the character with disadvantage.
  if (!stats) return true;
  return armorGrants(character).has(`${stats.armorType} armor`);
}

export function isProficientWithShield(character: Character): boolean {
  return armorGrants(character).has('shields');
}

/**
 * What the character is currently suffering for armor they lack proficiency with.
 *
 * PHB p.144: "you have disadvantage on any ability check, saving throw, or attack roll that
 * involves Strength or Dexterity, and you can't cast spells."
 *
 * Returned rather than applied so the caller decides — the Str/Dex restriction is per-roll and only
 * the roll site knows which ability it is using. `sources` names the offending item so the sheet can
 * say WHY, because an unexplained disadvantage reads as a bug.
 */
export function armorPenalty(character: Character): {
  strDexDisadvantage: boolean;
  cannotCastSpells: boolean;
  sources: string[];
} {
  const sources: string[] = [];
  const armor = (character.inventory ?? []).find(i => i.category === 'armor' && i.equipped);
  const shield = (character.inventory ?? []).find(i => i.category === 'shield' && i.equipped);
  if (armor && !isProficientWithArmor(character, armor.name)) sources.push(armor.name);
  // A shield you are not proficient with carries the same penalty as armor (PHB p.144 covers both).
  if (shield && !isProficientWithShield(character)) sources.push(shield.name);
  return {
    strDexDisadvantage: sources.length > 0,
    // Only worn ARMOR blocks spellcasting. A shield does not — RAW the spellcasting restriction is
    // stated for armor you lack proficiency with, and a shield is not armor for that clause.
    cannotCastSpells: !!(armor && !isProficientWithArmor(character, armor.name)),
    sources,
  };
}
