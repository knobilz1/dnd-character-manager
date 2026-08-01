import type { SubclassOptionGroup } from '../types';
import { ALL_SPELLS } from './spells';

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
/** The 18 skills, as choices. Ids are `SkillName` verbatim so they merge into the proficiency set. */
const ALL_SKILL_CHOICES = [
  'Acrobatics', 'Animal Handling', 'Arcana', 'Athletics', 'Deception', 'History',
  'Insight', 'Intimidation', 'Investigation', 'Medicine', 'Nature', 'Perception',
  'Performance', 'Persuasion', 'Religion', 'Sleight of Hand', 'Stealth', 'Survival',
].map(s => ({ id: s, name: s }));


/** Cantrips from one class's spell list, as option choices.
 *
 *  Built from ALL_SPELLS rather than transcribed, because the list genuinely spans books — 20 druid
 *  and 35 wizard cantrips across seven of them — and a hand-copied list would silently rot every
 *  time a book was added. `sourceBook` rides along so the picker can hide what the table doesn't
 *  own, the same rule every other content filter in the app follows.
 */
function cantripChoices(spellListClassId: string) {
  return ALL_SPELLS
    .filter(s => s.level === 0 && s.classes.includes(spellListClassId))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(s => ({
      id: s.id,
      name: s.name,
      description: `${s.school}${s.damageType ? ' \u00b7 ' + s.damageType : ''}`,
      sourceBook: s.sourceBook,
    }));
}

/** The named pair Arcane Archer Lore offers, rather than a whole class list. */
function namedCantripChoices(ids: string[]) {
  return ids
    .map(id => ALL_SPELLS.find(s => s.id === id))
    .filter((s): s is NonNullable<typeof s> => !!s)
    .map(s => ({ id: s.id, name: s.name, description: s.school, sourceBook: s.sourceBook }));
}

