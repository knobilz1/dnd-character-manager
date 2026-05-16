import type { Feat, Character, AbilityKey, BookId } from '../types';
import { getClass } from './classes';
import { getSubclass } from './subclasses';
import { getRace } from './races';

export const ALL_FEATS: Feat[] = [
  // PHB Feats
  {
    id: 'alert',
    name: 'Alert',
    sourceBook: 'PHB',
    description: 'Always on the lookout for danger, you gain the following benefits:\n• You gain a +5 bonus to initiative.\n• You can\'t be surprised while you are conscious.\n• Other creatures don\'t gain advantage on attack rolls against you as a result of being unseen by you.',
  },
  {
    id: 'athlete',
    name: 'Athlete',
    sourceBook: 'PHB',
    description: 'You have undergone extensive physical training to gain the following benefits:\n• Increase your Strength or Dexterity score by 1, to a maximum of 20.\n• When you are prone, standing up uses only 5 feet of your movement.\n• Climbing doesn\'t halve your speed.\n• You can make a running long jump or a running high jump after moving only 5 feet on foot.',
    abilityScoreIncrease: {},
  },
  {
    id: 'actor',
    name: 'Actor',
    sourceBook: 'PHB',
    description: 'Skilled at mimicry and dramatics, you gain the following benefits:\n• Increase your Charisma score by 1, to a maximum of 20.\n• You have advantage on Deception and Performance checks when trying to pass yourself off as a different person.\n• You can mimic the speech of another person or the sounds made by other creatures. You must have heard the person speaking, or heard the creature make the sound, for at least 1 minute.',
    abilityScoreIncrease: { cha: 1 },
  },
  {
    id: 'charger',
    name: 'Charger',
    sourceBook: 'PHB',
    description: 'When you use your action to Dash, you can use a bonus action to make one melee weapon attack or to shove a creature. If you move at least 10 feet in a straight line immediately before taking this bonus action, you either gain a +5 bonus to the attack\'s damage roll (if you chose to make a melee attack and hit) or push the target up to 10 feet away from you (if you chose to shove and you succeed).',
  },
  {
    id: 'crossbow-expert',
    name: 'Crossbow Expert',
    sourceBook: 'PHB',
    description: 'Thanks to extensive practice with the crossbow, you gain the following benefits:\n• You ignore the loading quality of crossbows with which you are proficient.\n• Being within 5 feet of a hostile creature doesn\'t impose disadvantage on your ranged attack rolls.\n• When you use the Attack action and attack with a one-handed weapon, you can use a bonus action to attack with a hand crossbow you are holding.',
  },
  {
    id: 'defensive-duelist',
    name: 'Defensive Duelist',
    sourceBook: 'PHB',
    prerequisite: { ability: { dex: 13 } },
    description: 'When you are wielding a finesse weapon with which you are proficient and another creature hits you with a melee attack, you can use your reaction to add your proficiency bonus to your AC for that attack, potentially causing the attack to miss you.',
  },
  {
    id: 'dual-wielder',
    name: 'Dual Wielder',
    sourceBook: 'PHB',
    description: 'You master fighting with two weapons, gaining the following benefits:\n• You gain a +1 bonus to AC while you are wielding a separate melee weapon in each hand.\n• You can use two-weapon fighting even when the one-handed melee weapons you are wielding aren\'t light.\n• You can draw or stow two one-handed weapons when you would normally be able to draw or stow only one.',
  },
  {
    id: 'dungeon-delver',
    name: 'Dungeon Delver',
    sourceBook: 'PHB',
    description: 'Alert to the hidden traps and secret doors found in many dungeons, you gain the following benefits:\n• You have advantage on Wisdom (Perception) and Intelligence (Investigation) checks made to detect the presence of secret doors.\n• You have advantage on saving throws made to avoid or resist traps.\n• You have resistance to the damage dealt by traps.\n• You can search for traps while traveling at a normal pace, instead of only at a slow pace.',
    grantsProficiency: ['Resistance to trap damage'],
  },
  {
    id: 'durable',
    name: 'Durable',
    sourceBook: 'PHB',
    description: 'Hardy and resilient, you gain the following benefits:\n• Increase your Constitution score by 1, to a maximum of 20.\n• When you roll a Hit Die to regain hit points, the minimum number of hit points you regain from the roll equals twice your Constitution modifier (minimum of 2).',
    abilityScoreIncrease: { con: 1 },
  },
  {
    id: 'elemental-adept',
    name: 'Elemental Adept',
    sourceBook: 'PHB',
    prerequisite: { spellcasting: true },
    description: 'When you gain this feat, choose one of the following damage types: acid, cold, fire, lightning, or thunder. Spells you cast ignore resistance to damage of the chosen type. In addition, when you roll damage for a spell you cast that deals damage of that type, you can treat any 1 on a damage die as a 2.',
  },
  {
    id: 'grappler',
    name: 'Grappler',
    sourceBook: 'PHB',
    prerequisite: { ability: { str: 13 } },
    description: 'You\'ve developed the skills necessary to hold your own in close-quarters grappling. You gain the following benefits:\n• You have advantage on attack rolls against a creature you are grappling.\n• You can use your action to try to pin a creature grappled by you. To do so, make another grapple check. If you succeed, you and the creature are both restrained until the grapple ends.',
  },
  {
    id: 'great-weapon-master',
    name: 'Great Weapon Master',
    sourceBook: 'PHB',
    description: 'You\'ve learned to put the weight of a weapon to your advantage, letting its momentum empower your strikes. You gain the following benefits:\n• On your turn, when you score a critical hit with a melee weapon or reduce a creature to 0 hit points with one, you can make one melee weapon attack as a bonus action.\n• Before you make a melee attack with a heavy weapon that you are proficient with, you can choose to take a -5 penalty to the attack roll. If the attack hits, you add +10 to the attack\'s damage.',
  },
  {
    id: 'healer',
    name: 'Healer',
    sourceBook: 'PHB',
    description: 'You are an able physician, allowing you to mend wounds quickly and get your allies back in the fight. You gain the following benefits:\n• When you use a healer\'s kit to stabilize a dying creature, that creature also regains 1 hit point.\n• As an action, you can spend one use of a healer\'s kit to tend to a creature and restore 1d6 + 4 hit points to it, plus additional hit points equal to the creature\'s maximum number of Hit Dice. The creature can\'t regain hit points from this feat again until it finishes a short or long rest.',
  },
  {
    id: 'heavily-armored',
    name: 'Heavily Armored',
    sourceBook: 'PHB',
    prerequisite: { proficiency: 'Medium Armor' },
    description: 'You have trained to master the use of heavy armor, gaining the following benefits:\n• Increase your Strength score by 1, to a maximum of 20.\n• You gain proficiency with heavy armor.',
    abilityScoreIncrease: { str: 1 },
    grantsProficiency: ['Heavy armor'],
  },
  {
    id: 'heavy-armor-master',
    name: 'Heavy Armor Master',
    sourceBook: 'PHB',
    prerequisite: { proficiency: 'Heavy Armor' },
    description: 'You can use your armor to deflect strikes that would kill others. You gain the following benefits:\n• Increase your Strength score by 1, to a maximum of 20.\n• While you\'re wearing heavy armor, bludgeoning, piercing, and slashing damage that you take from nonmagical weapons is reduced by 3.',
    abilityScoreIncrease: { str: 1 },
  },
  {
    id: 'inspiring-leader',
    name: 'Inspiring Leader',
    sourceBook: 'PHB',
    prerequisite: { ability: { cha: 13 } },
    description: 'You can spend 10 minutes inspiring your companions, shoring up their resolve to fight. When you do so, choose up to six friendly creatures (which can include yourself) within 30 feet of you who can see or hear you and who can understand you. Each creature can gain temporary hit points equal to your level + your Charisma modifier. A creature can\'t gain temporary hit points from this feat again until it has finished a short or long rest.',
  },
  {
    id: 'keen-mind',
    name: 'Keen Mind',
    sourceBook: 'PHB',
    description: 'You have a mind that can track time, direction, and detail with uncanny precision. You gain the following benefits:\n• Increase your Intelligence score by 1, to a maximum of 20.\n• You always know which way is north.\n• You always know the number of hours left before the next sunrise or sunset.\n• You can accurately recall anything you have seen or heard within the past month.',
    abilityScoreIncrease: { int: 1 },
  },
  {
    id: 'lightly-armored',
    name: 'Lightly Armored',
    sourceBook: 'PHB',
    description: 'You have trained to master the use of light armor, gaining the following benefits:\n• Increase your Strength or Dexterity score by 1, to a maximum of 20.\n• You gain proficiency with light armor.',
    grantsProficiency: ['Light armor'],
  },
  {
    id: 'lucky',
    name: 'Lucky',
    sourceBook: 'PHB',
    description: 'You have inexplicable luck that seems to kick in at just the right moment. You have 3 luck points. Whenever you make an attack roll, an ability check, or a saving throw, you can spend one luck point to roll an additional d20. You can choose to spend one of your luck points after you roll the die, but before the outcome is determined. You choose which of the d20s is used for the attack roll, ability check, or saving throw. You can also spend one luck point when an attack roll is made against you. Roll a d20, and then choose whether the attack uses the attacker\'s roll or yours. If more than one creature spends a luck point to influence the outcome of a roll, the points cancel each other out; no additional dice are rolled. You regain your expended luck points when you finish a long rest.',
  },
  {
    id: 'mage-slayer',
    name: 'Mage Slayer',
    sourceBook: 'PHB',
    description: 'You have practiced techniques useful in melee combat against spellcasters, gaining the following benefits:\n• When a creature within 5 feet of you casts a spell, you can use your reaction to make a melee weapon attack against that creature.\n• When you damage a creature that is concentrating on a spell, that creature has disadvantage on the saving throw it makes to maintain its concentration.\n• You have advantage on saving throws against spells cast by creatures within 5 feet of you.',
  },
  {
    id: 'magic-initiate',
    name: 'Magic Initiate',
    sourceBook: 'PHB',
    description: 'Choose a class: bard, cleric, druid, sorcerer, warlock, or wizard. You learn two cantrips of your choice from that class\'s spell list. In addition, choose one 1st-level spell to learn from that same list. Using this feat, you can cast the spell once at its lowest level, and you must finish a long rest before you can cast it in this way again. Your spellcasting ability for these spells depends on the class you chose: Charisma for bard, sorcerer, or warlock; Wisdom for cleric or druid; or Intelligence for wizard.',
  },
  {
    id: 'martial-adept',
    name: 'Martial Adept',
    sourceBook: 'PHB',
    description: 'You have martial training that allows you to perform special combat maneuvers. You gain the following benefits:\n• You learn two maneuvers of your choice from among those available to the Battle Master archetype in the fighter class. If a maneuver you use requires your target to make a saving throw to resist the maneuver\'s effects, the saving throw DC equals 8 + your proficiency bonus + your Strength or Dexterity modifier (your choice).\n• If you already have superiority dice, you gain one more; otherwise, you have one superiority die, which is a d6. This die is used to fuel your maneuvers. A superiority die is expended when you use it. You regain your expended superiority dice when you finish a short or long rest.',
  },
  {
    id: 'moderately-armored',
    name: 'Moderately Armored',
    sourceBook: 'PHB',
    prerequisite: { proficiency: 'Light Armor' },
    description: 'You have trained to master the use of medium armor and shields, gaining the following benefits:\n• Increase your Strength or Dexterity score by 1, to a maximum of 20.\n• You gain proficiency with medium armor and shields.',
    grantsProficiency: ['Medium armor', 'Shields'],
  },
  {
    id: 'mounted-combatant',
    name: 'Mounted Combatant',
    sourceBook: 'PHB',
    description: 'You are a dangerous foe to face while mounted. While you are mounted and aren\'t incapacitated, you gain the following benefits:\n• You have advantage on melee attack rolls against any unmounted creature that is smaller than your mount.\n• You can force an attack targeted at your mount to target you instead.\n• If your mount is subjected to an effect that allows it to make a Dexterity saving throw to take only half damage, it instead takes no damage if it succeeds on the saving throw, and only half damage if it fails.',
  },
  {
    id: 'observant',
    name: 'Observant',
    sourceBook: 'PHB',
    description: 'Quick to notice details of your environment, you gain the following benefits:\n• Increase your Intelligence or Wisdom score by 1, to a maximum of 20.\n• If you can see a creature\'s mouth while it is speaking a language you understand, you can interpret what it\'s saying by reading its lips.\n• You have a +5 bonus to your passive Wisdom (Perception) and passive Intelligence (Investigation) scores.',
  },
  {
    id: 'polearm-master',
    name: 'Polearm Master',
    sourceBook: 'PHB',
    description: 'You can keep your enemies at bay with reach weapons. You gain the following benefits:\n• When you take the Attack action and attack with only a glaive, halberd, quarterstaff, or spear, you can use a bonus action to make a melee attack with the opposite end of the weapon. This attack uses the same ability modifier as the primary attack. The weapon\'s damage die for this attack is a d4, and it deals bludgeoning damage.\n• While you are wielding a glaive, halberd, pike, quarterstaff, or spear, other creatures provoke an opportunity attack from you when they enter your reach.',
  },
  {
    id: 'resilient',
    name: 'Resilient',
    sourceBook: 'PHB',
    description: 'Choose one ability score. You gain the following benefits:\n• Increase the chosen ability score by 1, to a maximum of 20.\n• You gain proficiency in saving throws using the chosen ability.',
  },
  {
    id: 'ritual-caster',
    name: 'Ritual Caster',
    sourceBook: 'PHB',
    prerequisite: { ability: { int: 13, wis: 13 } },
    description: 'You have learned a number of spells that you can cast as rituals. These spells are written in a ritual book, which you must have in hand while casting one of them. When you choose this feat, you acquire a ritual book holding two 1st-level spells of your choice. Choose one of the following classes: bard, cleric, druid, sorcerer, warlock, or wizard. You must choose your spells from that class\'s spell list, and the spells you choose must have the ritual tag.',
  },
  {
    id: 'savage-attacker',
    name: 'Savage Attacker',
    sourceBook: 'PHB',
    description: 'Once per turn when you roll damage for a melee weapon attack, you can reroll the weapon\'s damage dice and use either total.',
  },
  {
    id: 'sentinel',
    name: 'Sentinel',
    sourceBook: 'PHB',
    description: 'You have mastered techniques to take advantage of every drop in any enemy\'s guard, gaining the following benefits:\n• When you hit a creature with an opportunity attack, the creature\'s speed becomes 0 for the rest of the turn.\n• Creatures provoke opportunity attacks from you even if they take the Disengage action before leaving your reach.\n• When a creature within 5 feet of you makes an attack against a target other than you (and that target doesn\'t have this feat), you can use your reaction to make a melee weapon attack against the attacking creature.',
  },
  {
    id: 'sharpshooter',
    name: 'Sharpshooter',
    sourceBook: 'PHB',
    description: 'You have mastered ranged weapons and can make shots that others find impossible. You gain the following benefits:\n• Attacking at long range doesn\'t impose disadvantage on your ranged weapon attack rolls.\n• Your ranged weapon attacks ignore half cover and three-quarters cover.\n• Before you make an attack with a ranged weapon that you are proficient with, you can choose to take a -5 penalty to the attack roll. If the attack hits, you add +10 to the attack\'s damage.',
  },
  {
    id: 'shield-master',
    name: 'Shield Master',
    sourceBook: 'PHB',
    description: 'You use shields not just for protection but also for offense. You gain the following benefits while you are wielding a shield:\n• If you take the Attack action on your turn, you can use a bonus action to try to shove a creature within 5 feet of you with your shield.\n• If you aren\'t incapacitated, you can add your shield\'s AC bonus to any Dexterity saving throw you make against a spell or other harmful effect that targets only you.\n• If you are subjected to an effect that allows you to make a Dexterity saving throw to take only half damage, you can use your reaction to take no damage if you succeed on the saving throw, interposing your shield between yourself and the source of the effect.',
  },
  {
    id: 'skilled',
    name: 'Skilled',
    sourceBook: 'PHB',
    description: 'You gain proficiency in any combination of three skills or tools of your choice.',
    grantsProficiency: ['3 skills or tools of your choice'],
  },
  {
    id: 'skulker',
    name: 'Skulker',
    sourceBook: 'PHB',
    prerequisite: { ability: { dex: 13 } },
    description: 'You are expert at slinking through shadows. You gain the following benefits:\n• You can try to hide when you are lightly obscured from the creature from which you are hiding.\n• When you are hidden from a creature and miss it with a ranged weapon attack, making the attack doesn\'t reveal your position.\n• Dim light doesn\'t impose disadvantage on your Wisdom (Perception) checks relying on sight.',
  },
  {
    id: 'spell-sniper',
    name: 'Spell Sniper',
    sourceBook: 'PHB',
    prerequisite: { spellcasting: true },
    description: 'You have learned techniques to enhance your attacks with certain kinds of spells, gaining the following benefits:\n• When you cast a spell that requires you to make an attack roll, the spell\'s range is doubled.\n• Your ranged spell attacks ignore half cover and three-quarters cover.\n• You learn one cantrip that requires an attack roll. Choose the cantrip from the bard, cleric, druid, sorcerer, warlock, or wizard spell list.',
  },
  {
    id: 'tavern-brawler',
    name: 'Tavern Brawler',
    sourceBook: 'PHB',
    description: 'Accustomed to rough-and-tumble fighting using whatever weapons happen to be at hand, you gain the following benefits:\n• Increase your Strength or Constitution score by 1, to a maximum of 20.\n• You are proficient with improvised weapons.\n• Your unarmed strike uses a d4 for damage.\n• When you hit a creature with an unarmed strike or an improvised weapon on your turn, you can use a bonus action to attempt to grapple the target.',
  },
  {
    id: 'tough',
    name: 'Tough',
    sourceBook: 'PHB',
    description: 'Your hit point maximum increases by an amount equal to twice your level when you gain this feat. Whenever you gain a level thereafter, your hit point maximum increases by an additional 2 hit points.',
  },
  {
    id: 'war-caster',
    name: 'War Caster',
    sourceBook: 'PHB',
    prerequisite: { spellcasting: true },
    description: 'You have practiced casting spells in the midst of combat, learning techniques that grant you the following benefits:\n• You have advantage on Constitution saving throws that you make to maintain your concentration on a spell when you take damage.\n• You can perform the somatic components of spells even when you have weapons or a shield in one or both hands.\n• When a hostile creature\'s movement provokes an opportunity attack from you, you can use your reaction to cast a spell at the creature, rather than making an opportunity attack. The spell must have a casting time of 1 action and must target only that creature.',
  },
  {
    id: 'weapon-master',
    name: 'Weapon Master',
    sourceBook: 'PHB',
    description: 'You have practiced extensively with a variety of weapons, gaining the following benefits:\n• Increase your Strength or Dexterity score by 1, to a maximum of 20.\n• You gain proficiency with four weapons of your choice. Each one must be a simple or a martial weapon.',
    grantsProficiency: ['4 weapons of your choice'],
  },
  // XGtE Feats
  {
    id: 'bountiful-luck',
    name: 'Bountiful Luck',
    sourceBook: 'XGtE',
    prerequisite: { race: 'halfling-lightfoot' },
    description: 'Your people have extraordinary luck, which you have learned to mystically lend to your companions when you see them falter. You\'re not sure how you do it; you just wish it, and it happens. Surely a sign of fortune\'s favor! When an ally you can see within 30 feet of you rolls a 1 on the d20 for an attack roll, an ability check, or a saving throw, you can use your reaction to let the ally reroll the die. The ally must use the new roll.',
  },
  {
    id: 'dragon-fear',
    name: 'Dragon Fear',
    sourceBook: 'XGtE',
    prerequisite: { race: 'dragonborn' },
    description: 'When angered, you radiate menace. You gain the following benefits:\n• Increase your Strength, Constitution, or Charisma score by 1, to a maximum of 20.\n• Instead of exhaling destructive energy, you can expend a use of your Breath Weapon trait to roar, forcing each creature of your choice within 30 feet of you to make a Wisdom saving throw (DC 8 + your proficiency bonus + your Charisma modifier). A target automatically succeeds on the save if it can\'t hear or see you. On a failed save, a target becomes frightened of you for 1 minute.',
  },
  {
    id: 'elven-accuracy',
    name: 'Elven Accuracy',
    sourceBook: 'XGtE',
    prerequisite: { race: 'elf-high' },
    description: 'The accuracy of elves is legendary, especially that of elf archers and spellcasters. You have uncanny aim with attacks that rely on precision rather than brute force. You gain the following benefits:\n• Increase your Dexterity, Intelligence, Wisdom, or Charisma score by 1, to a maximum of 20.\n• Whenever you have advantage on an attack roll using Dexterity, Intelligence, Wisdom, or Charisma, you can reroll one of the dice once.',
  },
  {
    id: 'fey-teleportation',
    name: 'Fey Teleportation',
    sourceBook: 'XGtE',
    prerequisite: { race: 'elf-high' },
    description: 'Your study of high elven lore has unlocked fey power that few other elves possess, except your eladrin cousins. Drawing on your fey ancestry, you can momentarily stride through the Feywild to shorten your path from one place to another. You gain the following benefits:\n• Increase your Intelligence or Charisma score by 1, to a maximum of 20.\n• You learn to speak, read, and write Sylvan.\n• You can cast the misty step spell once using this trait. You regain the ability to do so when you finish a short or long rest. Intelligence is your spellcasting ability for this spell.',
    grantsSpell: ['misty-step'],
  },
  // TCE Feats
  {
    id: 'artificer-initiate',
    name: 'Artificer Initiate',
    sourceBook: 'TCE',
    description: 'You\'ve learned some of an artificer\'s inventiveness:\n• You learn one cantrip of your choice from the artificer spell list, and you learn one 1st-level spell of your choice from that list. Intelligence is your spellcasting ability for these spells.\n• You can cast this feat\'s 1st-level spell without a spell slot, and you must finish a long rest before you can cast it in this way again. You can also cast the spell using any spell slots you have.\n• You gain proficiency with one type of artisan\'s tools of your choice, and you can use that type of tool as a spellcasting focus for any spell you cast that uses Intelligence as its spellcasting ability.',
  },
  {
    id: 'fighting-initiate',
    name: 'Fighting Initiate',
    sourceBook: 'TCE',
    prerequisite: { proficiency: 'Martial Weapon' },
    description: 'Your martial training has helped you develop a particular style of fighting. As a result, you learn one Fighting Style option of your choice from the fighter class. If you already have a style, the one you choose must be different. Whenever you reach a level that grants the Ability Score Improvement feature, you can replace this feat\'s fighting style with another one from the fighter class that you don\'t have.',
  },
  {
    id: 'fey-touched',
    name: 'Fey Touched',
    sourceBook: 'TCE',
    description: 'Your exposure to the Feywild\'s magic has changed you, granting you the following benefits:\n• Increase your Intelligence, Wisdom, or Charisma score by 1, to a maximum of 20.\n• You learn the misty step spell and one 1st-level spell of your choice. The 1st-level spell must be from the divination or enchantment school of magic. You can cast each of these spells without expending a spell slot. Once you cast either of these spells in this way, you can\'t cast that spell in this way again until you finish a long rest. You can also cast these spells using spell slots you have of the appropriate level. The spells\' spellcasting ability is the ability increased by this feat.',
    grantsSpell: ['misty-step'],
  },
  {
    id: 'shadow-touched',
    name: 'Shadow Touched',
    sourceBook: 'TCE',
    description: 'Your exposure to the Shadowfell\'s magic has changed you, granting you the following benefits:\n• Increase your Intelligence, Wisdom, or Charisma score by 1, to a maximum of 20.\n• You learn the invisibility spell and one 1st-level spell of your choice. The 1st-level spell must be from the illusion or necromancy school of magic. You can cast each of these spells without expending a spell slot. Once you cast either of these spells in this way, you can\'t cast that spell in this way again until you finish a long rest. You can also cast these spells using spell slots you have of the appropriate level. The spells\' spellcasting ability is the ability increased by this feat.',
    grantsSpell: ['invisibility'],
  },
  {
    id: 'skill-expert',
    name: 'Skill Expert',
    sourceBook: 'TCE',
    description: 'You have honed your proficiency with particular skills, granting you the following benefits:\n• Increase one ability score of your choice by 1, to a maximum of 20.\n• You gain proficiency in one skill of your choice.\n• Choose one skill in which you have proficiency. You gain expertise with that skill, which means your proficiency bonus is doubled for any ability check you make with it. The skill you choose must be one that isn\'t already benefiting from a feature, such as Expertise, that doubles your proficiency bonus.',
  },
  {
    id: 'telekinetic',
    name: 'Telekinetic',
    sourceBook: 'TCE',
    description: 'You learn to move things with your mind, granting you the following benefits:\n• Increase your Intelligence, Wisdom, or Charisma score by 1, to a maximum of 20.\n• You learn the mage hand cantrip. You can cast it without verbal or somatic components, and you can make the spectral hand invisible. If you already know this cantrip, its range increases by 30 feet when you cast it. Its spellcasting ability is the ability increased by this feat.\n• As a bonus action, you can try to telekinetically shove one creature you can see within 30 feet of you. When you do so, the target must succeed on a Strength saving throw (DC 8 + your proficiency bonus + the ability modifier of the score increased by this feat) or be moved 5 feet toward you or away from you. A creature can willingly fail this save.',
  },
  {
    id: 'telepathic',
    name: 'Telepathic',
    sourceBook: 'TCE',
    description: 'You awaken the ability to mentally connect with others, granting you the following benefits:\n• Increase your Intelligence, Wisdom, or Charisma score by 1, to a maximum of 20.\n• You can speak telepathically to any creature you can see within 60 feet of you. Your telepathic utterances are in a language you know, and the creature understands you only if it knows that language. Your communication doesn\'t give the creature the ability to respond to you telepathically.\n• You can cast the detect thoughts spell, requiring no spell slot or components, and you must finish a long rest before you can cast it this way again. Your spellcasting ability for the spell is the ability increased by this feat. If you have spell slots of 2nd level or higher, you can cast this spell with them.',
  },

  // ── REMAINING PHB FEATS ────────────────────────────────────────────────
  {
    id: 'linguist',
    name: 'Linguist',
    sourceBook: 'PHB',
    description: 'You have studied languages and codes, gaining the following benefits:\n• Increase your Intelligence score by 1, to a maximum of 20.\n• You learn three languages of your choice.\n• You can ably create written ciphers. Others can\'t decipher a code you create unless you teach them, they succeed on an Intelligence check (DC equal to your Intelligence score + your proficiency bonus), or they use magic to decipher it.',
    abilityScoreIncrease: { int: 1 },
  },
  {
    id: 'medium-armor-master',
    name: 'Medium Armor Master',
    sourceBook: 'PHB',
    prerequisite: { other: 'Proficiency with medium armor' },
    description: 'You have practiced moving in medium armor to gain the following benefits:\n• Wearing medium armor doesn\'t impose disadvantage on your Dexterity (Stealth) checks.\n• When you wear medium armor, you can add 3, rather than 2, to your AC if you have a Dexterity of 16 or higher.',
  },
  {
    id: 'mobile',
    name: 'Mobile',
    sourceBook: 'PHB',
    description: 'You are exceptionally speedy and agile. You gain the following benefits:\n• Your speed increases by 10 feet.\n• When you use the Dash action, difficult terrain doesn\'t cost you extra movement on that turn.\n• When you make a melee attack against a creature, you don\'t provoke opportunity attacks from that creature for the rest of the turn, whether you hit or not.',
  },

  // ── REMAINING XGtE FEATS ───────────────────────────────────────────────
  {
    id: 'dragon-hide',
    name: 'Dragon Hide',
    sourceBook: 'XGtE',
    prerequisite: { race: 'dragonborn' },
    description: 'You manifest scales and claws reminiscent of your draconic ancestors:\n• Increase your Strength or Charisma score by 1, to a maximum of 20.\n• Your scales harden. While you aren\'t wearing armor, you can calculate your AC as 13 + your Dexterity modifier. You can use a shield and still gain this benefit.\n• You grow retractable claws from the tips of your fingers. The claws are natural weapons, which you can use to make unarmed strikes. If you hit with them, you deal slashing damage equal to 1d4 + your Strength modifier, instead of the bludgeoning damage normal for an unarmed strike.',
  },
  {
    id: 'drow-high-magic',
    name: 'Drow High Magic',
    sourceBook: 'XGtE',
    prerequisite: { race: 'elf-drow' },
    description: 'You learn more of the magic typical of dark elves. You learn the detect magic spell and can cast it at will, without expending a spell slot. You also learn levitate and dispel magic, each of which you can cast once without expending a spell slot. You regain the ability to cast those two spells in this way when you finish a long rest. Charisma is your spellcasting ability for all three spells.',
  },
  {
    id: 'dwarven-fortitude',
    name: 'Dwarven Fortitude',
    sourceBook: 'XGtE',
    prerequisite: { race: 'dwarf' },
    description: 'You have the blood of dwarf heroes flowing through your veins:\n• Increase your Constitution score by 1, to a maximum of 20.\n• Whenever you take the Dodge action in combat, you can spend one Hit Die to heal yourself. Roll the die, add your Constitution modifier, and regain a number of hit points equal to the total (minimum of 1).',
    abilityScoreIncrease: { con: 1 },
  },
  {
    id: 'fade-away',
    name: 'Fade Away',
    sourceBook: 'XGtE',
    prerequisite: { race: 'gnome' },
    description: 'Your people are clever, with a knack for illusion magic:\n• Increase your Dexterity or Intelligence score by 1, to a maximum of 20.\n• Immediately after you take damage, you can use a reaction to magically become invisible until the end of your next turn or until you attack, deal damage, or force someone to make a saving throw. Once you use this ability, you can\'t do so again until you finish a short or long rest.',
  },
  {
    id: 'flames-of-phlegethos',
    name: 'Flames of Phlegethos',
    sourceBook: 'XGtE',
    prerequisite: { race: 'tiefling' },
    description: 'You learn to call on hellfire to serve your commands:\n• Increase your Intelligence or Charisma score by 1, to a maximum of 20.\n• When you roll fire damage for a spell you cast, you can reroll any roll of 1 on the fire damage dice, but you must use the new roll, even if it is another 1.\n• Whenever you cast a spell that deals fire damage, you can cause flames to wreathe you until the end of your next turn. The flames shed bright light out to 30 feet and dim light for an additional 30 feet. While the flames are present, any creature within 5 feet that hits you with a melee attack takes 1d4 fire damage.',
  },
  {
    id: 'infernal-constitution',
    name: 'Infernal Constitution',
    sourceBook: 'XGtE',
    prerequisite: { race: 'tiefling' },
    description: 'Fiendish blood runs strong in you:\n• Increase your Constitution score by 1, to a maximum of 20.\n• You have resistance to cold damage and poison damage.\n• You have advantage on saving throws against being poisoned.',
    abilityScoreIncrease: { con: 1 },
  },
  {
    id: 'orcish-fury',
    name: 'Orcish Fury',
    sourceBook: 'XGtE',
    prerequisite: { race: 'half-orc' },
    description: 'Your fury burns tirelessly:\n• Increase your Strength or Constitution score by 1, to a maximum of 20.\n• When you hit with an attack using a simple or martial weapon, you can roll one of the weapon\'s damage dice an additional time and add it as extra damage of the weapon\'s damage type. Once you use this ability, you can\'t do so again until you finish a short or long rest.\n• Immediately after you use your Relentless Endurance trait, you can use your reaction to make one weapon attack.',
  },
  {
    id: 'prodigy',
    name: 'Prodigy',
    sourceBook: 'XGtE',
    prerequisite: { other: 'Half-elf, half-orc, or human' },
    description: 'You have a knack for learning new things. You gain the following benefits:\n• You gain one skill proficiency of your choice, one tool proficiency of your choice, and fluency in one language of your choice.\n• Choose one skill in which you have proficiency. You gain expertise with that skill, which means your proficiency bonus is doubled for any ability check you make with it.',
  },
  {
    id: 'second-chance',
    name: 'Second Chance',
    sourceBook: 'XGtE',
    prerequisite: { race: 'halfling' },
    description: 'Fortune favors you when someone tries to strike you:\n• Increase your Dexterity, Constitution, or Charisma score by 1, to a maximum of 20.\n• When a creature you can see hits you with an attack roll, you can use your reaction to force that creature to reroll. Once you use this ability, you can\'t use it again until you roll initiative at the start of combat or until you finish a short or long rest.',
  },
  {
    id: 'squat-nimbleness',
    name: 'Squat Nimbleness',
    sourceBook: 'XGtE',
    prerequisite: { other: 'Dwarf or a Small race' },
    description: 'You are uncommonly nimble for your race. You gain the following benefits:\n• Increase your Strength or Dexterity score by 1, to a maximum of 20.\n• Your walking speed increases by 5 feet.\n• You gain proficiency in the Acrobatics or Athletics skill (your choice).\n• You have advantage on any Strength (Athletics) or Dexterity (Acrobatics) check you make to escape from being grappled.',
  },
  {
    id: 'wood-elf-magic',
    name: 'Wood Elf Magic',
    sourceBook: 'XGtE',
    prerequisite: { race: 'elf-wood' },
    description: 'You learn the magic of the primeval woods, which are revered and protected by your kind. You learn one druid cantrip of your choice. You also learn the longstrider and pass without trace spells, each of which you can cast once without expending a spell slot. You regain the ability to cast those two spells in this way when you finish a long rest. Wisdom is your spellcasting ability for all three spells.',
  },

  // ── REMAINING TCE FEATS ────────────────────────────────────────────────
  {
    id: 'chef',
    name: 'Chef',
    sourceBook: 'TCE',
    description: 'Time spent mastering the culinary arts has paid off:\n• Increase your Constitution or Wisdom score by 1, to a maximum of 20.\n• You gain proficiency with cook\'s utensils if you don\'t already have it.\n• As part of a short rest, you can cook special food, provided you have ingredients and cook\'s utensils on hand. You can prepare enough food for a number of creatures equal to 4 + your proficiency bonus. At the end of the short rest, any creature who eats the food and spends at least one Hit Die regains an extra 1d8 hit points.\n• With one hour of work or when you finish a long rest, you can cook a number of treats equal to your proficiency bonus. These treats last 8 hours after being made. A creature can use a bonus action to eat one of those treats to gain temporary hit points equal to your proficiency bonus.',
  },
  {
    id: 'crusher',
    name: 'Crusher',
    sourceBook: 'TCE',
    description: 'You are practiced in the art of crushing your enemies:\n• Increase your Strength or Constitution score by 1, to a maximum of 20.\n• Once per turn, when you hit a creature with an attack that deals bludgeoning damage, you can move it 5 feet to an unoccupied space, provided the target is no more than one size larger than you.\n• When you score a critical hit that deals bludgeoning damage to a creature, attack rolls against that creature are made with advantage until the start of your next turn.',
  },
  {
    id: 'eldritch-adept',
    name: 'Eldritch Adept',
    sourceBook: 'TCE',
    prerequisite: { other: 'Spellcasting or Pact Magic feature' },
    description: 'Studying occult lore, you have unlocked eldritch power within yourself: you learn one Eldritch Invocation option of your choice from the warlock class. If the invocation has a prerequisite, you can choose that invocation only if you\'re a warlock who meets the prerequisite. Whenever you gain a level, you can replace the invocation with another from the warlock class.',
  },
  {
    id: 'gunner',
    name: 'Gunner',
    sourceBook: 'TCE',
    description: 'You have a quick hand and keen eye when employing firearms, granting you the following benefits:\n• Increase your Dexterity score by 1, to a maximum of 20.\n• You gain proficiency with firearms.\n• You ignore the loading property of firearms.\n• Being within 5 feet of a hostile creature doesn\'t impose disadvantage on your ranged attack rolls.',
    abilityScoreIncrease: { dex: 1 },
  },
  {
    id: 'metamagic-adept',
    name: 'Metamagic Adept',
    sourceBook: 'TCE',
    prerequisite: { other: 'Spellcasting or Pact Magic feature' },
    description: 'You\'ve learned how to exert your will on your spells:\n• You learn two Metamagic options of your choice from the sorcerer class. You can use only one Metamagic option on a spell when you cast it, unless the option says otherwise.\n• You gain 2 sorcery points to spend on Metamagic. You regain all spent sorcery points when you finish a long rest.',
  },
  {
    id: 'piercer',
    name: 'Piercer',
    sourceBook: 'TCE',
    description: 'You have achieved a penetrating precision in combat:\n• Increase your Strength or Dexterity score by 1, to a maximum of 20.\n• Once per turn, when you hit a creature with an attack that deals piercing damage, you can reroll one of the attack\'s damage dice, and you must use the new roll.\n• When you score a critical hit that deals piercing damage to a creature, you can roll one additional damage die when determining the extra piercing damage the target takes.',
  },
  {
    id: 'poisoner',
    name: 'Poisoner',
    sourceBook: 'TCE',
    description: 'You can prepare and deliver deadly poisons:\n• When you make a damage roll that deals poison damage, it ignores resistance to poison damage.\n• You can apply poison to a weapon or piece of ammunition as a bonus action, instead of an action.\n• You gain proficiency with the poisoner\'s kit if you don\'t already have it. With one hour of work and 50 gp worth of materials, you can produce a number of doses of potent poison equal to your proficiency bonus. The poison retains potency for 1 hour. When you hit a creature with a weapon coated with this poison, the creature takes an extra 2d8 poison damage and must succeed on a DC 14 Constitution save or be poisoned for 1 minute.',
  },
  {
    id: 'slasher',
    name: 'Slasher',
    sourceBook: 'TCE',
    description: 'You\'ve learned where to cut to have the greatest results:\n• Increase your Strength or Dexterity score by 1, to a maximum of 20.\n• Once per turn, when you hit a creature with an attack that deals slashing damage, you can reduce the speed of the target by 10 feet until the start of your next turn.\n• When you score a critical hit that deals slashing damage to a creature, you grievously wound it. Until the start of your next turn, the target has disadvantage on all attack rolls.',
  },

  // ── FToD FEATS ─────────────────────────────────────────────────────────
  {
    id: 'gift-of-the-chromatic-dragon',
    name: 'Gift of the Chromatic Dragon',
    sourceBook: 'FToD',
    description: 'You have been gifted with the power of chromatic dragons:\n• Chromatic Infusion. As a bonus action, you can touch one simple or martial weapon and infuse it with one of: acid, cold, fire, lightning, or poison. For the next minute, the weapon deals an extra 1d4 damage of the chosen type. After you use this ability, you can\'t use it again until you finish a long rest.\n• Reactive Resistance. When you take acid, cold, fire, lightning, or poison damage, you can use your reaction to give yourself resistance to that instance of damage. After you use this ability, you can\'t use it again until you finish a long rest.',
  },
  {
    id: 'gift-of-the-gem-dragon',
    name: 'Gift of the Gem Dragon',
    sourceBook: 'FToD',
    prerequisite: { other: '4th level' },
    description: 'You have manifested the power of gem dragons:\n• Increase your Intelligence, Wisdom, or Charisma score by 1, to a maximum of 20.\n• Telekinetic Reprisal. When a creature within 10 feet of you deals damage to you, you can use your reaction to force the creature to make a Strength save. On failure, it takes 2d8 force damage, is pushed 10 feet, and knocked prone; on success, half damage. Prof-bonus uses per long rest.\n• Psionic Wings. Spectral wings emerge from your back, granting you a flying speed equal to your walking speed for 10 minutes. Once per long rest.',
  },
  {
    id: 'gift-of-the-metallic-dragon',
    name: 'Gift of the Metallic Dragon',
    sourceBook: 'FToD',
    description: 'You bear a gift bestowed by metallic dragons:\n• Draconic Healing. You learn the Cure Wounds spell. You can cast it once without expending a spell slot. You regain the ability to cast it this way when you finish a long rest.\n• Protective Wings. When you or a creature you can see within 5 feet of you is hit by an attack, you can use your reaction to extend spectral wings, granting a bonus to AC against the attack equal to your proficiency bonus. Prof-bonus uses per long rest.',
  },
];

