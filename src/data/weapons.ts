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
  versatile?: string;    // damage dice when used two-handed
  ranged?: boolean;      // ranged weapons use DEX for the attack roll
}

export const WEAPON_TABLE: WeaponData[] = [
  // Simple Melee
  { name: 'club',          damageDice: '1d4',  damageType: 'bludgeoning', ability: 'str' },
  { name: 'dagger',        damageDice: '1d4',  damageType: 'piercing',    ability: 'finesse' },
  { name: 'greatclub',     damageDice: '1d8',  damageType: 'bludgeoning', ability: 'str' },
  { name: 'handaxe',       damageDice: '1d6',  damageType: 'slashing',    ability: 'str' },
  { name: 'javelin',       damageDice: '1d6',  damageType: 'piercing',    ability: 'str' },
  { name: 'light hammer',  damageDice: '1d4',  damageType: 'bludgeoning', ability: 'str' },
  { name: 'mace',          damageDice: '1d6',  damageType: 'bludgeoning', ability: 'str' },
  { name: 'quarterstaff',  damageDice: '1d6',  damageType: 'bludgeoning', ability: 'str', versatile: '1d8' },
  { name: 'sickle',        damageDice: '1d4',  damageType: 'slashing',    ability: 'str' },
  { name: 'spear',         damageDice: '1d6',  damageType: 'piercing',    ability: 'str', versatile: '1d8' },
  { name: 'unarmed',       damageDice: '1',    damageType: 'bludgeoning', ability: 'str', aliases: ['unarmed strike'] },
  // Simple Ranged
  { name: 'light crossbow',damageDice: '1d8',  damageType: 'piercing',    ability: 'dex', ranged: true, aliases: ['crossbow, light'] },
  { name: 'dart',          damageDice: '1d4',  damageType: 'piercing',    ability: 'finesse', ranged: true },
  { name: 'shortbow',      damageDice: '1d6',  damageType: 'piercing',    ability: 'dex', ranged: true },
  { name: 'sling',         damageDice: '1d4',  damageType: 'bludgeoning', ability: 'dex', ranged: true },
  // Martial Melee
  { name: 'battleaxe',     damageDice: '1d8',  damageType: 'slashing',    ability: 'str', versatile: '1d10' },
  { name: 'flail',         damageDice: '1d8',  damageType: 'bludgeoning', ability: 'str' },
  { name: 'glaive',        damageDice: '1d10', damageType: 'slashing',    ability: 'str' },
  { name: 'greataxe',      damageDice: '1d12', damageType: 'slashing',    ability: 'str' },
  { name: 'greatsword',    damageDice: '2d6',  damageType: 'slashing',    ability: 'str' },
  { name: 'halberd',       damageDice: '1d10', damageType: 'slashing',    ability: 'str' },
  { name: 'lance',         damageDice: '1d12', damageType: 'piercing',    ability: 'str' },
  { name: 'longsword',     damageDice: '1d8',  damageType: 'slashing',    ability: 'str', versatile: '1d10' },
  { name: 'maul',          damageDice: '2d6',  damageType: 'bludgeoning', ability: 'str' },
  { name: 'morningstar',   damageDice: '1d8',  damageType: 'piercing',    ability: 'str' },
  { name: 'pike',          damageDice: '1d10', damageType: 'piercing',    ability: 'str' },
  { name: 'rapier',        damageDice: '1d8',  damageType: 'piercing',    ability: 'finesse' },
  { name: 'scimitar',      damageDice: '1d6',  damageType: 'slashing',    ability: 'finesse' },
  { name: 'shortsword',    damageDice: '1d6',  damageType: 'piercing',    ability: 'finesse' },
  { name: 'trident',       damageDice: '1d6',  damageType: 'piercing',    ability: 'str', versatile: '1d8' },
  { name: 'war pick',      damageDice: '1d8',  damageType: 'piercing',    ability: 'str' },
  { name: 'warhammer',     damageDice: '1d8',  damageType: 'bludgeoning', ability: 'str', versatile: '1d10' },
  { name: 'whip',          damageDice: '1d4',  damageType: 'slashing',    ability: 'finesse' },
  // Martial Ranged
  { name: 'blowgun',       damageDice: '1',    damageType: 'piercing',    ability: 'dex', ranged: true },
  { name: 'hand crossbow', damageDice: '1d6',  damageType: 'piercing',    ability: 'dex', ranged: true, aliases: ['crossbow, hand'] },
  { name: 'heavy crossbow',damageDice: '1d10', damageType: 'piercing',    ability: 'dex', ranged: true, aliases: ['crossbow, heavy'] },
  { name: 'longbow',       damageDice: '1d8',  damageType: 'piercing',    ability: 'dex', ranged: true },
  { name: 'net',           damageDice: '—',    damageType: '—',           ability: 'dex', ranged: true },
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
