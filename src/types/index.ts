export type BookId =
  | 'PHB'
  | 'PHB2024'
  | 'DMG'
  | 'XGtE'
  | 'TCE'
  | 'MMoM'
  | 'VGM'
  | 'FToD'
  | 'SCoC'
  | 'EGtW'
  | 'ToB'
  | 'AcqInc'
  | 'GGR'
  | 'SJA'
  | 'ERLW'
  | 'SCAG';

export interface Book {
  id: BookId;
  name: string;
  shortName: string;
  color: string;
  description: string;
  year: number;
  category?: 'sourcebook' | 'module';
}

export type AbilityKey = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';

export type SkillName =
  | 'Acrobatics' | 'Animal Handling' | 'Arcana' | 'Athletics'
  | 'Deception' | 'History' | 'Insight' | 'Intimidation'
  | 'Investigation' | 'Medicine' | 'Nature' | 'Perception'
  | 'Performance' | 'Persuasion' | 'Religion' | 'Sleight of Hand'
  | 'Stealth' | 'Survival';

export type SpellSchool =
  | 'Abjuration' | 'Conjuration' | 'Divination' | 'Enchantment'
  | 'Evocation' | 'Illusion' | 'Necromancy' | 'Transmutation';

export type SpellComponent = 'V' | 'S' | 'M';

export type SpellLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export type DamageType =
  | 'acid' | 'bludgeoning' | 'cold' | 'fire' | 'force'
  | 'lightning' | 'necrotic' | 'piercing' | 'poison'
  | 'psychic' | 'radiant' | 'slashing' | 'thunder';

export type Condition =
  | 'Blinded' | 'Charmed' | 'Deafened' | 'Exhaustion'
  | 'Frightened' | 'Grappled' | 'Incapacitated' | 'Invisible'
  | 'Paralyzed' | 'Petrified' | 'Poisoned' | 'Prone'
  | 'Restrained' | 'Stunned' | 'Unconscious';

export type ExhaustionLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type SpellcastingType = 'full' | 'half' | 'third' | 'pact' | 'none';

export type AbilityScoreMethod = 'pointbuy' | 'standard_array' | 'manual' | 'roll';

export interface Trait {
  name: string;
  description: string;
}

export interface InnateSpell {
  spellId: string;
  recharge: 'cantrip' | 'long' | 'short';
  /** Minimum total character level to have this spell. Defaults to 1. */
  minCharLevel?: number;
  ability: AbilityKey;
}

export interface Race {
  id: string;
  name: string;
  sourceBook: BookId;
  size: 'Tiny' | 'Small' | 'Medium' | 'Large';
  speed: number;
  swim?: number;
  /** 'walk' = "flying speed equal to your walking speed" — tracks walk bonuses
   *  (a monk Aarakocra flies at monk speed) and, for every such race, the trait
   *  also forbids flying in medium/heavy armor. A number is a flat speed with
   *  no armor clause (SCAG Winged Tiefling). */
  fly?: number | 'walk';
  climb?: number;
  abilityScoreIncreases: Partial<Record<AbilityKey, number>>;
  /** The race's ability increase is chosen by the player rather than fixed, so
   *  `abilityScoreIncreases` is empty and the real value lives on the character.
   *  Each entry is one legal distribution, as a list of increments to assign to distinct
   *  abilities. MMoM / SJA / FToD / SCoC races offer `[[2,1],[1,1,1]]`; Variant Human offers
   *  `[[1,1]]` — a genuinely different rule, which is why this is a shape rather than a flag.
   *  Note the ten PHB 2024 species are NOT flexible: in 2024 the *background* grants the
   *  increase, so their empty `abilityScoreIncreases` is correct and they must not carry this. */
  flexibleAsi?: number[][];
  traits: Trait[];
  darkvision?: number;
  resistances?: DamageType[];
  languages: string[];
  proficiencies?: string[];
  /** Withheld from the race picker while its source is in doubt, WITHOUT deleting it — `getRace`
   *  still resolves the id, so a character already built as this race keeps working. Removing the
   *  entry outright would make that character unopenable. */
  hidden?: boolean;
  isSubrace: boolean;
  parentRaceId?: string;
  subraces?: Race[];
  innateSpells?: InnateSpell[];
  /** Races whose book lets the player pick the spellcasting ability for their innate spells
   *  (MMoM Duergar and Deep Gnome: "Intelligence, Wisdom, or Charisma... choose when you select
   *  this race"). One choice covers the whole trait, so it lives on the race rather than on each
   *  InnateSpell. The chosen value is stored as `Character.innateSpellAbility`; each spell's own
   *  `ability` is the fallback for characters saved before the choice existed. */
  innateSpellAbilityChoice?: AbilityKey[];
  hpBonusPerLevel?: number;
  /** Racial natural armor formula. base + optional ability mod. If canUseWithArmor is true,
   *  the character can also use this formula when wearing armor (taking the better value). */
  naturalArmor?: { base: number; mod?: AbilityKey; canUseWithArmor?: boolean };
  /** Limited-use racial abilities that are NOT spells — Breath Weapon, Relentless Endurance,
   *  Stone's Endurance, Fey Step and so on. Racial *spells* are tracked separately via
   *  `innateSpells` + `Character.innateSpellUses`; this covers everything else, which previously
   *  had nowhere to live and so could not be tracked at all.
   *  `maxPerLevel` is keyed on TOTAL character level, not class level. */
  resources?: ClassResourceDefinition[];
}

