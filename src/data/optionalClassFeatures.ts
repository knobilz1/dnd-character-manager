import type { OptionalClassFeature } from '../types';

export const ALL_OPTIONAL_CLASS_FEATURES: OptionalClassFeature[] = [
  // Barbarian
  {
    id: 'barbarian-primal-knowledge',
    name: 'Primal Knowledge',
    sourceBook: 'TCE',
    classId: 'barbarian',
    minLevel: 3,
    description: 'When you reach 3rd level and again at 10th level, you gain proficiency in one skill of your choice from the list of skills available to barbarians at 1st level.',
  },
  {
    id: 'barbarian-instinctive-pounce',
    name: 'Instinctive Pounce',
    sourceBook: 'TCE',
    classId: 'barbarian',
    minLevel: 7,
    description: 'As part of the bonus action you take to enter your rage, you can move up to half your speed.',
  },

  // Bard
  {
    id: 'bard-magical-inspiration',
    name: 'Magical Inspiration',
    sourceBook: 'TCE',
    classId: 'bard',
    minLevel: 2,
    description: 'If a creature has a Bardic Inspiration die from you and casts a spell that restores hit points or deals damage, the creature can roll that die and choose a damaged or healed target to affect. Add the die result to the healing or to one damage roll of that spell.',
  },
  {
    id: 'bard-bardic-versatility',
    name: 'Bardic Versatility',
    sourceBook: 'TCE',
    classId: 'bard',
    minLevel: 4,
    description: 'Whenever you reach a level in this class that grants the Ability Score Improvement feature, you can replace one cantrip you know or one of your Expertise skills with another cantrip from the bard spell list or another eligible skill.',
  },

  // Cleric
  {
    id: 'cleric-harness-divine-power',
    name: 'Harness Divine Power',
    sourceBook: 'TCE',
    classId: 'cleric',
    minLevel: 2,
    description: 'As a bonus action, you can expend a use of your Channel Divinity to fuel your spells. Choose one expended spell slot of 1st or 2nd level. That slot is restored. You can use this feature a number of times equal to your proficiency bonus, and you regain all expended uses when you finish a long rest.',
  },
  {
    id: 'cleric-cantrip-versatility',
    name: 'Cantrip Versatility',
    sourceBook: 'TCE',
    classId: 'cleric',
    minLevel: 4,
    description: 'Whenever you reach a level in this class that grants the Ability Score Improvement feature, you can replace one cantrip you learned from this class\'s Spellcasting feature with another cantrip from the cleric spell list.',
  },

  // Druid
  {
    id: 'druid-wild-companion',
    name: 'Wild Companion',
    sourceBook: 'TCE',
    classId: 'druid',
    minLevel: 2,
    description: 'You can expend a use of your Wild Shape feature to cast Find Familiar without material components. When you do so, the familiar is a fey instead of a beast, and the familiar vanishes when you use Wild Shape again.',
  },
  {
    id: 'druid-cantrip-versatility',
    name: 'Cantrip Versatility',
    sourceBook: 'TCE',
    classId: 'druid',
    minLevel: 4,
    description: 'Whenever you reach a level in this class that grants the Ability Score Improvement feature, you can replace one cantrip you learned from this class\'s Spellcasting feature with another cantrip from the druid spell list.',
  },

  // Fighter
  {
    id: 'fighter-martial-versatility',
    name: 'Martial Versatility',
    sourceBook: 'TCE',
    classId: 'fighter',
    minLevel: 4,
    description: 'Whenever you reach a level in this class that grants the Ability Score Improvement feature, you can replace a fighting style you know with another fighting style available to fighters. If you know any maneuvers from the Battle Master subclass, you can replace one maneuver you know with a different maneuver.',
  },

  // Monk
  {
    id: 'monk-dedicated-weapon',
    name: 'Dedicated Weapon',
    sourceBook: 'TCE',
    classId: 'monk',
    minLevel: 2,
    description: 'Whenever you finish a short or long rest, you can touch one weapon and make it your dedicated weapon. It must be a simple or martial weapon you are proficient with. Until you use this feature again, that weapon counts as a monk weapon for you.',
  },
  {
    id: 'monk-ki-fueled-attack',
    name: 'Ki-Fueled Attack',
    sourceBook: 'TCE',
    classId: 'monk',
    minLevel: 3,
    description: 'If you spend 1 or more ki points as part of your action on your turn, you can make one attack with an unarmed strike or a monk weapon as a bonus action.',
  },
  {
    id: 'monk-quickened-healing',
    name: 'Quickened Healing',
    sourceBook: 'TCE',
    classId: 'monk',
    minLevel: 4,
    description: 'As an action, you can spend 2 ki points and roll a Martial Arts die. You regain a number of hit points equal to the number rolled plus your proficiency bonus.',
  },
  {
    id: 'monk-focused-aim',
    name: 'Focused Aim',
    sourceBook: 'TCE',
    classId: 'monk',
    minLevel: 5,
    description: 'When you miss an attack roll, you can spend 1 to 3 ki points to increase your attack roll by 2 for each of these ki points you spend, potentially turning the miss into a hit.',
  },

  // Paladin
  {
    id: 'paladin-harness-divine-power',
    name: 'Harness Divine Power',
    sourceBook: 'TCE',
    classId: 'paladin',
    minLevel: 3,
    description: 'As a bonus action, you can expend a use of your Channel Divinity to fuel your spells. Choose one expended spell slot of 1st through 3rd level. That slot is restored. You can use this feature a number of times equal to your proficiency bonus, and you regain all expended uses when you finish a long rest.',
  },
  {
    id: 'paladin-martial-versatility',
    name: 'Martial Versatility',
    sourceBook: 'TCE',
    classId: 'paladin',
    minLevel: 4,
    description: 'Whenever you reach a level in this class that grants the Ability Score Improvement feature, you can replace a fighting style you know with another fighting style available to paladins.',
  },

  // Ranger
  {
    id: 'ranger-deft-explorer',
    name: 'Deft Explorer',
    sourceBook: 'TCE',
    classId: 'ranger',
    minLevel: 1,
    description: 'You are an unsurpassed explorer and survivor. You gain the Canny benefit: choose one skill proficiency — your proficiency bonus is doubled for ability checks using that skill, and you learn two additional languages. At 6th level you gain Roving (your speed increases by 5 ft., and you gain a climbing and swimming speed equal to your walking speed). At 10th level you gain Tireless (gain temporary HP as a bonus action equal to 1d8 + Wisdom modifier, usable proficiency bonus times per long rest).',
  },
  {
    id: 'ranger-favored-foe',
    name: 'Favored Foe',
    sourceBook: 'TCE',
    classId: 'ranger',
    minLevel: 1,
    description: 'When you hit a creature with an attack roll, you can mark the target as your favored enemy for 1 minute (concentration). The first time each of your turns that you hit and deal damage to the favored enemy, you deal an extra 1d4 damage. You can use this feature a number of times equal to your proficiency bonus, and you regain all expended uses when you finish a long rest.',
  },
  {
    id: 'ranger-primal-awareness',
    name: 'Primal Awareness',
    sourceBook: 'TCE',
    classId: 'ranger',
    minLevel: 3,
    description: 'You can focus your awareness through the interconnections of nature. You learn additional spells at certain levels: Speak with Animals (3rd), Beast Sense (5th), Speak with Plants (9th), Locate Creature (13th), Commune with Nature (17th). These spells don\'t count against your spells known and can be cast once each without expending a spell slot, regaining the ability on a long rest.',
  },
  {
    id: 'ranger-tireless',
    name: 'Tireless',
    sourceBook: 'TCE',
    classId: 'ranger',
    minLevel: 10,
    description: 'As an action, you can give yourself temporary hit points equal to 1d8 + your Wisdom modifier (minimum 1). You can use this action a number of times equal to your proficiency bonus, regaining all expended uses on a long rest. Also, whenever you finish a short rest, your exhaustion level decreases by 1.',
  },
  {
    id: "ranger-nature's-veil",
    name: "Nature's Veil",
    sourceBook: 'TCE',
    classId: 'ranger',
    minLevel: 14,
    description: 'As a bonus action, you can magically become invisible, along with any equipment you are wearing or carrying, until the start of your next turn. You can use this feature a number of times equal to your proficiency bonus, and you regain all expended uses when you finish a long rest.',
  },

  // Rogue
  {
    id: 'rogue-steady-aim',
    name: 'Steady Aim',
    sourceBook: 'TCE',
    classId: 'rogue',
    minLevel: 3,
    description: 'As a bonus action, you give yourself advantage on your next attack roll on the current turn. You can use this bonus action only if you haven\'t moved during this turn, and after you use the bonus action, your speed is 0 until the end of the current turn.',
  },

  // Sorcerer
  {
    id: 'sorcerer-magical-guidance',
    name: 'Magical Guidance',
    sourceBook: 'TCE',
    classId: 'sorcerer',
    minLevel: 5,
    description: 'You can tap into your inner wellspring of magic to try to conjure success from failure. When you make an ability check that fails, you can spend 1 sorcery point to reroll the d20, and you must use the new roll, potentially turning the failure into a success.',
  },

  // Warlock
  {
    id: 'warlock-eldritch-versatility',
    name: 'Eldritch Versatility',
    sourceBook: 'TCE',
    classId: 'warlock',
    minLevel: 4,
    description: 'Whenever you reach a level in this class that grants the Ability Score Improvement feature, you can do one of the following: replace one cantrip from this class\'s Pact Magic with another warlock cantrip; replace the Pact Boon option you chose with one of the other options; or, if you\'re 12th level or higher, replace one Mystic Arcanum spell with another warlock spell of the same level.',
  },

  // Wizard
  {
    id: 'wizard-cantrip-formulas',
    name: 'Cantrip Formulas',
    sourceBook: 'TCE',
    classId: 'wizard',
    minLevel: 3,
    description: 'You have scribed a set of arcane formulas in your spellbook that you can use to formulate a cantrip in your mind. Whenever you finish a long rest and consult those formulas in your spellbook, you can replace one wizard cantrip you know with another wizard cantrip from the Player\'s Handbook.',
  },
];

export function getOptionalFeaturesForClass(classId: string): OptionalClassFeature[] {
  return ALL_OPTIONAL_CLASS_FEATURES.filter(f => f.classId === classId);
}
