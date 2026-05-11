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
  { id: 'battle-master', name: 'Battle Master', classId: 'fighter', sourceBook: 'PHB', description: 'Those who emulate the archetype of the Battle Master employ martial techniques passed down through generations.', features: [
    { name: 'Combat Superiority', level: 3, description: 'When you choose this archetype at 3rd level, you learn maneuvers that are fueled by special dice called superiority dice (d8, upgrading to d10 at 10th level and d12 at 18th level). You learn three maneuvers of your choice. You have four superiority dice. You regain all of your expended superiority dice when you finish a short or long rest.' },
    { name: 'Student of War', level: 3, description: 'At 3rd level, you gain proficiency with one type of artisan\'s tools of your choice.' },
    { name: 'Know Your Enemy', level: 7, description: 'If you spend at least 1 minute observing or interacting with another creature outside combat, you can learn certain information about its capabilities compared to your own.' },
    { name: 'Improved Combat Superiority', level: 10, description: 'At 10th level, your superiority dice turn into d10s. At 18th level, they turn into d12s.' },
    { name: 'Relentless', level: 15, description: 'Starting at 15th level, when you roll initiative and have no superiority dice remaining, you regain 1 superiority die.' },
  ]},
  { id: 'eldritch-knight', name: 'Eldritch Knight', classId: 'fighter', sourceBook: 'PHB', description: 'The archetypical Eldritch Knight combines the martial mastery common to all fighters with a careful study of magic.', features: [
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
  { id: 'arcane-trickster', name: 'Arcane Trickster', classId: 'rogue', sourceBook: 'PHB', description: 'Some rogues enhance their fine-honed skills of stealth and agility with magic, learning tricks of enchantment and illusion.', features: [
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
];

export function getSubclassesForClass(classId: string): Subclass[] {
  return ALL_SUBCLASSES.filter(s => s.classId === classId);
}

export function getSubclass(id: string): Subclass | undefined {
  return ALL_SUBCLASSES.find(s => s.id === id);
}