export interface ClassFeature {
  name: string;
  level: number;
  description: string;
  isASI?: boolean;
  /** The level grants a FEAT only, with no option to take +2 ability points instead —
   *  PHB 2024's level-19 Epic Boon works this way ("Epic Boon feat or another feat"),
   *  unlike a normal Ability Score Improvement. Set alongside `isASI`, which is what
   *  drives the level-up dialog into its feat/ASI step in the first place. */
  featOnly?: boolean;
}

export interface ClassResourceDefinition {
  name: string;
  key: string;
  /** 'special' = the rule is not a rest at all, so NO rest restores it and the player
   *  resets it by hand when the fiction says so. Required for the shapes the other three
   *  cannot express: an in-game cooldown measured in days (Cleric Divine Intervention is
   *  7 days after a *successful* use, but a long rest after a failed one), and a randomly
   *  rolled number of long rests (the Genie's Limited Wish, 1d4). Modelling either as
   *  'long' would silently hand the feature back every night. Always pair with
   *  `rechargeNote`, or the card has nothing to tell the player. */
  rechargeOn: 'short' | 'long' | 'dawn' | 'special';
  /** Human-readable recharge rule, shown in place of "Recharges on X rest". Only meaningful
   *  for `rechargeOn: 'special'`. */
  rechargeNote?: string;
  maxPerLevel: Record<number, number | 'unlimited'>;
  /** Maps class level to die size for resources with a scaling die (e.g. Bardic Inspiration d6→d12).
   *  Sparse — the last entry at or below the current level applies. */
  resourceDie?: Record<number, number>;
  /** Partial short-rest recovery, for resources whose rule is "regain N on a Short Rest, all on a Long
   *  Rest" — PHB 2024 Cleric Channel Divinity and Druid Wild Shape both work this way. Use together with
   *  `rechargeOn: 'long'`; a short rest then adds this many uses back instead of refilling.
   *  Do NOT use for "regain all on a Short Rest" (2024 Monk Focus) — that is plain `rechargeOn: 'short'`. */
  shortRestRegain?: number;
}

export interface DClass {
  id: string;
  name: string;
  sourceBook: BookId;
  /** Additional books this entry is available in (reprints). Used alongside sourceBook for filtering. */
  alsoIn?: BookId[];
  hitDie: 4 | 6 | 8 | 10 | 12;
  primaryAbility: AbilityKey[];
  savingThrows: [AbilityKey, AbilityKey];
  armorProficiencies: string[];
  weaponProficiencies: string[];
  toolProficiencies: string[];
  skillChoices: { count: number; from: SkillName[] };
  spellcastingType: SpellcastingType;
  spellcastingAbility?: AbilityKey;
  features: ClassFeature[];
  resources: ClassResourceDefinition[];
  subclassLabel: string;
  subclassLevel: number;
  multiclassPrerequisites: Partial<Record<AbilityKey, number>>;
  /** A SECOND set that also qualifies, for the one class whose prerequisite is an OR rather than
   *  an AND: fighter is "Str 13 or Dex 13" (PHB p.163). Every other class ANDs its requirements,
   *  so this is left unset. Without it a dexterous fighter with Str 8 would be refused a
   *  multiclass the book allows. */
  multiclassPrerequisitesAlt?: Partial<Record<AbilityKey, number>>;
  /** Proficiencies gained when this is your SECOND (multiclass) entry — not granted at 1st-level start.
   *  Source: PHB p.163 multiclassing table (2014); PHB 2024 per-class "As a Multiclass Character" section.
   *  Empty array = no additional proficiencies (Sorcerer, Wizard, Monk 2024). */
  multiclassGains?: string[];
  spellList?: string[];
  /** Override the class ID used to look up spells & mechanics tables.
   *  Set this on variant classes (e.g. 'barbarian-2024') to the base
   *  class id ('barbarian') so existing spell entries still apply. */
  spellListClassId?: string;
}

