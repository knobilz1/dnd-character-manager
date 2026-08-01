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
// NOTE: Artificer is also a half-caster but gets 2×1st-level slots at level 1.
// Use ARTIFICER_SLOTS for Artificer characters.
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

// Artificer spell slots (TCE p. 11) — same progression as half-caster but
// starts at level 1 (2 × 1st-level slots), unlike Paladin/Ranger who get none.
export const ARTIFICER_SLOTS: Record<number, number[]> = {
  1:  [2,0,0,0,0,0,0,0,0],
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

/** `roundUp` marks the artificer, the one half-caster whose levels round UP in the multiclass
 *  total — "Add half artificer levels (rounded up)", TCE p.10. Paladin and ranger round down.
 *  Flooring it cost a level-1 or level-3 artificer a whole effective caster level, so an
 *  artificer 1 / wizard 1 got a single-caster's slots instead of a two-caster's. */
export function getMulticlassSpellSlots(
  classes: Array<{ type: 'full' | 'half' | 'third' | 'pact' | 'none'; level: number; roundUp?: boolean }>
): number[] {
  let effective = 0;
  for (const c of classes) {
    if (c.type === 'full')  effective += c.level;
    if (c.type === 'half')  effective += c.roundUp ? Math.ceil(c.level / 2) : Math.floor(c.level / 2);
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
  bard:            [4,5,6,7,8,9,10,11,12,14,15,15,16,18,19,19,20,22,22,22],
  sorcerer:        [2,3,4,5,6,7,8,9,10,11,12,12,13,13,14,14,15,15,15,15],
  warlock:         [2,3,4,5,6,7,8,9,10,10,11,11,12,12,13,13,14,14,15,15],
  ranger:          [0,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11],
  // 2024 PHB known casters
  'sorcerer-2024': [2,4,6,7,9,10,11,12,14,15,16,16,17,17,18,18,19,20,21,22],
  'warlock-2024':  [2,3,4,5,6,7,8,9,10,10,11,11,12,12,13,13,14,14,15,15],
};

// Fixed prepared spell counts for 2024 PHB prepared casters (index = level - 1)
export const PREPARED_SPELLS_2024: Partial<Record<string, number[]>> = {
  'bard-2024':    [4,5,6,7,9,10,11,12,14,15,16,16,17,17,18,18,19,20,21,22],
  'cleric-2024':  [4,5,6,7,9,10,11,12,14,15,16,16,17,17,18,18,19,20,21,22],
  'druid-2024':   [4,5,6,7,9,10,11,12,14,15,16,16,17,17,18,18,19,20,21,22],
  'paladin-2024': [2,2,4,5,6,6,7,7,9,9,10,10,11,11,12,12,14,14,15,15],
  'ranger-2024':  [2,3,4,5,6,6,7,7,9,9,10,10,11,11,12,12,14,14,15,15],
  'wizard-2024':  [4,5,6,7,9,10,11,12,14,15,16,16,17,18,19,21,22,23,24,25],
};

/** True when the class prepares spells from a list rather than knowing a fixed set.
 *
 *  Derived from `maxPreparedSpellsFor` rather than restated as an id list: that function already
 *  encodes the answer (it returns null for known/spontaneous casters), and it is the only copy that
 *  covers both editions. Four hardcoded arrays used to answer this question independently and three
 *  of them listed 2014 ids only, so every 2024 prepared caster — bard, cleric, druid, paladin,
 *  ranger and wizard — was treated as a known caster by the sheet, the sidebar and the spell panel.
 *  Level and modifier are irrelevant to the question, so any values do. */
export function isPreparedCaster(classId: string): boolean {
  return maxPreparedSpellsFor(classId, 1, 0) !== null;
}

export function spellsKnownFor(classId: string, level: number): number {
  const table = SPELLS_KNOWN[classId];
  if (!table) return 0;
  return table[Math.max(0, Math.min(level, 20) - 1)] ?? 0;
}

// Cantrips known by class & level (PHB tables, index = level - 1)
export const CANTRIPS_KNOWN: Record<string, number[]> = {
  bard:           [2,2,2,3,3,3,3,3,3,4,4,4,4,4,4,4,4,4,4,4],
  cleric:         [3,3,3,4,4,4,4,4,4,5,5,5,5,5,5,5,5,5,5,5],
  druid:          [2,2,2,3,3,3,3,3,3,4,4,4,4,4,4,4,4,4,4,4],
  sorcerer:       [4,4,4,5,5,5,5,5,5,6,6,6,6,6,6,6,6,6,6,6],
  warlock:        [2,2,2,3,3,3,3,3,3,4,4,4,4,4,4,4,4,4,4,4],
  wizard:         [3,3,3,4,4,4,4,4,4,5,5,5,5,5,5,5,5,5,5,5],
  artificer:      [2,2,2,2,2,2,2,2,2,3,3,3,3,4,4,4,4,4,4,4],
  // 2024 PHB classes — same cantrip progressions
  'bard-2024':    [2,2,2,3,3,3,3,3,3,4,4,4,4,4,4,4,4,4,4,4],
  'cleric-2024':  [3,3,3,4,4,4,4,4,4,5,5,5,5,5,5,5,5,5,5,5],
  'druid-2024':   [2,2,2,3,3,3,3,3,3,4,4,4,4,4,4,4,4,4,4,4],
  'sorcerer-2024':[4,4,4,5,5,5,5,5,5,6,6,6,6,6,6,6,6,6,6,6],
  'warlock-2024': [2,2,2,3,3,3,3,3,3,4,4,4,4,4,4,4,4,4,4,4],
  'wizard-2024':  [3,3,3,4,4,4,4,4,4,5,5,5,5,5,5,5,5,5,5,5],
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
  // 2024 PHB classes use fixed tables
  const fixed2024 = PREPARED_SPELLS_2024[classId];
  if (fixed2024) {
    return fixed2024[Math.max(0, Math.min(level, 20) - 1)] ?? 1;
  }
  switch (classId) {
    case 'cleric':
    case 'druid':
    case 'wizard':
      return Math.max(1, level + spellMod);
    case 'paladin':
      if (level < 2) return 0;
      return Math.max(1, Math.floor(level / 2) + spellMod);
    case 'artificer':
      // TCE: "Int modifier + half artificer level (rounded down)", minimum one spell. The Artificer
      // does get spells at level 1 (unlike Paladin/Ranger, who start at 2) but that is what the
      // Math.max(1, ...) is for — using ceil to buy it instead over-prepared by exactly one at
      // every ODD level, all the way to 19.
      return Math.max(1, Math.floor(level / 2) + spellMod);
    default:
      return null; // sorcerer, bard, ranger, warlock are known/spontaneous
  }
}
