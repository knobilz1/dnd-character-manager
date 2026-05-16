import type { SlotLevel } from '../types';

// Full caster spell slots (Wizard, Sorcerer, Bard, Cleric, Druid)
export const FULL_CASTER_SLOTS: Record<number, number[]> = {
  1:  [2,0,0,0,0,0,0,0,0],
  2:  [3,0,0,0,0,0,0,0,0],
  3:  [4,2,0,0,0,0,0,0,0],
  4:  [4,3,0,0,0,0,0,0,0],
  5:  [4,3,2,0,0,0,0,0,0],
  6:  [4,3,3,0,0,0,0,0,0],
  7:  [4,3,3,1,0,0,0,0,0],
  8:  [4,3,3,2,0,0,0,0,0],
  9:  [4,3,3,3,1,0,0,0,0],
  10: [4,3,3,3,2,0,0,0,0],
  11: [4,3,3,3,2,1,0,0,0],
  12: [4,3,3,3,2,1,0,0,0],
  13: [4,3,3,3,2,1,1,0,0],
  14: [4,3,3,3,2,1,1,0,0],
  15: [4,3,3,3,2,1,1,1,0],
  16: [4,3,3,3,2,1,1,1,0],
  17: [4,3,3,3,2,1,1,1,1],
  18: [4,3,3,3,3,1,1,1,1],
  19: [4,3,3,3,3,2,1,1,1],
  20: [4,3,3,3,3,2,2,1,1],
};

// Half caster slots (Paladin, Ranger) — index by class level
export const HALF_CASTER_SLOTS: Record<number, number[]> = {
  1:  [0,0,0,0,0,0,0,0,0],
  2:  [2,0,0,0,0,0,0,0,0],
  3:  [3,0,0,0,0,0,0,0,0],
  4:  [3,0,0,0,0,0,0,0,0],
  5:  [4,2,0,0,0,0,0,0,0],
  6:  [4,2,0,0,0,0,0,0,0],
  7:  [4,3,0,0,0,0,0,0,0],
  8:  [4,3,0,0,0,0,0,0,0],
  9:  [4,3,2,0,0,0,0,0,0],
  10: [4,3,2,0,0,0,0,0,0],
  11: [4,3,3,0,0,0,0,0,0],
  12: [4,3,3,0,0,0,0,0,0],
  13: [4,3,3,1,0,0,0,0,0],
  14: [4,3,3,1,0,0,0,0,0],
  15: [4,3,3,2,0,0,0,0,0],
  16: [4,3,3,2,0,0,0,0,0],
  17: [4,3,3,3,1,0,0,0,0],
  18: [4,3,3,3,1,0,0,0,0],
  19: [4,3,3,3,2,0,0,0,0],
  20: [4,3,3,3,2,0,0,0,0],
};

// Third caster slots (Eldritch Knight, Arcane Trickster) — by class level
export const THIRD_CASTER_SLOTS: Record<number, number[]> = {
  1:  [0,0,0,0,0,0,0,0,0],
  2:  [0,0,0,0,0,0,0,0,0],
  3:  [2,0,0,0,0,0,0,0,0],
  4:  [3,0,0,0,0,0,0,0,0],
  5:  [3,0,0,0,0,0,0,0,0],
  6:  [3,0,0,0,0,0,0,0,0],
  7:  [4,2,0,0,0,0,0,0,0],
  8:  [4,2,0,0,0,0,0,0,0],
  9:  [4,2,0,0,0,0,0,0,0],
  10: [4,3,0,0,0,0,0,0,0],
  11: [4,3,0,0,0,0,0,0,0],
  12: [4,3,0,0,0,0,0,0,0],
  13: [4,3,2,0,0,0,0,0,0],
  14: [4,3,2,0,0,0,0,0,0],
  15: [4,3,2,0,0,0,0,0,0],
  16: [4,3,3,0,0,0,0,0,0],
  17: [4,3,3,0,0,0,0,0,0],
  18: [4,3,3,0,0,0,0,0,0],
  19: [4,3,3,1,0,0,0,0,0],
  20: [4,3,3,1,0,0,0,0,0],
};

// Warlock pact magic
export const PACT_MAGIC_TABLE: Record<number, { slots: number; slotLevel: number }> = {
  1:  { slots: 1, slotLevel: 1 },
  2:  { slots: 2, slotLevel: 1 },
  3:  { slots: 2, slotLevel: 2 },
  4:  { slots: 2, slotLevel: 2 },
  5:  { slots: 2, slotLevel: 3 },
  6:  { slots: 2, slotLevel: 3 },
  7:  { slots: 2, slotLevel: 4 },
  8:  { slots: 2, slotLevel: 4 },
  9:  { slots: 2, slotLevel: 5 },
  10: { slots: 2, slotLevel: 5 },
  11: { slots: 3, slotLevel: 5 },
  12: { slots: 3, slotLevel: 5 },
  13: { slots: 3, slotLevel: 5 },
  14: { slots: 3, slotLevel: 5 },
  15: { slots: 3, slotLevel: 5 },
  16: { slots: 3, slotLevel: 5 },
  17: { slots: 4, slotLevel: 5 },
  18: { slots: 4, slotLevel: 5 },
  19: { slots: 4, slotLevel: 5 },
  20: { slots: 4, slotLevel: 5 },
};

export const PROFICIENCY_BONUS: Record<number, number> = {
  1: 2,  2: 2,  3: 2,  4: 2,
  5: 3,  6: 3,  7: 3,  8: 3,
  9: 4,  10: 4, 11: 4, 12: 4,
  13: 5, 14: 5, 15: 5, 16: 5,
  17: 6, 18: 6, 19: 6, 20: 6,
};