export interface Subclass {
  id: string;
  name: string;
  classId: string;
  sourceBook: BookId;
  /** Additional books this entry is available in (reprints). */
  alsoIn?: BookId[];
  /** Kept in the data but not offered in any picker. For entries whose real source book is not
   *  registered yet: hiding beats mis-attributing it to a book it isn't in, and beats deleting
   *  it (which would break any character who already picked it). */
  hidden?: boolean;
  description: string;
  features: ClassFeature[];
  /** Armour/shield categories this subclass grants ("Heavy armor", "Medium armor", "Shields") —
   *  the wording matches `DClass.armorProficiencies` so `armorGrants` can union them directly.
   *  No level key: you cannot hold a subclass before its own subclass level, and every one of
   *  these grants lands exactly there. Weapon, tool and skill grants in the same feature are
   *  deliberately NOT here; those are separate systems. */
  armorProficiencies?: string[];
  alwaysPreparedSpells?: Record<number, string[]>;
  /** Always-prepared spells that depend on a build choice: Circle of the Land picks one of
   *  eight land types and gets that column only. Outer key is the chosen land, inner shape
   *  matches alwaysPreparedSpells. Kept separate from alwaysPreparedSpells because those
   *  apply unconditionally — merging the two would grant a Land druid all 8 lists at once.
   *  Named concretely rather than generalised: this is the only subclass with the shape. */
  landSpells?: Record<string, Record<number, string[]>>;
  /** D4 — build choices this subclass asks the player to make once. Generic, unlike the named
   *  `landType` / `totemSpirit` fields on ClassOptionsState, which predate this and are left alone:
   *  they already work end to end and renaming them would orphan every saved character. */
  options?: SubclassOptionGroup[];
  expandedSpells?: Record<number, string[]>;
  spellcastingType?: SpellcastingType;
  /** For subclass-granted spellcasting, the class whose spell list to use (e.g. 'wizard' for EK/AT). */
  spellListClassId?: string;
  /** Cantrips known at each class level (index = level-1). For subclass-granted spellcasters (EK, AT). */
  cantripsKnownByClassLevel?: number[];
  /** Spells known at each class level (index = level-1). For subclass-granted spellcasters (EK, AT). */
  spellsKnownByClassLevel?: number[];
  /** Flat HP bonus gained per class level (e.g. 1 for Draconic Bloodline). */
  hpBonusPerLevel?: number;
  /** Schools of magic restricted for non-cantrip spell picks (EK: Abjuration/Evocation; AT: Enchantment/Illusion). Cantrips are never restricted. */
  restrictedSchools?: SpellSchool[];
  /** Class levels where the player may choose a spell from any school instead of the restricted set. */
  freePickLevels?: number[];
  resources?: ClassResourceDefinition[];
}

export interface Spell {
  id: string;
  name: string;
  level: SpellLevel;
  school: SpellSchool;
  sourceBook: BookId;
  /** Additional books this entry is available in (reprints). */
  alsoIn?: BookId[];
  castingTime: string;
  range: string;
  components: SpellComponent[];
  materialComponent?: string;
  duration: string;
  concentration: boolean;
  ritual: boolean;
  description: string;
  atHigherLevels?: string;
  classes: string[];
  damageType?: DamageType;
  savingThrow?: AbilityKey;
  tags: string[];
}

export interface Background {
  id: string;
  name: string;
  sourceBook: BookId;
  /** C7 — PHB 2024 only. The 2024 rules moved the ability score increase off the species and onto
   *  the background: three candidate abilities, distributed as +2/+1 or +1/+1/+1. 2014 and GGR
   *  backgrounds leave both fields undefined because in those rules the RACE grants the increase,
   *  and setting them here would hand a 2014 character a bonus the rules never gave them. */
  abilityScoreOptions?: AbilityKey[];
  flexibleAsi?: number[][];
  /** PHB 2024 only: the Origin feat this background grants at level 1. It is NOT an ASI
   *  pick — it comes free, on top of whatever feats the class earns — which is why it
   *  lives here rather than being pushed into `selectedFeats`. Read it through
   *  `effectiveFeatIds` (utils/effectiveFeats.ts); until that existed the feat was only
   *  ever prose in `feature.description` and granted nothing at all. */
  originFeatId?: string;
  skillProficiencies: [SkillName, SkillName];
  toolProficiencies: string[];
  languages: number;
  equipment: string[];
  feature: { name: string; description: string };
  personalityTraits: string[];
  ideals: string[];
  bonds: string[];
  flaws: string[];
}

/** Player-authored background flavour. Any field filled in here replaces the
 *  book's suggested text everywhere the background is DISPLAYED (sheet, print,
 *  PDF, the DM's party notes). Mechanics — skill/tool proficiencies, languages,
 *  starting equipment, the background feature — always come from `backgroundId`,
 *  so rewriting your history never changes what you're proficient in. */
export interface BackgroundCustom {
  name?: string;
  personalityTraits?: string;
  ideals?: string;
  bonds?: string;
  flaws?: string;
  backstory?: string;
}

