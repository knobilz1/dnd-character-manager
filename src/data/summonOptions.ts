import type { Companion } from '../types';
import type { BeastForm } from './beastForms';
import { ALL_BEAST_FORMS } from './beastForms';
import { ALL_SUMMON_FORMS } from './summonForms';

/**
 * What a summoning spell lets you choose, and what the choice becomes.
 *
 * Several spells summon a creature the character then has to TRACK — hit points, conditions, its
 * own attacks — and the app already has somewhere to track it: a Companion, with its own pop-out
 * sheet. What was missing was the step in between. Casting Find Familiar left the player to add
 * the owl by hand from a panel that only offered Beast Master beasts.
 *
 * Keyed by spell id so the picker is data, not a switch statement: adding Find Steed or a Summon
 * spell is a new entry here plus its stat blocks, not new UI.
 */
export interface SummonOption {
  /** Stat block id in beastForms.ts — this is what the companion sheet reads. */
  beastId: string;
  label: string;
}

export interface SummonSpec {
  /** Decides how the companion's numbers scale — see utils/companion.ts. */
  kind: Companion['kind'];
  title: string;
  help: string;
  options: SummonOption[];
}

/**
 * PHB Find Familiar, all fifteen forms, every one of which already has a stat block.
 *
 * Pact of the Chain's imp / pseudodragon / quasit / sprite are deliberately NOT here: they are not
 * beasts and have no stat block in beastForms.ts, so offering them would produce a companion whose
 * sheet renders nothing. They need their stat blocks added first.
 */
export const SUMMON_SPECS: Record<string, SummonSpec> = {
  'find-familiar': {
    kind: 'familiar',
    title: 'Choose a familiar',
    help: 'The familiar uses the chosen stat block but is a celestial, fey, or fiend rather than a beast. It acts on your turn and can deliver touch spells.',
    options: [
      { beastId: 'bat',             label: 'Bat' },
      { beastId: 'cat',             label: 'Cat' },
      { beastId: 'crab',            label: 'Crab' },
      { beastId: 'frog',            label: 'Frog (toad)' },
      { beastId: 'hawk',            label: 'Hawk' },
      { beastId: 'lizard',          label: 'Lizard' },
      { beastId: 'octopus',         label: 'Octopus' },
      { beastId: 'owl',             label: 'Owl' },
      { beastId: 'poisonous-snake', label: 'Poisonous snake' },
      { beastId: 'quipper',         label: 'Fish (quipper)' },
      { beastId: 'rat',             label: 'Rat' },
      { beastId: 'raven',           label: 'Raven' },
      { beastId: 'sea-horse',       label: 'Sea horse' },
      { beastId: 'spider',          label: 'Spider' },
      { beastId: 'weasel',          label: 'Weasel' },
    ],
  },
  'find-steed': {
    kind: 'summoned',
    title: 'Choose a steed',
    help: 'The steed is a celestial, fey, or fiend and uses the chosen stat block. It disappears when it drops to 0 hit points.',
    options: [
      { beastId: 'warhorse', label: 'Warhorse' },
      { beastId: 'pony',     label: 'Pony' },
      { beastId: 'camel',    label: 'Camel' },
      { beastId: 'elk',      label: 'Elk' },
      { beastId: 'mastiff',  label: 'Mastiff' },
    ],
  },
  'find-greater-steed': {
    kind: 'summoned',
    title: 'Choose a greater steed',
    help: 'The steed is a celestial, fey, or fiend and uses the chosen stat block.',
    // Peryton is one of the six the spell offers and is the one creature here the SRD does not
    // cover, so it is left out rather than invented. Everything else is generated from source.
    options: [
      { beastId: 'griffon',             label: 'Griffon' },
      { beastId: 'pegasus',             label: 'Pegasus' },
      { beastId: 'dire-wolf',           label: 'Dire Wolf' },
      { beastId: 'rhinoceros',          label: 'Rhinoceros' },
      { beastId: 'saber-toothed-tiger', label: 'Saber-Toothed Tiger' },
    ],
  },
};

