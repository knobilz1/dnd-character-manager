// Common 5e weapon stats for the attack panel.
// Name matching is case-insensitive substring — "Longsword +1" still matches "longsword".

export interface WeaponData {
  name: string;          // canonical key (lowercase)
  aliases?: string[];    // extra substrings to match
  damageDice: string;    // e.g. "1d8"
  damageType: string;    // "slashing" / "piercing" / "bludgeoning"
  /** How the attack ability is selected:
   *  'str'     = always STR
   *  'dex'     = always DEX (ranged / thrown DEX)
   *  'finesse' = higher of STR/DEX
   */
  ability: 'str' | 'dex' | 'finesse';
  /** PHB weapon category. Drives proficiency: nearly every class states its proficiency as
   *  "Simple weapons" / "Martial weapons" rather than by name, so without this the attack roll
   *  had no way to ask and simply granted the bonus to everyone. 'unarmed' is proficient for all. */
  category: 'simple' | 'martial' | 'unarmed';
  versatile?: string;    // damage dice when used two-handed
  ranged?: boolean;      // ranged weapons use DEX for the attack roll
}

export const WEAPON_TABLE: WeaponData[] = [
  // Simple Melee
  { name: 'club', category: 'simple',          damageDice: '1d4',  damageType: 'bludgeoning', ability: 'str' },
  { name: 'dagger', category: 'simple',        damageDice: '1d4',  damageType: 'piercing',    ability: 'finesse' },
  { name: 'greatclub', category: 'simple',     damageDice: '1d8',  damageType: 'bludgeoning', ability: 'str' },
  { name: 'handaxe', category: 'simple',       damageDice: '1d6',  damageType: 'slashing',    ability: 'str' },
  { name: 'javelin', category: 'simple',       damageDice: '1d6',  damageType: 'piercing',    ability: 'str' },
  { name: 'light hammer', category: 'simple',  damageDice: '1d4',  damageType: 'bludgeoning', ability: 'str' },
  { name: 'mace', category: 'simple',          damageDice: '1d6',  damageType: 'bludgeoning', ability: 'str' },
  { name: 'quarterstaff', category: 'simple',  damageDice: '1d6',  damageType: 'bludgeoning', ability: 'str', versatile: '1d8' },
  { name: 'sickle', category: 'simple',        damageDice: '1d4',  damageType: 'slashing',    ability: 'str' },
  { name: 'spear', category: 'simple',         damageDice: '1d6',  damageType: 'piercing',    ability: 'str', versatile: '1d8' },
  { name: 'unarmed', category: 'unarmed',       damageDice: '1',    damageType: 'bludgeoning', ability: 'str', aliases: ['unarmed strike'] },
  // Simple Ranged
  { name: 'light crossbow', category: 'simple',damageDice: '1d8',  damageType: 'piercing',    ability: 'dex', ranged: true, aliases: ['crossbow, light'] },
  { name: 'dart', category: 'simple',          damageDice: '1d4',  damageType: 'piercing',    ability: 'finesse', ranged: true },
  { name: 'shortbow', category: 'simple',      damageDice: '1d6',  damageType: 'piercing',    ability: 'dex', ranged: true },
  { name: 'sling', category: 'simple',         damageDice: '1d4',  damageType: 'bludgeoning', ability: 'dex', ranged: true },
  // Martial Melee
  { name: 'battleaxe', category: 'martial',     damageDice: '1d8',  damageType: 'slashing',    ability: 'str', versatile: '1d10' },
  { name: 'flail', category: 'martial',         damageDice: '1d8',  damageType: 'bludgeoning', ability: 'str' },
  { name: 'glaive', category: 'martial',        damageDice: '1d10', damageType: 'slashing',    ability: 'str' },
  { name: 'greataxe', category: 'martial',      damageDice: '1d12', damageType: 'slashing',    ability: 'str' },
  { name: 'greatsword', category: 'martial',    damageDice: '2d6',  damageType: 'slashing',    ability: 'str' },
  { name: 'halberd', category: 'martial',       damageDice: '1d10', damageType: 'slashing',    ability: 'str' },
  { name: 'lance', category: 'martial',         damageDice: '1d12', damageType: 'piercing',    ability: 'str' },
  { name: 'longsword', category: 'martial',     damageDice: '1d8',  damageType: 'slashing',    ability: 'str', versatile: '1d10' },
  { name: 'maul', category: 'martial',          damageDice: '2d6',  damageType: 'bludgeoning', ability: 'str' },
  { name: 'morningstar', category: 'martial',   damageDice: '1d8',  damageType: 'piercing',    ability: 'str' },
  { name: 'pike', category: 'martial',          damageDice: '1d10', damageType: 'piercing',    ability: 'str' },
  { name: 'rapier', category: 'martial',        damageDice: '1d8',  damageType: 'piercing',    ability: 'finesse' },
  { name: 'scimitar', category: 'martial',      damageDice: '1d6',  damageType: 'slashing',    ability: 'finesse' },
  { name: 'shortsword', category: 'martial',    damageDice: '1d6',  damageType: 'piercing',    ability: 'finesse' },
  { name: 'trident', category: 'martial',       damageDice: '1d6',  damageType: 'piercing',    ability: 'str', versatile: '1d8' },
  { name: 'war pick', category: 'martial',      damageDice: '1d8',  damageType: 'piercing',    ability: 'str' },
  { name: 'warhammer', category: 'martial',     damageDice: '1d8',  damageType: 'bludgeoning', ability: 'str', versatile: '1d10' },
  { name: 'whip', category: 'martial',          damageDice: '1d4',  damageType: 'slashing',    ability: 'finesse' },
  // Martial Ranged
  { name: 'blowgun', category: 'martial',       damageDice: '1',    damageType: 'piercing',    ability: 'dex', ranged: true },
  { name: 'hand crossbow', category: 'martial', damageDice: '1d6',  damageType: 'piercing',    ability: 'dex', ranged: true, aliases: ['crossbow, hand'] },
  { name: 'heavy crossbow', category: 'martial',damageDice: '1d10', damageType: 'piercing',    ability: 'dex', ranged: true, aliases: ['crossbow, heavy'] },
  { name: 'longbow', category: 'martial',       damageDice: '1d8',  damageType: 'piercing',    ability: 'dex', ranged: true },
  { name: 'net', category: 'martial',           damageDice: '—',    damageType: '—',           ability: 'dex', ranged: true },
];