export interface FeatPrerequisite {
  minLevel?: number;
  /** ALL of these scores are required (2014 feats that name one ability). */
  ability?: Partial<Record<AbilityKey, number>>;
  /** ANY ONE of these scores satisfies it — PHB 2024 writes ten feats as "Strength or Dexterity
   *  13+". Squeezing those into `ability` above dropped the alternative silently, so the sheet
   *  told a Dex-based rogue that Athlete and Sentinel need Strength. */
  abilityAny?: Partial<Record<AbilityKey, number>>;
  spellcasting?: boolean;
  proficiency?: string;
  race?: string;
  classId?: string;
  other?: string;
}

export type ASIChoice =
  | { type: 'feat'; featId: string; abilityIncrease?: Partial<Record<AbilityKey, number>> }
  | { type: 'asi'; increases: Partial<Record<AbilityKey, number>> };

export interface Feat {
  id: string;
  name: string;
  sourceBook: BookId;
  prerequisite?: FeatPrerequisite;
  description: string;
  abilityScoreIncrease?: Partial<Record<AbilityKey, number>>;
  /** NOTE: there is deliberately no `grantsSpell` here. It existed, seven feats populated it, and
   *  nothing ever read it — so the four PHB 2024 feats that carried only that field granted no
   *  spell at all. `grantedSpells` below is the one the sheet and the rest handlers consume. */
  /** ARMOUR and WEAPON grants only — the two things `armorGrants` and `isProficientWithWeapon`
   *  match against ("Heavy armor", "Shields", "Martial weapons"). Tools and languages have their
   *  own fields below: the tool pipeline treats anything it cannot parse as a fixed tool, so a
   *  "Martial weapons" entry in here would print on the sheet as a tool proficiency. */
  grantsProficiency?: string[];
  /** Tool-proficiency grants, in the same grammar class and background `toolProficiencies` use —
   *  so "Cook's utensils" is fixed and "Three artisan's tools of your choice" becomes a picker. */
  grantsTools?: string[];
  /** How many languages of the player's choice this feat grants (Linguist: 3, Prodigy: 1). */
  grantsLanguages?: number;
  /**
   * Proficiency picks, where the player chooses from an explicit list.
   *
   * One shape covers all of them because each pick is resolved by WHICH CATALOG it appears in:
   * a pick that is a skill name becomes a skill proficiency, one that is a tool becomes a tool
   * proficiency, one that is a weapon becomes weapon proficiency. That is what lets Skilled's
   * "any combination of three skills or tools" be a single picker rather than two coupled ones.
   *
   * When `count` covers the whole of `options` the picks are granted outright with no picker —
   * Boon of Skill grants every skill, and making the player click all eighteen is not a choice.
   */
  grantsPicks?: {
    count: number;
    label: string;
    options: string[];
    /** Keen Mind / Observant (2024): "gain proficiency OR Expertise" — a pick you were
     *  already proficient in becomes Expertise instead of a second proficiency. */
    upgradeToExpertise?: boolean;
  };
  /** Expertise slots (doubled proficiency) this feat grants, chosen from skills already held. */
  grantsExpertise?: number;
  /**
   * Spells the player CHOOSES. Once picked each one behaves exactly like a `grantedSpells` entry —
   * same tracking key, same rest handling — so the only thing this adds is the choice.
   *
   * Magic Initiate and Strixhaven Initiate say the picks must come from ONE list (or one college).
   * The pools here are the union instead, and the constraint is left to the player: enforcing it
   * would mean a list-selector per feat, and the alternative on offer today is no spells at all.
   */
  grantsSpellPicks?: Array<{
    /** Unique within the feat; storage keys on `${featId}:${key}`. */
    key: string;
    label: string;
    count: number;
    /** Count equals proficiency bonus instead, and grows with it (Ritual Caster 2024). */
    countFromProfBonus?: boolean;
    level: 0 | 1;
    /** Spell lists to draw from. Ignored when `spellIds` names the pool outright. */
    classIds?: string[];
    /** An explicit pool, for grants that name their spells (Strixhaven's cantrip triples). */
    spellIds?: string[];
    ritualOnly?: boolean;
    /** Spell Sniper: only cantrips that require an attack roll. */
    requiresAttackRoll?: boolean;
    recharge: 'cantrip' | 'long' | 'short';
    ability: AbilityKey;
  }>;
  /** Extra HP gained each time a level is gained while this feat is held. */
  hpBonusPerLevel?: number;
  /** One-time retroactive HP bonus per level already gained when this feat is first taken
   *  (e.g. Tough: +2×currentLevel immediately). Applied only in LevelUpDialog at the
   *  moment the feat is picked; the creator store handles it via hpBonusPerLevel×level. */
  hpRetroactiveBonusPerPastLevel?: number;
  /** One-time flat HP-maximum bonus, independent of level (Boon of Fortitude: +40). Applied once
   *  when the feat is taken — not per level, which is `hpBonusPerLevel` above. */
  hpBonus?: number;
  /** Flat bonus added to initiative (e.g. Alert: +5). */
  initiativeBonus?: number;
  /** Flat bonus added to walking speed in feet (e.g. Mobile: +10, Squat Nimbleness: +5). */
  speedBonus?: number;
  /** Flat bonus added to passive Perception (e.g. Observant: +5). */
  passivePerceptionBonus?: number;
  /** Flat bonus added to passive Investigation (e.g. Observant: +5). */
  passiveInvestigationBonus?: number;
  /** Abilities the player can choose +1 from when taking this feat at an ASI level-up.
   *  Applied to baseAbilityScores via the ASIChoice.abilityIncrease mechanism. */
  abilityScoreChoice?: AbilityKey[];
  /** When true, the ability chosen via abilityScoreChoice also grants proficiency in that
   *  saving throw (e.g. Resilient). Stored in character.featChoices[featId]. */
  grantsSaveForChosenAbility?: boolean;
  /** Spells granted by this feat with their use-tracking metadata. */
  grantedSpells?: Array<{ spellId: string; recharge: 'cantrip' | 'long' | 'short'; ability: AbilityKey }>;
  /** Trackable resources granted by this feat (e.g. Lucky: 3 luck points). */
  grantedResources?: Array<{ key: string; name: string; max: number; rechargeOn: 'short' | 'long' }>;
}

