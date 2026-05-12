import type { Metamagic } from '../types';

export const ALL_METAMAGIC: Metamagic[] = [
  // PHB
  { id: 'careful-spell', name: 'Careful Spell', sourceBook: 'PHB', cost: '1 sorcery point', description: 'When you cast a spell that forces other creatures to make a saving throw, you can protect some of those creatures. You spend 1 sorcery point and choose a number of those creatures up to your Charisma modifier (minimum of one). A chosen creature automatically succeeds on its saving throw against the spell.' },
  { id: 'distant-spell', name: 'Distant Spell', sourceBook: 'PHB', cost: '1 sorcery point', description: 'When you cast a spell that has a range of 5 feet or greater, you can spend 1 sorcery point to double the range of the spell. When you cast a spell that has a range of touch, you can spend 1 sorcery point to make the range of the spell 30 feet.' },
  { id: 'empowered-spell', name: 'Empowered Spell', sourceBook: 'PHB', cost: '1 sorcery point', description: 'When you roll damage for a spell, you can spend 1 sorcery point to reroll a number of the damage dice up to your Charisma modifier (minimum of one). You must use the new rolls. You can use Empowered Spell even if you have already used a different Metamagic option during the casting of the spell.' },
  { id: 'extended-spell', name: 'Extended Spell', sourceBook: 'PHB', cost: '1 sorcery point', description: 'When you cast a spell that has a duration of 1 minute or longer, you can spend 1 sorcery point to double its duration, to a maximum duration of 24 hours.' },
  { id: 'heightened-spell', name: 'Heightened Spell', sourceBook: 'PHB', cost: '3 sorcery points', description: 'When you cast a spell that forces a creature to make a saving throw to resist its effects, you can spend 3 sorcery points to give one target of the spell disadvantage on its first saving throw made against the spell.' },
  { id: 'quickened-spell', name: 'Quickened Spell', sourceBook: 'PHB', cost: '2 sorcery points', description: 'When you cast a spell that has a casting time of 1 action, you can spend 2 sorcery points to change the casting time to 1 bonus action for this casting.' },
  { id: 'subtle-spell', name: 'Subtle Spell', sourceBook: 'PHB', cost: '1 sorcery point', description: 'When you cast a spell, you can spend 1 sorcery point to cast it without any somatic or verbal components.' },
  { id: 'twinned-spell', name: 'Twinned Spell', sourceBook: 'PHB', cost: 'Spell level (1 minimum)', description: 'When you cast a spell that targets only one creature and doesn\'t have a range of self, you can spend a number of sorcery points equal to the spell\'s level to target a second creature in range with the same spell (1 sorcery point if the spell is a cantrip). To be eligible, a spell must be incapable of targeting more than one creature at the spell\'s current level.' },

  // XGtE
  { id: 'seeking-spell', name: 'Seeking Spell', sourceBook: 'XGtE', cost: '2 sorcery points', description: 'If you make an attack roll for a spell and miss, you can spend 2 sorcery points to reroll the d20, and you must use the new roll.' },

  // TCE
  { id: 'transmuted-spell', name: 'Transmuted Spell', sourceBook: 'TCE', cost: '1 sorcery point', description: 'When you cast a spell that deals a type of damage from the following list, you can spend 1 sorcery point to change that damage type to one of the others: acid, cold, fire, lightning, poison, thunder.' },
];

export function getMetamagic(id: string): Metamagic | undefined {
  return ALL_METAMAGIC.find(m => m.id === id);
}