export const ASI_LEVELS: Record<string, number[]> = {
  barbarian:  [4, 8, 12, 16, 19],
  bard:       [4, 8, 12, 16, 19],
  cleric:     [4, 8, 12, 16, 19],
  druid:      [4, 8, 12, 16, 19],
  fighter:    [4, 6, 8, 12, 14, 16, 19],
  monk:       [4, 8, 12, 16, 19],
  paladin:    [4, 8, 12, 16, 19],
  ranger:     [4, 8, 12, 16, 19],
  rogue:      [4, 8, 10, 12, 16, 19],
  sorcerer:   [4, 8, 12, 16, 19],
  warlock:    [4, 8, 12, 16, 19],
  wizard:     [4, 8, 12, 16, 19],
  artificer:  [4, 8, 12, 16, 19],
};

export const POINT_BUY_COSTS: Record<number, number> = {
  8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9,
};

export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];

export function getSpellSlots(
  type: 'full' | 'half' | 'third',
  level: number
): number[] {
  const table =
    type === 'full' ? FULL_CASTER_SLOTS :
    type === 'half' ? HALF_CASTER_SLOTS :
    THIRD_CASTER_SLOTS;
  return table[Math.min(Math.max(level, 1), 20)] ?? Array(9).fill(0);
}

export function getMulticlassSpellSlots(
  classes: Array<{ type: 'full' | 'half' | 'third' | 'pact' | 'none'; level: number }>
): number[] {
  let effective = 0;
  for (const c of classes) {
    if (c.type === 'full')  effective += c.level;
    if (c.type === 'half')  effective += Math.floor(c.level / 2);
    if (c.type === 'third') effective += Math.floor(c.level / 3);
  }
  if (effective === 0) return Array(9).fill(0);
  return FULL_CASTER_SLOTS[Math.min(effective, 20)] ?? Array(9).fill(0);
}

export const SKILL_ABILITY: Record<string, string> = {
  'Acrobatics': 'dex',
  'Animal Handling': 'wis',
  'Arcana': 'int',
  'Athletics': 'str',
  'Deception': 'cha',
  'History': 'int',
  'Insight': 'wis',
  'Intimidation': 'cha',
  'Investigation': 'int',
  'Medicine': 'wis',
  'Nature': 'int',
  'Perception': 'wis',
  'Performance': 'cha',
  'Persuasion': 'cha',
  'Religion': 'int',
  'Sleight of Hand': 'dex',
  'Stealth': 'dex',
  'Survival': 'wis',
};

export function abilityMod(score: number): number {
  return Math.floor((score - 10) / 2);
}

export function totalCharacterLevel(classes: Array<{ level: number }>): number {
  return classes.reduce((sum, c) => sum + c.level, 0);
}

export function emptySlotState(): Record<SlotLevel, number> {
  return { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0 };
}

// Spells known by class & level for spontaneous casters (index = level - 1)
export const SPELLS_KNOWN: Partial<Record<string, number[]>> = {
  bard:     [4,5,6,7,8,9,10,11,12,14,15,15,16,18,19,19,20,22,22,22],
  sorcerer: [2,3,4,5,6,7,8,9,10,11,12,12,13,13,14,14,15,15,15,15],
  warlock:  [2,3,4,5,6,7,8,9,10,10,11,11,12,12,13,13,14,14,15,15],
  ranger:   [0,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11],
};

export function spellsKnownFor(classId: string, level: number): number {
  const table = SPELLS_KNOWN[classId];
  if (!table) return 0;
  return table[Math.max(0, Math.min(level, 20) - 1)] ?? 0;
}

// Cantrips known by class & level (PHB tables, index = level - 1)
export const CANTRIPS_KNOWN: Record<string, number[]> = {
  bard:      [2,2,2,3,3,3,3,3,3,4,4,4,4,4,4,4,4,4,4,4],
  cleric:    [3,3,3,4,4,4,4,4,4,5,5,5,5,5,5,5,5,5,5,5],
  druid:     [2,2,2,3,3,3,3,3,3,4,4,4,4,4,4,4,4,4,4,4],
  sorcerer:  [4,4,4,5,5,5,5,5,5,6,6,6,6,6,6,6,6,6,6,6],
  warlock:   [2,2,2,3,3,3,3,3,3,4,4,4,4,4,4,4,4,4,4,4],
  wizard:    [3,3,3,4,4,4,4,4,4,5,5,5,5,5,5,5,5,5,5,5],
  artificer: [2,2,2,2,2,2,2,2,2,3,3,3,3,4,4,4,4,4,4,4],
};

export function cantripsKnownFor(classId: string, level: number): number {
  const table = CANTRIPS_KNOWN[classId];
  if (!table) return 0;
  return table[Math.max(0, Math.min(level, 20) - 1)] ?? 0;
}

// Number of spells a prepared caster can prepare. Returns null for spontaneous/known casters.
export function maxPreparedSpellsFor(
  classId: string,
  level: number,
  spellMod: number,
): number | null {
  switch (classId) {
    case 'cleric':
    case 'druid':
    case 'wizard':
      return Math.max(1, level + spellMod);
    case 'paladin':
      if (level < 2) return 0;
      return Math.max(1, Math.floor(level / 2) + spellMod);
    case 'artificer':
      if (level < 2) return 0;
      return Math.max(1, Math.ceil(level / 2) + spellMod);
    default:
      return null; // sorcerer, bard, ranger, warlock are known/spontaneous
  }
}