export function getFeat(id: string): Feat | undefined {
  return ALL_FEATS.find(f => f.id === id);
}

function checkArmorProficiency(profKey: string, character: Character): boolean {
  const allArmor = character.classes
    .map(cl => getClass(cl.classId))
    .filter(Boolean)
    .flatMap(cd => cd!.armorProficiencies.map(x => x.toLowerCase()));
  const p = profKey.toLowerCase();
  if (p.includes('light')) return allArmor.some(x => x.includes('light') || x.includes('medium') || x.includes('heavy') || x.includes('all armor'));
  if (p.includes('medium')) return allArmor.some(x => x.includes('medium') || x.includes('heavy') || x.includes('all armor'));
  if (p.includes('heavy')) return allArmor.some(x => x.includes('heavy') || x.includes('all armor'));
  return false;
}

function checkMartialWeaponProficiency(character: Character): boolean {
  return character.classes
    .map(cl => getClass(cl.classId))
    .filter(Boolean)
    .some(cd => cd!.weaponProficiencies.some(p => p.toLowerCase().includes('martial')));
}

/** Returns feats the character is eligible to choose (book-filtered, prereqs met, not already taken). */
export function getEligibleFeats(character: Character, enabledBooks: BookId[]): Feat[] {
  const alreadyTaken = new Set(character.selectedFeats ?? []);
  const totalLevel = character.classes.reduce((s, c) => s + c.level, 0);

  const race = getRace(character.raceId);
  const racialBonuses = race?.abilityScoreIncreases ?? {};
  const effectiveScore = (k: AbilityKey) =>
    (character.baseAbilityScores[k] ?? 0) + ((racialBonuses as Partial<Record<AbilityKey, number>>)[k] ?? 0);

  const canCast = character.classes.some(cl => {
    const def = getClass(cl.classId);
    if (def && def.spellcastingType !== 'none') return true;
    if (cl.subclassId) {
      const sub = getSubclass(cl.subclassId);
      if (sub?.spellcastingType && sub.spellcastingType !== 'none') return true;
    }
    return false;
  });

  return ALL_FEATS.filter(feat => {
    if (!enabledBooks.includes(feat.sourceBook)) return false;
    if (alreadyTaken.has(feat.id)) return false;

    const prereq = feat.prerequisite;
    if (!prereq) return true;

    if (prereq.race) {
      const raceId = character.raceId;
      // 'halfling' matches 'halfling-lightfoot'; 'halfling-lightfoot' only matches exactly
      if (raceId !== prereq.race && !raceId.startsWith(prereq.race)) return false;
    }
    if (prereq.minLevel !== undefined && totalLevel < prereq.minLevel) return false;
    if (prereq.ability) {
      for (const [k, min] of Object.entries(prereq.ability)) {
        if (effectiveScore(k as AbilityKey) < (min as number)) return false;
      }
    }
    if (prereq.spellcasting && !canCast) return false;
    if (prereq.proficiency) {
      const p = prereq.proficiency.toLowerCase();
      if (p.includes('martial')) {
        if (!checkMartialWeaponProficiency(character)) return false;
      } else if (p.includes('armor')) {
        if (!checkArmorProficiency(prereq.proficiency, character)) return false;
      }
    }
    if (prereq.classId && !character.classes.some(cl => cl.classId === prereq.classId)) return false;
    // prereq.other is free-text — can't enforce programmatically, show it but allow selection
    return true;
  });
}
