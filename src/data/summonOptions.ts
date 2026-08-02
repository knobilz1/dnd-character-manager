import type { Companion } from '../types';

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
};

export function summonSpecFor(spellId: string): SummonSpec | undefined {
  return SUMMON_SPECS[spellId];
}