export interface FightingStyle {
  id: string;
  name: string;
  sourceBook: BookId;
  classes: string[];
  description: string;
  /** Withheld from the pickers — the entry is not in any book this app can cite. */
  hidden?: boolean;
}

export interface EldritchInvocation {
  id: string;
  name: string;
  sourceBook: BookId;
  minLevel: number;
  prerequisitePact?: 'blade' | 'chain' | 'tome' | 'talisman';
  prerequisiteSpell?: string;
  prerequisiteText?: string;
  description: string;
}

export interface PactBoon {
  id: string;
  name: string;
  sourceBook: BookId;
  description: string;
}

export interface Metamagic {
  id: string;
  name: string;
  sourceBook: BookId;
  cost: string;
  description: string;
}

export interface Maneuver {
  id: string;
  name: string;
  sourceBook: BookId;
  description: string;
}

export interface Infusion {
  id: string;
  name: string;
  sourceBook: BookId;
  /** Additional books this entry is available in. The Artificer class itself is
   *  `sourceBook: 'TCE', alsoIn: ['ERLW']`, so without the same tag here a player who enabled
   *  ERLW could take the class and then find an empty infusion picker. The other option types
   *  (Metamagic, Maneuver, Invocation, PactBoon, FightingStyle) still lack this field — they
   *  have no equivalent cross-book class today, but `bookEnabled` already reads it if added. */
  alsoIn?: BookId[];
  minLevel: number;
  prerequisite?: string;
  description: string;
}

export interface OptionalClassFeature {
  id: string;
  name: string;
  sourceBook: BookId;
  classId: string;
  minLevel: number;
  description: string;
}

export interface ClassOptionsState {
  fightingStyles: string[];
  invocations: string[];
  pactBoon?: string;
  metamagic: string[];
  maneuvers: string[];
  infusions: string[];
  optionalFeatures: string[];
  /** Barbarian Totem Warrior — chosen at lv.3 (bear/eagle/wolf/elk/tiger) */
  totemSpirit?: string;
  /** Barbarian Totem Warrior — chosen at lv.6 (Aspect of the Beast) */
  aspectTotem?: string;
  /** Barbarian Totem Warrior — chosen at lv.14 (Totemic Attunement) */
  totemicAttunement?: string;
  /** Druid Circle of the Land — chosen at lv.3, selects which Circle Spells you get
   *  (arctic | coast | desert | forest | grassland | mountain | swamp | underdark).
   *  Without it the subclass grants no spells at all. */
  landType?: string;
}

export type ItemCategory =
  | 'weapon' | 'armor' | 'shield' | 'tool' | 'pack'
  | 'consumable' | 'gear' | 'treasure' | 'magic' | 'other';

export interface InventoryItem {
  id: string;             // unique per row in the bag
  name: string;
  quantity: number;
  category: ItemCategory;
  equipped?: boolean;
  description?: string;
  weight?: number;        // in pounds, per item
  source?: 'class' | 'background' | 'manual';
  /** Attuned to this item. Real state, not derived: whether an item REQUIRES
   *  attunement is read from its description, but whether you have actually spent
   *  one of your three slots on it is a choice only the player can make. */
  attuned?: boolean;
  maxCharges?: number;    // optional charge tracking (e.g. magic items)
  charges?: number;       // current charges remaining
  recharge?: 'dawn' | 'long' | 'short';  // when charges restore (undefined = no auto-restore)
}