/** Returns the weapon entry whose name or alias appears in the given item name. */
export function lookupWeapon(itemName: string): WeaponData | undefined {
  const lower = itemName.toLowerCase();
  return WEAPON_TABLE.find(w =>
    lower.includes(w.name) || w.aliases?.some(a => lower.includes(a))
  );
}

/** Roll a single die expression like "1d8", "2d6", or "1" (for flat 1 dmg). */
export function rollDamage(dice: string): number {
  if (dice === '—') return 0;
  const flat = parseInt(dice, 10);
  if (!isNaN(flat) && !dice.includes('d')) return flat;
  const [countStr, sidesStr] = dice.split('d');
  const count = parseInt(countStr, 10) || 1;
  const sides = parseInt(sidesStr, 10) || 1;
  let total = 0;
  for (let i = 0; i < count; i++) total += Math.floor(Math.random() * sides) + 1;
  return total;
}

/** Returns the dice expression as a label: "1d8+3", "2d6+0", etc. */
export function damageLine(dice: string, mod: number): string {
  if (dice === '—') return '—';
  if (mod === 0) return dice;
  return `${dice}${mod >= 0 ? '+' : ''}${mod}`;
}

/** Every weapon a player can be granted proficiency with by name, in Title Case for display.
 *  WEAPON_TABLE keys are lowercase for substring matching; Weapon Master's picker needs the
 *  printed form, and `isProficientWithWeapon` lowercases both sides before comparing. */
export const WEAPON_NAMES: string[] = WEAPON_TABLE
  .filter(w => w.category !== 'unarmed')
  .map(w => w.name.replace(/\b[a-z]/g, c => c.toUpperCase()));