/**
 * Spells and ITEMS that summon a creature you then have to track. Items are keyed by name because
 * that is what an inventory row carries; spells by id.
 *
 * Everything here uses `summoned` — the stat block as printed, no owner scaling — which is what
 * Find Steed, a figurine and a commanded elemental all have in common. Stat blocks come from
 * summonForms.ts, generated from the SRD.
 *
 * Deliberately absent: Horn of Valhalla summons 2d4+2 berserkers, and Pipes of the Sewers a swarm.
 * Both stat blocks exist, but a crowd is not a companion — one card per creature would bury the
 * sheet, and neither is a thing the player controls for hours. They stay DM-side.
 */
export const ITEM_SUMMON_SPECS: Record<string, SummonSpec> = {
  'Figurine of Wondrous Power (Silver Raven)':   one('raven', 'Silver Raven'),
  'Figurine of Wondrous Power (Bronze Griffon)': one('griffon', 'Bronze Griffon'),
  'Figurine of Wondrous Power (Ebony Fly)':      one('giant-wasp', 'Ebony Fly'),
  'Figurine of Wondrous Power (Golden Lions)':   one('lion', 'Golden Lion'),
  'Figurine of Wondrous Power (Ivory Goats)':    {
    kind: 'summoned',
    title: 'Ivory Goats',
    help: 'Three goats, each with its own command word and its own use.',
    options: [
      { beastId: 'goat',       label: 'Goat of Traveling' },
      { beastId: 'giant-goat', label: 'Goat of Travail' },
    ],
  },
  'Figurine of Wondrous Power (Marble Elephant)':  one('elephant', 'Marble Elephant'),
  'Figurine of Wondrous Power (Obsidian Steed)':   one('nightmare', 'Obsidian Steed'),
  'Figurine of Wondrous Power (Onyx Dog)':         one('mastiff', 'Onyx Dog'),
  'Figurine of Wondrous Power (Serpentine Owl)':   one('giant-owl', 'Serpentine Owl'),
  'Bowl of Commanding Water Elementals':   one('water-elemental', 'Water Elemental'),
  'Brazier of Commanding Fire Elementals': one('fire-elemental', 'Fire Elemental'),
  'Censer of Controlling Air Elementals':  one('air-elemental', 'Air Elemental'),
  'Stone of Controlling Earth Elementals': one('earth-elemental', 'Earth Elemental'),
  'Elemental Gem (Blue Sapphire)':  one('water-elemental', 'Water Elemental'),
  'Elemental Gem (Red Corundum)':   one('fire-elemental', 'Fire Elemental'),
  'Elemental Gem (Emerald)':        one('air-elemental', 'Air Elemental'),
  'Elemental Gem (Yellow Diamond)': one('earth-elemental', 'Earth Elemental'),
  'Ring of Djinni Summoning':       one('djinni', 'Djinni'),
};

/** A summon with exactly one possible creature — still worth a confirm step, and it keeps the
 *  creation path identical to the ones that do offer a choice. */
function one(beastId: string, label: string): SummonSpec {
  return {
    kind: 'summoned',
    title: `Summon ${label}`,
    help: 'It uses its stat block as printed and acts on your turn.',
    options: [{ beastId, label }],
  };
}

export function summonSpecFor(spellId: string): SummonSpec | undefined {
  return SUMMON_SPECS[spellId];
}

export function itemSummonSpecFor(itemName: string): SummonSpec | undefined {
  return ITEM_SUMMON_SPECS[itemName];
}

/**
 * A summon option's stat block, from whichever pool holds it.
 *
 * Lives here rather than in summonForms.ts because that file is GENERATED and a helper added to it
 * would vanish on the next run of gen_summon_forms.py.
 */
export function resolveCreatureForm(id: string): BeastForm | undefined {
  return ALL_BEAST_FORMS.find(f => f.id === id) ?? ALL_SUMMON_FORMS.find(f => f.id === id);
}
