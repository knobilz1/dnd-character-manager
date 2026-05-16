import type { Subclass } from '../../types';

export const ALL_SUBCLASSES: Subclass[] = [
  // Barbarian
  { id: 'berserker', name: 'Path of the Berserker', classId: 'barbarian', sourceBook: 'PHB', description: 'For some barbarians, rage is a means to an end—that end being violence. The Path of the Berserker is a path of untrammeled fury, slick with blood.', features: [
    { name: 'Frenzy', level: 3, description: 'Starting when you choose this path at 3rd level, you can go into a frenzy when you rage. If you do so, for the duration of your rage you can make a single melee weapon attack as a bonus action on each of your turns after this one.' },
    { name: 'Mindless Rage', level: 6, description: 'Beginning at 6th level, you can\'t be charmed or frightened while raging. If you are charmed or frightened when you enter your rage, the effect is suspended for the duration of the rage.' },
    { name: 'Intimidating Presence', level: 10, description: 'Beginning at 10th level, you can use your action to frighten someone with your menacing presence. When you do so, choose one creature that you can see within 30 feet of you.' },
    { name: 'Retaliation', level: 14, description: 'Starting at 14th level, when you take damage from a creature that is within 5 feet of you, you can use your reaction to make a melee weapon attack against that creature.' },
  ]},
  { id: 'totem-warrior', name: 'Path of the Totem Warrior', classId: 'barbarian', sourceBook: 'PHB', description: 'The Path of the Totem Warrior is a spiritual journey, as the barbarian accepts a spirit animal as guide, protector, and inspiration.', features: [
    { name: 'Spirit Seeker', level: 3, description: 'Yours is a path that seeks attunement with the natural world, giving you a kinship with beasts.' },
    { name: 'Totem Spirit', level: 3, description: 'At 3rd level, when you adopt this path, you choose a totem spirit and gain its feature. You must make or acquire a physical totem object—an amulet or similar adornment—that incorporates fur or feathers, claws, teeth, or bones of the totem animal. Bear: While raging, you have resistance to all damage except psychic damage. Eagle: While you\'re raging, other creatures have disadvantage on opportunity attack rolls against you, and you can use the Dash action as a bonus action on your turn. Wolf: While you\'re raging, your friends have advantage on melee attack rolls against any creature within 5 feet of you that is hostile to you.' },
    { name: 'Aspect of the Beast', level: 6, description: 'At 6th level, you gain a magical benefit based on the totem animal of your choice.' },
    { name: 'Spirit Walker', level: 10, description: 'At 10th level, you can cast the commune with nature spell, but only as a ritual.' },
    { name: 'Totemic Attunement', level: 14, description: 'At 14th level, you gain a magical benefit based on a totem animal of your choice.' },
  ]},
  { id: 'storm-herald', name: 'Path of the Storm Herald', classId: 'barbarian', sourceBook: 'XGtE', description: 'Typical barbarians harbor a fury that dwells within. Their rage grants them superior strength, durability, and speed. Barbarians who follow the Path of the Storm Herald learn instead to transform their rage into a mantle of primal magic.', features: [
    { name: 'Storm Aura', level: 3, description: 'You emanate a stormy, magical aura while you rage. The aura extends 10 feet from you in every direction, but not through total cover. Your aura has an effect that activates when you enter your rage, and you can activate the effect again on each of your turns as a bonus action.' },
    { name: 'Storm Soul', level: 6, description: 'The storm grants you benefits even when your aura isn\'t active. The benefits are based on the environment you chose for your Storm Aura.' },
    { name: 'Shielding Storm', level: 10, description: 'You learn to use your mastery of the storm to protect others. Each creature of your choice has the damage resistance you gained from the Storm Soul feature while the creature is in your Storm Aura.' },
    { name: 'Raging Storm', level: 14, description: 'The power of the storm you channel grows mightier, lashing out at your foes.' },
  ]},
  // Bard
  { id: 'college-of-lore', name: 'College of Lore', classId: 'bard', sourceBook: 'PHB', description: 'Bards of the College of Lore know something about most things, collecting bits of knowledge from sources as diverse as scholarly tomes and peasant tales.', features: [
    { name: 'Bonus Proficiencies', level: 3, description: 'When you join the College of Lore at 3rd level, you gain proficiency with three skills of your choice.' },
    { name: 'Cutting Words', level: 3, description: 'Also at 3rd level, you learn how to use your wit to distract, confuse, and otherwise sap the confidence and competence of others. When a creature that you can see within 60 feet of you makes an attack roll, an ability check, or a damage roll, you can use your reaction to expend one of your uses of Bardic Inspiration, rolling a Bardic Inspiration die and subtracting the number rolled from the creature\'s roll.' },
    { name: 'Additional Magical Secrets', level: 6, description: 'At 6th level, you learn two spells of your choice from any class. A spell you choose must be of a level you can cast, as shown on the Bard table, or a cantrip. The chosen spells count as bard spells for you but don\'t count against the number of bard spells you know.' },
    { name: 'Peerless Skill', level: 14, description: 'Starting at 14th level, when you make an ability check, you can expend one use of Bardic Inspiration. Roll a Bardic Inspiration die and add the number rolled to your ability check. You can choose to do so after you roll the die for the ability check, but before the DM tells you whether you succeed or fail.' },
  ]},
  { id: 'college-of-valor', name: 'College of Valor', classId: 'bard', sourceBook: 'PHB', description: 'Bards of the College of Valor are daring skalds whose tales keep alive the memory of the great heroes of the past.', features: [
    { name: 'Bonus Proficiencies', level: 3, description: 'When you join the College of Valor at 3rd level, you gain proficiency with medium armor, shields, and martial weapons.' },
    { name: 'Combat Inspiration', level: 3, description: 'Also at 3rd level, you learn to inspire others in battle. A creature that has a Bardic Inspiration die from you can roll that die and add the number rolled to a weapon damage roll it just made. Alternatively, when an attack roll is made against the creature, it can use its reaction to roll the Bardic Inspiration die and add the number rolled to its AC against that attack, after seeing the roll but before knowing whether it hits or misses.' },
    { name: 'Extra Attack', level: 6, description: 'Starting at 6th level, you can attack twice, instead of once, whenever you take the Attack action on your turn.' },
    { name: 'Battle Magic', level: 14, description: 'At 14th level, you have mastered the art of weaving spellcasting and weapon use into a single harmonious act. When you use your action to cast a bard spell, you can make one weapon attack as a bonus action.' },
  ]},
  { id: 'college-of-glamour', name: 'College of Glamour', classId: 'bard', sourceBook: 'XGtE', description: 'The College of Glamour is the home of bards who mastered their craft in the vibrant realm of the Feywild or under the tutelage of someone who dwelled there.', features: [
    { name: 'Mantle of Inspiration', level: 3, description: 'When you join the College of Glamour at 3rd level, you gain the ability to weave a song of fey magic that imbues your allies with vigor and speed.' },
    { name: 'Enthralling Performance', level: 3, description: 'Starting at 3rd level, you can charge your performance with the captivating magic of the Feywild.' },
    { name: 'Mantle of Majesty', level: 6, description: 'At 6th level, you gain the ability to cloak yourself in a fey magic that makes others want to serve you.' },
    { name: 'Unbreakable Majesty', level: 14, description: 'At 14th level, your appearance permanently takes on an otherworldly aspect that makes you look more lovely and fierce.' },
  ]},
  // Cleric
  { id: 'life-domain', name: 'Life Domain', classId: 'cleric', sourceBook: 'PHB', description: 'The Life domain focuses on the vibrant positive energy—one of the fundamental forces of the universe—that sustains all life.', features: [
    { name: 'Disciple of Life', level: 1, description: 'Also starting at 1st level, your healing spells are more effective. Whenever you use a spell of 1st level or higher to restore hit points to a creature, the creature regains additional hit points equal to 2 + the spell\'s level.' },
    { name: 'Channel Divinity: Preserve Life', level: 2, description: 'Starting at 2nd level, you can use your Channel Divinity to heal the badly injured. As an action, you present your holy symbol and evoke healing energy that can restore a number of hit points equal to five times your cleric level.' },
    { name: 'Blessed Healer', level: 6, description: 'Beginning at 6th level, the healing spells you cast on others heal you as well. When you cast a spell of 1st level or higher that restores hit points to a creature other than you, you regain hit points equal to 2 + the spell\'s level.' },
    { name: 'Divine Strike', level: 8, description: 'At 8th level, you gain the ability to infuse your weapon strikes with divine energy. Once on each of your turns when you hit a creature with a weapon attack, you can cause the attack to deal an extra 1d8 radiant damage to the target.' },
    { name: 'Supreme Healing', level: 17, description: 'Starting at 17th level, when you would normally roll one or more dice to restore hit points with a spell, you instead use the highest number possible for each die.' },
  ], alwaysPreparedSpells: { 1: ['bless', 'cure-wounds'], 3: ['lesser-restoration', 'spiritual-weapon'], 5: ['beacon-of-hope', 'revivify'], 7: ['death-ward', 'guardian-of-faith'], 9: ['mass-cure-wounds', 'raise-dead'] }},
  { id: 'knowledge-domain', name: 'Knowledge Domain', classId: 'cleric', sourceBook: 'PHB', description: 'The gods of knowledge—including Ioun, Oghma, Thoth, and others—value learning and understanding above all.', features: [
    { name: 'Blessings of Knowledge', level: 1, description: 'At 1st level, you learn two languages of your choice. You also become proficient in your choice of two of the following skills: Arcana, History, Nature, or Religion. Your proficiency bonus is doubled for any ability check you make that uses either of the chosen skills.' },
    { name: 'Channel Divinity: Knowledge of the Ages', level: 2, description: 'Starting at 2nd level, you can use your Channel Divinity to tap into a divine well of knowledge. As an action, you choose one skill or tool. For 10 minutes, you have proficiency with the chosen skill or tool.' },
    { name: 'Read Thoughts', level: 6, description: 'At 6th level, you can use your Channel Divinity to read a creature\'s thoughts.' },
    { name: 'Potent Spellcasting', level: 8, description: 'Starting at 8th level, you add your Wisdom modifier to the damage you deal with any cleric cantrip.' },
    { name: 'Visions of the Past', level: 17, description: 'Starting at 17th level, you can call up visions of the past that relate to an object you hold or your immediate surroundings.' },
  ]},
  { id: 'light-domain', name: 'Light Domain', classId: 'cleric', sourceBook: 'PHB', description: 'Gods of light—including Helm, Lathander, Pholtus, Branchala, the Silver Flame, Belenus, Apollo, and Re-Horakhty—promote the ideals of rebirth and renewal, truth, vigilance, and beauty.', features: [
    { name: 'Bonus Cantrip', level: 1, description: 'When you choose this domain at 1st level, you gain the light cantrip if you don\'t already know it.' },
    { name: 'Warding Flare', level: 1, description: 'Also at 1st level, you can interpose divine light between yourself and an attacking enemy. When you are attacked by a creature within 30 feet of you that you can see, you can use your reaction to impose disadvantage on the attack roll, causing light to flare before the attacker before it hits or misses.' },
    { name: 'Channel Divinity: Radiance of the Dawn', level: 2, description: 'Starting at 2nd level, you can use your Channel Divinity to harness sunlight, banishing darkness and dealing radiant damage to your foes.' },
    { name: 'Improved Flare', level: 6, description: 'Starting at 6th level, you can also use your Warding Flare feature when a creature that you can see within 30 feet of you attacks a creature other than you.' },
    { name: 'Potent Spellcasting', level: 8, description: 'Starting at 8th level, you add your Wisdom modifier to the damage you deal with any cleric cantrip.' },
    { name: 'Corona of Light', level: 17, description: 'Starting at 17th level, you can use your action to activate an aura of sunlight that lasts for 1 minute or until you dismiss it using another action.' },
  ]},
  // Fighter
  { id: 'champion', name: 'Champion', classId: 'fighter', sourceBook: 'PHB', description: 'The archetypal Champion focuses on the development of raw physical power honed to deadly perfection.', features: [
    { name: 'Improved Critical', level: 3, description: 'Beginning when you choose this archetype at 3rd level, your weapon attacks score a critical hit on a roll of 19 or 20.' },
    { name: 'Remarkable Athlete', level: 7, description: 'Starting at 7th level, you can add half your proficiency bonus (round up) to any Strength, Dexterity, or Constitution check you make that doesn\'t already use your proficiency bonus.' },
    { name: 'Additional Fighting Style', level: 10, description: 'At 10th level, you can choose a second option from the Fighting Style class feature.' },
    { name: 'Superior Critical', level: 15, description: 'Starting at 15th level, your weapon attacks score a critical hit on a roll of 18–20.' },
    { name: 'Survivor', level: 18, description: 'At 18th level, you attain the pinnacle of resilience in battle. At the start of each of your turns, you regain hit points equal to 5 + your Constitution modifier if you have no more than half of your hit points left.' },
  ]},
  { id: 'battle-master', name: 'Battle Master', classId: 'fighter', sourceBook: 'PHB', description: 'Those who emulate the archetype of the Battle Master employ martial techniques passed down through generations.',
    resources: [
      {
        name: 'Superiority Dice',
        key: 'superiority_dice',
        rechargeOn: 'short',
        // Subclass resource keyed on the multiclass\'s fighter level; tables here are by class level.
        maxPerLevel: { 1:0,2:0,3:4,4:4,5:4,6:4,7:5,8:5,9:5,10:5,11:5,12:5,13:5,14:5,15:6,16:6,17:6,18:6,19:6,20:6 },
      },
    ],
    features: [
    { name: 'Combat Superiority', level: 3, description: 'When you choose this archetype at 3rd level, you learn maneuvers that are fueled by special dice called superiority dice (d8, upgrading to d10 at 10th level and d12 at 18th level). You learn three maneuvers of your choice. You have four superiority dice. You regain all of your expended superiority dice when you finish a short or long rest.' },
    { name: 'Student of War', level: 3, description: 'At 3rd level, you gain proficiency with one type of artisan\'s tools of your choice.' },
    { name: 'Know Your Enemy', level: 7, description: 'If you spend at least 1 minute observing or interacting with another creature outside combat, you can learn certain information about its capabilities compared to your own.' },
    { name: 'Improved Combat Superiority', level: 10, description: 'At 10th level, your superiority dice turn into d10s. At 18th level, they turn into d12s.' },
    { name: 'Relentless', level: 15, description: 'Starting at 15th level, when you roll initiative and have no superiority dice remaining, you regain 1 superiority die.' },
  ]},
  { id: 'eldritch-knight', name: 'Eldritch Knight', classId: 'fighter', sourceBook: 'PHB', description: 'The archetypical Eldritch Knight combines the martial mastery common to all fighters with a careful study of magic.', spellcastingType: 'third', features: [
    { name: 'Spellcasting', level: 3, description: 'When you reach 3rd level, you augment your martial prowess with the ability to cast spells.', },
    { name: 'Weapon Bond', level: 3, description: 'At 3rd level, you learn a ritual that creates a magical bond between yourself and one weapon.' },
    { name: 'War Magic', level: 7, description: 'Beginning at 7th level, when you use your action to cast a cantrip, you can make one weapon attack as a bonus action.' },
    { name: 'Eldritch Strike', level: 10, description: 'At 10th level, you learn how to make your weapon strikes undercut a creature\'s resistance to your spells.' },
    { name: 'Arcane Charge', level: 15, description: 'At 15th level, you gain the ability to teleport up to 30 feet to an unoccupied space you can see when you use your Action Surge.' },
    { name: 'Improved War Magic', level: 18, description: 'Starting at 18th level, when you use your action to cast a spell, you can make one weapon attack as a bonus action.' },
  ], spellcastingType: 'third'},
  // Monk
  { id: 'way-of-the-open-hand', name: 'Way of the Open Hand', classId: 'monk', sourceBook: 'PHB', description: 'Monks of the Way of the Open Hand are the ultimate masters of martial arts combat, whether armed or unarmed.', features: [
    { name: 'Open Hand Technique', level: 3, description: 'Starting when you choose this tradition at 3rd level, you can manipulate your enemy\'s ki when you harness your own. Whenever you hit a creature with one of the attacks granted by your Flurry of Blows, you can impose one of the following effects on that target: It must succeed on a Dexterity saving throw or be knocked prone. It must make a Strength saving throw. If it fails, you can push it up to 15 feet away from you. It can\'t take reactions until the end of your next turn.' },
    { name: 'Wholeness of Body', level: 6, description: 'At 6th level, you gain the ability to heal yourself. As an action, you can regain hit points equal to three times your monk level. You must finish a long rest before you can use this feature again.' },
    { name: 'Tranquility', level: 11, description: 'Beginning at 11th level, you can enter a special meditation that surrounds you with an aura of peace.' },
    { name: 'Quivering Palm', level: 17, description: 'At 17th level, you gain the ability to set up lethal vibrations in someone\'s body.' },
  ]},
  { id: 'way-of-shadow', name: 'Way of Shadow', classId: 'monk', sourceBook: 'PHB', description: 'Monks of the Way of Shadow follow a tradition that values stealth and subterfuge. These monks might be called ninjas or shadowdancers.', features: [
    { name: 'Shadow Arts', level: 3, description: 'Starting when you choose this tradition at 3rd level, you can use your ki to duplicate the effects of certain spells. As an action, you can spend 2 ki points to cast darkness, darkvision, pass without trace, or silence, without providing material components.' },
    { name: 'Shadow Step', level: 6, description: 'At 6th level, you gain the ability to step from one shadow into another. When you are in dim light or darkness, as a bonus action you can teleport up to 60 feet to an unoccupied space you can see that is also in dim light or darkness.' },
    { name: 'Cloak of Shadows', level: 11, description: 'By 11th level, you have learned to become one with the shadows. When you are in an area of dim light or darkness, you can use your action to become invisible. You remain invisible until you make an attack, cast a spell, or are in an area of bright light.' },
    { name: 'Opportunist', level: 17, description: 'At 17th level, you can exploit a creature\'s momentary distraction when it is hit by an attack.' },
  ]},
  // Paladin
  { id: 'oath-of-devotion', name: 'Oath of Devotion', classId: 'paladin', sourceBook: 'PHB', description: 'The Oath of Devotion binds a paladin to the loftiest ideals of justice, virtue, and order. Sometimes called cavaliers, white knights, or holy warriors.', features: [
    { name: 'Sacred Weapon', level: 3, description: 'As an action, you can imbue one weapon that you are holding with positive energy, using your Channel Divinity. For 1 minute, you add your Charisma modifier to attack rolls made with that weapon (with a minimum bonus of +1). The weapon also emits bright light in a 20-foot radius and dim light 20 feet beyond that. If the weapon is not already magical, it becomes magical for the duration.' },
    { name: 'Turn the Unholy', level: 3, description: 'As an action, you present your holy symbol and speak a prayer censuring fiends and undead, using your Channel Divinity. Each fiend or undead that can see or hear you within 30 feet of you must make a Wisdom saving throw.' },
    { name: 'Aura of Devotion', level: 7, description: 'Starting at 7th level, you and friendly creatures within 10 feet of you can\'t be charmed while you are conscious.' },
    { name: 'Purity of Spirit', level: 15, description: 'Beginning at 15th level, you are always under the effects of a protection from evil and good spell.' },
    { name: 'Holy Nimbus', level: 20, description: 'At 20th level, as an action, you can emanate an aura of sunlight. For 1 minute, bright light shines from you in a 30-foot radius, and dim light shines 30 feet beyond that.' },
  ], alwaysPreparedSpells: { 3: ['protection-from-evil-and-good', 'sanctuary'], 5: ['lesser-restoration', 'zone-of-truth'], 9: ['beacon-of-hope', 'dispel-magic'], 13: ['freedom-of-movement', 'guardian-of-faith'], 17: ['commune', 'flame-strike'] }},
  { id: 'oath-of-the-ancients', name: 'Oath of the Ancients', classId: 'paladin', sourceBook: 'PHB', description: 'The Oath of the Ancients is as old as the race of elves and the rituals of the druids.', features: [
    { name: 'Nature\'s Wrath', level: 3, description: 'You can use your Channel Divinity to invoke primeval forces to ensnare a foe. As an action, you can cause spectral vines to spring up and reach for a creature within 10 feet of you that you can see.' },
    { name: 'Turn the Faithless', level: 3, description: 'You can use your Channel Divinity to utter ancient words that are painful for fey and fiends to hear.' },
    { name: 'Aura of Warding', level: 7, description: 'Beginning at 7th level, ancient magic lies so heavily upon you that it creates an aegis around you. You and friendly creatures within 10 feet of you have resistance to damage from spells.' },
    { name: 'Undying Sentinel', level: 15, description: 'Starting at 15th level, when you are reduced to 0 hit points and are not killed outright, you can choose to drop to 1 hit point instead. Once you use this ability, you can\'t use it again until you finish a long rest.' },
    { name: 'Elder Champion', level: 20, description: 'At 20th level, you can assume the form of an ancient force of nature, taking on an appearance you choose.' },
  ]},
  // Ranger
  { id: 'hunter', name: 'Hunter', classId: 'ranger', sourceBook: 'PHB', description: 'Emulating the Hunter archetype means accepting your place as a bulwark between civilization and the terrors of the wilderness.', features: [
    { name: 'Hunter\'s Prey', level: 3, description: 'At 3rd level, you gain one of the following features of your choice: Colossus Slayer (deal extra d8 damage to creatures below their max HP), Giant Killer (reaction attack on large+ creature missing you), Horde Breaker (attack another creature within 5 ft. of target).' },
    { name: 'Defensive Tactics', level: 7, description: 'At 7th level, you gain one of the following features of your choice: Escape the Horde (opportunity attacks against you have disadvantage), Multiattack Defense (+4 AC after being hit), Steel Will (advantage on frightened saves).' },
    { name: 'Multiattack', level: 11, description: 'At 11th level, you gain one of the following features: Volley (ranged attack at all creatures in 10 ft radius) or Whirlwind Attack (melee attack at all creatures within 5 ft).' },
    { name: 'Superior Hunter\'s Defense', level: 15, description: 'At 15th level, you gain one of the following features: Evasion, Stand Against the Tide, or Uncanny Dodge.' },
  ]},
  { id: 'beast-master', name: 'Beast Master', classId: 'ranger', sourceBook: 'PHB', description: 'The Beast Master archetype embodies a friendship between the civilized races and the beasts of the world.', features: [
    { name: 'Ranger\'s Companion', level: 3, description: 'At 3rd level, you gain a beast companion that accompanies you on your adventures and is trained to fight alongside you. Choose a beast that is no larger than Medium and that has a challenge rating of 1/4 or lower.' },
    { name: 'Exceptional Training', level: 7, description: 'Beginning at 7th level, on any of your turns when your beast companion doesn\'t attack, you can use a bonus action to command the beast to take the Dash, Disengage, Dodge, or Help action on its turn.' },
    { name: 'Bestial Fury', level: 11, description: 'Starting at 11th level, your beast companion can make two attacks when you command it to use the Attack action.' },
    { name: 'Share Spells', level: 15, description: 'Beginning at 15th level, when you cast a spell targeting yourself, you can also affect your beast companion with the spell if the beast is within 30 feet of you.' },
  ]},
  // Rogue
  { id: 'thief', name: 'Thief', classId: 'rogue', sourceBook: 'PHB', description: 'You hone your skills in the larcenous arts. Burglars, bandits, cutpurses, and other criminals typically follow this archetype.', features: [
    { name: 'Fast Hands', level: 3, description: 'Starting at 3rd level, you can use the bonus action granted by your Cunning Action to make a Dexterity (Sleight of Hand) check, use your thieves\' tools to disarm a trap or open a lock, or take the Use an Object action.' },
    { name: 'Second-Story Work', level: 3, description: 'When you choose this archetype at 3rd level, you gain the ability to climb faster than normal; climbing no longer costs you extra movement.' },
    { name: 'Supreme Sneak', level: 9, description: 'Starting at 9th level, you have advantage on a Dexterity (Stealth) check if you move no more than half your speed on the same turn.' },
    { name: 'Use Magic Device', level: 13, description: 'By 13th level, you have learned enough about the workings of magic that you can improvise the use of items even when they are not intended for you.' },
    { name: 'Thief\'s Reflexes', level: 17, description: 'When you reach 17th level, you have become adept at laying ambushes and quickly escaping danger. You can take two turns during the first round of any combat.' },
  ]},
  { id: 'assassin', name: 'Assassin', classId: 'rogue', sourceBook: 'PHB', description: 'You focus your training on the grim art of death. Those who adhere to this archetype are diverse: hired killers, spies, bounty hunters, and even priests trained to exterminate the enemies of their deity.', features: [
    { name: 'Bonus Proficiencies', level: 3, description: 'When you choose this archetype at 3rd level, you gain proficiency with the disguise kit and the poisoner\'s kit.' },
    { name: 'Assassinate', level: 3, description: 'Starting at 3rd level, you are at your deadliest when you get the drop on your enemies. You have advantage on attack rolls against any creature that hasn\'t taken a turn in the combat yet. In addition, any hit you score against a creature that is surprised is a critical hit.' },
    { name: 'Infiltration Expertise', level: 9, description: 'Starting at 9th level, you can unfailingly create false identities for yourself.' },
    { name: 'Impostor', level: 13, description: 'At 13th level, you gain the ability to unerringly mimic another person\'s speech, writing, and behavior.' },
    { name: 'Death Strike', level: 17, description: 'Starting at 17th level, you become a master of instant death. When you attack and hit a creature that is surprised, it must make a Constitution saving throw (DC 8 + your Dexterity modifier + your proficiency bonus). On a failed save, double the damage of your attack against the creature.' },
  ]},
  { id: 'arcane-trickster', name: 'Arcane Trickster', classId: 'rogue', sourceBook: 'PHB', description: 'Some rogues enhance their fine-honed skills of stealth and agility with magic, learning tricks of enchantment and illusion.', spellcastingType: 'third', features: [
    { name: 'Spellcasting', level: 3, description: 'When you reach 3rd level, you augment your martial prowess with the ability to cast spells.' },
    { name: 'Mage Hand Legerdemain', level: 3, description: 'Starting at 3rd level, when you cast mage hand, you can make the spectral hand invisible, and you can perform the following additional tasks with it.' },
    { name: 'Magical Ambush', level: 9, description: 'Starting at 9th level, if you are hidden from a creature when you cast a spell on it, the creature has disadvantage on any saving throw it makes against the spell this turn.' },
    { name: 'Versatile Trickster', level: 13, description: 'At 13th level, you gain the ability to distract targets with your mage hand.' },
    { name: 'Spell Thief', level: 17, description: 'At 17th level, you gain the ability to magically steal the knowledge of how to cast a spell from another spellcaster.' },
  ], spellcastingType: 'third'},
  // Sorcerer
  { id: 'draconic-bloodline', name: 'Draconic Bloodline', classId: 'sorcerer', sourceBook: 'PHB', description: 'Your innate magic comes from draconic magic that was mingled with your blood or that of your ancestors. Most often, sorcerers with this origin trace their descent back to a mighty sorcerer of ancient times who made a bargain with a dragon or who might even have claimed a dragon parent.', features: [
    { name: 'Dragon Ancestor', level: 1, description: 'At 1st level, you choose one type of dragon as your ancestor. The damage type associated with each dragon is used by features you gain later.' },
    { name: 'Draconic Resilience', level: 1, description: 'As magic flows through your body, it causes physical traits of your dragon ancestors to emerge. At 1st level, your hit point maximum increases by 1 and increases by 1 again whenever you gain a level in this class. Additionally, parts of your skin are covered by a thin sheen of dragon-like scales. When you aren\'t wearing armor, your AC equals 13 + your Dexterity modifier.' },
    { name: 'Elemental Affinity', level: 6, description: 'Starting at 6th level, when you cast a spell that deals damage of the type associated with your draconic ancestry, you can add your Charisma modifier to one damage roll of that spell. At the same time, you can spend 1 sorcery point to gain resistance to that damage type for 1 hour.' },
    { name: 'Dragon Wings', level: 14, description: 'At 14th level, you gain the ability to sprout a pair of dragon wings from your back, gaining a flying speed equal to your current speed.' },
    { name: 'Draconic Presence', level: 18, description: 'Beginning at 18th level, you can channel the dread presence of your dragon ancestor, causing those around you to become awestruck or frightened.' },
  ]},
  { id: 'wild-magic', name: 'Wild Magic', classId: 'sorcerer', sourceBook: 'PHB', description: 'Your innate magic comes from the wild forces of chaos that underlie the order of creation. You might have endured exposure to some form of raw magic, perhaps through a planar portal leading to Limbo, the Elemental Planes, or the mysterious Far Realm.', features: [
    { name: 'Wild Magic Surge', level: 1, description: 'Starting when you choose this origin at 1st level, your spellcasting can unleash surges of untamed magic. Immediately after you cast a sorcerer spell of 1st level or higher, the DM can have you roll a d20. If you roll a 1, roll on the Wild Magic Surge table to create a random magical effect.' },
    { name: 'Tides of Chaos', level: 1, description: 'Starting at 1st level, you can manipulate the forces of chance and chaos to gain advantage on one attack roll, ability check, or saving throw. Once you do so, you must finish a long rest before you can use this feature again.' },
    { name: 'Bend Luck', level: 6, description: 'Starting at 6th level, you have the ability to twist fate using your wild magic. When another creature you can see makes an attack roll, an ability check, or a saving throw, you can use your reaction and spend 2 sorcery points to roll 1d4 and apply the number rolled as a bonus or penalty (your choice) to the creature\'s roll.' },
    { name: 'Controlled Chaos', level: 14, description: 'At 14th level, you gain a modicum of control over the surges of your wild magic. Whenever you roll on the Wild Magic Surge table, you can roll twice and use either number.' },
    { name: 'Spell Bombardment', level: 18, description: 'Beginning at 18th level, the harmful energy of your spells intensifies. When you roll damage for a spell and roll the highest number possible on any of the dice, choose one of those dice, roll it again and add that roll to the damage.' },
  ]},
  // Warlock
  { id: 'the-fiend', name: 'The Fiend', classId: 'warlock', sourceBook: 'PHB', description: 'You have made a pact with a fiend from the lower planes of existence, a being whose aims are evil, even if you strive against those aims.', features: [
    { name: 'Dark One\'s Blessing', level: 1, description: 'Starting at 1st level, when you reduce a hostile creature to 0 hit points, you gain temporary hit points equal to your Charisma modifier + your warlock level (minimum of 1).' },
    { name: 'Dark One\'s Own Luck', level: 6, description: 'Starting at 6th level, you can call on your patron to alter fate in your favor. When you make an ability check or a saving throw, you can use this feature to add a d10 to your roll. You can do so after seeing the initial roll but before any of the roll\'s effects occur. Once you use this feature, you can\'t use it again until you finish a short or long rest.' },
    { name: 'Fiendish Resilience', level: 10, description: 'Starting at 10th level, you can choose one damage type when you finish a short or long rest. You gain resistance to that damage type until you choose a different one with this feature.' },
    { name: 'Hurl Through Hell', level: 14, description: 'Starting at 14th level, when you hit a creature with an attack, you can use this feature to instantly transport the target through the lower planes.' },
  ], expandedSpells: { 1: ['burning-hands', 'command'], 3: ['blindness-deafness', 'scorching-ray'], 5: ['fireball', 'stinking-cloud'], 7: ['fire-shield', 'wall-of-fire'], 9: ['flame-strike', 'hallow'] }},
  { id: 'the-great-old-one', name: 'The Great Old One', classId: 'warlock', sourceBook: 'PHB', description: 'Your patron is a mysterious entity whose nature is utterly foreign to the fabric of reality. It might come from the Far Realm, the space beyond reality, or it could be one of the elder gods known only in legends.', features: [
    { name: 'Awakened Mind', level: 1, description: 'Starting at 1st level, your alien knowledge gives you the ability to touch the minds of other creatures. You can communicate telepathically with any creature you can see within 30 feet of you.' },
    { name: 'Entropic Ward', level: 6, description: 'At 6th level, you learn to magically ward yourself against attack and to turn an enemy\'s failed strike into good luck for yourself.' },
    { name: 'Thought Shield', level: 10, description: 'Starting at 10th level, your thoughts can\'t be read by telepathy or other means unless you allow it.' },
    { name: 'Create Thrall', level: 14, description: 'At 14th level, you gain the ability to infect a humanoid\'s mind with the alien magic of your patron.' },
  ]},
  { id: 'the-archfey', name: 'The Archfey', classId: 'warlock', sourceBook: 'PHB', description: 'Your patron is a lord or lady of the fey, a creature of legend who holds secrets that were forgotten before the mortal races were born.', features: [
    { name: 'Fey Presence', level: 1, description: 'Starting at 1st level, your patron bestows upon you the ability to project the fearsome presence of the Fey. As an action, you can cause each creature in a 10-foot cube originating from you to make a Wisdom saving throw against your warlock spell save DC. The creatures that fail their saving throws are all charmed or frightened by you (your choice) until the end of your next turn.' },
    { name: 'Misty Escape', level: 6, description: 'Starting at 6th level, you can vanish in a puff of mist in response to harm. When you take damage, you can use your reaction to turn invisible and teleport up to 60 feet to an unoccupied space you can see.' },
    { name: 'Beguiling Defenses', level: 10, description: 'Beginning at 10th level, your patron teaches you how to turn the mind-affecting magic of your enemies against them.' },
    { name: 'Dark Delirium', level: 14, description: 'Starting at 14th level, you can plunge a creature into an illusory realm. As an action, choose a creature that you can see within 60 feet of you.' },
  ]},
  // Wizard
  { id: 'school-of-evocation', name: 'School of Evocation', classId: 'wizard', sourceBook: 'PHB', description: 'You focus your study on magic that creates powerful elemental effects such as bitter cold, searing flame, rolling thunder, crackling lightning, and burning acid.', features: [
    { name: 'Evocation Savant', level: 2, description: 'Beginning when you select this school at 2nd level, the gold and time you must spend to copy an evocation spell into your spellbook is halved.' },
    { name: 'Sculpt Spells', level: 2, description: 'Beginning at 2nd level, you can create pockets of relative safety within the effects of your evocation spells. When you cast an evocation spell that affects other creatures that you can see, you can choose a number of them equal to 1 + the spell\'s level. The chosen creatures automatically succeed on their saving throws against the spell, and they take no damage if they would normally take half damage on a successful save.' },
    { name: 'Potent Cantrip', level: 6, description: 'Starting at 6th level, your damaging cantrips affect even creatures that avoid the brunt of the effect. When a creature succeeds on a saving throw against your cantrip, the creature takes half the cantrip\'s damage (if any) but suffers no additional effect from the cantrip.' },
    { name: 'Empowered Evocation', level: 10, description: 'Beginning at 10th level, you can add your Intelligence modifier to the damage roll of any wizard evocation spell you cast.' },
    { name: 'Overchannel', level: 14, description: 'Starting at 14th level, you can increase the power of your simpler spells. When you cast a wizard spell of 5th level or lower that deals damage, you can deal maximum damage with that spell.' },
  ]},
  { id: 'school-of-abjuration', name: 'School of Abjuration', classId: 'wizard', sourceBook: 'PHB', description: 'The School of Abjuration emphasizes magic that blocks, banishes, or protects. Detractors of this school say that its tradition is about denial, negation rather than positive assertion.', features: [
    { name: 'Abjuration Savant', level: 2, description: 'Beginning when you select this school at 2nd level, the gold and time you must spend to copy an abjuration spell into your spellbook is halved.' },
    { name: 'Arcane Ward', level: 2, description: 'Starting at 2nd level, you can weave magic around yourself for protection. When you cast an abjuration spell of 1st level or higher, you can simultaneously use a strand of the spell\'s magic to create a magical ward on yourself that lasts until you finish a long rest. The ward has hit points equal to twice your wizard level + your Intelligence modifier.' },
    { name: 'Projected Ward', level: 6, description: 'Starting at 6th level, when a creature that you can see within 30 feet of you takes damage, you can use your reaction to cause your Arcane Ward to absorb that damage.' },
    { name: 'Improved Abjuration', level: 10, description: 'Beginning at 10th level, when you cast an abjuration spell that requires you to make an ability check as a part of casting that spell (as in counterspell and dispel magic), you add your proficiency bonus to that ability check.' },
    { name: 'Spell Resistance', level: 14, description: 'Starting at 14th level, you have advantage on saving throws against spells. Furthermore, you have resistance against the damage of spells.' },
  ]},
  { id: 'school-of-illusion', name: 'School of Illusion', classId: 'wizard', sourceBook: 'PHB', description: 'You focus your studies on magic that dazzles the senses, befuddles the mind, and tricks even the wisest folk.', features: [
    { name: 'Illusion Savant', level: 2, description: 'Beginning when you select this school at 2nd level, the gold and time you must spend to copy an illusion spell into your spellbook is halved.' },
    { name: 'Improved Minor Illusion', level: 2, description: 'When you choose this school at 2nd level, you learn the minor illusion cantrip. If you already know this cantrip, you learn a different wizard cantrip of your choice. The cantrip doesn\'t count against your number of cantrips known. When you cast minor illusion, you can create both a sound and an image with a single casting of the spell.' },
    { name: 'Malleable Illusions', level: 6, description: 'Starting at 6th level, when you cast an illusion spell that has a duration of 1 minute or longer, you can use your action to change the nature of that illusion (using the spell\'s normal parameters for the illusion), provided that you can see the illusion.' },
    { name: 'Illusory Self', level: 10, description: 'Beginning at 10th level, you can create an illusory duplicate of yourself as an instant, almost instinctual reaction to danger.' },
    { name: 'Illusory Reality', level: 14, description: 'By 14th level, you have learned the secret of weaving shadow magic into your illusions to give them a semi-reality. When you cast an illusion spell of 1st level or higher, you can choose one inanimate, nonmagical object that is part of the illusion and make that object real.' },
  ]},

  // ── PHB: REMAINING CLERIC DOMAINS ─────────────────────────────────────
  { id: 'nature-domain', name: 'Nature Domain', classId: 'cleric', sourceBook: 'PHB', description: 'Gods of nature are as varied as the natural world itself. Druids revere nature as a whole, while clerics of nature gods serve specific aspects of the natural world.', features: [
    { name: 'Acolyte of Nature', level: 1, description: 'You learn one druid cantrip of your choice and gain proficiency in one of: Animal Handling, Nature, or Survival.' },
    { name: 'Bonus Proficiency', level: 1, description: 'You gain proficiency with heavy armor.' },
    { name: 'Channel Divinity: Charm Animals and Plants', level: 2, description: 'Each beast or plant creature within 30 feet that you can see must make a Wisdom save or be charmed for 1 minute.' },
    { name: 'Dampen Elements', level: 6, description: 'When you or a creature within 30 feet takes acid, cold, fire, lightning, or thunder damage, you can use your reaction to grant resistance against that instance of damage.' },
    { name: 'Divine Strike', level: 8, description: 'Once on each of your turns when you hit a creature with a weapon attack, you can cause the attack to deal an extra 1d8 cold, fire, or lightning damage (2d8 at 14th level).' },
    { name: 'Master of Nature', level: 17, description: 'You gain the ability to command animals and plant creatures. While charmed by your Channel Divinity, you can use a bonus action to verbally command them.' },
  ]},
  { id: 'tempest-domain', name: 'Tempest Domain', classId: 'cleric', sourceBook: 'PHB', description: 'Gods whose portfolios include the Tempest domain govern storms, sea, and sky. They include gods of lightning and thunder, of earthquakes, fire, and the fury of the elements.', features: [
    { name: 'Bonus Proficiencies', level: 1, description: 'You gain proficiency with martial weapons and heavy armor.' },
    { name: 'Wrath of the Storm', level: 1, description: 'When a creature within 5 feet hits you, you can use your reaction to cause it to make a Dexterity save, taking 2d8 lightning or thunder damage on a fail. Usable a number of times equal to your Wisdom modifier per long rest.' },
    { name: 'Channel Divinity: Destructive Wrath', level: 2, description: 'When you roll thunder or lightning damage, you can use Channel Divinity to deal maximum damage.' },
    { name: 'Thunderbolt Strike', level: 6, description: 'When you deal lightning damage to a Large or smaller creature, you can also push it up to 10 feet away.' },
    { name: 'Divine Strike', level: 8, description: 'Once per turn on hit with a weapon attack, deal extra 1d8 thunder damage (2d8 at 14th).' },
    { name: 'Stormborn', level: 17, description: 'You have a flying speed equal to your walking speed when not underground or indoors.' },
  ]},
  { id: 'trickery-domain', name: 'Trickery Domain', classId: 'cleric', sourceBook: 'PHB', description: 'Gods of trickery are mischief-makers and instigators who stand as a constant challenge to the accepted order among both gods and mortals.', features: [
    { name: 'Blessing of the Trickster', level: 1, description: 'You can use your action to touch a willing creature other than yourself to give it advantage on Dex (Stealth) checks for 1 hour.' },
    { name: 'Channel Divinity: Invoke Duplicity', level: 2, description: 'You create a perfect illusion of yourself within 30 feet that lasts for 1 minute. As a bonus action, you can move it up to 30 feet. You can cast spells through it and gain advantage on attacks against creatures within 5 feet of both you and the illusion.' },
    { name: 'Channel Divinity: Cloak of Shadows', level: 6, description: 'You become invisible until the end of your next turn.' },
    { name: 'Divine Strike', level: 8, description: 'Once per turn on hit with a weapon attack, deal extra 1d8 poison damage (2d8 at 14th).' },
    { name: 'Improved Duplicity', level: 17, description: 'You can create up to four duplicates of yourself with Invoke Duplicity instead of one.' },
  ]},
  { id: 'war-domain', name: 'War Domain', classId: 'cleric', sourceBook: 'PHB', description: 'War has many manifestations. It can make heroes of ordinary people. It can be desperate and horrific, with acts of cruelty and cowardice eclipsing examples of excellence and courage.', features: [
    { name: 'Bonus Proficiencies', level: 1, description: 'You gain proficiency with martial weapons and heavy armor.' },
    { name: 'War Priest', level: 1, description: 'When you use the Attack action, you can make one weapon attack as a bonus action. Usable a number of times equal to your Wis modifier per long rest.' },
    { name: 'Channel Divinity: Guided Strike', level: 2, description: 'When you or another creature within 30 feet makes an attack roll, you can use Channel Divinity to give a +10 bonus to the roll.' },
    { name: 'Channel Divinity: War God\'s Blessing', level: 6, description: 'As a reaction when a creature within 30 feet makes an attack roll, you can use Channel Divinity to grant a +10 bonus to the roll.' },
    { name: 'Divine Strike', level: 8, description: 'Once per turn on hit with a weapon attack, deal extra 1d8 damage of the weapon\'s type (2d8 at 14th).' },
    { name: 'Avatar of Battle', level: 17, description: 'You gain resistance to bludgeoning, piercing, and slashing damage from nonmagical attacks.' },
  ]},

  // ── PHB: DRUID CIRCLES ────────────────────────────────────────────────
  { id: 'circle-of-the-land', name: 'Circle of the Land', classId: 'druid', sourceBook: 'PHB', description: 'The Circle of the Land is made up of mystics and sages who safeguard ancient knowledge and rites through a vast oral tradition.',
    resources: [
      {
        name: 'Natural Recovery',
        key: 'natural_recovery',
        rechargeOn: 'long',
        // Once per long rest from druid level 2 onward.
        maxPerLevel: { 1:0,2:1,3:1,4:1,5:1,6:1,7:1,8:1,9:1,10:1,11:1,12:1,13:1,14:1,15:1,16:1,17:1,18:1,19:1,20:1 },
      },
    ],
    features: [
    { name: 'Bonus Cantrip', level: 2, description: 'You learn one additional druid cantrip of your choice.' },
    { name: 'Natural Recovery', level: 2, description: 'During a short rest, you can recover expended spell slots up to a combined level equal to half your druid level (rounded up) once per long rest.' },
    { name: 'Circle Spells', level: 3, description: 'Your mystical connection to the land infuses you with the ability to cast certain spells. Choose a land type (arctic, coast, desert, forest, grassland, mountain, swamp, or Underdark) to determine your bonus spells.' },
    { name: 'Land\'s Stride', level: 6, description: 'Moving through nonmagical difficult terrain costs no extra movement. You can also pass through nonmagical plants without taking damage.' },
    { name: 'Nature\'s Ward', level: 10, description: 'You can\'t be charmed or frightened by elementals or fey, and you are immune to poison and disease.' },
    { name: 'Nature\'s Sanctuary', level: 14, description: 'Creatures of the natural world sense your connection. When a beast or plant creature attacks you, it must make a Wisdom save or choose a different target, or its attack misses.' },
  ]},
  { id: 'circle-of-the-moon', name: 'Circle of the Moon', classId: 'druid', sourceBook: 'PHB', description: 'Druids of the Circle of the Moon are fierce guardians of the wilds. Their order gathers under the full moon to share news and trade warnings.', features: [
    { name: 'Combat Wild Shape', level: 2, description: 'You can use Wild Shape on your turn as a bonus action, rather than as an action. Additionally, you can expend a spell slot as a bonus action while transformed to regain 1d8 HP per level of the slot.' },
    { name: 'Circle Forms', level: 2, description: 'You can transform into a beast with a CR as high as 1 (improves at higher levels).' },
    { name: 'Primal Strike', level: 6, description: 'Your attacks in beast form count as magical for overcoming resistance to nonmagical attacks.' },
    { name: 'Elemental Wild Shape', level: 10, description: 'You can expend two uses of Wild Shape to transform into an air, earth, fire, or water elemental.' },
    { name: 'Thousand Forms', level: 14, description: 'You can cast Alter Self at will.' },
  ]},

  // ── PHB: MONK ─────────────────────────────────────────────────────────
  { id: 'way-of-the-four-elements', name: 'Way of the Four Elements', classId: 'monk', sourceBook: 'PHB', description: 'You follow a monastic tradition that teaches you to harness the elements. When you focus your ki, you can align yourself with the forces of creation.', features: [
    { name: 'Disciple of the Elements', level: 3, description: 'You learn magical disciplines that harness the power of the four elements. You know the Elemental Attunement discipline plus one of your choice. You learn additional disciplines at 6th, 11th, and 17th level.' },
    { name: 'Elemental Disciplines', level: 3, description: 'Disciplines include effects like Fist of Unbroken Air, Water Whip, Fist of Four Thunders, Rush of the Gale Spirits, and Shape the Flowing River.' },
  ]},

  // ── PHB: PALADIN ──────────────────────────────────────────────────────
  { id: 'oath-of-vengeance', name: 'Oath of Vengeance', classId: 'paladin', sourceBook: 'PHB', description: 'The Oath of Vengeance is a solemn commitment to punish those who have committed a grievous sin. When evil forces slaughter helpless villagers, the paladin of vengeance steps forward.', features: [
    { name: 'Channel Divinity: Abjure Enemy', level: 3, description: 'You target one creature within 60 feet that must make a Wisdom save (with disadvantage if you can see it). On a fail, the creature is frightened and has speed 0 for 1 minute.' },
    { name: 'Channel Divinity: Vow of Enmity', level: 3, description: 'As a bonus action, you mark a creature within 10 feet. You have advantage on attack rolls against it for 1 minute.' },
    { name: 'Relentless Avenger', level: 7, description: 'When you hit a creature with an opportunity attack, you can move up to half your speed immediately after the attack and as part of the same reaction.' },
    { name: 'Soul of Vengeance', level: 15, description: 'When a creature marked by Vow of Enmity makes an attack, you can use your reaction to make a melee weapon attack against it.' },
    { name: 'Avenging Angel', level: 20, description: 'You can use your action to assume the form of an angelic avenger for 1 hour. You gain a flying speed of 60 feet, and creatures within 30 feet that you can see must succeed on a Wis save or be frightened.' },
  ]},

  // ── PHB: REMAINING WIZARD SCHOOLS ─────────────────────────────────────
  { id: 'school-of-conjuration', name: 'School of Conjuration', classId: 'wizard', sourceBook: 'PHB', description: 'As a conjurer, you favor spells that produce objects and creatures out of thin air. You can teleport across vast distances and call up creatures from other planes.', features: [
    { name: 'Conjuration Savant', level: 2, description: 'The gold and time you must spend to copy a conjuration spell into your spellbook is halved.' },
    { name: 'Minor Conjuration', level: 2, description: 'You can use your action to conjure up an inanimate object weighing no more than 10 pounds in your hand or in an unoccupied space. The object lasts for 1 hour or until you cast this feature again.' },
    { name: 'Benign Transposition', level: 6, description: 'You can use your action to teleport up to 30 feet to an unoccupied space you can see, or swap places with a willing creature of your size.' },
    { name: 'Focused Conjuration', level: 10, description: 'While concentrating on a conjuration spell, your concentration can\'t be broken as a result of taking damage.' },
    { name: 'Durable Summons', level: 14, description: 'Any creature you summon or create with a conjuration spell has 30 temporary hit points.' },
  ]},
  { id: 'school-of-divination', name: 'School of Divination', classId: 'wizard', sourceBook: 'PHB', description: 'The counsel of a diviner is sought by royalty and rogues alike, for all seek a clearer understanding of the past, present, and future.', features: [
    { name: 'Divination Savant', level: 2, description: 'The gold and time you must spend to copy a divination spell into your spellbook is halved.' },
    { name: 'Portent', level: 2, description: 'When you finish a long rest, roll two d20s and record the numbers rolled. You can replace any attack roll, saving throw, or ability check made by you or a creature you can see with one of these foretelling rolls.' },
    { name: 'Expert Divination', level: 6, description: 'When you cast a divination spell of 2nd level or higher using a spell slot, you regain one expended spell slot of a lower level.' },
    { name: 'The Third Eye', level: 10, description: 'You can use your action to gain one of these benefits: Darkvision 60 ft, Ethereal Sight, Greater Comprehension, or See Invisibility.' },
    { name: 'Greater Portent', level: 14, description: 'You roll three d20s for your Portent feature instead of two.' },
  ]},
  { id: 'school-of-enchantment', name: 'School of Enchantment', classId: 'wizard', sourceBook: 'PHB', description: 'As a member of the School of Enchantment, you have honed your ability to magically entrance and beguile other people and monsters.', features: [
    { name: 'Enchantment Savant', level: 2, description: 'The gold and time you must spend to copy an enchantment spell into your spellbook is halved.' },
    { name: 'Hypnotic Gaze', level: 2, description: 'You can use your action to choose one creature within 5 feet. The target must succeed on a Wisdom save or be charmed, with speed 0 and incapacitated until the end of your next turn.' },
    { name: 'Instinctive Charm', level: 6, description: 'When a creature within 30 feet makes an attack roll against you, you can use your reaction to divert the attack to another creature within range.' },
    { name: 'Split Enchantment', level: 10, description: 'When you cast an enchantment spell of 1st level or higher that targets only one creature, you can have it target a second creature.' },
    { name: 'Alter Memories', level: 14, description: 'When you cast an enchantment spell to charm a creature, you can alter its understanding so it becomes unaware of being affected by the spell.' },
  ]},
  { id: 'school-of-necromancy', name: 'School of Necromancy', classId: 'wizard', sourceBook: 'PHB', description: 'The School of Necromancy explores the cosmic forces of life, death, and undeath. As you focus your studies in this tradition, you learn to manipulate the energy that animates all living things.', features: [
    { name: 'Necromancy Savant', level: 2, description: 'The gold and time you must spend to copy a necromancy spell into your spellbook is halved.' },
    { name: 'Grim Harvest', level: 2, description: 'Once per turn when you kill a creature with a spell of 1st level or higher, you regain HP equal to twice the spell\'s level (three times for necromancy spells).' },
    { name: 'Undead Thralls', level: 6, description: 'You add the Animate Dead spell to your spellbook if it is not already there. When you cast Animate Dead, you can target one additional corpse. Undead under your control gain bonus HP and damage.' },
    { name: 'Inured to Undeath', level: 10, description: 'You have resistance to necrotic damage, and your hit point maximum can\'t be reduced.' },
    { name: 'Command Undead', level: 14, description: 'You can use your action to take control of an undead creature within 60 feet via a Charisma contest.' },
  ]},
  { id: 'school-of-transmutation', name: 'School of Transmutation', classId: 'wizard', sourceBook: 'PHB', description: 'You are a student of spells that modify energy and matter. To you, the world is not a fixed thing, but eminently mutable, and you delight in being an agent of change.', features: [
    { name: 'Transmutation Savant', level: 2, description: 'The gold and time you must spend to copy a transmutation spell into your spellbook is halved.' },
    { name: 'Minor Alchemy', level: 2, description: 'You can temporarily alter the physical properties of one nonmagical object, changing it from one substance into another, taking 10 minutes for each cubic foot.' },
    { name: 'Transmuter\'s Stone', level: 6, description: 'You can spend 8 hours creating a transmuter\'s stone that stores transmutation magic. The stone grants one benefit: darkvision 60 ft, +10 speed, proficiency in Con saves, or resistance to a damage type.' },
    { name: 'Shapechanger', level: 10, description: 'You add Polymorph to your spellbook. You can cast it without expending a spell slot, but the target must be yourself and you can only transform into a Medium or smaller beast with CR 1 or lower.' },
    { name: 'Master Transmuter', level: 14, description: 'You can use your action to consume the reserve of transmutation magic stored within your transmuter\'s stone in one of these ways: Major Transformation, Panacea, Restore Life, or Restore Youth.' },
  ]},

  // ── XGtE: BARBARIAN ──────────────────────────────────────────────────
  { id: 'ancestral-guardian', name: 'Path of the Ancestral Guardian', classId: 'barbarian', sourceBook: 'XGtE', description: 'Some barbarians hail from cultures that revere their ancestors. These tribes teach that the warriors of the past linger in the world as mighty spirits.', features: [
    { name: 'Ancestral Protectors', level: 3, description: 'Spectral warriors appear when you enter your rage. The first creature you hit with an attack on your turn becomes the target of these warriors; the creature has disadvantage on attacks against anyone other than you, and your allies have resistance to damage from it.' },
    { name: 'Spirit Shield', level: 6, description: 'When a creature you can see within 30 feet takes damage, you can use your reaction to reduce that damage by 2d6 (3d6 at 10th, 4d6 at 14th).' },
    { name: 'Consult the Spirits', level: 10, description: 'You can cast Augury or Clairvoyance through your ancestral spirits, once per short or long rest.' },
    { name: 'Vengeful Ancestors', level: 14, description: 'When you use Spirit Shield, the attacker takes the same amount of force damage you prevented.' },
  ]},
  { id: 'zealot', name: 'Path of the Zealot', classId: 'barbarian', sourceBook: 'XGtE', description: 'Barbarians who follow the Path of the Zealot are warriors who channel divine fury into a martial frenzy. They serve as the avenging instruments of their gods.', features: [
    { name: 'Divine Fury', level: 3, description: 'While raging, the first creature you hit with a weapon attack on each turn takes extra damage equal to 1d6 + half your barbarian level (necrotic or radiant, your choice).' },
    { name: 'Warrior of the Gods', level: 3, description: 'Spells that return you to life don\'t require material components.' },
    { name: 'Fanatical Focus', level: 6, description: 'If you fail a saving throw while raging, you can reroll it. You can only reroll one save per rage.' },
    { name: 'Zealous Presence', level: 10, description: 'As a bonus action, up to ten creatures of your choice within 60 feet gain advantage on attack rolls and saving throws until the start of your next turn.' },
    { name: 'Rage Beyond Death', level: 14, description: 'While raging, having 0 HP doesn\'t knock you unconscious. You can still die from failed death saves, but death is delayed until rage ends.' },
  ]},

  // ── XGtE: BARD ───────────────────────────────────────────────────────
  { id: 'college-of-swords', name: 'College of Swords', classId: 'bard', sourceBook: 'XGtE', description: 'Bards of the College of Swords are called blades. They entertain through daring feats of weapon prowess, often combined with theatrical performance.', features: [
    { name: 'Bonus Proficiencies', level: 3, description: 'You gain proficiency with medium armor and scimitars. If you\'re proficient with a simple or martial melee weapon, you can use it as a spellcasting focus.' },
    { name: 'Fighting Style', level: 3, description: 'Choose Dueling or Two-Weapon Fighting.' },
    { name: 'Blade Flourish', level: 3, description: 'When you take the Attack action, your walking speed increases by 10 feet. You can also spend one use of Bardic Inspiration to add a flourish: Defensive, Slashing, or Mobile.' },
    { name: 'Extra Attack', level: 6, description: 'You can attack twice when you take the Attack action.' },
    { name: 'Master\'s Flourish', level: 14, description: 'You can use a flourish without spending Bardic Inspiration, rolling a d6 in place of the inspiration die.' },
  ]},
  { id: 'college-of-whispers', name: 'College of Whispers', classId: 'bard', sourceBook: 'XGtE', description: 'Most folk are happy to welcome a bard into their midst. But some bards of the College of Whispers use their gifts to spread mistrust and ruin.', features: [
    { name: 'Psychic Blades', level: 3, description: 'When you hit a creature with a weapon attack, you can expend one use of Bardic Inspiration to deal an extra 2d6 psychic damage (scales with level).' },
    { name: 'Words of Terror', level: 3, description: 'If you speak with a humanoid alone for at least 1 minute, you can target them to make a Wisdom save or be frightened of you or another creature of your choice for 1 hour.' },
    { name: 'Mantle of Whispers', level: 6, description: 'When a humanoid dies within 30 feet, you can use your reaction to capture its shadow. You can use it to assume the creature\'s appearance.' },
    { name: 'Shadow Lore', level: 14, description: 'You can target a creature within 30 feet that can hear you. It must succeed on a Wis save or become charmed for 8 hours, fearing you will reveal a shameful secret.' },
  ]},

  // ── XGtE: CLERIC ─────────────────────────────────────────────────────
  { id: 'forge-domain', name: 'Forge Domain', classId: 'cleric', sourceBook: 'XGtE', description: 'The gods of the forge are patrons of artisans who work with metal, from a humble blacksmith to a mighty mason.', features: [
    { name: 'Bonus Proficiencies', level: 1, description: 'You gain proficiency with heavy armor and smith\'s tools.' },
    { name: 'Blessing of the Forge', level: 1, description: 'At the end of a long rest, you can touch one nonmagical object and turn it into a magic item that grants a +1 bonus to AC (armor) or attack and damage rolls (weapon).' },
    { name: 'Channel Divinity: Artisan\'s Blessing', level: 2, description: 'You conduct a 1-hour ritual to create one simple item or piece of nonmagical equipment that contains metal, worth no more than 100 gp.' },
    { name: 'Soul of the Forge', level: 6, description: 'You gain resistance to fire damage, +1 AC while wearing heavy armor, and your weapon attacks deal +1 fire damage.' },
    { name: 'Divine Strike', level: 8, description: 'Once per turn on hit with a weapon attack, deal extra 1d8 fire damage (2d8 at 14th).' },
    { name: 'Saint of Forge and Fire', level: 17, description: 'You have immunity to fire damage and resistance to nonmagical bludgeoning, piercing, and slashing damage while wearing heavy armor.' },
  ]},
  { id: 'grave-domain', name: 'Grave Domain', classId: 'cleric', sourceBook: 'XGtE', description: 'Gods of the grave watch over the line between life and death. To these deities, death and the afterlife are a foundational part of the multiverse.', features: [
    { name: 'Circle of Mortality', level: 1, description: 'You gain the Spare the Dying cantrip and can cast it as a bonus action at range 30 feet. Healing spells on creatures at 0 HP are maximized.' },
    { name: 'Eyes of the Grave', level: 1, description: 'As an action, you can sense the presence of undead within 60 feet that aren\'t behind total cover and don\'t have a CR higher than your cleric level. Wis modifier uses per long rest.' },
    { name: 'Channel Divinity: Path to the Grave', level: 2, description: 'Choose one creature within 30 feet. It is cursed; the next attack against it has advantage, and the attack ignores resistance to its damage type and treats immunity as resistance.' },
    { name: 'Sentinel at Death\'s Door', level: 6, description: 'When a creature you can see within 30 feet would suffer a critical hit, you can use your reaction to make it a normal hit. Wis modifier uses per long rest.' },
    { name: 'Potent Spellcasting', level: 8, description: 'You add your Wisdom modifier to damage from cleric cantrips.' },
    { name: 'Keeper of Souls', level: 17, description: 'When an enemy you can see within 60 feet dies, you or a creature within 60 feet regains HP equal to the dying creature\'s HD.' },
  ]},

  // ── XGtE: DRUID ──────────────────────────────────────────────────────
  { id: 'circle-of-dreams', name: 'Circle of Dreams', classId: 'druid', sourceBook: 'XGtE', description: 'Druids who are members of the Circle of Dreams hail from regions that have strong ties to the Feywild and its dreamlike realms.', features: [
    { name: 'Balm of the Summer Court', level: 2, description: 'You have a pool of d6s equal to your druid level. As a bonus action, you can choose a creature within 120 feet and spend dice from the pool: heal HP equal to total + grant temp HP.' },
    { name: 'Hearth of Moonlight and Shadow', level: 6, description: 'When you finish a short or long rest, you can create a 30-foot-radius sphere of magic. Allies inside gain +5 to Stealth and Perception checks, and total cover from outside.' },
    { name: 'Hidden Paths', level: 10, description: 'You can use a bonus action to teleport up to 60 feet to an unoccupied space you can see, or teleport a willing creature within 30 feet up to 60 feet. Wis modifier uses per long rest.' },
    { name: 'Walker in Dreams', level: 14, description: 'You can cast Dream, Scrying, or Teleportation Circle as a 1-minute action, once per long rest.' },
  ]},
  { id: 'circle-of-the-shepherd', name: 'Circle of the Shepherd', classId: 'druid', sourceBook: 'XGtE', description: 'Druids of the Circle of the Shepherd commune with the spirits of nature, especially the spirits of beasts and the fey, and call to those spirits for aid.', features: [
    { name: 'Speech of the Woods', level: 2, description: 'You can understand and verbally communicate with beasts, and you learn Sylvan.' },
    { name: 'Spirit Totem', level: 2, description: 'As a bonus action, you summon a 30-foot-aura spirit (Bear: temp HP and advantage on Str checks/saves; Hawk: reaction grants advantage on attacks within 30 ft; Unicorn: detect enemies, healing).' },
    { name: 'Mighty Summoner', level: 6, description: 'Beasts and fey you summon have +2 HP per Hit Die and their attacks count as magical.' },
    { name: 'Guardian Spirit', level: 10, description: 'Beasts and fey you summon that end their turn within your Spirit Totem aura regain HP equal to half your druid level.' },
    { name: 'Faithful Summons', level: 14, description: 'When you\'re reduced to 0 HP or incapacitated, four spirits of CR 2 or lower (in form of beasts) appear within 20 feet for 1 hour.' },
  ]},

  // ── XGtE: FIGHTER ────────────────────────────────────────────────────
  { id: 'arcane-archer', name: 'Arcane Archer', classId: 'fighter', sourceBook: 'XGtE', description: 'An Arcane Archer studies a unique elven method of archery that weaves magic into attacks to produce supernatural effects.', features: [
    { name: 'Arcane Archer Lore', level: 3, description: 'You gain proficiency in Arcana or Nature, and you learn the Prestidigitation or Druidcraft cantrip.' },
    { name: 'Arcane Shot', level: 3, description: 'You learn two Arcane Shot options of your choice (Banishing, Beguiling, Bursting, Enfeebling, Grasping, Piercing, Seeking, or Shadow Arrow). You have two uses, regaining all on a short or long rest.' },
    { name: 'Magic Arrow', level: 7, description: 'Whenever you fire a nonmagical arrow from a shortbow or longbow, you can make it magical for the purpose of overcoming resistance and immunity.' },
    { name: 'Curving Shot', level: 7, description: 'When you miss with a magic arrow, you can use a bonus action to reroll the attack roll against a different target within 60 feet.' },
    { name: 'Ever-Ready Shot', level: 15, description: 'If you have no Arcane Shot uses remaining at initiative, you regain one use.' },
    { name: 'Improved Shots', level: 18, description: 'Arcane Shot damage dice increase from d6 to d8.' },
  ]},
  { id: 'cavalier', name: 'Cavalier', classId: 'fighter', sourceBook: 'XGtE', description: 'The archetypal Cavalier excels at mounted combat. Usually born of noble birth, the cavalier embodies the ideals of chivalry.', features: [
    { name: 'Bonus Proficiency', level: 3, description: 'You gain proficiency in one of: Animal Handling, History, Insight, Performance, or Persuasion. Or you can choose to learn one language.' },
    { name: 'Born to the Saddle', level: 3, description: 'You have advantage on saves to avoid falling off your mount. Mounting/dismounting costs 5 feet of movement.' },
    { name: 'Unwavering Mark', level: 3, description: 'When you make a melee weapon attack, you can mark the target. While marked, the creature has disadvantage on attacks against anyone other than you. You can also make a bonus action attack against a marked creature that hits an ally.' },
    { name: 'Warding Maneuver', level: 7, description: 'When a creature you can see within 5 feet hits you or an ally with an attack, you can use your reaction to add 1d8 to their AC against that attack and gain resistance to the damage.' },
    { name: 'Hold the Line', level: 10, description: 'Creatures provoke opportunity attacks from you when they move 5 feet or more while in your reach. On hit, the creature\'s speed is 0 until the end of the current turn.' },
    { name: 'Ferocious Charger', level: 15, description: 'If you move at least 10 feet in a straight line and then hit a creature with an attack, that target must succeed on a Strength save or be knocked prone.' },
    { name: 'Vigilant Defender', level: 18, description: 'You can take a reaction on every turn in combat to make an opportunity attack.' },
  ]},
  { id: 'samurai', name: 'Samurai', classId: 'fighter', sourceBook: 'XGtE', description: 'The Samurai is a fighter who draws on an implacable fighting spirit to overcome enemies. A Samurai\'s resolve is nearly unbreakable.', features: [
    { name: 'Bonus Proficiency', level: 3, description: 'You gain proficiency in one of: History, Insight, Performance, or Persuasion. Or you learn one language.' },
    { name: 'Fighting Spirit', level: 3, description: 'As a bonus action on your turn, you can give yourself advantage on weapon attack rolls until the end of the current turn and gain 5 temp HP (10 at 10th, 15 at 15th). Wis-modifier uses per long rest.' },
    { name: 'Elegant Courtier', level: 7, description: 'You add your Wisdom modifier to Charisma (Persuasion) checks, and you gain proficiency in Wisdom saves.' },
    { name: 'Tireless Spirit', level: 10, description: 'When you roll initiative and have no Fighting Spirit uses remaining, you regain one use.' },
    { name: 'Rapid Strike', level: 15, description: 'If you have advantage on an attack against a creature, you can forgo that advantage to make one additional attack.' },
    { name: 'Strength Before Death', level: 18, description: 'When you take damage that would reduce you to 0 HP, you can use your reaction to delay falling unconscious and take one extra turn immediately.' },
  ]},

  // ── XGtE: MONK ───────────────────────────────────────────────────────
  { id: 'way-of-the-drunken-master', name: 'Way of the Drunken Master', classId: 'monk', sourceBook: 'XGtE', description: 'The Way of the Drunken Master teaches its students to move with the jerky, unpredictable movements of a drunkard.', features: [
    { name: 'Bonus Proficiencies', level: 3, description: 'You gain proficiency in Performance and with brewer\'s supplies.' },
    { name: 'Drunken Technique', level: 3, description: 'Whenever you use Flurry of Blows, you gain Disengage as a bonus, and your speed increases by 10 feet until the end of your turn.' },
    { name: 'Tipsy Sway', level: 6, description: 'Leap to Your Feet: Standing from prone costs only 5 feet of movement. Redirect Attack: When a creature within 5 feet misses you, spend 1 ki point to redirect the attack to another creature within 5 feet.' },
    { name: 'Drunkard\'s Luck', level: 11, description: 'When you have disadvantage on an ability check, attack roll, or saving throw, you can spend 2 ki points to cancel it.' },
    { name: 'Intoxicated Frenzy', level: 17, description: 'When using Flurry of Blows, you make up to three additional attacks instead of two, provided each attack targets a different creature.' },
  ]},
  { id: 'way-of-the-kensei', name: 'Way of the Kensei', classId: 'monk', sourceBook: 'XGtE', description: 'Monks of the Way of the Kensei train relentlessly with their weapons, to the point where the weapon becomes an extension of the body.', features: [
    { name: 'Path of the Kensei', level: 3, description: 'Choose two weapons to be your kensei weapons (one melee, one ranged). You gain various benefits with them, including Agile Parry, Kensei\'s Shot, and Way of the Brush.' },
    { name: 'One with the Blade', level: 6, description: 'Magic Kensei Weapons: your attacks with kensei weapons count as magical. Deft Strike: spend 1 ki to add a martial arts die to a kensei weapon damage roll, once per turn.' },
    { name: 'Sharpen the Blade', level: 11, description: 'As a bonus action, spend up to 3 ki points to grant a kensei weapon a bonus to attack and damage rolls equal to ki spent, for 1 minute.' },
    { name: 'Unerring Accuracy', level: 17, description: 'If you miss with a monk weapon attack on your turn, you can reroll it once.' },
  ]},
  { id: 'way-of-the-sun-soul', name: 'Way of the Sun Soul', classId: 'monk', sourceBook: 'XGtE', description: 'Monks of the Way of the Sun Soul learn to channel their own life energy into searing bolts of light.', features: [
    { name: 'Radiant Sun Bolt', level: 3, description: 'You can hurl a bolt of radiance: ranged spell attack, 30 feet, deals 1d4 + Dex mod radiant damage. Counts as monk weapon. You can spend ki for Flurry of Blows-style attacks with bolts.' },
    { name: 'Searing Arc Strike', level: 6, description: 'Immediately after using Attack action, spend 2 ki points to cast Burning Hands as a bonus action (scales by spending more ki).' },
    { name: 'Searing Sunburst', level: 11, description: 'Create a 20-foot sphere of light at a point within 150 feet. Each creature in it must make a Con save, taking 2d6 radiant damage on a fail. Spend ki to increase damage.' },
    { name: 'Sun Shield', level: 17, description: 'You emit bright light in 30 feet, and when a creature hits you with a melee attack, it takes radiant damage equal to 5 + your Wis modifier.' },
  ]},

  // ── XGtE: PALADIN ────────────────────────────────────────────────────
  { id: 'oath-of-conquest', name: 'Oath of Conquest', classId: 'paladin', sourceBook: 'XGtE', description: 'The Oath of Conquest calls to paladins who seek glory in battle and the subjugation of their enemies.', features: [
    { name: 'Channel Divinity: Conquering Presence', level: 3, description: 'Each creature of your choice in 30 feet must succeed on a Wisdom save or be frightened of you for 1 minute.' },
    { name: 'Channel Divinity: Guided Strike', level: 3, description: 'When you or a creature within 30 feet makes an attack roll, gain a +10 bonus to the roll.' },
    { name: 'Aura of Conquest', level: 7, description: 'Frightened creatures within 10 feet (30 ft at 18th) have speed 0 and take 4 psychic damage at the start of their turn (8 at 18th).' },
    { name: 'Scornful Rebuke', level: 15, description: 'When a creature hits you with an attack, it takes psychic damage equal to your Charisma modifier (if positive).' },
    { name: 'Invincible Conqueror', level: 20, description: 'As an action, you assume a form of supernatural power for 1 minute: resistance to all damage, extra attack on Attack action, and crit on 19-20.' },
  ]},
  { id: 'oath-of-redemption', name: 'Oath of Redemption', classId: 'paladin', sourceBook: 'XGtE', description: 'The Oath of Redemption sets a paladin on a difficult path, one that requires a holy warrior to use violence only as a last resort.', features: [
    { name: 'Emissary of Peace', level: 3, description: 'As a bonus action, gain +5 bonus to Cha (Persuasion) checks for 10 minutes. Cha modifier uses per long rest.' },
    { name: 'Rebuke the Violent', level: 3, description: 'When a creature within 30 feet hits another with an attack, you can use your reaction to force a Wisdom save or take radiant damage equal to the damage dealt.' },
    { name: 'Aura of the Guardian', level: 7, description: 'When a creature within 10 feet (30 ft at 18th) takes damage, you can use your reaction to magically take that damage instead.' },
    { name: 'Protective Spirit', level: 15, description: 'You regain HP equal to 1d6 + half your paladin level if you end your turn in combat with fewer than half your HP and aren\'t incapacitated.' },
    { name: 'Emissary of Redemption', level: 20, description: 'You have resistance to all damage from creatures, and any creature that damages you takes radiant damage equal to twice the damage dealt.' },
  ]},

  // ── XGtE: RANGER ─────────────────────────────────────────────────────
  { id: 'gloom-stalker', name: 'Gloom Stalker', classId: 'ranger', sourceBook: 'XGtE', description: 'Gloom Stalkers are at home in the darkest places: deep under the earth, in gloomy alleyways, in primeval forests, and wherever else the light dims.', features: [
    { name: 'Gloom Stalker Magic', level: 3, description: 'You learn additional spells, starting with Disguise Self.' },
    { name: 'Dread Ambusher', level: 3, description: 'On your first turn in combat, your speed increases by 10 feet and you can make an additional weapon attack on your Attack action that deals an extra 1d8 damage.' },
    { name: 'Umbral Sight', level: 3, description: 'You gain darkvision 60 feet (or +30 ft if you already have it). While in darkness, you are invisible to creatures relying on darkvision.' },
    { name: 'Iron Mind', level: 7, description: 'You gain proficiency in Wisdom saves (or Int/Cha if already have Wis).' },
    { name: 'Stalker\'s Flurry', level: 11, description: 'If you miss with a weapon attack on your turn, you can make another weapon attack as part of the same action.' },
    { name: 'Shadowy Dodge', level: 15, description: 'When a creature makes an attack roll against you with advantage, you can use your reaction to impose disadvantage instead.' },
  ]},
  { id: 'horizon-walker', name: 'Horizon Walker', classId: 'ranger', sourceBook: 'XGtE', description: 'Horizon Walkers guard the world against threats that originate from other planes or that seek to ravage the mortal realm with extraplanar magic.', features: [
    { name: 'Horizon Walker Magic', level: 3, description: 'You learn additional spells, starting with Protection from Evil and Good.' },
    { name: 'Detect Portal', level: 3, description: 'As an action, detect the distance and direction to the closest planar portal within 1 mile. Use once per short or long rest.' },
    { name: 'Planar Warrior', level: 3, description: 'As a bonus action, choose a creature within 30 feet. The next time you hit it on this turn, it takes an extra 1d8 force damage (2d8 at 11th level), and the original damage becomes force damage.' },
    { name: 'Ethereal Step', level: 7, description: 'As a bonus action, cast Etherealness affecting only you and lasting 1 turn. Once per short or long rest.' },
    { name: 'Distant Strike', level: 11, description: 'When you take the Attack action, you can teleport up to 10 feet between attacks. If you attack at least two different creatures, you can make a third attack against a third creature.' },
    { name: 'Spectral Defense', level: 15, description: 'When you take damage from an attack, you can use your reaction to gain resistance against the attack\'s damage.' },
  ]},
  { id: 'monster-slayer', name: 'Monster Slayer', classId: 'ranger', sourceBook: 'XGtE', description: 'Monster Slayers seek out vampires, dragons, evil fey, fiends, and other magical threats.', features: [
    { name: 'Monster Slayer Magic', level: 3, description: 'You learn additional spells, starting with Protection from Evil and Good.' },
    { name: 'Hunter\'s Sense', level: 3, description: 'As an action, choose a creature within 60 feet. You learn its damage immunities, resistances, and vulnerabilities. Wis-mod uses per long rest.' },
    { name: 'Slayer\'s Prey', level: 3, description: 'As a bonus action, designate a creature within 60 feet as your prey. The first time you hit it on each of your turns, deal an extra 1d6 damage.' },
    { name: 'Supernatural Defense', level: 7, description: 'Whenever the target of your Slayer\'s Prey forces you to make a save, or you make an ability check to escape it, add 1d6 to your roll.' },
    { name: 'Magic-User\'s Nemesis', level: 11, description: 'When you see a creature within 60 feet casting a spell or teleporting, use your reaction to force a Wisdom save or its casting/teleportation fails.' },
    { name: 'Slayer\'s Counter', level: 15, description: 'If your Slayer\'s Prey forces you to make a save, you can use your reaction to make one weapon attack against it. If you hit, the save automatically succeeds.' },
  ]},

  // ── XGtE: ROGUE ──────────────────────────────────────────────────────
  { id: 'inquisitive', name: 'Inquisitive', classId: 'rogue', sourceBook: 'XGtE', description: 'Inquisitives excel at rooting out secrets and unraveling mysteries. They rely on their sharp instincts, eye for detail, and forensic mind.', features: [
    { name: 'Ear for Deceit', level: 3, description: 'When you make a Wisdom (Insight) check to determine whether a creature is lying, treat a roll of 7 or lower as 8.' },
    { name: 'Eye for Detail', level: 3, description: 'You can use a bonus action to make a Wisdom (Perception) check to spot a hidden creature or object or to make an Investigation check to uncover or decipher clues.' },
    { name: 'Insightful Fighting', level: 3, description: 'As a bonus action, make an Insight check contested by a creature\'s Deception check. On success, you can use Sneak Attack against that creature without needing advantage or an ally adjacent.' },
    { name: 'Steady Eye', level: 9, description: 'You have advantage on Perception and Investigation checks if you move no more than half your speed on the same turn.' },
    { name: 'Unerring Eye', level: 13, description: 'As an action, sense the presence of illusions, shapechangers not in original form, and magical disguises within 30 feet.' },
    { name: 'Eye for Weakness', level: 17, description: 'While using Insightful Fighting against a target, your Sneak Attack damage against that target increases by 3d6.' },
  ]},
  { id: 'mastermind', name: 'Mastermind', classId: 'rogue', sourceBook: 'XGtE', description: 'Your focus is on people and on the influence and secrets they have. Masterminds are master manipulators, intriguers, and puppeteers.', features: [
    { name: 'Master of Intrigue', level: 3, description: 'You gain proficiency with disguise kit, forgery kit, and one gaming set. You learn two languages. You can mimic the speech of another person or the sounds made by other creatures.' },
    { name: 'Master of Tactics', level: 3, description: 'You can use Help as a bonus action, and Help can be used at a range of 30 feet.' },
    { name: 'Insightful Manipulator', level: 9, description: 'If you spend 1 minute observing or interacting with a non-hostile creature, you can learn certain information about its capabilities.' },
    { name: 'Misdirection', level: 13, description: 'When a creature makes an attack roll against you, you can use your reaction to have it target another creature within 5 feet that is providing cover to you.' },
    { name: 'Soul of Deceit', level: 17, description: 'You can\'t be magically compelled to tell the truth, and you can\'t be telepathically read or have your alignment determined.' },
  ]},
  { id: 'scout', name: 'Scout', classId: 'rogue', sourceBook: 'XGtE', description: 'You are skilled in stealth and surviving far from the streets of a city, allowing you to scout ahead of your companions during expeditions.', features: [
    { name: 'Skirmisher', level: 3, description: 'You can move up to half your speed as a reaction when an enemy ends its turn within 5 feet, without provoking opportunity attacks.' },
    { name: 'Survivalist', level: 3, description: 'You gain proficiency in Nature and Survival, and your proficiency bonus is doubled for those skills.' },
    { name: 'Superior Mobility', level: 9, description: 'Your walking speed increases by 10 feet, also applying to climbing or swimming speeds.' },
    { name: 'Ambush Master', level: 13, description: 'On your first turn in combat, if you take the Attack action, you have advantage on the attack and your allies have advantage on attacks against your target until the start of your next turn.' },
    { name: 'Sudden Strike', level: 17, description: 'If you take the Attack action, you can make one additional attack as a bonus action. This attack can deal Sneak Attack damage even if you already dealt it this turn.' },
  ]},
  { id: 'swashbuckler', name: 'Swashbuckler', classId: 'rogue', sourceBook: 'XGtE', description: 'You focus your training on the art of the blade, relying on speed, elegance, and charm in equal parts.', features: [
    { name: 'Fancy Footwork', level: 3, description: 'When you make a melee attack against a creature, that creature can\'t make opportunity attacks against you for the rest of your turn.' },
    { name: 'Rakish Audacity', level: 3, description: 'You add your Charisma modifier to your initiative rolls. You can use Sneak Attack without needing advantage if no other creatures within 5 feet are within 5 feet of the target.' },
    { name: 'Panache', level: 9, description: 'As an action, make a Cha (Persuasion) check contested by a creature\'s Wis (Insight). On success vs hostile: it has disadvantage on attacks against others until you damage it. Vs non-hostile: it becomes charmed for 1 minute.' },
    { name: 'Elegant Maneuver', level: 13, description: 'As a bonus action, gain advantage on the next Acrobatics or Athletics check this turn.' },
    { name: 'Master Duelist', level: 17, description: 'If you miss with an attack roll, you can roll it again with advantage. Once per short or long rest.' },
  ]},

  // ── XGtE: SORCERER ───────────────────────────────────────────────────
  { id: 'divine-soul', name: 'Divine Soul', classId: 'sorcerer', sourceBook: 'XGtE', description: 'Sometimes the spark of magic that fuels a sorcerer comes from a divine source. Such blessed individuals are known as Divine Souls.', features: [
    { name: 'Divine Magic', level: 1, description: 'Choose an affinity (Good, Evil, Lawful, Chaotic, or Neutral) that grants you a free spell and shapes your spell list. You can add a cleric spell each time you learn a sorcerer spell.' },
    { name: 'Favored by the Gods', level: 1, description: 'If you fail a saving throw or miss with an attack, you can add 2d4 to the total. Once per short or long rest.' },
    { name: 'Empowered Healing', level: 6, description: 'When you or an ally within 5 feet rolls dice to determine HP restored, spend 1 sorcery point to reroll any of those dice.' },
    { name: 'Otherworldly Wings', level: 14, description: 'As a bonus action, manifest spectral wings (60 ft fly speed). Once granted, you can dismiss as a bonus action.' },
    { name: 'Unearthly Recovery', level: 18, description: 'As a bonus action when below half HP, regain HP equal to half your max. Once per long rest.' },
  ]},
  { id: 'shadow-magic', name: 'Shadow Magic', classId: 'sorcerer', sourceBook: 'XGtE', description: 'You are a creature of shadow, for your innate magic comes from the Shadowfell itself.', features: [
    { name: 'Eyes of the Dark', level: 1, description: 'You gain darkvision 120 feet. You also know Darkness and can cast it by spending 2 sorcery points instead of a spell slot; you can see through the darkness you create.' },
    { name: 'Strength of the Grave', level: 1, description: 'When damage reduces you to 0 HP, make a Charisma save (DC 5 + damage). On success, drop to 1 HP. Once per long rest.' },
    { name: 'Hound of Ill Omen', level: 6, description: 'Spend 3 sorcery points to summon a hound of shadow to harass a creature within 120 feet. The hound makes attacks and grants advantage on attacks against the target.' },
    { name: 'Shadow Walk', level: 14, description: 'While in dim light or darkness, use a bonus action to teleport up to 120 feet to an unoccupied space you can see in dim light or darkness.' },
    { name: 'Umbral Form', level: 18, description: 'Spend 6 sorcery points to become shadow form: resistance to all damage except force/radiant, and you can move through occupied spaces. Lasts 1 minute.' },
  ]},
  { id: 'storm-sorcery', name: 'Storm Sorcery', classId: 'sorcerer', sourceBook: 'XGtE', description: 'Your innate magic comes from the power of elemental air. Many with this power can trace their magic back to a near-death experience caused by the Great Rain.', features: [
    { name: 'Wind Speaker', level: 1, description: 'You can speak, read, and write Primordial (Aquan, Auran, Ignan, Terran).' },
    { name: 'Tempestuous Magic', level: 1, description: 'Whenever you cast a spell of 1st level or higher, you can use a bonus action to fly up to 10 feet without provoking opportunity attacks.' },
    { name: 'Heart of the Storm', level: 6, description: 'You gain resistance to lightning and thunder damage. When you cast a 1st-level+ spell that deals lightning or thunder, creatures within 10 feet take damage equal to half your sorcerer level.' },
    { name: 'Storm Guide', level: 6, description: 'At will, control nearby weather (stop rain in 20 ft radius, direct wind for 1 minute).' },
    { name: 'Storm\'s Fury', level: 14, description: 'When a creature within 5 feet hits you with a melee attack, use your reaction to deal lightning damage equal to your sorcerer level and force a Strength save or be pushed 20 feet.' },
    { name: 'Wind Soul', level: 18, description: 'You gain immunity to lightning and thunder damage and a flying speed of 60 feet. As an action, reduce your flying speed to grant flight to creatures within 30 feet for 1 hour.' },
  ]},

  // ── XGtE: WARLOCK ────────────────────────────────────────────────────
  { id: 'hexblade', name: 'The Hexblade', classId: 'warlock', sourceBook: 'XGtE', description: 'You have made your pact with a mysterious entity from the Shadowfell — a force that manifests in sentient magic weapons.', features: [
    { name: 'Hexblade\'s Curse', level: 1, description: 'As a bonus action, curse a creature within 30 feet for 1 minute. You gain a bonus to damage rolls against it equal to your proficiency bonus, your attacks crit on 19-20 against it, and if it dies you regain HP. Use once per short or long rest.' },
    { name: 'Hex Warrior', level: 1, description: 'You gain proficiency with medium armor, shields, and martial weapons. You can use Charisma in place of Strength or Dexterity for the attack and damage rolls of one weapon you touch at the end of a long rest.' },
    { name: 'Accursed Specter', level: 6, description: 'When you slay a humanoid, you can cause its spirit to rise as a specter under your control for 1 hour. Once per long rest.' },
    { name: 'Armor of Hexes', level: 10, description: 'When your Hexblade\'s Cursed target hits you with an attack, roll a d6. On 4 or higher, the attack misses you.' },
    { name: 'Master of Hexes', level: 14, description: 'When the target of your Hexblade\'s Curse dies, you can apply the curse to a different creature within 30 feet.' },
  ]},
  { id: 'the-celestial', name: 'The Celestial', classId: 'warlock', sourceBook: 'XGtE', description: 'Your patron is a powerful being of the Upper Planes. You have bound yourself to an ancient empyrean, solar, or other powerful entity of light.', features: [
    { name: 'Bonus Cantrips', level: 1, description: 'You learn the Light and Sacred Flame cantrips.' },
    { name: 'Healing Light', level: 1, description: 'You have a pool of d6s equal to 1 + warlock level. As a bonus action, choose a creature within 60 feet (including yourself) and spend dice to heal them.' },
    { name: 'Radiant Soul', level: 6, description: 'You gain resistance to radiant damage, and once per turn when you cast a spell that deals radiant or fire damage, you can add your Cha modifier to one damage roll.' },
    { name: 'Celestial Resilience', level: 10, description: 'At the end of a short or long rest, you and up to five creatures of your choice within 30 feet gain temporary HP.' },
    { name: 'Searing Vengeance', level: 14, description: 'When you or an ally within 60 feet are reduced to 0 HP, you can use your reaction to stand the ally up with HP equal to half their max and deal radiant damage to creatures within 30 feet. Once per long rest.' },
  ]},

  // ── XGtE: WIZARD ─────────────────────────────────────────────────────
  { id: 'war-magic', name: 'War Magic', classId: 'wizard', sourceBook: 'XGtE', description: 'Practitioners of War Magic stand bravely on the front lines of battle, balancing offense and defense as they wield powerful evocations and abjurations.', features: [
    { name: 'Arcane Deflection', level: 2, description: 'When you\'re hit by an attack or fail a save, use your reaction to gain +2 AC against that attack or +4 to the save. You can\'t cast spells other than cantrips until end of next turn.' },
    { name: 'Tactical Wit', level: 2, description: 'You add your Intelligence modifier to your initiative rolls.' },
    { name: 'Power Surge', level: 6, description: 'You can store magical energy when you successfully Counterspell or Dispel Magic. You can have a maximum of half your Int modifier (rounded down, min 1) surges. When you deal damage with a spell, spend a surge to add force damage equal to half your wizard level.' },
    { name: 'Durable Magic', level: 10, description: 'While concentrating on a spell, you gain +2 AC and +2 to saving throws.' },
    { name: 'Deflecting Shroud', level: 14, description: 'When you use Arcane Deflection, you can cause magical energy to arc; up to three creatures within 60 feet take force damage equal to half your wizard level.' },
  ]},

  // ── TCE: BARBARIAN ───────────────────────────────────────────────────
  { id: 'path-of-the-beast', name: 'Path of the Beast', classId: 'barbarian', sourceBook: 'TCE', description: 'A barbarian who walks the Path of the Beast draws their rage from a bestial spark burning within their soul.', features: [
    { name: 'Form of the Beast', level: 3, description: 'When you enter your rage, you transform, gaining a natural weapon: Bite (1d8 piercing, regain HP equal to prof bonus once per turn on hit), Claws (1d6 slashing, one extra attack when taking Attack action), or Tail (1d8 piercing, reach 10 ft + reaction to add 1d8 AC bonus).' },
    { name: 'Bestial Soul', level: 6, description: 'Attacks with natural weapons count as magical. Choose a benefit on each rage: swimming/breathing underwater, climb speed, or jump 30 ft.' },
    { name: 'Infectious Fury', level: 10, description: 'When you hit a creature with your natural weapon while raging, force a Wis save or it must use its reaction to make a melee attack against another creature, or take 2d12 psychic damage. Prof-bonus uses per long rest.' },
    { name: 'Call the Hunt', level: 14, description: 'When you enter your rage, choose up to a number of creatures equal to your Con modifier. They gain temp HP and advantage on attacks until your rage ends.' },
  ]},
  { id: 'path-of-wild-magic', name: 'Path of Wild Magic', classId: 'barbarian', sourceBook: 'TCE', description: 'Barbarians who tread the Path of Wild Magic perceive the magical energies that suffuse the multiverse and learn to channel them in battle.', features: [
    { name: 'Magic Awareness', level: 3, description: 'As an action, sense the presence of magic within 60 feet. Prof-bonus uses per long rest.' },
    { name: 'Wild Surge', level: 3, description: 'When you enter your rage, roll on the Wild Magic table to manifest a random magical effect (e.g., shadowy tendrils, teleport ally, summon a creature, etc.).' },
    { name: 'Bolstering Magic', level: 6, description: 'As an action, touch a creature: 1d3 bonus on attacks/checks for 10 minutes, or roll 1d3 to regain a spell slot of that level. Prof-bonus uses per long rest.' },
    { name: 'Unstable Backlash', level: 10, description: 'When you take damage or fail a save during rage, use your reaction to roll a new effect on the Wild Magic table.' },
    { name: 'Controlled Surge', level: 14, description: 'When you roll on the Wild Magic table, you can roll twice and use either result.' },
  ]},

  // ── TCE: BARD ────────────────────────────────────────────────────────
  { id: 'college-of-creation', name: 'College of Creation', classId: 'bard', sourceBook: 'TCE', description: 'A bard who walks the College of Creation\'s path views themselves as an extension of the Song of Creation, the great musical effort that gave birth to all that exists.', features: [
    { name: 'Mote of Potential', level: 3, description: 'When a creature uses a Bardic Inspiration die you gave them, they roll an additional effect (extra inspiration die, AC bonus, or temp HP).' },
    { name: 'Performance of Creation', level: 6, description: 'As an action, expend a 2nd-level (or higher) spell slot to create a nonmagical item of your choice in an unoccupied space, worth up to 20 gp times the slot level.' },
    { name: 'Animating Performance', level: 14, description: 'As an action, animate a Large or smaller nonmagical item that you can see within 30 feet (Dancing Item). Uses prof-bonus times per long rest.' },
    { name: 'Creative Crescendo', level: 14, description: 'When you cast Performance of Creation, you can create three items at once.' },
  ]},
  { id: 'college-of-eloquence', name: 'College of Eloquence', classId: 'bard', sourceBook: 'TCE', description: 'Adherents of the College of Eloquence master the art of oratory. They sway hearts and minds with practiced charm and an unassailable logic.', features: [
    { name: 'Silver Tongue', level: 3, description: 'When you make a Cha (Persuasion) or Cha (Deception) check, you can treat a d20 roll of 9 or lower as a 10.' },
    { name: 'Unsettling Words', level: 3, description: 'As a bonus action, spend a Bardic Inspiration die. Choose one creature within 60 feet; it must subtract the rolled number from its next save before end of your next turn.' },
    { name: 'Unfailing Inspiration', level: 6, description: 'When a creature uses a Bardic Inspiration die from you and fails the roll, they keep the die.' },
    { name: 'Universal Speech', level: 6, description: 'As an action, choose up to Cha-mod creatures within 60 feet. They understand every language you speak for 1 hour.' },
    { name: 'Infectious Inspiration', level: 14, description: 'When a creature within 60 feet uses your Bardic Inspiration die and succeeds, use your reaction to inspire another creature within 60 feet (no action by them required). Cha-mod uses per long rest.' },
  ]},

  // ── TCE: CLERIC ──────────────────────────────────────────────────────
  { id: 'order-domain', name: 'Order Domain', classId: 'cleric', sourceBook: 'TCE', description: 'The Order Domain represents discipline, dedication to a just cause, and devotion to a well-organized society.', features: [
    { name: 'Bonus Proficiencies', level: 1, description: 'You gain proficiency with heavy armor, and proficiency in one of: Intimidation or Persuasion.' },
    { name: 'Voice of Authority', level: 1, description: 'When you cast a 1st-level+ spell that targets an ally, that ally can use its reaction to make one weapon attack.' },
    { name: 'Channel Divinity: Order\'s Demand', level: 2, description: 'Choose any creatures within 30 feet. Each must succeed on a Wisdom save or be charmed by you until end of your next turn (or drop what they\'re holding).' },
    { name: 'Embodiment of the Law', level: 6, description: 'If you cast an enchantment spell, you can do so as a bonus action instead of an action. Wis-mod uses per long rest.' },
    { name: 'Divine Strike', level: 8, description: 'Once per turn on hit with a weapon attack, deal extra 1d8 psychic damage (2d8 at 14th).' },
    { name: 'Order\'s Wrath', level: 17, description: 'When you deal Divine Strike damage to a creature, pick another creature within 30 feet; the next time anyone attacks the picked creature before your next turn, it takes 2d8 psychic damage.' },
  ]},
  { id: 'peace-domain', name: 'Peace Domain', classId: 'cleric', sourceBook: 'TCE', description: 'The teachings of the gods of the Peace Domain unite people of all sorts to live with one another in tranquility.', features: [
    { name: 'Implement of Peace', level: 1, description: 'You gain proficiency in Insight, Performance, or Persuasion (your choice).' },
    { name: 'Emboldening Bond', level: 1, description: 'As an action, choose up to prof-bonus willing creatures within 30 feet (including you). You form a bond between them for 10 minutes; while within 30 feet of each other, a bonded creature can add 1d4 to an attack roll, save, or ability check. Prof-bonus uses per long rest.' },
    { name: 'Channel Divinity: Balm of Peace', level: 2, description: 'You move up to your speed without provoking opportunity attacks. When you move within 5 feet of a creature on this move, you can heal it for 2d6 + your Wis modifier. A creature can be healed only once this way per use.' },
    { name: 'Protective Bond', level: 6, description: 'When a bonded creature is about to take damage, another bonded creature within 30 feet can use its reaction to teleport to an unoccupied space within 5 feet and take the damage instead.' },
    { name: 'Potent Spellcasting', level: 8, description: 'You add your Wisdom modifier to damage from cleric cantrips.' },
    { name: 'Expansive Bond', level: 17, description: 'Emboldening Bond range becomes 60 feet, and the d4 becomes a d6. Protective Bond grants resistance to damage.' },
  ]},
  { id: 'twilight-domain', name: 'Twilight Domain', classId: 'cleric', sourceBook: 'TCE', description: 'The Twilight Domain represents the night sky, the protective veil of dusk, and the encroaching twilight.', features: [
    { name: 'Bonus Proficiencies', level: 1, description: 'You gain proficiency with martial weapons and heavy armor.' },
    { name: 'Eyes of Night', level: 1, description: 'You have darkvision 300 feet. As an action, you can grant this darkvision to willing creatures within 10 feet for 1 hour.' },
    { name: 'Vigilant Blessing', level: 1, description: 'As an action, you can grant a creature you touch (including yourself) advantage on its next initiative roll.' },
    { name: 'Channel Divinity: Twilight Sanctuary', level: 2, description: 'As an action, create a 30-foot-radius sphere of twilight centered on you for 1 minute. Allies in the sphere gain temp HP equal to 1d6 + cleric level each turn, or can end a charm/fright effect.' },
    { name: 'Steps of Night', level: 6, description: 'In dim light or darkness, as a bonus action, gain a flying speed equal to your walking speed for 1 minute. Prof-bonus uses per long rest.' },
    { name: 'Divine Strike', level: 8, description: 'Once per turn on hit with a weapon attack, deal extra 1d8 radiant damage (2d8 at 14th).' },
    { name: 'Twilight Shroud', level: 17, description: 'Allies in your Twilight Sanctuary have half cover.' },
  ]},

  // ── TCE: DRUID ───────────────────────────────────────────────────────
  { id: 'circle-of-spores', name: 'Circle of Spores', classId: 'druid', sourceBook: 'TCE', description: 'Druids of the Circle of Spores find beauty in decay. They see the life-and-death cycle in fungi growing on rotting wood.', features: [
    { name: 'Halo of Spores', level: 2, description: 'As a reaction when a creature moves into 10 feet of you or starts its turn there, force a Con save or take 1d4 necrotic damage (scales with level).' },
    { name: 'Symbiotic Entity', level: 2, description: 'As an action, expend a Wild Shape use to gain temp HP equal to 4 x druid level. Halo of Spores damage doubles, and weapon attacks deal +1d6 necrotic damage.' },
    { name: 'Fungal Infestation', level: 6, description: 'When a Small or Medium beast or humanoid within 10 feet dies, you can use your reaction to animate it as a zombie under your control for 1 hour. Wis-mod uses per long rest.' },
    { name: 'Spreading Spores', level: 10, description: 'As a bonus action while Symbiotic Entity is active, create a 10-foot cube of spores within 30 feet for 1 minute. Creatures entering or starting their turn take Halo of Spores damage.' },
    { name: 'Fungal Body', level: 14, description: 'You are immune to being blinded, deafened, frightened, or poisoned. Any crit against you counts as a normal hit instead.' },
  ]},
  { id: 'circle-of-stars', name: 'Circle of Stars', classId: 'druid', sourceBook: 'TCE', description: 'Druids of the Circle of Stars draw power from starlight. They glimpse the future in the stars\' radiance.', features: [
    { name: 'Star Map', level: 2, description: 'You create a chart of the heavens that serves as a spellcasting focus. You learn the Guidance cantrip and Guiding Bolt as a known spell.' },
    { name: 'Starry Form', level: 2, description: 'As a bonus action, expend a Wild Shape use to take on Starry Form (Archer: ranged spell attack for 1d8+Wis radiant; Chalice: heal another creature when you cast a healing spell; Dragon: take 10 on Con saves for concentration).' },
    { name: 'Cosmic Omen', level: 6, description: 'After a long rest, roll a die to determine your omen (Weal: add d6 to ally\'s attack/save; Woe: subtract d6 from enemy roll). Prof-bonus uses.' },
    { name: 'Twinkling Constellations', level: 10, description: 'Starry Form effects improve, and as a bonus action while in Starry Form, you can change which form you have and gain a flying speed of 20 feet.' },
    { name: 'Full of Stars', level: 14, description: 'While in Starry Form, you become partially incorporeal: resistance to bludgeoning, piercing, and slashing.' },
  ]},
  { id: 'circle-of-wildfire', name: 'Circle of Wildfire', classId: 'druid', sourceBook: 'TCE', description: 'Druids of the Circle of Wildfire understand that destruction sometimes paves the way for greater growth.', features: [
    { name: 'Circle Spells', level: 2, description: 'You learn additional spells: Burning Hands, Cure Wounds, etc.' },
    { name: 'Summon Wildfire Spirit', level: 2, description: 'As an action, expend a Wild Shape use to summon a wildfire spirit (Small elemental) in an unoccupied space within 30 feet. It can use Fiery Teleportation to teleport and deal fire damage.' },
    { name: 'Enhanced Bond', level: 6, description: 'When you cast a fire or healing spell, you can have it originate from your wildfire spirit. Damage spells deal +1d8 fire; healing spells heal +1d8.' },
    { name: 'Cauterizing Flames', level: 10, description: 'When a Small or larger creature dies within 30 feet of your wildfire spirit, a harmless spectral flame springs forth. As an action, a creature within 5 feet can heal another creature or deal fire damage to an enemy. Prof-bonus uses.' },
    { name: 'Blazing Revival', level: 14, description: 'If you drop to 0 HP, your wildfire spirit is destroyed and you regain HP equal to half your max. Once per long rest.' },
  ]},

  // ── TCE: FIGHTER ─────────────────────────────────────────────────────
  { id: 'psi-warrior', name: 'Psi Warrior', classId: 'fighter', sourceBook: 'TCE', description: 'A Psi Warrior is a fighter who augments their physical might with the psionic power of their mind.', features: [
    { name: 'Psionic Power', level: 3, description: 'You have a pool of Psionic Energy dice (Int-mod + prof-bonus per long rest, starting at d6, scaling to d12 at 17th). Use them for: Protective Field, Psionic Strike, or Telekinetic Movement.' },
    { name: 'Telekinetic Adept', level: 7, description: 'You learn Psi-Powered Leap (bonus action fly speed equal to twice your walking speed) and Telekinetic Thrust (when using Psionic Strike, force a Strength save or knock the target prone or push it 10 feet).' },
    { name: 'Guarded Mind', level: 10, description: 'You have resistance to psychic damage. If you start your turn frightened or charmed, you can spend 1 energy die to end the conditions.' },
    { name: 'Bulwark of Force', level: 15, description: 'As a bonus action, choose up to Int-mod creatures within 30 feet. They each gain half cover for 1 minute. Once per long rest.' },
    { name: 'Telekinetic Master', level: 18, description: 'You can cast Telekinesis without spell components, expending no spell slot. While concentrating, you can make one attack as a bonus action.' },
  ]},
  { id: 'rune-knight', name: 'Rune Knight', classId: 'fighter', sourceBook: 'TCE', description: 'Rune Knights are fighters who enhance their gear with potent runes, fragments of giants\' lost rune magic.', features: [
    { name: 'Bonus Proficiencies', level: 3, description: 'You gain proficiency with smith\'s tools and can speak, read, and write Giant.' },
    { name: 'Rune Carver', level: 3, description: 'You learn two runes of your choice (Cloud, Fire, Frost, Stone, Hill, Storm). Inscribed on gear, each rune grants a passive benefit and a usable property.' },
    { name: 'Giant\'s Might', level: 3, description: 'As a bonus action, become Large for 1 minute, gaining advantage on Strength checks/saves and extra 1d6 damage on weapon attacks once per turn. Prof-bonus uses per long rest.' },
    { name: 'Runic Shield', level: 7, description: 'When an ally within 60 feet is hit by an attack, use your reaction to force the attacker to reroll. Prof-bonus uses per long rest.' },
    { name: 'Great Stature', level: 10, description: 'Your size becomes permanently Large, and Giant\'s Might damage increases to 1d8.' },
    { name: 'Master of Runes', level: 15, description: 'You can use each rune twice per short or long rest.' },
    { name: 'Runic Juggernaut', level: 18, description: 'Giant\'s Might damage increases to 1d10, lasts 10 minutes, and you can become Huge.' },
  ]},

  // ── TCE: MONK ────────────────────────────────────────────────────────
  { id: 'way-of-mercy', name: 'Way of Mercy', classId: 'monk', sourceBook: 'TCE', description: 'Monks of the Way of Mercy learn to manipulate the life force of others to bring aid to those in need.', features: [
    { name: 'Implements of Mercy', level: 3, description: 'You gain proficiency in Insight and Medicine, plus an herbalism kit.' },
    { name: 'Hand of Healing', level: 3, description: 'As an action, spend 1 ki to touch a creature and restore HP equal to your Martial Arts die + Wis mod. Also can be used in place of a Flurry of Blows attack.' },
    { name: 'Hand of Harm', level: 3, description: 'Once per turn when you hit with an unarmed strike, spend 1 ki to deal extra necrotic damage equal to Martial Arts die + Wis mod.' },
    { name: 'Physician\'s Touch', level: 6, description: 'When you use Hand of Healing, end one of: blinded, deafened, paralyzed, poisoned, stunned. When you use Hand of Harm, target is poisoned until end of next turn.' },
    { name: 'Flurry of Healing and Harm', level: 11, description: 'When you use Flurry of Blows, you can replace each unarmed strike with Hand of Healing without spending ki.' },
    { name: 'Hand of Ultimate Mercy', level: 17, description: 'Spend 5 ki to touch a corpse dead no more than 24 hours and return it to life with full HP. Once per long rest.' },
  ]},
  { id: 'way-of-the-astral-self', name: 'Way of the Astral Self', classId: 'monk', sourceBook: 'TCE', description: 'A monk who follows the Way of the Astral Self believes their body is an illusion, and that their consciousness can manifest a visible astral form.', features: [
    { name: 'Arms of the Astral Self', level: 3, description: 'As a bonus action, spend 1 ki to summon spectral arms for 10 minutes. They use Wis for attacks/damage, deal 1d10 force damage, have 10-ft reach, and offer Wis-based defense.' },
    { name: 'Visage of the Astral Self', level: 6, description: 'As a bonus action (or as part of summoning Arms), summon Astral Eyes (60 ft darkvision) and Astral Mouth (60 ft telepathy + use Wis for Cha checks).' },
    { name: 'Body of the Astral Self', level: 11, description: 'When you have both Arms and Visage manifested, you gain Deflect Energy (reduce damage by 1d10 + monk level) and Empowered Arms (extra Martial Arts die damage once per turn).' },
    { name: 'Awakened Astral Self', level: 17, description: 'You gain +2 AC while astral self is summoned, and you can make three attacks with your Arms when taking the Attack action.' },
  ]},

  // ── TCE: PALADIN ─────────────────────────────────────────────────────
  { id: 'oath-of-glory', name: 'Oath of Glory', classId: 'paladin', sourceBook: 'TCE', description: 'Paladins who take the Oath of Glory believe they are destined — and divinely fated — for great deeds.', features: [
    { name: 'Channel Divinity: Peerless Athlete', level: 3, description: 'As a bonus action, gain advantage on Str (Athletics) and Dex (Acrobatics) checks for 10 minutes. Carrying capacity doubles.' },
    { name: 'Channel Divinity: Inspiring Smite', level: 3, description: 'Right after using Divine Smite, use a bonus action to grant temp HP (2d8 + paladin level) to creatures of your choice within 30 feet.' },
    { name: 'Aura of Alacrity', level: 7, description: 'Your walking speed increases by 10 feet. Allies within 5 feet (10 ft at 18th) also gain +10 ft speed.' },
    { name: 'Glorious Defense', level: 15, description: 'When you or an ally within 10 feet are hit by an attack, use your reaction to grant +Cha-mod AC against that attack. If the attack misses, make one weapon attack against the attacker. Cha-mod uses per long rest.' },
    { name: 'Living Legend', level: 20, description: 'As a bonus action for 1 minute: advantage on Cha checks, advantage on missed attack rolls (reroll once), and force enemies to reroll their successful saves vs your spells. Once per long rest.' },
  ]},
  { id: 'oath-of-the-watchers', name: 'Oath of the Watchers', classId: 'paladin', sourceBook: 'TCE', description: 'The Oath of the Watchers binds paladins to protect mortals from the dangers posed by extraplanar entities.', features: [
    { name: 'Channel Divinity: Watcher\'s Will', level: 3, description: 'As an action, choose up to Cha-mod creatures within 30 feet. They gain advantage on Int, Wis, and Cha saves for 1 minute.' },
    { name: 'Channel Divinity: Abjure the Extraplanar', level: 3, description: 'Each aberration, celestial, elemental, fey, or fiend within 30 feet must make a Wis save or be turned for 1 minute.' },
    { name: 'Aura of the Sentinel', level: 7, description: 'You and allies within 10 feet (30 ft at 18th) gain a bonus to initiative rolls equal to your prof bonus.' },
    { name: 'Vigilant Rebuke', level: 15, description: 'When you or a creature within 30 feet succeeds on an Int, Wis, or Cha save, use your reaction to deal 2d8 + Cha mod force damage to the source.' },
    { name: 'Mortal Bulwark', level: 20, description: 'As a bonus action for 1 minute: truesight 120 ft, advantage on attacks vs aberrations/celestials/elementals/fey/fiends, and banish them on a hit (Cha save). Once per long rest.' },
  ]},

  // ── TCE: RANGER ──────────────────────────────────────────────────────
  { id: 'fey-wanderer', name: 'Fey Wanderer', classId: 'ranger', sourceBook: 'TCE', description: 'Mysterious wardens of the Feywild, Fey Wanderers are infused with otherworldly magic.', features: [
    { name: 'Dreadful Strikes', level: 3, description: 'Once per turn when you hit with a weapon attack, deal +1d4 psychic damage (1d6 at 11th level).' },
    { name: 'Fey Wanderer Magic', level: 3, description: 'You learn additional spells, starting with Charm Person.' },
    { name: 'Otherworldly Glamour', level: 3, description: 'You gain +Wis-mod to Cha checks, and you become proficient in one of: Deception, Performance, or Persuasion.' },
    { name: 'Beguiling Twist', level: 7, description: 'Advantage on saves vs being charmed and frightened. When you or an ally within 120 feet succeeds on a save vs charm/fright, use your reaction to force a creature within 120 feet to make a Wis save or be charmed/frightened by you for 1 minute.' },
    { name: 'Fey Reinforcements', level: 11, description: 'You learn Summon Fey. You can cast it without a material component or expending a slot, once per long rest.' },
    { name: 'Misty Wanderer', level: 15, description: 'You can cast Misty Step a number of times per long rest equal to your Wis mod. You can take a willing creature within 5 feet with you.' },
  ]},
  { id: 'swarmkeeper', name: 'Swarmkeeper', classId: 'ranger', sourceBook: 'TCE', description: 'Magic intermingles with the bond that an archetypal ranger shares with nature — but the Swarmkeeper bonds with a swarm of nature spirits.', features: [
    { name: 'Gathered Swarm', level: 3, description: 'A swarm of nature spirits aids you. When you hit with an attack, choose: +1d6 piercing damage, push target 15 feet, or move yourself 5 feet without provoking opportunity attacks.' },
    { name: 'Swarmkeeper Magic', level: 3, description: 'You learn additional spells, starting with Mage Hand.' },
    { name: 'Writhing Tide', level: 7, description: 'As a bonus action, gain a flying speed of 10 feet for 1 minute. Prof-bonus uses per long rest.' },
    { name: 'Mighty Swarm', level: 11, description: 'Gathered Swarm damage increases to 1d8. Push effect also knocks Medium or smaller targets prone, and move effect makes you difficult to hit.' },
    { name: 'Swarming Dispersal', level: 15, description: 'When you take damage, use your reaction to gain resistance against it and teleport up to 30 feet. Prof-bonus uses per long rest.' },
  ]},

  // ── TCE: ROGUE ───────────────────────────────────────────────────────
  { id: 'phantom', name: 'Phantom', classId: 'rogue', sourceBook: 'TCE', description: 'Some rogues remain tied to the realms of the living and the dead through powerful trauma or ritual.', features: [
    { name: 'Whispers of the Dead', level: 3, description: 'Whenever you finish a short or long rest, you can gain proficiency in one skill or tool, replacing it next rest.' },
    { name: 'Wails from the Grave', level: 3, description: 'When you deal Sneak Attack damage, choose another creature within 30 feet that you can see. It takes necrotic damage equal to half your Sneak Attack damage. Prof-bonus uses per long rest.' },
    { name: 'Tokens of the Departed', level: 9, description: 'When a creature within 30 feet dies, create a Soul Trinket that fits in your hand. You can hold a number equal to prof bonus. Use a trinket to gain advantage on a save or empower Wails from the Grave.' },
    { name: 'Ghost Walk', level: 13, description: 'As a bonus action, take a ghostly form for 10 minutes: flying speed 10 feet, resistance to all damage except force/psychic, and you can move through objects/creatures. Costs a Soul Trinket.' },
    { name: 'Death\'s Friend', level: 17, description: 'Wails from the Grave no longer has a limited use. When you finish a long rest, you can gain a Soul Trinket.' },
  ]},
  { id: 'soulknife', name: 'Soulknife', classId: 'rogue', sourceBook: 'TCE', description: 'A Soulknife strikes with imaginary blades formed of psionic energy that pierce mind and body.', features: [
    { name: 'Psionic Power', level: 3, description: 'You have psionic energy dice (Int-mod + prof-bonus per long rest, starting d6, scaling to d12). Use for Psi-Bolstered Knack or Psychic Whispers.' },
    { name: 'Psychic Blades', level: 3, description: 'You can manifest a psychic blade as a bonus action. It counts as a simple finesse melee weapon with a 60-ft range thrown property and deals 1d6 psychic damage (1d4 for offhand).' },
    { name: 'Soul Blades', level: 9, description: 'You learn Homing Strikes (spend an energy die to turn a missed Psychic Blade attack into a hit) and Psychic Teleportation (spend a die to teleport up to 30 ft).' },
    { name: 'Psychic Veil', level: 13, description: 'As an action, become invisible for 1 hour or until you deal damage to a creature or force a save. Once per long rest, or spend an energy die.' },
    { name: 'Rend Mind', level: 17, description: 'When you Sneak Attack with a Psychic Blade, force a Wis save or be stunned for 1 minute. Once per short or long rest (no charge with an energy die).' },
  ]},

  // ── TCE: SORCERER ────────────────────────────────────────────────────
  { id: 'aberrant-mind', name: 'Aberrant Mind', classId: 'sorcerer', sourceBook: 'TCE', description: 'An alien influence has wrapped its tendrils around your mind, giving you psionic power.', features: [
    { name: 'Psionic Spells', level: 1, description: 'You learn additional spells (Mind Sliver, Dissonant Whispers, etc.) and can swap your sorcerer spells for divination or enchantment spells.' },
    { name: 'Telepathic Speech', level: 1, description: 'As a bonus action, form a telepathic link with a creature you can see within 30 feet for sorcerer-level minutes.' },
    { name: 'Psionic Sorcery', level: 6, description: 'When you cast a Psionic Spell, you can spend sorcery points equal to the spell\'s level instead of a spell slot. The spell requires no V or S components.' },
    { name: 'Psychic Defenses', level: 6, description: 'You gain resistance to psychic damage and advantage on saves to avoid being charmed or frightened.' },
    { name: 'Revelation in Flesh', level: 14, description: 'Spend 1+ sorcery points to gain otherworldly traits for 10 minutes: see invisible 60 ft, swim/fly 30 ft, slip through 1-inch gaps, or 60 ft telepathy.' },
    { name: 'Warping Implosion', level: 18, description: 'As an action, teleport up to 120 feet. Creatures within 30 feet of your starting space must make a Str save or take 5d10 force damage and be pulled to your new space. Once per long rest.' },
  ]},
  { id: 'clockwork-soul', name: 'Clockwork Soul', classId: 'sorcerer', sourceBook: 'TCE', description: 'The cosmic forces of order and chaos perpetually struggle. Some sorcerers draw their power from this struggle, embodying the perfection of order.', features: [
    { name: 'Clockwork Magic', level: 1, description: 'You learn additional spells (Alarm, Protection from Evil and Good, etc.) and can swap your sorcerer spells for abjuration or transmutation spells.' },
    { name: 'Restore Balance', level: 1, description: 'When a creature within 60 feet rolls with advantage or disadvantage, you can use your reaction to cancel it. Prof-bonus uses per long rest.' },
    { name: 'Bastion of Law', level: 6, description: 'Spend 1-5 sorcery points to grant a creature within 30 feet that many d8s, used to cancel damage taken.' },
    { name: 'Trance of Order', level: 14, description: 'As a bonus action, you become unflappable for 1 minute: attack rolls vs you don\'t have advantage, and your d20 rolls for attacks, ability checks, and saves treat 9 or lower as 10.' },
    { name: 'Clockwork Cavalcade', level: 18, description: 'As an action, summon spirits of order in a 30-foot cube within 30 feet. They heal up to 100 HP among creatures, end one spell of 6th level or lower on each creature, and repair damaged objects. Once per long rest.' },
  ]},

  // ── TCE: WARLOCK ─────────────────────────────────────────────────────
  { id: 'the-fathomless', name: 'The Fathomless', classId: 'warlock', sourceBook: 'TCE', description: 'You have plumbed the ocean\'s deepest trenches and found a creature of the depths willing to make a pact with you.', features: [
    { name: 'Tentacle of the Deeps', level: 1, description: 'As a bonus action, summon a spectral tentacle in an unoccupied space within 60 feet. As a bonus action on subsequent turns, use the tentacle to attack: ranged spell attack 60 ft, 1d8 cold damage, target\'s speed -10 ft.' },
    { name: 'Gift of the Sea', level: 1, description: 'You gain a swimming speed of 40 feet and the ability to breathe underwater.' },
    { name: 'Oceanic Soul', level: 6, description: 'You gain resistance to cold damage. While underwater, you have resistance to acid, fire, lightning, and thunder damage. You can speak with aquatic creatures.' },
    { name: 'Guardian Coil', level: 6, description: 'As a reaction when you or a creature within 10 feet of your tentacle takes damage, reduce it by 2d8 (3d8 at 10th).' },
    { name: 'Grasping Tentacles', level: 10, description: 'You learn Evard\'s Black Tentacles. You can cast it once per long rest without a slot, and gain temporary HP equal to your warlock level when you cast it.' },
    { name: 'Fathomless Plunge', level: 14, description: 'As an action, teleport yourself and up to 5 willing creatures within 30 feet through a portal to a body of water you have seen, up to 1 mile away. Once per short or long rest.' },
  ]},
  { id: 'the-genie', name: 'The Genie', classId: 'warlock', sourceBook: 'TCE', description: 'You have made a pact with one of the rarest kinds of genie, a noble genie of an exotic court.', features: [
    { name: 'Genie\'s Vessel', level: 1, description: 'Your patron gifts you a vessel (lamp, ring, etc.). As a bonus action, you can vanish into the vessel for up to twice your prof-bonus hours. You can also use it to deal extra damage based on your genie\'s kind (Dao: bludgeoning, Djinni: thunder, Efreeti: fire, Marid: cold).' },
    { name: 'Elemental Gift', level: 6, description: 'You gain resistance to a damage type based on your genie kind, and as a bonus action a flying speed of 30 feet for 10 minutes. Prof-bonus uses per long rest.' },
    { name: 'Sanctuary Vessel', level: 10, description: 'When you hide in your Genie\'s Vessel, you can bring along willing creatures within 30 feet (up to 5). Creatures inside regain HP at the start of each hour as if they\'d spent Hit Dice.' },
    { name: 'Limited Wish', level: 14, description: 'You can entreat your genie patron to cast any spell of 6th level or lower as a free action. Once per long rest, but you must wait 1d4 long rests before using it again.' },
  ]},

  // ── TCE: WIZARD ──────────────────────────────────────────────────────
  { id: 'bladesinging', name: 'Bladesinging', classId: 'wizard', sourceBook: 'TCE', description: 'Bladesingers are elves who use their wizardly training to perfect a deadly art that combines swordplay with magic.', features: [
    { name: 'Training in War and Song', level: 2, description: 'You gain proficiency with light armor, one type of one-handed melee weapon (rapier, longsword, scimitar, sword, etc.), and Performance.' },
    { name: 'Bladesong', level: 2, description: 'As a bonus action, you can start the Bladesong (lasts 1 minute or until you don armor/shield, use two hands, or are incapacitated). While active: +Int mod to AC, +10 ft speed, advantage on Acrobatics checks, +Int mod to Concentration saves. Prof-bonus uses per short or long rest.' },
    { name: 'Extra Attack', level: 6, description: 'You can attack twice when you take the Attack action. You can also replace one of these attacks with a cantrip with a casting time of 1 action.' },
    { name: 'Song of Defense', level: 10, description: 'While Bladesong is active, you can use your reaction when you take damage to expend a spell slot and reduce the damage by five times the slot level.' },
    { name: 'Song of Victory', level: 14, description: 'While Bladesong is active, you add your Intelligence modifier to the damage of your melee weapon attacks.' },
  ]},
  { id: 'order-of-scribes', name: 'Order of Scribes', classId: 'wizard', sourceBook: 'TCE', description: 'The Order of Scribes is a club of bookish mages who treat their spellbooks as extensions of their minds.', features: [
    { name: 'Wizardly Quill', level: 2, description: 'You magically create a special quill that requires no ink and makes copying spells faster and cheaper (gold cost halved). You can produce a new quill as an action.' },
    { name: 'Awakened Spellbook', level: 2, description: 'Your spellbook becomes a sentient companion. When you cast a spell from it, you can change the damage type to another from a spell in the book. Once per long rest, when you cast a 1st-level+ spell, you can do so as a ritual without taking 10 extra minutes.' },
    { name: 'Manifest Mind', level: 6, description: 'As a bonus action, project the consciousness of your spellbook as a luminous, incorporeal image within 60 feet for 1 hour. Cast spells through it. Prof-bonus uses per long rest.' },
    { name: 'Master Scrivener', level: 10, description: 'After a long rest, create a single Spell Scroll containing one wizard spell of 1st or 2nd level from your spellbook.' },
    { name: 'One with the Word', level: 14, description: 'When you take damage, use your reaction to reduce it by 3d6. The book then loses pages equal to the damage prevented; if it loses all pages, you take 3d6 psychic damage but the book regenerates.' },
  ]},

  // ── FToD: MONK ───────────────────────────────────────────────────────
  { id: 'way-of-the-ascendant-dragon', name: 'Way of the Ascendant Dragon', classId: 'monk', sourceBook: 'FToD', description: 'Monks of the Way of the Ascendant Dragon emulate the might of dragons by harnessing their power within themselves.', features: [
    { name: 'Draconic Disciple', level: 3, description: 'You learn Draconic. You can imbue your unarmed strikes with draconic energy, dealing acid, cold, fire, lightning, or poison damage. You gain proficiency in Cha (Intimidation or Persuasion).' },
    { name: 'Breath of the Dragon', level: 3, description: 'When you use Attack action, replace one attack with a breath weapon — a 20-foot cone or 30-foot line dealing Martial Arts die damage of your chosen element (Dex save half).' },
    { name: 'Wings Unfurled', level: 6, description: 'When you use Step of the Wind, you can sprout spectral wings, gaining a flying speed equal to your walking speed until the end of your turn. Prof-bonus uses per long rest.' },
    { name: 'Aspect of the Wyrm', level: 11, description: 'As a bonus action, create a 30-foot aura: Frightful Presence (creatures of your choice make a Wis save or be frightened) or Draconic Resistance (allies gain resistance to your damage type). Prof-bonus uses per long rest.' },
    { name: 'Ascendant Aspect', level: 17, description: 'Breath of the Dragon damage doubles. Aspect of the Wyrm: blindsight 30 feet. When you roll initiative, regain one Wings Unfurled use.' },
  ]},

  // ── FToD: RANGER ─────────────────────────────────────────────────────
  { id: 'drakewarden', name: 'Drakewarden', classId: 'ranger', sourceBook: 'FToD', description: 'Drakewardens are rangers who form a bond with a small draconic spirit that manifests as a drake companion.', features: [
    { name: 'Draconic Gift', level: 3, description: 'You learn the Thaumaturgy cantrip and you learn Draconic.' },
    { name: 'Drake Companion', level: 3, description: 'As an action, magically summon a Tiny dragon spirit (Drake Companion) that manifests in an unoccupied space within 30 feet. The drake is friendly to you and your allies and obeys your commands. It has a damage type you choose at summon. Once per long rest (unlimited if you cast as a 1st-level+ spell).' },
    { name: 'Bond of Fang and Scale', level: 7, description: 'The drake becomes Medium. You and the drake gain a flying speed equal to your walking speed (when mounted). The drake\'s Infused Strikes deal extra damage, and it gains other defensive features.' },
    { name: 'Drake\'s Breath', level: 11, description: 'As an action, command your drake to exhale draconic energy at a point within 60 feet: 30-foot cone, 8d6 damage of its damage type (Dex save half). Once per long rest.' },
    { name: 'Perfected Bond', level: 15, description: 'The drake grows: deals +2d6 damage on attacks once per turn. When attacked, you can use a reaction to swap places with the drake. Your drake gains immunity to its damage type.' },
  ]},

  // ── TCE: ARTIFICER SUBCLASSES ─────────────────────────────────────────
  { id: 'alchemist', name: 'Alchemist', classId: 'artificer', sourceBook: 'TCE', description: 'An Alchemist is an expert at combining reagents to produce mystical effects. Alchemists use their creations to give life and to leech it away.', features: [
    { name: 'Tool Proficiency', level: 3, description: 'You gain proficiency with alchemist\'s supplies. If you already have it, you gain proficiency with one other type of artisan\'s tools.' },
    { name: 'Alchemist Spells', level: 3, description: 'You always have certain spells prepared: Healing Word, Ray of Sickness (3rd), Flaming Sphere, Melf\'s Acid Arrow (5th), Gaseous Form, Mass Healing Word (9th), Blight, Death Ward (13th), Cloudkill, Raise Dead (17th).' },
    { name: 'Experimental Elixir', level: 3, description: 'After a long rest, you can magically produce an experimental elixir in an empty flask. Roll on the Experimental Elixir table for the effect (Healing, Swiftness, Resilience, Boldness, Flight, Transformation). At higher levels you create more elixirs.' },
    { name: 'Alchemical Savant', level: 5, description: 'When you cast a spell using alchemist\'s supplies as a focus, you add your Intelligence modifier to one healing or acid/fire/necrotic/poison damage roll of the spell.' },
    { name: 'Restorative Reagents', level: 9, description: 'When a creature drinks one of your elixirs, it gains temporary HP equal to 2d6 + your Intelligence modifier. You can also cast Lesser Restoration without expending a spell slot, a number of times equal to your Int modifier per long rest.' },
    { name: 'Chemical Mastery', level: 15, description: 'You gain resistance to acid and poison damage and are immune to the poisoned condition. You can cast Greater Restoration and Heal once per long rest each without expending a spell slot.' },
  ]},
  { id: 'armorer', name: 'Armorer', classId: 'artificer', sourceBook: 'TCE', description: 'An artificer who specializes as an Armorer modifies armor to function almost like a second skin.', features: [
    { name: 'Tools of the Trade', level: 3, description: 'You gain proficiency with heavy armor and smith\'s tools.' },
    { name: 'Armorer Spells', level: 3, description: 'You always have certain spells prepared: Magic Missile, Thunderwave (3rd), Mirror Image, Shatter (5th), Hypnotic Pattern, Lightning Bolt (9th), Fire Shield, Greater Invisibility (13th), Passwall, Wall of Force (17th).' },
    { name: 'Arcane Armor', level: 3, description: 'Your armor becomes Arcane Armor. It includes integrated weapons, requires no Strength minimum, you can don/doff as an action, and it includes thieves\' tools/smith\'s tools.' },
    { name: 'Armor Model', level: 3, description: 'Choose a model — Guardian or Infiltrator — granting unique features:\n• Guardian: Thunder Gauntlets (magical melee weapon, 1d8 thunder), Defensive Field (bonus action temp HP).\n• Infiltrator: Lightning Launcher (magical ranged weapon, 1d6 lightning), Powered Steps, Dampening Field.' },
    { name: 'Extra Attack', level: 5, description: 'You can attack twice when you take the Attack action.' },
    { name: 'Armor Modifications', level: 9, description: 'You learn to extend infusion magic to your Arcane Armor. You can have up to 4 infusions in armor pieces. The number of infused items doesn\'t count against your max.' },
    { name: 'Perfected Armor', level: 15, description: 'Guardian: Pull and deal damage when a creature within 30 feet hits an ally. Infiltrator: Crit on 19-20 with Lightning Launcher; on hit, target sheds bright light and grants advantage on attacks against it.' },
  ]},
  { id: 'artillerist', name: 'Artillerist', classId: 'artificer', sourceBook: 'TCE', description: 'An Artillerist specializes in using magic to hurl energy, projectiles, and explosions on a battlefield.', features: [
    { name: 'Tool Proficiency', level: 3, description: 'You gain proficiency with woodcarver\'s tools. If you already have it, you gain proficiency with one other type of artisan\'s tools.' },
    { name: 'Artillerist Spells', level: 3, description: 'You always have certain spells prepared: Shield, Thunderwave (3rd), Scorching Ray, Shatter (5th), Fireball, Wind Wall (9th), Ice Storm, Wall of Fire (13th), Cone of Cold, Wall of Force (17th).' },
    { name: 'Eldritch Cannon', level: 3, description: 'You can use your action to magically create a Small or Tiny Eldritch Cannon in an unoccupied space within 5 feet. Choose Flamethrower, Force Ballista, or Protector. It lasts 1 hour or until destroyed/dismissed. Once per long rest unless you expend a spell slot.' },
    { name: 'Arcane Firearm', level: 5, description: 'You can turn a wand, staff, or rod into an arcane firearm — a magical conduit for your artificer spells. When you cast an artificer spell through it, you add 1d8 to the spell\'s damage roll.' },
    { name: 'Explosive Cannon', level: 9, description: 'Each of your Eldritch Cannon options deals more damage (Flamethrower 2d8, Force Ballista 3d8, Protector 2d8). As an action, you can command your cannon to detonate, dealing force damage to creatures within 20 feet.' },
    { name: 'Fortified Position', level: 15, description: 'You and your allies have half cover while within 10 feet of a cannon you create. You can have two cannons at the same time.' },
  ]},
  { id: 'battle-smith', name: 'Battle Smith', classId: 'artificer', sourceBook: 'TCE', description: 'Armies require protection, and someone has to put things back together if defenses fail. A combination of protector and medic, a Battle Smith is an expert at defending allies and repairing both materiel and personnel.', features: [
    { name: 'Tools of the Trade', level: 3, description: 'You gain proficiency with martial weapons and smith\'s tools.' },
    { name: 'Battle Smith Spells', level: 3, description: 'You always have certain spells prepared: Heroism, Shield (3rd), Branding Smite, Warding Bond (5th), Aura of Vitality, Conjure Barrage (9th), Aura of Purity, Fire Shield (13th), Banishing Smite, Mass Cure Wounds (17th).' },
    { name: 'Battle Ready', level: 3, description: 'You can use your Intelligence modifier instead of Strength or Dexterity for the attack and damage rolls of magic weapons. You gain proficiency with martial weapons.' },
    { name: 'Steel Defender', level: 3, description: 'You magically create a steel defender — a Medium construct ally. It uses statistics based on your Intelligence modifier and artificer level. It obeys your commands and acts on your initiative.' },
    { name: 'Extra Attack', level: 5, description: 'You can attack twice when you take the Attack action.' },
    { name: 'Arcane Jolt', level: 9, description: 'When you hit a target with a magic weapon attack or your steel defender hits, you can channel magical energy: deal an extra 2d6 force damage, or restore 2d6 HP to one creature within 30 feet. Int-mod uses per long rest.' },
    { name: 'Improved Defender', level: 15, description: 'Your Arcane Jolt damage/healing increases to 4d6. When your steel defender uses its Deflect Attack reaction, the attacker takes force damage equal to 1d4 + Int mod.' },
  ]},

  // ── EGtW: Explorer's Guide to Wildemount ────────────────────────────────
  { id: 'echo-knight', name: 'Echo Knight', classId: 'fighter', sourceBook: 'EGtW', description: 'A mysterious and feared frontline warrior of the Kryn Dynasty, the Echo Knight has mastered the art of using dunamis to summon the fading shades of unrealized timelines to aid them in battle. Passing through the shades of history, an Echo Knight can shroud themselves in the memory of conflict.', features: [
    { name: 'Manifest Echo', level: 3, description: 'You can use a bonus action to magically manifest an echo of yourself in an unoccupied space you can see within 15 feet of you. This echo is a magical, translucent, gray image of you that lasts until it is destroyed, until you dismiss it as a bonus action, until you manifest another echo, or until you\'re incapacitated.\n\nYour echo has AC 14 + your proficiency bonus, 1 hit point, and immunity to all conditions. If it has to make a saving throw, it uses your saving throw bonus. It is the same size as you, and it occupies its space. On your turn, you can mentally command the echo to move up to 30 feet in any direction. If your echo is ever more than 30 feet from you at the end of your turn, it is destroyed.\n\nAs an action, you can teleport to your echo\'s space. When you do, your echo is destroyed.' },
    { name: 'Unleash Incarnation', level: 3, description: 'You can heighten your echo\'s fury. Whenever you take the Attack action, you can make one additional melee attack from the echo\'s position. You can use this feature a number of times equal to your Constitution modifier (minimum of once). You regain all expended uses when you finish a long rest.' },
    { name: 'Echo Avatar', level: 7, description: 'You can temporarily transfer your consciousness to your echo. As an action, you can see through your echo\'s eyes and hear through its ears. During this time, you are deafened and blinded. You can sustain this effect for up to 10 minutes, and you can end it at any time (requires no action). While your echo is being used in this way, it can be up to 1,000 feet away from you without being destroyed.' },
    { name: 'Shadow Martyr', level: 10, description: 'You can make your echo throw itself in front of an attack directed at another creature that you can see. Before the attack roll is made, you can use your reaction to teleport the echo to an unoccupied space within 5 feet of the targeted creature. The attack roll that triggered the reaction is made against the echo instead. Once you use this feature, you can\'t use it again until you finish a short or long rest.' },
    { name: 'Reclaim Potential', level: 15, description: 'You\'ve learned to absorb the fleeting magic of your echo. When an echo of yours is destroyed by an enemy\'s attack, you can gain a number of temporary hit points equal to 2d6 + your Constitution modifier, provided you don\'t already have temporary hit points.\n\nYou can use this feature a number of times equal to your Constitution modifier (minimum of once). You regain all expended uses when you finish a long rest.' },
    { name: 'Legion of One', level: 18, description: 'You can use a bonus action to create two echoes with your Manifest Echo feature, and these echoes can coexist. If you try to create a third echo, the previous two echoes are destroyed. Anything you can do from one echo\'s position can be done from the other\'s instead.\n\nIn addition, when you roll initiative and have no uses of Unleash Incarnation remaining, you regain one use of that feature.' },
  ]},

  { id: 'chronurgy-magic', name: 'Chronurgy Magic', classId: 'wizard', sourceBook: 'EGtW', description: 'Focusing on the manipulation of time, those who follow the Chronurgy tradition learn to alter the pace of reality to their liking. Using the principles of dunamis, these mages can slow down or reverse time around a creature.', features: [
    { name: 'Chronal Shift', level: 2, description: 'You can magically exert limited control over the flow of time around a creature. As a reaction, after you or a creature you can see within 30 feet of you makes an attack roll, an ability check, or a saving throw, you can force the creature to reroll. You must use this ability before you know whether the roll succeeds or fails. The creature must use the second roll. You can use this ability twice, and you regain all expended uses when you finish a long rest.' },
    { name: 'Temporal Awareness', level: 2, description: 'You can add your Intelligence modifier to your initiative rolls.' },
    { name: 'Momentary Stasis', level: 6, description: 'As an action, you can magically force a Large or smaller creature you can see within 60 feet of you to make a Constitution saving throw against your spell save DC. On a failed save, the creature is encased in a field of magical energy until the end of your next turn or until the creature takes any damage. While encased in this way, the creature is incapacitated and has a speed of 0.\n\nYou can use this feature a number of times equal to your Intelligence modifier (minimum of once). You regain all expended uses when you finish a long rest.' },
    { name: 'Arcane Abeyance', level: 10, description: 'When you cast a spell using a spell slot of 4th level or lower, you can condense the spell\'s magic into a mote and touch a willing creature. The spell is stored in that creature, who must make concentration checks if necessary.\n\nThe spell storage lasts until the creature uses it (as a bonus action) or 8 hours pass. If the creature is incapacitated, the spell activates immediately targeting the creature. Once you use this feature, you can\'t use it again until you finish a short or long rest.' },
    { name: 'Convergent Future', level: 14, description: 'You can peer through possible futures and magically pull one of them into reality. As a reaction, when you or a creature you can see within 60 feet of you makes an attack roll, an ability check, or a saving throw, you can ignore the roll and decide whether the roll succeeds or fails. When you use this feature, you gain one level of exhaustion. Only a long rest removes this exhaustion.' },
  ]},

  { id: 'graviturgy-magic', name: 'Graviturgy Magic', classId: 'wizard', sourceBook: 'EGtW', description: 'Understanding and mastering the forces that draw matter together or drive it apart, the School of Graviturgy opens up possibilities that other spellcasters can\'t consider. Some of the brightest arcane minds have been drawn to this school, seeking to master the forces that bind the universe together.', features: [
    { name: 'Adjust Density', level: 2, description: 'As an action, you can magically alter the weight of one object or creature you can see within 30 feet of you. The object or creature must be Large or smaller. The target\'s weight is halved or doubled for up to 1 minute or until your concentration ends (as if concentrating on a spell).\n\nWhile the weight of a creature is halved by this effect, the creature\'s speed increases by 10 feet, it can jump twice as far as normal, and it has disadvantage on Strength checks and Strength saving throws. While the weight of a creature is doubled by this effect, the creature\'s speed is reduced by 10 feet, and it has disadvantage on Dexterity checks and Dexterity saving throws.\n\nYou can use this feature a number of times equal to your Intelligence modifier (minimum of once). You regain all expended uses when you finish a long rest.' },
    { name: 'Gravity Well', level: 2, description: 'Whenever you cast a spell on a creature, you can move the target 5 feet to an unoccupied space of your choice if the target is willing or if it is incapacitated or restrained.' },
    { name: 'Violent Attraction', level: 6, description: 'When another creature that you can see within 60 feet of you hits with a weapon attack, you can use your reaction to increase the attack\'s velocity, causing the attack\'s target to take an extra 1d10 damage of the weapon\'s type.\n\nAlternatively, if a creature within 60 feet of you takes damage from a fall, you can use your reaction to increase the fall\'s damage by 2d10.\n\nYou can use this feature a number of times equal to your Intelligence modifier (minimum of once). You regain all expended uses when you finish a long rest.' },
    { name: 'Event Horizon', level: 10, description: 'As an action, you can magically emit a powerful field of gravitational energy that tugs at other creatures for up to 1 minute or until your concentration ends (as if concentrating on a spell). For the duration, whenever a creature hostile to you starts its turn within 30 feet of you, it must make a Strength saving throw against your spell save DC. On a failed save, it takes 2d10 force damage, and its speed is reduced to 0 until the start of its next turn. On a successful save, it takes half as much damage and suffers no reduction to its speed.\n\nOnce you use this feature, you can\'t do so again until you finish a long rest.' },
    { name: 'Deprive the Unworthy', level: 14, description: 'You can seize control of gravitational energy to strip it from another creature. As a bonus action, you can magically target a creature you can see within 30 feet of you. The target must make a Strength saving throw against your spell save DC. On a failed save, its flying speed (if any) is reduced to 0 feet for 1 minute. An airborne creature affected by this feature descends at 60 feet per round until it reaches the ground or the minute ends.\n\nIn addition, when a creature within 30 feet of you makes an attack roll using a ranged weapon, you can use your reaction to impose disadvantage on the roll. You can use this reaction a number of times equal to your Intelligence modifier (minimum of once). You regain all expended uses after a long rest.' },
  ]},

  { id: 'cobalt-soul', name: 'Way of the Cobalt Soul', classId: 'monk', sourceBook: 'EGtW', description: 'Driven by the pursuit of knowledge and the spirit of truth, monks of the Cobalt Soul are the enlightened agents of the Cobalt Reserve, a network of libraries and scholars across Exandria. These monks use their physical prowess and keen intellect to expose the secrets of the world.', features: [
    { name: 'Extract Aspects', level: 3, description: 'When you hit a creature with one of the attacks granted by your Flurry of Blows, you can analyze its defenses. On a hit, you learn the following information about the creature: its damage vulnerabilities, damage resistances, damage immunities, and condition immunities.\n\nThe DM might determine that some information about the creature is too obscure to be ascertained in this way.' },
    { name: 'Extort Truth', level: 3, description: 'You can precisely strike a hidden pressure point to weaken a creature\'s defenses. Whenever you hit a creature with one of the attacks granted by your Flurry of Blows, you can spend 1 ki point to force the creature to make a Charisma saving throw. On a failed save, the creature is unable to speak a deliberate lie and has disadvantage on Deception checks for 1 minute.\n\nYou know if the creature failed or succeeded on its saving throw. An affected creature is aware of the effect and can thus avoid answering questions to which it would normally respond with a lie.' },
    { name: 'Mystical Erudition', level: 3, description: 'You have extensively studied the history and lore within the archives of the Cobalt Soul. You learn one language of your choice, and you gain proficiency with one of the following skills of your choice: Arcana, History, Investigation, Nature, or Religion. If you already have proficiency in one of the listed skills, you can choose to double your proficiency bonus for ability checks you make that use that skill.' },
    { name: 'Mind of Mercury', level: 6, description: 'You have honed your awareness through relentless mental training. Once per turn when you use Extract Aspects, you can use it against one additional creature. When you do so, you can move up to half your speed without triggering opportunity attacks.\n\nYour Mystical Erudition improves. You learn one additional language and gain proficiency in one additional skill from the Mystical Erudition list.' },
    { name: 'Debilitating Barrage', level: 11, description: 'You\'ve gained the knowledge to temporarily incapacitate a creature\'s defense against certain types of damage. When you hit a creature with one of the attacks granted by your Flurry of Blows, you can spend 3 ki points to cause the creature to gain vulnerability to one damage type of your choice until the start of your next turn.\n\nIf the creature has resistance to the chosen damage type, the resistance is suspended rather than vulnerability being applied.' },
    { name: 'Mystical Erudition (Improved)', level: 11, description: 'You learn one additional language and gain proficiency in one additional skill from the Mystical Erudition list. You can also choose to triple your proficiency bonus for ability checks using a skill in which you have doubled your proficiency bonus from Mystical Erudition.' },
    { name: 'Sequester Strikes', level: 17, description: 'When you use Debilitating Barrage, you can spend an additional ki point to impose two different damage type vulnerabilities instead of one. If a creature already has vulnerability to one of those damage types, that condition isn\'t applied, but the other vulnerability is.' },
  ]},
];

export function getSubclassesForClass(classId: string): Subclass[] {
  return ALL_SUBCLASSES.filter(s => s.classId === classId);
}

export function getSubclass(id: string): Subclass | undefined {
  return ALL_SUBCLASSES.find(s => s.id === id);
}
