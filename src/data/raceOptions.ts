import type { DamageType } from '../types';

/**
 * Racial trait choices — the "choose one" decisions a race's traits demand
 * (Draconic Ancestry, Fiendish Legacy, Giant Ancestry, …), which until now
 * existed only as prose inside trait descriptions: nothing recorded them, no
 * picker offered them, and the auto-generator shipped dragonborn with no
 * ancestry at all.
 *
 * The chosen values live in `Character.raceOptions` (keyed by group key) and
 * are picked on the sheet's Traits panel; `rollRandomCharacter` picks them
 * automatically. Where a choice decides a damage resistance, `resistance`
 * carries it and `resistancesOf` reads it — the rest of a choice's mechanics
 * (lineage spells, boon actions, the Keen Senses skill) are DISPLAY-LEVEL for
 * now: recorded and shown, not yet wired into derived stats. Wire them here,
 * not in per-race special cases, when they grow mechanics.
 */

export interface RaceOptionChoice {
  value: string;
  label: string;
  /** Short mechanical reminder shown beside the label. */
  note?: string;
  /** Damage resistance this choice grants — read by resistancesOf. */
  resistance?: DamageType;
}

export interface RaceOptionGroup {
  /** Stable storage key in Character.raceOptions. Never rename casually. */
  key: string;
  label: string;
  /** Total character level the choice unlocks at (Simic's 5th-level enhancement). */
  minLevel?: number;
  /** Another group in the same race whose picked value this one may not repeat. */
  excludesKey?: string;
  options: RaceOptionChoice[];
}

const d = (value: string, label: string, resistance: DamageType): RaceOptionChoice =>
  ({ value, label, note: resistance[0].toUpperCase() + resistance.slice(1), resistance });

/** The PHB's ten-dragon table, shared verbatim by every standard dragonborn. */
const STANDARD_DRAGON_TABLE: RaceOptionChoice[] = [
  d('black', 'Black', 'acid'),
  d('blue', 'Blue', 'lightning'),
  d('brass', 'Brass', 'fire'),
  d('bronze', 'Bronze', 'lightning'),
  d('copper', 'Copper', 'acid'),
  d('gold', 'Gold', 'fire'),
  d('green', 'Green', 'poison'),
  d('red', 'Red', 'fire'),
  d('silver', 'Silver', 'cold'),
  d('white', 'White', 'cold'),
];

const DRACONIC_ANCESTRY: RaceOptionGroup = {
  key: 'draconic-ancestry',
  label: 'Draconic Ancestry',
  options: STANDARD_DRAGON_TABLE,
};

const SIZE_CHOICE: RaceOptionGroup = {
  key: 'size',
  label: 'Size',
  options: [
    { value: 'medium', label: 'Medium' },
    { value: 'small', label: 'Small' },
  ],
};

const SIMIC_ENHANCEMENTS_L1: RaceOptionChoice[] = [
  { value: 'manta-glide', label: 'Manta Glide', note: 'glide; soften falls' },
  { value: 'nimble-climber', label: 'Nimble Climber', note: 'climb speed' },
  { value: 'underwater-adaptation', label: 'Underwater Adaptation', note: 'breathe water; swim speed' },
];