// Equipment choice option: each option is a labeled bundle of items.
/** D4 — a build choice a SUBCLASS asks the player to make once, and that must persist.
 *
 *  Distinct from a use-time choice, which is re-made every activation and correctly needs no
 *  storage (Berserker's "choose one creature", Circle of Stars' Starry Form). The audit found 103
 *  subclass features containing choice language and only two of them prompted; hand triage put 23
 *  in this category and ~95 in the other. No regex separates them — the question is whether the
 *  answer persists, and the descriptions do not say.
 *
 *  `picksByLevel` is CUMULATIVE, not a per-level delta: Arcane Archer knows 2 Arcane Shots at 3 and
 *  3 at 7, so the map reads {3: 2, 7: 3}. Storing deltas would make a character who multiclassed
 *  away and back accumulate extra picks.
 */
export interface SubclassOptionGroup {
  key: string;
  label: string;
  /** Cumulative pick count keyed on the level in THIS class, matching `maxPerLevel` convention. */
  picksByLevel: Record<number, number>;
  /** `sourceBook` is only set where the choice list spans books and must be filtered by what
   *  the table owns — cantrip grants draw on 20 druid / 35 wizard cantrips across seven
   *  books. Skills and weapons are book-agnostic and leave it unset. */
  choices: { id: string; name: string; description?: string; sourceBook?: BookId }[];
  /**
   * What the picks CONFER, when they confer something the rest of the sheet must act on.
   * Omit for choices that are purely descriptive (Dragon Ancestor, Hunter's Prey…).
   *
   * `'skill'` is the load-bearing one: `useCharacterDerived` merges those picks into the skill
   * proficiency set, which is what makes College of Lore's three skills actually exist. For it to
   * work each choice `id` MUST be a `SkillName` exactly as spelled in `ALL_SKILLS`.
   *
   * `'cantrip'` choices carry SPELL ids: they are merged into the always-prepared set so the
   * cantrip lands in the spellbook, and are therefore not counted against cantrips known —
   * a subclass cantrip is gained IN ADDITION to the class's own.
   *
   * `'resistance'` choices carry DamageType ids and are read by `resistancesOf`, so they halve
   * damage exactly like a racial resistance.
   */
  grants?: 'skill' | 'language' | 'tool' | 'weapon' | 'cantrip' | 'resistance';
}

export interface EquipmentOption {
  label: string;
  items: { name: string; quantity?: number; category?: ItemCategory; weight?: number }[];
  /** Coin bundled INTO this package, in gp. PHB 2024 only: its packages read
   *  "Greataxe + 4 Handaxes + Explorer's Pack + 15 gp", so the gold is part of the option rather
   *  than the 2014-style either/or alternative held in `ClassStartingEquipment.startingGold`. */
  gold?: number;
}

export interface EquipmentChoice {
  label: string;          // human-readable prompt
  options: EquipmentOption[];
}

export interface ClassStartingEquipment {
  classId: string;
  choices: EquipmentChoice[];
  fixed: { name: string; quantity?: number; category?: ItemCategory; weight?: number }[];
  startingGold?: string;  // e.g. "4d4 × 10 gp"
}

export interface AbilityScores {
  str: number;
  dex: number;
  con: number;
  int: number;
  wis: number;
  cha: number;
}

export interface DeathSaves {
  successes: number;
  failures: number;
}

export interface ClassLevel {
  classId: string;
  level: number;
  subclassId?: string;
  hitPointsRolled: number[];
}

export interface ResourceState {
  key: string;
  current: number;
  max: number;
}

// ── Alternate Forms ──────────────────────────────────────────────────────────

export interface BeastFormAttack {
  name: string;
  toHit: number;        // integer bonus, e.g. +4 → 4
  damage: string;       // e.g. "2d6+4"
  damageType: DamageType;
  reach?: number;       // feet, defaults to 5
  range?: string;       // e.g. "20/60 ft" for ranged
  notes?: string;       // e.g. "Grapple on hit DC 13"
}

export interface BeastFormSpeed {
  walk?: number;
  swim?: number;
  fly?: number;
  climb?: number;
  burrow?: number;
}

export interface ActiveWildShape {
  id: string;           // beast id from beastForms.ts, or 'custom'
  name: string;
  cr: number | string;  // e.g. '0', '1/4', '1/2', 1, 2 …
  size: 'Tiny' | 'Small' | 'Medium' | 'Large' | 'Huge';
  maxHp: number;
  currentHp: number;
  ac: number;
  str: number;
  dex: number;
  con: number;
  speed: BeastFormSpeed;
  attacks: BeastFormAttack[];
  specialAbilities?: string[];
  isCustom?: boolean;
}