export const SUBCLASS_OPTIONS: Record<string, SubclassOptionGroup[]> = {
  'scag-arcana-domain': [
    {
      key: 'arcaneInitiateCantrips',
      label: 'Arcane Initiate — Wizard Cantrips',
      picksByLevel: { 1: 2 },
      choices: cantripChoices('wizard'),
      grants: 'cantrip',
    },
  ],

  'circle-of-the-land': [
    {
      key: 'landBonusCantrip',
      label: 'Bonus Cantrip — Druid Cantrip',
      picksByLevel: { 2: 1 },
      choices: cantripChoices('druid'),
      grants: 'cantrip',
    },
  ],


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
  'arcane-archer': [
    {
      key: 'arcaneArcherLoreCantrip',
      label: 'Arcane Archer Lore — Cantrip',
      picksByLevel: { 3: 1 },
      choices: namedCantripChoices(['prestidigitation', 'druidcraft']),
      grants: 'cantrip',
    },
  {
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

  // PHB p.80. The monk knows Elemental Attunement for free and picks one other at 3rd, then one
  // more at 6th, 11th and 17th — so the CHOSEN count is 1/2/3/4 and Elemental Attunement is not in
  // the list. Without this the subclass is unplayable from the sheet: its entire content is which
  // disciplines you took. Level requirements are carried in the choice NAME, which is the
  // convention SubclassOptionsPicker already gates on (see Rune Knight).
  'way-of-the-four-elements': [{
    key: 'elementalDisciplines',
    label: 'Elemental Disciplines (Elemental Attunement is known for free)',
    picksByLevel: { 3: 1, 6: 2, 11: 3, 17: 4 },
    choices: [
      { id: 'fangs-of-the-fire-snake', name: 'Fangs of the Fire Snake', description: '1 ki — unarmed reach +10 ft, fire damage' },
      { id: 'fist-of-four-thunders', name: 'Fist of Four Thunders', description: '2 ki — thunderwave' },
      { id: 'fist-of-unbroken-air', name: 'Fist of Unbroken Air', description: '2 ki — 3d10 bludgeoning, push and prone' },
      { id: 'rush-of-the-gale-spirits', name: 'Rush of the Gale Spirits', description: '2 ki — gust of wind' },
      { id: 'shape-the-flowing-river', name: 'Shape the Flowing River', description: '1 ki — reshape ice and water' },
      { id: 'sweeping-cinder-strike', name: 'Sweeping Cinder Strike', description: '2 ki — burning hands' },
      { id: 'water-whip', name: 'Water Whip', description: '2 ki — 3d10 bludgeoning, prone or pull' },
      { id: 'clench-of-the-north-wind', name: 'Clench of the North Wind (6th)', description: '3 ki — hold person' },
      { id: 'gong-of-the-summit', name: 'Gong of the Summit (6th)', description: '3 ki — shatter' },
      { id: 'eternal-mountain-defense', name: 'Eternal Mountain Defense (11th)', description: '5 ki — stoneskin (self)' },
      { id: 'flames-of-the-phoenix', name: 'Flames of the Phoenix (11th)', description: '4 ki — fireball' },
      { id: 'mist-stance', name: 'Mist Stance (11th)', description: '4 ki — gaseous form (self)' },
      { id: 'ride-the-wind', name: 'Ride the Wind (11th)', description: '4 ki — fly (self)' },
      { id: 'breath-of-winter', name: 'Breath of Winter (17th)', description: '6 ki — cone of cold' },
      { id: 'river-of-hungry-flame', name: 'River of Hungry Flame (17th)', description: '5 ki — wall of fire' },
      { id: 'wave-of-rolling-earth', name: 'Wave of Rolling Earth (17th)', description: '6 ki — wall of stone' },
    ],
  }],

  // XGtE p.34: "any simple or martial weapon that lacks the heavy and special properties. The
  // longbow is also a valid choice." Two at 3rd, then one more at 6th, 11th and 17th.
  // Derived from items.ts rather than hand-typed: excluded the 8 heavy weapons and Net, then
  // dropped Lance (its description spells out the special property without using the word) and
  // added Longbow back per the explicit exception. Ids are WEAPON_TABLE names so the proficiency
  // grant below can resolve them through lookupWeapon.
  'way-of-the-kensei': [{
    key: 'kenseiWeapons',
    label: 'Kensei Weapons (at least one melee and one ranged)',
    picksByLevel: { 3: 2, 6: 3, 11: 4, 17: 5 },
    grants: 'weapon',
    choices: [
      'club', 'dagger', 'greatclub', 'handaxe', 'javelin', 'light hammer', 'mace', 'quarterstaff',
      'sickle', 'spear', 'battleaxe', 'flail', 'longsword', 'morningstar', 'rapier', 'scimitar',
      'shortsword', 'trident', 'war pick', 'warhammer', 'whip',
      'light crossbow', 'dart', 'shortbow', 'sling', 'blowgun', 'hand crossbow', 'longbow',
    ].map(w => ({ id: w, name: w.replace(/\b\w/g, c => c.toUpperCase()) })),
  }],

  // ── Subclass SKILL grants ──────────────────────────────────────────────────────────────────
  // These carry `grants: 'skill'`, so useCharacterDerived merges the picks straight into the skill
  // proficiency set. Before this they were feature prose only: the creator caps skill picks at the
  // CLASS's own `skillChoices.count`, so a College of Lore bard's three skills never existed.
  // Choice ids MUST be SkillName exactly as spelled in ALL_SKILLS or the merge silently misses.

  // PHB p.54, verified: "Bonus Proficiencies. When you join the College of Lore at 3rd level, you
  // gain proficiency with three skills of your choice." Any three — hence the full list.
  'college-of-lore': [{
    key: 'loreBonusSkills',
    label: 'Bonus Proficiencies — three skills of your choice',
    picksByLevel: { 3: 3 },
    grants: 'skill',
    choices: ALL_SKILL_CHOICES,
  }],

  // PHB 2024, verified: "BONUS PROFICIENCIES You gain proficiency with three skills of your choice."
  'college-of-lore-2024': [{
    key: 'loreBonusSkills2024',
    label: 'Bonus Proficiencies — three skills of your choice',
    picksByLevel: { 3: 3 },
    grants: 'skill',
    choices: ALL_SKILL_CHOICES,
  }],

  // PHB p.62, verified: "Acolyte of Nature. At 1st level, you learn one druid cantrip of your
  // choice. You also gain proficiency in one of the following skills of your choice: Animal
  // Handling, Nature, or Survival." (The cantrip half is not modelled here — cantrips live in the
  // spellbook, not in this mechanism.)
  'nature-domain': [
    {
      key: 'acolyteOfNatureCantrip',
      label: 'Acolyte of Nature — Druid Cantrip',
      picksByLevel: { 1: 1 },
      choices: cantripChoices('druid'),
      grants: 'cantrip',
    },
  {
    key: 'acolyteOfNatureSkill',
    label: 'Acolyte of Nature — skill proficiency',
    picksByLevel: { 1: 1 },
    grants: 'skill',
    choices: [
      { id: 'Animal Handling', name: 'Animal Handling' },
      { id: 'Nature', name: 'Nature' },
      { id: 'Survival', name: 'Survival' },
    ],
  }],

  // SCAG p.129, verified: "At 7th level, you gain proficiency in the Persuasion skill. If you are
  // already proficient in it, you gain proficiency in one of the following skills of your choice:
  // Animal Handling, Insight, Intimidation, or Performance."
  // Modelled as one pick across all five rather than as conditional machinery: take Persuasion
  // normally, or the alternative when you already have it. The doubled Persuasion this feature also
  // grants is separate and already handled in useCharacterDerived.
  'scag-purple-dragon-knight': [{
    key: 'royalEnvoySkill',
    label: 'Royal Envoy — Persuasion, or another skill if already proficient',
    picksByLevel: { 7: 1 },
    grants: 'skill',
    choices: [
      { id: 'Persuasion', name: 'Persuasion', description: 'The default grant' },
      { id: 'Animal Handling', name: 'Animal Handling', description: 'Only if already proficient in Persuasion' },
      { id: 'Insight', name: 'Insight', description: 'Only if already proficient in Persuasion' },
      { id: 'Intimidation', name: 'Intimidation', description: 'Only if already proficient in Persuasion' },
      { id: 'Performance', name: 'Performance', description: 'Only if already proficient in Persuasion' },
    ],
  }],

  // PHB 2024 Fey Wanderer, Otherworldly Glamour. Source note: this one is taken from the app's own
  // feature text (itself audited for wording in June 2026) rather than the PDF — the Fey Wanderer
  // entry does not survive text extraction from the 2024 scan.
  'fey-wanderer-2024': [{
    key: 'otherworldlyGlamourSkill',
    label: 'Otherworldly Glamour — skill proficiency',
    picksByLevel: { 3: 1 },
    grants: 'skill',
    choices: [
      { id: 'Deception', name: 'Deception' },
      { id: 'Performance', name: 'Performance' },
      { id: 'Persuasion', name: 'Persuasion' },
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