export const RACE_OPTION_GROUPS: Record<string, RaceOptionGroup[]> = {
  // ── Dragonborn, every family ─────────────────────────────────────────────
  dragonborn: [DRACONIC_ANCESTRY],
  'dragonborn-draconblood': [DRACONIC_ANCESTRY],
  'dragonborn-ravenite': [DRACONIC_ANCESTRY],
  'dragonborn-2024': [DRACONIC_ANCESTRY],
  'dragonborn-chromatic': [{
    key: 'chromatic-ancestry',
    label: 'Chromatic Ancestry',
    options: [
      d('black', 'Black', 'acid'), d('blue', 'Blue', 'lightning'), d('green', 'Green', 'poison'),
      d('red', 'Red', 'fire'), d('white', 'White', 'cold'),
    ],
  }],
  'dragonborn-metallic': [{
    key: 'metallic-ancestry',
    label: 'Metallic Ancestry',
    options: [
      d('brass', 'Brass', 'fire'), d('bronze', 'Bronze', 'lightning'), d('copper', 'Copper', 'acid'),
      d('gold', 'Gold', 'fire'), d('silver', 'Silver', 'cold'),
    ],
  }],
  'dragonborn-gem': [{
    key: 'gem-ancestry',
    label: 'Gem Ancestry',
    options: [
      d('amethyst', 'Amethyst', 'force'), d('crystal', 'Crystal', 'radiant'),
      d('emerald', 'Emerald', 'psychic'), d('sapphire', 'Sapphire', 'thunder'),
      d('topaz', 'Topaz', 'necrotic'),
    ],
  }],

  // ── PHB 2024 species ─────────────────────────────────────────────────────
  'tiefling-2024': [
    {
      key: 'fiendish-legacy',
      label: 'Fiendish Legacy',
      options: [
        { value: 'abyssal', label: 'Abyssal', note: 'Poison resistance; Poison Spray', resistance: 'poison' },
        { value: 'chthonic', label: 'Chthonic', note: 'Necrotic resistance; Chill Touch', resistance: 'necrotic' },
        { value: 'infernal', label: 'Infernal', note: 'Fire resistance; Fire Bolt', resistance: 'fire' },
      ],
    },
    SIZE_CHOICE,
  ],
  'aasimar-2024': [SIZE_CHOICE],
  'elf-2024': [
    {
      key: 'elven-lineage',
      label: 'Elven Lineage',
      options: [
        { value: 'drow', label: 'Drow', note: 'Darkvision 120 ft; Dancing Lights' },
        { value: 'high-elf', label: 'High Elf', note: 'Prestidigitation' },
        { value: 'wood-elf', label: 'Wood Elf', note: 'Speed 35 ft; Druidcraft' },
      ],
    },
    {
      key: 'keen-senses',
      label: 'Keen Senses',
      options: [
        { value: 'insight', label: 'Insight' },
        { value: 'perception', label: 'Perception' },
        { value: 'survival', label: 'Survival' },
      ],
    },
  ],
  'gnome-2024': [{
    key: 'gnomish-lineage',
    label: 'Gnomish Lineage',
    options: [
      { value: 'forest', label: 'Forest Gnome', note: 'Minor Illusion; Speak with Animals' },
      { value: 'rock', label: 'Rock Gnome', note: 'Mending, Prestidigitation; clockwork devices' },
    ],
  }],
  'goliath-2024': [{
    key: 'giant-ancestry',
    label: 'Giant Ancestry',
    options: [
      { value: 'clouds-jaunt', label: "Cloud's Jaunt", note: 'bonus action 30 ft teleport' },
      { value: 'fires-burn', label: "Fire's Burn", note: '+1d10 fire on a hit' },
      { value: 'frosts-chill', label: "Frost's Chill", note: '+1d6 cold, slow 10 ft' },
      { value: 'hills-tumble', label: "Hill's Tumble", note: 'knock a hit target prone' },
      { value: 'stones-endurance', label: "Stone's Endurance", note: 'reaction: reduce damage 1d12+Con' },
      { value: 'storms-thunder', label: "Storm's Thunder", note: 'reaction: 1d8 thunder back' },
    ],
  }],

  // ── Simic Hybrid ─────────────────────────────────────────────────────────
  'simic-hybrid': [
    {
      key: 'animal-enhancement-1',
      label: 'Animal Enhancement (1st level)',
      options: SIMIC_ENHANCEMENTS_L1,
    },
    {
      key: 'animal-enhancement-5',
      label: 'Animal Enhancement (5th level)',
      minLevel: 5,
      excludesKey: 'animal-enhancement-1',
      options: [
        ...SIMIC_ENHANCEMENTS_L1,
        { value: 'grappling-appendages', label: 'Grappling Appendages', note: '1d6+Str claws; bonus-action grapple' },
        { value: 'carapace', label: 'Carapace', note: '+1 AC without heavy armor' },
        { value: 'acid-spit', label: 'Acid Spit', note: '30 ft, 2d10 acid, Dex save' },
      ],
    },
  ],
};

/** The groups this race owes AT this total level, in declaration order. */
export function raceOptionGroups(raceId: string | undefined, totalLevel: number): RaceOptionGroup[] {
  if (!raceId) return [];
  return (RACE_OPTION_GROUPS[raceId] ?? []).filter(g => totalLevel >= (g.minLevel ?? 1));
}

/** Damage resistances granted by the choices actually made. */
export function raceOptionResistances(
  raceId: string | undefined, picks: Record<string, string> | undefined,
): DamageType[] {
  if (!raceId || !picks) return [];
  const out: DamageType[] = [];
  for (const g of RACE_OPTION_GROUPS[raceId] ?? []) {
    const chosen = g.options.find(o => o.value === picks[g.key]);
    if (chosen?.resistance) out.push(chosen.resistance);
  }
  return out;
}