// ── Companions ───────────────────────────────────────────────────────────────

/**
 * A creature the character CONTROLS but is not — a Beast Master's beast, a Steel Defender, a
 * drake, a familiar. Distinct from ActiveWildShape, which transforms the character rather than
 * adding a second creature.
 *
 * `kind` is the load-bearing field. Beast Master grafts the RANGER's proficiency bonus onto an
 * ordinary beast stat block and floors its HP at 4 x ranger level, while a Steel Defender and a
 * drake have their own progressions. Storing only "which stat block" would be right for one
 * subclass and silently wrong for the rest.
 */
export interface Companion {
  id: string;
  /** Which feature granted it — decides how the numbers scale. */
  /** `summoned` is anything conjured by a spell or item that uses its stat block as printed —
   *  a Find Steed mount, a figurine's creature, a commanded elemental. No owner scaling. */
  kind: 'beast-master' | 'steel-defender' | 'drakewarden' | 'familiar' | 'summoned'
      | 'homunculus';
  /** The class whose level drives the scaling (e.g. 'ranger' for a Beast Master beast). */
  classId: string;
  /** Stat block id from beastForms.ts. Used by `beast-master`; other kinds carry their own. */
  beastId?: string;
  /** Player-given name — the beast's species stays on the stat block. */
  name: string;
  currentHP: number;
  tempHP?: number;
  conditions?: Condition[];
  /** Whether it is currently out. Only active companions are placed on maps and tracked in a
   *  fight — the DM console reads this to know whether to give it a deployment cell. */
  active: boolean;
}

/** A companion's live numbers with its owner's scaling already applied. */
export interface CompanionDerived {
  beastName: string;
  size: 'Tiny' | 'Small' | 'Medium' | 'Large' | 'Huge';
  cr: string;
  maxHP: number;
  ac: number;
  speed: BeastFormSpeed;
  /** The bonus folded into ac / toHit / damage above, so the UI can show its working. */
  profBonusApplied: number;
  /** 2 once Bestial Fury (11th) is online. */
  attacksPerAction: number;
  attacks: BeastFormAttack[];
  specialAbilities: string[];
}

// ── Campaign Journal ─────────────────────────────────────────────────────────

