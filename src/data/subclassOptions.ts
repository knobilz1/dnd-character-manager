import type { SubclassOptionGroup } from '../types';

/**
 * D4 — subclass BUILD choices, the ones that persist and must be prompted once.
 *
 * The audit found 103 subclass features containing choice language, of which only two were ever
 * prompted. Hand triage split them: ~95 are use-time (re-chosen on each rage, rest or activation,
 * and correctly need no storage), and 23 are build choices that go unrecorded — so nothing
 * downstream can act on them.
 *
 * Three were already solved before this file existed, with named fields on `ClassOptionsState`:
 * Totem Warrior (three of them), Battle Master manoeuvres, and Circle of the Land's land type.
 * Those are deliberately left where they are — they work end to end, and renaming them would
 * orphan every saved character that already carries one.
 *
 * `picksByLevel` is CUMULATIVE. Arcane Archer knows 2 Arcane Shots at level 3 and 3 at level 7, so
 * it reads `{ 3: 2, 7: 3 }`. Deltas would let a character who multiclassed out and back accumulate
 * extra picks.
 *
 * Every list below is transcribed from the book, with the page-anchored source named per group.
 */
export const SUBCLASS_OPTIONS: Record<string, SubclassOptionGroup[]> = {

  // PHB p.102. The chosen dragon determines a damage type, which Elemental Affinity (6th) then
  // keys off — this is the one D4 choice with a directly mechanical consequence, which is why it
  // is first.
  'draconic-bloodline': [{
    key: 'dragonAncestor',
    label: 'Dragon Ancestor',
    picksByLevel: { 1: 1 },
    choices: [
      { id: 'black', name: 'Black', description: 'Acid' },
      { id: 'blue', name: 'Blue', description: 'Lightning' },
      { id: 'brass', name: 'Brass', description: 'Fire' },
      { id: 'bronze', name: 'Bronze', description: 'Lightning' },
      { id: 'copper', name: 'Copper', description: 'Acid' },
      { id: 'gold', name: 'Gold', description: 'Fire' },
      { id: 'green', name: 'Green', description: 'Poison' },
      { id: 'red', name: 'Red', description: 'Fire' },
      { id: 'silver', name: 'Silver', description: 'Cold' },
      { id: 'white', name: 'White', description: 'Cold' },
    ],
  }],

  // PHB 2024 splits what 2014 did in one step: the ancestor is picked at 3, and Elemental Affinity
  // at 6 names the damage type you resist. The 2024 list is by damage type, not by dragon colour.
  'draconic-bloodline-2024': [{
    key: 'draconicAncestor2024',
    label: 'Draconic Ancestor',
    picksByLevel: { 3: 1 },
    choices: [
      { id: 'acid', name: 'Acid' },
      { id: 'cold', name: 'Cold' },
      { id: 'fire', name: 'Fire' },
      { id: 'lightning', name: 'Lightning' },
      { id: 'poison', name: 'Poison' },
    ],
  }],

  // XGtE p.50. The affinity grants one extra spell that does not count against spells known.
  'divine-soul': [{
    key: 'divineAffinity',
    label: 'Divine Magic affinity',
    picksByLevel: { 1: 1 },
    choices: [
      { id: 'good', name: 'Good', description: 'Cure Wounds' },
      { id: 'evil', name: 'Evil', description: 'Inflict Wounds' },
      { id: 'law', name: 'Law', description: 'Bless' },
      { id: 'chaos', name: 'Chaos', description: 'Bane' },
      { id: 'neutrality', name: 'Neutrality', description: 'Protection from Evil and Good' },
    ],
  }],

  // TCE p.31. Hill and Storm carry a level prerequisite, which the picker enforces by only
  // offering them once the character qualifies.
  'rune-knight': [{
    key: 'runes',
    label: 'Runes known',
    picksByLevel: { 3: 2, 7: 3, 10: 4, 15: 5 },
    choices: [
      { id: 'cloud', name: 'Cloud Rune', description: 'Redirect an attack to another creature' },
      { id: 'fire', name: 'Fire Rune', description: 'Extra fire damage and restrain on a hit' },
      { id: 'frost', name: 'Frost Rune', description: '+2 to Strength and Constitution rolls' },
      { id: 'stone', name: 'Stone Rune', description: 'Charm a creature that ends its turn near you' },
      { id: 'hill', name: 'Hill Rune (7th)', description: 'Resistance to bludgeoning, piercing and slashing' },
      { id: 'storm', name: 'Storm Rune (7th)', description: 'Grant advantage or impose disadvantage on a roll' },
    ],
  }],

  // XGtE p.29.
  'arcane-archer': [{
    key: 'arcaneShots',
    label: 'Arcane Shot options',
    picksByLevel: { 3: 2, 7: 3, 10: 4, 15: 5, 18: 6 },
    choices: [
      { id: 'banishing', name: 'Banishing Arrow', description: 'Banish the target until the end of its next turn' },
      { id: 'beguiling', name: 'Beguiling Arrow', description: 'Psychic damage and charm the target toward an ally' },
      { id: 'bursting', name: 'Bursting Arrow', description: 'Force damage to everything within 10 feet' },
      { id: 'enfeebling', name: 'Enfeebling Arrow', description: 'Necrotic damage and halve the target’s weapon damage' },
      { id: 'grasping', name: 'Grasping Arrow', description: 'Poison damage, reduce speed, and damage on movement' },
      { id: 'piercing', name: 'Piercing Arrow', description: 'Pierce through everything in a line' },
      { id: 'seeking', name: 'Seeking Arrow', description: 'Curve around cover to find an unseen target' },
      { id: 'shadow', name: 'Shadow Arrow', description: 'Psychic damage and blind the target beyond 5 feet' },
    ],
  }],

  // PHB p.93. Both are chosen once and kept — the 2024 Hunter re-chooses them on a rest, which is
  // why hunter-2024 is deliberately absent from this file.
  'hunter': [
    {
      key: 'huntersPrey',
      label: "Hunter's Prey",
      picksByLevel: { 3: 1 },
      choices: [
        { id: 'colossus-slayer', name: 'Colossus Slayer', description: '+1d8 against a wounded creature, once per turn' },
        { id: 'giant-killer', name: 'Giant Killer', description: 'Reaction attack when a Large or larger creature misses you' },
        { id: 'horde-breaker', name: 'Horde Breaker', description: 'A second attack against a different adjacent creature' },
      ],
    },
    {
      key: 'defensiveTactics',
      label: 'Defensive Tactics',
      picksByLevel: { 7: 1 },
      choices: [
        { id: 'escape-the-horde', name: 'Escape the Horde', description: 'Opportunity attacks against you have disadvantage' },
        { id: 'multiattack-defense', name: 'Multiattack Defense', description: '+4 AC against a creature’s follow-up attacks' },
        { id: 'steel-will', name: 'Steel Will', description: 'Advantage on saves against being frightened' },
      ],
    },
    {
      key: 'multiattack',
      label: 'Multiattack',
      picksByLevel: { 11: 1 },
      choices: [
        { id: 'volley', name: 'Volley', description: 'A ranged attack against every creature in a 10-foot radius' },
        { id: 'whirlwind-attack', name: 'Whirlwind Attack', description: 'A melee attack against every creature within 5 feet' },
      ],
    },
    {
      key: 'superiorHuntersDefense',
      label: "Superior Hunter's Defense",
      picksByLevel: { 15: 1 },
      choices: [
        { id: 'evasion', name: 'Evasion', description: 'No damage on a successful Dexterity save' },
        { id: 'stand-against-the-tide', name: 'Stand Against the Tide', description: 'Redirect a miss into another creature' },
        { id: 'uncanny-dodge', name: 'Uncanny Dodge', description: 'Halve the damage of one attack you can see' },
      ],
    },
  ],

  // FToD p.14. Fixes the element for Breath of the Dragon.
  'way-of-the-ascendant-dragon': [{
    key: 'draconicElement',
    label: 'Draconic element',
    picksByLevel: { 3: 1 },
    choices: [
      { id: 'acid', name: 'Acid' },
      { id: 'cold', name: 'Cold' },
      { id: 'fire', name: 'Fire' },
      { id: 'lightning', name: 'Lightning' },
      { id: 'poison', name: 'Poison' },
    ],
  }],

  // PHB 2024. The companion is a summoned stat block, so the choice is a build choice rather than
  // the 2014 version's fragile permanent pet.
  'beast-master-2024': [{
    key: 'primalCompanion',
    label: 'Primal Companion',
    picksByLevel: { 3: 1 },
    choices: [
      { id: 'land', name: 'Beast of the Land', description: 'Charge knocks the target prone' },
      { id: 'sea', name: 'Beast of the Sea', description: 'Swim speed; its hit can grapple' },
      { id: 'sky', name: 'Beast of the Sky', description: 'Fly speed; hit and run' },
    ],
  }],
};

/** The option groups a subclass offers, or an empty list. */
export function getSubclassOptions(subclassId: string | undefined): SubclassOptionGroup[] {
  return (subclassId && SUBCLASS_OPTIONS[subclassId]) || [];
}

/** How many picks this group allows at the given level in that class. Cumulative — see the note
 *  on `picksByLevel`. Returns the highest entry at or below `level`, so a gap is not a reset. */
export function picksAllowed(group: SubclassOptionGroup, level: number): number {
  let n = 0;
  for (const [lvl, count] of Object.entries(group.picksByLevel)) {
    if (level >= Number(lvl)) n = Math.max(n, count);
  }
  return n;
}

/** Damage type a Draconic Bloodline sorcerer's ancestry grants, for Elemental Affinity.
 *  The whole reason Dragon Ancestor is worth storing: without it, the 6th-level feature has no
 *  damage type to attach to and simply does nothing. */
export const DRAGON_DAMAGE: Record<string, string> = {
  black: 'acid', copper: 'acid',
  blue: 'lightning', bronze: 'lightning',
  brass: 'fire', gold: 'fire', red: 'fire',
  green: 'poison',
  silver: 'cold', white: 'cold',
};
