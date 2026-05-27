export type BookId =
  | 'PHB'
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
  spellList?: string[];
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
  | { type: 'feat'; featId: string }
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
}

export type WizardStep =
  | 'books' | 'race' | 'class' | 'subclass' | 'class-options'
  | 'background' | 'ability-scores' | 'skills'
  | 'feats' | 'spells' | 'equipment' | 'review';

export const WIZARD_STEPS: WizardStep[] = [
  'books', 'race', 'class', 'subclass', 'class-options',
  'background', 'ability-scores', 'skills',
  'feats', 'spells', 'equipment', 'review',
];

export const STEP_LABELS: Record<WizardStep, string> = {
  'books': 'Books',
  'race': 'Race',
  'class': 'Class',
  'subclass': 'Subclass',
  'class-options': 'Options',
  'background': 'Background',
  'ability-scores': 'Abilities',
  'skills': 'Skills',
  'feats': 'Feats',
  'spells': 'Spells',
  'equipment': 'Equipment',
  'review': 'Review',
};