export interface JournalEntry {
  id: string;
  date: string;           // "YYYY-MM-DD"
  sessionNumber?: number;
  title: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

export interface PreparedSpell {
  spellId: string;
  isPrepared: boolean;
  isAlwaysPrepared: boolean;
}

export interface PactMagicState {
  slotsTotal: number;
  slotsUsed: number;
  slotLevel: number;
}

export type SlotLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

// ── Character Appearance ──────────────────────────────────────────────────────
export type CharacterGender = 'male' | 'female' | 'nonbinary';

export interface CharacterAppearance {
  gender: CharacterGender;
  /** Selected hairstyle id from HAIR_STYLES (src/data/hair.ts). Undefined → the
   *  race/gender default style. 'none' → bald. */
  hairId?: string;
  /** Hex color (e.g. '#3b2a1a') applied as a runtime tint to the hair mesh.
   *  Undefined → the hair's native texture color. Ignored if the style isn't tintable. */
  hairColor?: string;
  // Future: skinTone, eyeColor, cosmetics (cloak/boots/gloves)
}

export interface Character {
  id: string;
  createdAt: number;
  updatedAt: number;
  name: string;
  playerName: string;
  portrait?: string;
  alignment: string;
  enabledBooks: BookId[];
  raceId: string;
  backgroundId: string;
  /** Player's own wording for the background — name, traits, backstory.
   *  Undefined/blank fields fall back to the book's suggestions. */
  backgroundCustom?: BackgroundCustom;
  classes: ClassLevel[];
  abilityScoreMethod: AbilityScoreMethod;
  baseAbilityScores: AbilityScores;
  /** Languages the player CHOSE, for the picks their race and background grant. Race data
   *  stores an unchosen language as a literal placeholder string ("one extra language of your
   *  choice"), which used to be printed on the sheet as though it were a language — see
   *  data/languages.ts. */
  selectedLanguages?: string[];
  /** Tool proficiencies the player CHOSE, keyed by the grant string that offered them
   *  ("Three musical instruments of your choice"). Keyed rather than flat so a bard's three
   *  instrument picks cannot be spent on artisan's tools — see data/tools.ts. */
  selectedToolProficiencies?: Record<string, string[]>;
  /** Proficiency picks made for feats, keyed by feat id. Separate from
   *  `selectedSkillProficiencies` because that array is capped at the CLASS's own skill count —
   *  putting a feat's skill in there would push a class pick out. */
  selectedFeatPicks?: Record<string, string[]>;
  /** Expertise chosen for feat-granted slots (Skill Expert, Prodigy, Boon of Skill). Separate
   *  from `expertiseSkills`, whose slots come from Rogue/Bard levels. */
  selectedFeatExpertise?: string[];
  /** Spells chosen for feat grants, keyed `${featId}:${grantKey}` — Magic Initiate's two cantrips
   *  and its 1st-level spell are separate grants with separate pools. */
  selectedFeatSpells?: Record<string, string[]>;
  selectedSkillProficiencies: SkillName[];
  selectedFeats: string[];
  classOptions: ClassOptionsState;
  inventory: InventoryItem[];
  // Hit dice spent per class, keyed by class id. e.g. { fighter: 2, wizard: 1 }
  // Total dice are derived from class levels; remaining = level - used.
  hitDiceUsed: Record<string, number>;
  spellbook: PreparedSpell[];
  concentrationSpellId?: string;
  /** This encounter's rolled initiative total (d20 + the sheet's initiative bonus).
   *  Cleared when the fight ends. Kept on the character rather than in component state so
   *  it survives a tab switch mid-fight and so the DM push can read it from anywhere. */
  initiativeRoll?: number;
  currentHP: number;
  tempHP: number;
  maxHP: number;
  deathSaves: DeathSaves;
  conditions: Condition[];
  exhaustionLevel: ExhaustionLevel;
  spellSlotsUsed: Record<SlotLevel, number>;
  pactMagic?: PactMagicState;
  resources: ResourceState[];
  innateSpellUses?: Record<string, number>;
  /** Player's pick when the race offers a choice of innate-spell ability. Unset falls back to
   *  the ability on each InnateSpell. See `Race.innateSpellAbilityChoice`. */
  innateSpellAbility?: AbilityKey;
  /** Chosen racial ability increases, for races with `flexibleAsi`. Read through
   *  `chosenAsi()` — never read `race.abilityScoreIncreases` directly, or a flexible race
   *  silently contributes nothing. */
  racialAbilityChoice?: Partial<Record<AbilityKey, number>>;
  /** D4 — chosen subclass build options, keyed by SubclassOptionGroup.key. Values are choice ids.
   *  Kept flat rather than nested per subclass: a key is unique across the data (asserted by the
   *  audit sweep), and a flat map survives a character multiclassing into a second subclass. */
  subclassOptions?: Record<string, string[]>;
  /** C7 — chosen BACKGROUND ability increases, for PHB 2024 backgrounds. Separate from
   *  `racialAbilityChoice` on purpose: a 2024 character can multiclass into nothing that changes
   *  its background, but merging the two would make an edition switch silently move the bonus. */
  backgroundAbilityChoice?: Partial<Record<AbilityKey, number>>;
  inspiration: boolean;
  experiencePoints: number;
  notes: string;
  currencies: { cp: number; sp: number; ep: number; gp: number; pp: number };
  inGraveyard?: boolean;
  // Campaign journal
  campaignName?: string;
  journal?: JournalEntry[];
  // Alternate form state
  activeWildShape?: ActiveWildShape | null;
  /** Creatures the character controls but is not (Beast Master beast, Steel Defender, familiar).
   *  Separate from activeWildShape, which is a transformation of the character. */
  companions?: Companion[];
  armorerMode?: 'guardian' | 'infiltrator';
  pathOfBeastForm?: 'bite' | 'claws' | 'tail' | null;
  // Expertise (doubled proficiency bonus): skill names where the character has expertise
  expertiseSkills?: string[];
  // Per-feat player ability choices (e.g. Resilient: which save to grant proficiency in)
  featChoices?: Record<string, AbilityKey>;
  // Knowledge Domain: 2 skills (from Arcana/History/Nature/Religion) that gain proficiency + expertise
  knowledgeDomainSkills?: string[];
  // 3D character appearance choices made in the creator
  appearance?: CharacterAppearance;
}

export type WizardStep =
  | 'books' | 'race' | 'class' | 'subclass' | 'class-options' | 'appearance'
  | 'background' | 'ability-scores' | 'skills'
  | 'feats' | 'spells' | 'equipment' | 'review';

export const WIZARD_STEPS: WizardStep[] = [
  'books', 'race', 'class', 'subclass', 'class-options', 'appearance',
  'background', 'ability-scores', 'skills',
  'feats', 'spells', 'equipment', 'review',
];

export const STEP_LABELS: Record<WizardStep, string> = {
  'books': 'Books',
  'race': 'Race',
  'class': 'Class',
  'subclass': 'Subclass',
  'class-options': 'Options',
  'appearance': 'Appearance',
  'background': 'Background',
  'ability-scores': 'Abilities',
  'skills': 'Skills',
  'feats': 'Feats',
  'spells': 'Spells',
  'equipment': 'Equipment',
  'review': 'Review',
};
