import type { BeastFormSpeed, BeastFormAttack, ActiveWildShape } from '../types';

// Re-export the data interface locally for brevity
export interface BeastForm {
  id: string;
  name: string;
  cr: number | string;
  size: 'Tiny' | 'Small' | 'Medium' | 'Large' | 'Huge';
  hp: number;
  ac: number;
  str: number;
  dex: number;
  con: number;
  speed: BeastFormSpeed;
  attacks: BeastFormAttack[];
  specialAbilities?: string[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function crToNumber(cr: number | string): number {
  if (typeof cr === 'number') return cr;
  const parts = cr.split('/');
  return parts.length === 2 ? Number(parts[0]) / Number(parts[1]) : Number(cr);
}

/**
 * Returns the maximum CR (as a decimal) a druid can use with Wild Shape.
 * Returns -1 if Wild Shape is not yet available.
 */
export function maxWildShapeCR(druidLevel: number, isMoon: boolean): number {
  if (druidLevel < 2) return -1;
  if (isMoon) return Math.max(1, Math.floor(druidLevel / 3));
  if (druidLevel >= 8) return 1;
  if (druidLevel >= 4) return 0.5;
  return 0.25; // levels 2-3
}

/** Whether a druid can use beast forms with a flying speed. */
export function wildShapeCanFly(druidLevel: number, isMoon: boolean): boolean {
  return isMoon ? druidLevel >= 6 : druidLevel >= 8;
}

/** Whether a druid can use beast forms with a swimming speed (base druid only). */
export function wildShapeCanSwim(druidLevel: number): boolean {
  return druidLevel >= 4;
}

/** Whether a given beast is usable at the given druid level. */
export function canUseBeast(beast: BeastForm, druidLevel: number, isMoon: boolean): boolean {
  if (crToNumber(beast.cr) > maxWildShapeCR(druidLevel, isMoon)) return false;
  if (beast.speed.fly && !wildShapeCanFly(druidLevel, isMoon)) return false;
  if (beast.speed.swim && !wildShapeCanSwim(druidLevel)) return false;
  return true;
}

/** Build an ActiveWildShape from a BeastForm (sets currentHp = maxHp). */
export function beastFormToActive(beast: BeastForm): ActiveWildShape {
  return {
    id: beast.id,
    name: beast.name,
    cr: beast.cr,
    size: beast.size,
    maxHp: beast.hp,
    currentHp: beast.hp,
    ac: beast.ac,
    str: beast.str,
    dex: beast.dex,
    con: beast.con,
    speed: beast.speed,
    attacks: beast.attacks,
    specialAbilities: beast.specialAbilities,
  };
}

// ── Beast Stat Blocks (Monster Manual) ───────────────────────────────────────

export const ALL_BEAST_FORMS: BeastForm[] = [
  // ── CR 0 ────────────────────────────────────────────────────────────────
  {
    id: 'cat', name: 'Cat', cr: 0, size: 'Tiny', hp: 2, ac: 12,
    str: 3, dex: 15, con: 10,
    speed: { walk: 40, climb: 30 },
    attacks: [{ name: 'Claws', toHit: 0, damage: '1', damageType: 'slashing', notes: 'No damage if target AC is hit' }],
    specialAbilities: ['Keen Smell'],
  },
  {
    id: 'eagle', name: 'Eagle', cr: 0, size: 'Small', hp: 4, ac: 12,
    str: 6, dex: 15, con: 10,
    speed: { walk: 10, fly: 60 },
    attacks: [{ name: 'Talons', toHit: 4, damage: '1d4+2', damageType: 'slashing' }],
    specialAbilities: ['Keen Sight'],
  },
  {
    id: 'frog', name: 'Frog', cr: 0, size: 'Tiny', hp: 1, ac: 11,
    str: 1, dex: 13, con: 8,
    speed: { walk: 20, swim: 20 },
    attacks: [],
    specialAbilities: ['Amphibious', 'Standing Leap (jump 10 ft)'],
  },
  {
    id: 'octopus', name: 'Octopus', cr: 0, size: 'Small', hp: 3, ac: 12,
    str: 4, dex: 15, con: 11,
    speed: { walk: 5, swim: 30 },
    attacks: [{ name: 'Tentacles', toHit: 4, damage: '1d4+2', damageType: 'bludgeoning', notes: 'Grapple on hit (DC 10)' }],
    specialAbilities: ['Underwater Camouflage', 'Water Breathing'],
  },
  {
    id: 'rat', name: 'Rat', cr: 0, size: 'Tiny', hp: 1, ac: 10,
    str: 2, dex: 11, con: 9,
    speed: { walk: 20, climb: 20 },
    attacks: [{ name: 'Bite', toHit: 0, damage: '1', damageType: 'piercing' }],
    specialAbilities: ['Keen Smell'],
  },

  // ── CR 1/8 ──────────────────────────────────────────────────────────────
  {
    id: 'blood-hawk', name: 'Blood Hawk', cr: '1/8', size: 'Small', hp: 7, ac: 13,
    str: 6, dex: 14, con: 10,
    speed: { walk: 10, fly: 60 },
    attacks: [{ name: 'Beak', toHit: 4, damage: '1d4+2', damageType: 'piercing' }],
    specialAbilities: ['Keen Sight', 'Pack Tactics'],
  },
  {
    id: 'giant-rat', name: 'Giant Rat', cr: '1/8', size: 'Small', hp: 7, ac: 12,
    str: 7, dex: 15, con: 11,
    speed: { walk: 30, swim: 10 },
    attacks: [{ name: 'Bite', toHit: 4, damage: '1d4+2', damageType: 'piercing' }],
    specialAbilities: ['Keen Smell', 'Pack Tactics'],
  },
  {
    id: 'mastiff', name: 'Mastiff', cr: '1/8', size: 'Medium', hp: 5, ac: 12,
    str: 13, dex: 14, con: 12,
    speed: { walk: 40 },
    attacks: [{ name: 'Bite', toHit: 3, damage: '1d6+1', damageType: 'piercing', notes: 'DC 11 STR or knocked prone' }],
    specialAbilities: ['Keen Hearing and Smell'],
  },
  {
    id: 'poisonous-snake', name: 'Poisonous Snake', cr: '1/8', size: 'Tiny', hp: 2, ac: 13,
    str: 2, dex: 16, con: 11,
    speed: { walk: 30, swim: 30 },
    attacks: [{ name: 'Bite', toHit: 5, damage: '1d4+3', damageType: 'piercing', notes: 'DC 10 CON or 2d4 poison dmg' }],
    specialAbilities: [],
  },

  // ── CR 1/4 ──────────────────────────────────────────────────────────────
  {
    id: 'constrictor-snake', name: 'Constrictor Snake', cr: '1/4', size: 'Large', hp: 13, ac: 12,
    str: 15, dex: 14, con: 11,
    speed: { walk: 30, swim: 30 },
    attacks: [
      { name: 'Bite', toHit: 4, damage: '1d6+2', damageType: 'piercing' },
      { name: 'Constrict', toHit: 4, damage: '1d8+2', damageType: 'bludgeoning', notes: 'Grapple on hit (escape DC 14), restrained while grappled' },
    ],
  },
  {
    id: 'giant-wolf-spider', name: 'Giant Wolf Spider', cr: '1/4', size: 'Medium', hp: 11, ac: 13,
    str: 12, dex: 16, con: 13,
    speed: { walk: 40, climb: 40 },
    attacks: [{ name: 'Bite', toHit: 3, damage: '1d6+1', damageType: 'piercing', notes: 'DC 11 CON or 2d6 poison; blinded if fail DC by 5+' }],
    specialAbilities: ['Spider Climb', 'Web Sense', 'Web Walker'],
  },
  {
    id: 'panther', name: 'Panther', cr: '1/4', size: 'Medium', hp: 13, ac: 12,
    str: 14, dex: 15, con: 10,
    speed: { walk: 50, climb: 40 },
    attacks: [
      { name: 'Bite', toHit: 4, damage: '1d6+2', damageType: 'piercing' },
      { name: 'Claws', toHit: 4, damage: '1d4+2', damageType: 'slashing' },
    ],
    specialAbilities: ['Keen Smell', 'Pounce (DC 12 STR or knocked prone, bonus bite as bonus action)'],
  },
  {
    id: 'wolf', name: 'Wolf', cr: '1/4', size: 'Medium', hp: 11, ac: 13,
    str: 12, dex: 15, con: 12,
    speed: { walk: 40 },
    attacks: [{ name: 'Bite', toHit: 4, damage: '2d4+2', damageType: 'piercing', notes: 'DC 11 STR or knocked prone' }],
    specialAbilities: ['Keen Hearing and Smell', 'Pack Tactics'],
  },

  // ── CR 1/2 ──────────────────────────────────────────────────────────────
  {
    id: 'ape', name: 'Ape', cr: '1/2', size: 'Medium', hp: 19, ac: 12,
    str: 16, dex: 14, con: 14,
    speed: { walk: 30, climb: 30 },
    attacks: [
      { name: 'Multiattack: 2 × Fist', toHit: 5, damage: '1d6+3', damageType: 'bludgeoning' },
      { name: 'Rock', toHit: 5, damage: '1d6+3', damageType: 'bludgeoning', range: '25/50 ft' },
    ],
  },
  {
    id: 'black-bear', name: 'Black Bear', cr: '1/2', size: 'Medium', hp: 19, ac: 11,
    str: 15, dex: 10, con: 14,
    speed: { walk: 40, climb: 30 },
    attacks: [
      { name: 'Bite', toHit: 4, damage: '1d6+2', damageType: 'piercing' },
      { name: 'Claws', toHit: 4, damage: '2d6+2', damageType: 'slashing' },
    ],
    specialAbilities: ['Keen Smell'],
  },
  {
    id: 'crocodile', name: 'Crocodile', cr: '1/2', size: 'Large', hp: 19, ac: 12,
    str: 15, dex: 10, con: 13,
    speed: { walk: 20, swim: 30 },
    attacks: [{ name: 'Bite', toHit: 4, damage: '1d10+2', damageType: 'piercing', notes: 'Grapple on hit (escape DC 12), restrained while grappled' }],
    specialAbilities: ['Hold Breath (15 min)'],
  },
  {
    id: 'warhorse', name: 'Warhorse', cr: '1/2', size: 'Large', hp: 19, ac: 11,
    str: 18, dex: 12, con: 13,
    speed: { walk: 60 },
    attacks: [{ name: 'Hooves', toHit: 6, damage: '2d6+4', damageType: 'bludgeoning' }],
    specialAbilities: ['Trampling Charge (DC 14 STR or knocked prone, bonus hooves)'],
  },

  // ── CR 1 ────────────────────────────────────────────────────────────────
  {
    id: 'brown-bear', name: 'Brown Bear', cr: 1, size: 'Large', hp: 34, ac: 11,
    str: 19, dex: 10, con: 16,
    speed: { walk: 40, climb: 30 },
    attacks: [
      { name: 'Bite', toHit: 5, damage: '1d8+4', damageType: 'piercing' },
      { name: 'Claws', toHit: 5, damage: '2d6+4', damageType: 'slashing' },
    ],
    specialAbilities: ['Keen Smell', 'Multiattack (bite + claws)'],
  },
  {
    id: 'dire-wolf', name: 'Dire Wolf', cr: 1, size: 'Large', hp: 37, ac: 14,
    str: 17, dex: 15, con: 15,
    speed: { walk: 50 },
    attacks: [{ name: 'Bite', toHit: 5, damage: '2d6+3', damageType: 'piercing', notes: 'DC 13 STR or knocked prone' }],
    specialAbilities: ['Keen Hearing and Smell', 'Pack Tactics'],
  },
  {
    id: 'giant-eagle', name: 'Giant Eagle', cr: 1, size: 'Large', hp: 26, ac: 13,
    str: 16, dex: 17, con: 13,
    speed: { walk: 10, fly: 80 },
    attacks: [
      { name: 'Multiattack: 2 × Talons', toHit: 5, damage: '2d6+3', damageType: 'slashing' },
      { name: 'Beak', toHit: 5, damage: '1d6+3', damageType: 'piercing' },
    ],
    specialAbilities: ['Keen Sight'],
  },
  {
    id: 'giant-toad', name: 'Giant Toad', cr: 1, size: 'Large', hp: 39, ac: 11,
    str: 15, dex: 13, con: 11,
    speed: { walk: 20, swim: 40 },
    attacks: [{ name: 'Bite', toHit: 4, damage: '1d10+2', damageType: 'piercing', notes: 'Grapple on hit (DC 13), swallow if grappled (2d6 acid/turn)' }],
    specialAbilities: ['Amphibious', 'Standing Leap', 'Swallow'],
  },
  {
    id: 'giant-hyena', name: 'Giant Hyena', cr: 1, size: 'Large', hp: 45, ac: 12,
    str: 16, dex: 14, con: 14,
    speed: { walk: 50 },
    attacks: [{ name: 'Bite', toHit: 5, damage: '2d6+3', damageType: 'piercing' }],
    specialAbilities: ['Rampage (bonus bite when reduce to 0 HP)'],
  },

  // ── CR 2 ────────────────────────────────────────────────────────────────
  {
    id: 'cave-bear', name: 'Cave Bear', cr: 2, size: 'Large', hp: 42, ac: 12,
    str: 20, dex: 10, con: 16,
    speed: { walk: 40, swim: 30 },
    attacks: [
      { name: 'Bite', toHit: 7, damage: '2d6+5', damageType: 'piercing' },
      { name: 'Claws', toHit: 7, damage: '2d8+5', damageType: 'slashing' },
    ],
    specialAbilities: ['Keen Smell', 'Multiattack (bite + claws)'],
  },
  {
    id: 'giant-constrictor-snake', name: 'Giant Constrictor Snake', cr: 2, size: 'Huge', hp: 60, ac: 12,
    str: 19, dex: 14, con: 12,
    speed: { walk: 30, swim: 30 },
    attacks: [
      { name: 'Bite', toHit: 6, damage: '1d8+4', damageType: 'piercing' },
      { name: 'Constrict', toHit: 6, damage: '2d8+4', damageType: 'bludgeoning', notes: 'Grapple on hit (escape DC 16), restrained' },
    ],
  },
  {
    id: 'polar-bear', name: 'Polar Bear', cr: 2, size: 'Large', hp: 42, ac: 12,
    str: 20, dex: 10, con: 16,
    speed: { walk: 40, swim: 30 },
    attacks: [
      { name: 'Bite', toHit: 7, damage: '1d8+5', damageType: 'piercing' },
      { name: 'Claws', toHit: 7, damage: '2d6+5', damageType: 'slashing' },
    ],
    specialAbilities: ['Keen Smell', 'Multiattack (bite + claws)'],
  },
  {
    id: 'rhinoceros', name: 'Rhinoceros', cr: 2, size: 'Large', hp: 45, ac: 11,
    str: 21, dex: 8, con: 15,
    speed: { walk: 40 },
    attacks: [{ name: 'Gore', toHit: 7, damage: '2d8+5', damageType: 'bludgeoning', notes: 'Charge: DC 15 STR or knocked prone + bonus gore' }],
    specialAbilities: ['Trampling Charge'],
  },

  // ── CR 3 ────────────────────────────────────────────────────────────────
  {
    id: 'ankylosaurus', name: 'Ankylosaurus', cr: 3, size: 'Huge', hp: 68, ac: 15,
    str: 19, dex: 11, con: 15,
    speed: { walk: 30 },
    attacks: [{ name: 'Tail', toHit: 6, damage: '4d6+4', damageType: 'bludgeoning', notes: 'DC 14 STR or knocked prone' }],
  },
  {
    id: 'giant-scorpion', name: 'Giant Scorpion', cr: 3, size: 'Large', hp: 52, ac: 15,
    str: 15, dex: 13, con: 15,
    speed: { walk: 40 },
    attacks: [
      { name: 'Claw ×2', toHit: 4, damage: '1d8+2', damageType: 'bludgeoning', notes: 'Grapple on hit (escape DC 12)' },
      { name: 'Sting', toHit: 4, damage: '1d10+2', damageType: 'piercing', notes: 'DC 12 CON or 4d10 poison, half on save' },
    ],
    specialAbilities: ['Multiattack (2 claws + sting)'],
  },

  // ── CR 4–6 (Circle of the Moon) ─────────────────────────────────────────
  {
    id: 'elephant', name: 'Elephant', cr: 4, size: 'Huge', hp: 76, ac: 12,
    str: 22, dex: 9, con: 17,
    speed: { walk: 40 },
    attacks: [
      { name: 'Gore', toHit: 8, damage: '3d8+6', damageType: 'piercing' },
      { name: 'Stomp', toHit: 8, damage: '3d10+6', damageType: 'bludgeoning', notes: 'Only vs prone targets' },
    ],
    specialAbilities: ['Trampling Charge (DC 12 STR or prone + stomp)'],
  },
  {
    id: 'triceratops', name: 'Triceratops', cr: 5, size: 'Huge', hp: 114, ac: 13,
    str: 22, dex: 9, con: 17,
    speed: { walk: 50 },
    attacks: [{ name: 'Gore', toHit: 9, damage: '4d8+6', damageType: 'piercing', notes: 'Trampling Charge: DC 13 STR or knocked prone' }],
    specialAbilities: ['Trampling Charge'],
  },
  {
    id: 'mammoth', name: 'Mammoth', cr: 6, size: 'Huge', hp: 126, ac: 13,
    str: 24, dex: 9, con: 21,
    speed: { walk: 40 },
    attacks: [
      { name: 'Gore', toHit: 11, damage: '4d8+7', damageType: 'piercing' },
      { name: 'Stomp', toHit: 11, damage: '4d10+7', damageType: 'bludgeoning', notes: 'Only vs prone targets' },
    ],
    specialAbilities: ['Trampling Charge (DC 18 STR or prone + stomp)'],
  },
];

// Ordered CR tiers for the picker UI
export const CR_ORDER = ['0', '1/8', '1/4', '1/2', '1', '2', '3', '4', '5', '6'] as const;

export function crLabel(cr: number | string): string {
  return `CR ${cr}`;
}

/** Beast forms grouped by CR string for the picker. */
export function getBeastFormsByCR(): Record<string, BeastForm[]> {
  const result: Record<string, BeastForm[]> = {};
  for (const beast of ALL_BEAST_FORMS) {
    const key = String(beast.cr);
    if (!result[key]) result[key] = [];
    result[key].push(beast);
  }
  return result;
}

// ── Elemental Forms (Circle of the Moon, level 10+) ──────────────────────────

export const ELEMENTAL_FORMS: BeastForm[] = [
  {
    id: 'air-elemental', name: 'Air Elemental', cr: 5, size: 'Large', hp: 90, ac: 15,
    str: 14, dex: 20, con: 14,
    speed: { walk: 0, fly: 90 },
    attacks: [
      { name: 'Slam ×2', toHit: 8, damage: '2d8+5', damageType: 'bludgeoning' },
      { name: 'Whirlwind', toHit: 0, damage: '3d8+5', damageType: 'bludgeoning', notes: 'DC 13 STR or flung 20 ft' },
    ],
    specialAbilities: ['Air Form (move through 1-inch space)', 'Resistance: lightning, thunder, bludgeoning/piercing/slashing (nonmagical)'],
  },
  {
    id: 'earth-elemental', name: 'Earth Elemental', cr: 5, size: 'Large', hp: 126, ac: 17,
    str: 20, dex: 8, con: 20,
    speed: { walk: 30, burrow: 30 },
    attacks: [
      { name: 'Slam ×2', toHit: 8, damage: '2d8+5', damageType: 'bludgeoning' },
    ],
    specialAbilities: ['Earth Glide (burrow through stone)', 'Siege Monster (double damage to structures)', 'Resistance: bludgeoning/piercing/slashing (nonmagical)', 'Immune: poison, exhaustion, paralyzed, petrified, unconscious'],
  },
  {
    id: 'fire-elemental', name: 'Fire Elemental', cr: 5, size: 'Large', hp: 102, ac: 13,
    str: 10, dex: 17, con: 16,
    speed: { walk: 50 },
    attacks: [
      { name: 'Touch ×2', toHit: 6, damage: '2d6+3', damageType: 'fire', notes: 'Ignites target (1d10 fire at start of their turn)' },
    ],
    specialAbilities: ['Fire Form (move through 1-inch space, touch ignites)', 'Illumination (bright 30 ft, dim 30 ft)', 'Water Susceptibility (5 cold per 5 ft water)'],
  },
  {
    id: 'water-elemental', name: 'Water Elemental', cr: 5, size: 'Large', hp: 114, ac: 14,
    str: 18, dex: 14, con: 18,
    speed: { walk: 30, swim: 90 },
    attacks: [
      { name: 'Slam ×2', toHit: 7, damage: '2d8+4', damageType: 'bludgeoning' },
      { name: 'Whelm', toHit: 7, damage: '2d8+4', damageType: 'bludgeoning', notes: 'Grapple (escape DC 15); grappled/restrained/suffocating' },
    ],
    specialAbilities: ['Water Form (move through 1-inch space)', 'Freeze (reduce speed 20 ft if dealt cold damage)'],
  },
];
