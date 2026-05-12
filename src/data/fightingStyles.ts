import type { FightingStyle } from '../types';

export const ALL_FIGHTING_STYLES: FightingStyle[] = [
  // PHB
  { id: 'archery', name: 'Archery', sourceBook: 'PHB', classes: ['fighter', 'ranger'], description: 'You gain a +2 bonus to attack rolls you make with ranged weapons.' },
  { id: 'defense', name: 'Defense', sourceBook: 'PHB', classes: ['fighter', 'paladin', 'ranger'], description: 'While you are wearing armor, you gain a +1 bonus to AC.' },
  { id: 'dueling', name: 'Dueling', sourceBook: 'PHB', classes: ['fighter', 'paladin', 'ranger'], description: 'When you are wielding a melee weapon in one hand and no other weapons, you gain a +2 bonus to damage rolls with that weapon.' },
  { id: 'great-weapon-fighting', name: 'Great Weapon Fighting', sourceBook: 'PHB', classes: ['fighter', 'paladin'], description: 'When you roll a 1 or 2 on a damage die for an attack you make with a melee weapon that you are wielding with two hands, you can reroll the die and must use the new roll.' },
  { id: 'protection', name: 'Protection', sourceBook: 'PHB', classes: ['fighter', 'paladin'], description: 'When a creature you can see attacks a target other than you that is within 5 feet of you, you can use your reaction to impose disadvantage on the attack roll. You must be wielding a shield.' },
  { id: 'two-weapon-fighting', name: 'Two-Weapon Fighting', sourceBook: 'PHB', classes: ['fighter', 'ranger'], description: 'When you engage in two-weapon fighting, you can add your ability modifier to the damage of the second attack.' },

  // PHB Bard College of Swords (XGtE)
  // XGtE additions
  { id: 'blind-fighting', name: 'Blind Fighting', sourceBook: 'TCE', classes: ['fighter', 'paladin', 'ranger'], description: 'You have blindsight with a range of 10 feet. Within that range, you can effectively see anything that isn\'t behind total cover, even if you are blinded or in darkness. Moreover, you can see an invisible creature within that range.' },
  { id: 'druidic-warrior', name: 'Druidic Warrior', sourceBook: 'TCE', classes: ['ranger'], description: 'You learn two cantrips of your choice from the druid spell list. Wisdom is your spellcasting ability for them.' },
  { id: 'interception', name: 'Interception', sourceBook: 'TCE', classes: ['fighter', 'paladin'], description: 'When a creature you can see hits a target, other than you, within 5 feet of you with an attack, you can use your reaction to reduce the damage the target takes by 1d10 + your proficiency bonus. You must be wielding a shield or a simple or martial weapon.' },
  { id: 'superior-technique', name: 'Superior Technique', sourceBook: 'TCE', classes: ['fighter'], description: 'You learn one maneuver of your choice from among those available to the Battle Master archetype. You gain one superiority die which is a d6. This die is used to fuel your maneuvers.' },
  { id: 'thrown-weapon-fighting', name: 'Thrown Weapon Fighting', sourceBook: 'TCE', classes: ['fighter', 'ranger'], description: 'You can draw a weapon that has the thrown property as part of the attack you make with the weapon. In addition, when you hit with a ranged attack using a thrown weapon, you gain a +2 bonus to the damage roll.' },
  { id: 'unarmed-fighting', name: 'Unarmed Fighting', sourceBook: 'TCE', classes: ['fighter'], description: 'Your unarmed strikes can deal bludgeoning damage equal to 1d6 + your Strength modifier on a hit. If you strike with two free hands, the d6 becomes a d8. At the start of each of your turns, you can deal 1d4 bludgeoning damage to one creature grappled by you.' },
  { id: 'close-quarters-shooter', name: 'Close Quarters Shooter', sourceBook: 'XGtE', classes: ['fighter'], description: 'When making a ranged attack while you are within 5 feet of a hostile creature, you do not have disadvantage on the attack roll. Your ranged attacks ignore half cover and three-quarters cover against targets within 30 feet. You also gain a +1 bonus to attack rolls on ranged attacks against targets within 30 feet.' },
  { id: 'mariner', name: 'Mariner', sourceBook: 'XGtE', classes: ['fighter', 'paladin', 'ranger'], description: 'As long as you are not wearing heavy armor or using a shield, you have a swimming speed and a climbing speed equal to your normal speed, and you gain a +1 bonus to AC.' },
  { id: 'tunnel-fighter', name: 'Tunnel Fighter', sourceBook: 'XGtE', classes: ['fighter'], description: 'You excel at defending narrow passages, doorways, and other tight spaces. As a bonus action, you can enter a defensive stance that lasts until the start of your next turn. While in this stance, you can make opportunity attacks without using your reaction, and you can use your reaction to make a melee attack against a creature that moves more than 5 feet while within your reach.' },
];

export function getFightingStyle(id: string): FightingStyle | undefined {
  return ALL_FIGHTING_STYLES.find(fs => fs.id === id);
}

export function getFightingStylesForClass(classId: string): FightingStyle[] {
  return ALL_FIGHTING_STYLES.filter(fs => fs.classes.includes(classId));
}
