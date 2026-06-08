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
  fly?: number;
  climb?: number;
  abilityScoreIncreases: Partial<Record<AbilityKey, number>>;
  traits: Trait[];
  darkvision?: number;
  resistances?: DamageType[];
  languages: string[];
  proficiencies?: string[];
  isSubrace: boolean;
  parentRaceId?: string;
  subraces?: Race[];
  innateSpells?: InnateSpell[];
  hpBonusPerLevel?: number;
  /** Racial natural armor formula. base + optional ability mod. If canUseWithArmor is true,
   *  the character can also use this formula when wearing armor (taking the better value). */
  naturalArmor?: { base: number; mod?: AbilityKey; canUseWithArmor?: boolean };
}

export interface ClassFeature {
  name: string;
  level: number;
  description: string;
  isASI?: boolean;
}

export interface ClassResourceDefinition {
  name: string;
  key: string;
  rechargeOn: 'short' | 'long' | 'dawn';
  maxPerLevel: Record<number, number | 'unlimited'>;
  /** Maps class level to die size for resources with a scaling die (e.g. Bardic Inspiration d6→d12).
   *  Sparse — the last entry at or below the current level applies. */
  resourceDie?: Record<number, number>;
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
  description: string;
  features: ClassFeature[];
  alwaysPreparedSpells?: Record<number, string[]>;
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

export interface FeatPrerequisite {
  minLevel?: number;
  ability?: Partial<Record<AbilityKey, number>>;
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
  grantsSpell?: string[];
  grantsProficiency?: string[];
  /** Extra HP gained each time a level is gained while this feat is held. */
  hpBonusPerLevel?: number;
  /** One-time retroactive HP bonus per level already gained when this feat is first taken
   *  (e.g. Tough: +2×currentLevel immediately). Applied only in LevelUpDialog at the
   *  moment the feat is picked; the creator store handles it via hpBonusPerLevel×level. */
  hpRetroactiveBonusPerPastLevel?: number;
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
  maxCharges?: number;    // optional charge tracking (e.g. magic items)
  charges?: number;       // current charges remaining
  recharge?: 'dawn' | 'long' | 'short';  // when charges restore (undefined = no auto-restore)
}

// Equipment choice option: each option is a labeled bundle of items.
export interface EquipmentOption {
  label: string;
  items: { name: string; quantity?: number; category?: ItemCategory; weight?: number }[];
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
  classes: ClassLevel[];
  abilityScoreMethod: AbilityScoreMethod;
  baseAbilityScores: AbilityScores;
  selectedSkillProficiencies: SkillName[];
  selectedFeats: string[];
  classOptions: ClassOptionsState;
  inventory: InventoryItem[];
  // Hit dice spent per class, keyed by class id. e.g. { fighter: 2, wizard: 1 }
  // Total dice are derived from class levels; remaining = level - used.
  hitDiceUsed: Record<string, number>;
  spellbook: PreparedSpell[];
  concentrationSpellId?: string;
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
