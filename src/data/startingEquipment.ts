import type { ClassStartingEquipment } from '../types';

export const CLASS_STARTING_EQUIPMENT: ClassStartingEquipment[] = [
  {
    classId: 'barbarian',
    choices: [
      {
        label: 'Weapon',
        options: [
          { label: 'A greataxe', items: [{ name: 'Greataxe', category: 'weapon', weight: 7 }] },
          { label: 'Any martial melee weapon', items: [{ name: 'Martial melee weapon (your choice)', category: 'weapon' }] },
        ],
      },
      {
        // Independent of the first choice — these are backup / thrown weapons,
        // not an offhand weapon. A greataxe + two handaxes is a valid combo (PHB).
        label: 'Backup weapons',
        options: [
          { label: 'Two handaxes', items: [{ name: 'Handaxe', quantity: 2, category: 'weapon', weight: 2 }] },
          { label: 'Any simple weapon', items: [{ name: 'Simple weapon (your choice)', category: 'weapon' }] },
        ],
      },
    ],
    fixed: [
      { name: 'Explorer\'s pack', category: 'pack', weight: 59 },
      { name: 'Javelin', quantity: 4, category: 'weapon', weight: 2 },
    ],
    startingGold: '2d4 × 10 gp',
  },
  {
    classId: 'bard',
    choices: [
      {
        label: 'Primary weapon',
        options: [
          { label: 'A rapier', items: [{ name: 'Rapier', category: 'weapon', weight: 2 }] },
          { label: 'A longsword', items: [{ name: 'Longsword', category: 'weapon', weight: 3 }] },
          { label: 'Any simple weapon', items: [{ name: 'Simple weapon (your choice)', category: 'weapon' }] },
        ],
      },
      {
        label: 'Pack',
        options: [
          { label: 'A diplomat\'s pack', items: [{ name: 'Diplomat\'s pack', category: 'pack', weight: 39 }] },
          { label: 'An entertainer\'s pack', items: [{ name: 'Entertainer\'s pack', category: 'pack', weight: 38 }] },
        ],
      },
      {
        label: 'Instrument',
        options: [
          { label: 'A lute', items: [{ name: 'Lute', category: 'tool', weight: 2 }] },
          { label: 'Any other musical instrument', items: [{ name: 'Musical instrument (your choice)', category: 'tool' }] },
        ],
      },
    ],
    fixed: [
      { name: 'Leather armor', category: 'armor', weight: 10 },
      { name: 'Dagger', category: 'weapon', weight: 1 },
    ],
    startingGold: '5d4 × 10 gp',
  },
  {
    classId: 'cleric',
    choices: [
      {
        label: 'Primary weapon',
        options: [
          { label: 'A mace', items: [{ name: 'Mace', category: 'weapon', weight: 4 }] },
          { label: 'A warhammer (if proficient)', items: [{ name: 'Warhammer', category: 'weapon', weight: 2 }] },
        ],
      },
      {
        label: 'Armor',
        options: [
          { label: 'Scale mail', items: [{ name: 'Scale mail', category: 'armor', weight: 45 }] },
          { label: 'Leather armor', items: [{ name: 'Leather armor', category: 'armor', weight: 10 }] },
          { label: 'Chain mail (if proficient)', items: [{ name: 'Chain mail', category: 'armor', weight: 55 }] },
        ],
      },
      {
        label: 'Ranged option',
        options: [
          { label: 'Light crossbow & 20 bolts', items: [
            { name: 'Light crossbow', category: 'weapon', weight: 5 },
            { name: 'Crossbow bolt', quantity: 20, category: 'consumable' },
          ] },
          { label: 'Any simple weapon', items: [{ name: 'Simple weapon (your choice)', category: 'weapon' }] },
        ],
      },
      {
        label: 'Pack',
        options: [
          { label: 'A priest\'s pack', items: [{ name: 'Priest\'s pack', category: 'pack', weight: 24 }] },
          { label: 'An explorer\'s pack', items: [{ name: 'Explorer\'s pack', category: 'pack', weight: 59 }] },
        ],
      },
    ],
    fixed: [
      { name: 'Shield', category: 'shield', weight: 6 },
      { name: 'Holy symbol', category: 'gear', weight: 1 },
    ],
    startingGold: '5d4 × 10 gp',
  },
  {
    classId: 'druid',
    choices: [
      {
        label: 'Shield or simple weapon',
        options: [
          { label: 'A wooden shield', items: [{ name: 'Wooden shield', category: 'shield', weight: 6 }] },
          { label: 'Any simple weapon', items: [{ name: 'Simple weapon (your choice)', category: 'weapon' }] },
        ],
      },
      {
        label: 'Melee weapon',
        options: [
          { label: 'A scimitar', items: [{ name: 'Scimitar', category: 'weapon', weight: 3 }] },
          { label: 'Any simple melee weapon', items: [{ name: 'Simple melee weapon (your choice)', category: 'weapon' }] },
        ],
      },
    ],
    fixed: [
      { name: 'Leather armor', category: 'armor', weight: 10 },
      { name: 'Explorer\'s pack', category: 'pack', weight: 59 },
      { name: 'Druidic focus', category: 'gear', weight: 1 },
    ],
    startingGold: '2d4 × 10 gp',
  },
  {
    classId: 'fighter',
    choices: [
      {
        label: 'Armor',
        options: [
          { label: 'Chain mail', items: [{ name: 'Chain mail', category: 'armor', weight: 55 }] },
          { label: 'Leather armor, longbow, 20 arrows', items: [
            { name: 'Leather armor', category: 'armor', weight: 10 },
            { name: 'Longbow', category: 'weapon', weight: 2 },
            { name: 'Arrow', quantity: 20, category: 'consumable' },
          ] },
        ],
      },
      {
        label: 'Weapon',
        options: [
          { label: 'A martial weapon and a shield', items: [
            { name: 'Martial weapon (your choice)', category: 'weapon' },
            { name: 'Shield', category: 'shield', weight: 6 },
          ] },
          { label: 'Two martial weapons', items: [
            { name: 'Martial weapon (your choice)', quantity: 2, category: 'weapon' },
          ] },
        ],
      },
      {
        label: 'Ranged option',
        options: [
          { label: 'Light crossbow & 20 bolts', items: [
            { name: 'Light crossbow', category: 'weapon', weight: 5 },
            { name: 'Crossbow bolt', quantity: 20, category: 'consumable' },
          ] },
          { label: 'Two handaxes', items: [{ name: 'Handaxe', quantity: 2, category: 'weapon', weight: 2 }] },
        ],
      },
      {
        label: 'Pack',
        options: [
          { label: 'Dungeoneer\'s pack', items: [{ name: 'Dungeoneer\'s pack', category: 'pack', weight: 61.5 }] },
          { label: 'Explorer\'s pack', items: [{ name: 'Explorer\'s pack', category: 'pack', weight: 59 }] },
        ],
      },
    ],
    fixed: [],
    startingGold: '5d4 × 10 gp',
  },
  {
    classId: 'monk',
    choices: [
      {
        label: 'Weapon',
        options: [
          { label: 'A shortsword', items: [{ name: 'Shortsword', category: 'weapon', weight: 2 }] },
          { label: 'Any simple weapon', items: [{ name: 'Simple weapon (your choice)', category: 'weapon' }] },
        ],
      },
      {
        label: 'Pack',
        options: [
          { label: 'Dungeoneer\'s pack', items: [{ name: 'Dungeoneer\'s pack', category: 'pack', weight: 61.5 }] },
          { label: 'Explorer\'s pack', items: [{ name: 'Explorer\'s pack', category: 'pack', weight: 59 }] },
        ],
      },
    ],
    fixed: [{ name: 'Dart', quantity: 10, category: 'weapon', weight: 0.25 }],
    startingGold: '5d4 gp',
  },
  {
    classId: 'paladin',
    choices: [
      {
        label: 'Weapon',
        options: [
          { label: 'A martial weapon and a shield', items: [
            { name: 'Martial weapon (your choice)', category: 'weapon' },
            { name: 'Shield', category: 'shield', weight: 6 },
          ] },
          { label: 'Two martial weapons', items: [
            { name: 'Martial weapon (your choice)', quantity: 2, category: 'weapon' },
          ] },
        ],
      },
      {
        label: 'Ranged option',
        options: [
          { label: 'Five javelins', items: [{ name: 'Javelin', quantity: 5, category: 'weapon', weight: 2 }] },
          { label: 'Any simple melee weapon', items: [{ name: 'Simple melee weapon (your choice)', category: 'weapon' }] },
        ],
      },
      {
        label: 'Pack',
        options: [
          { label: 'Priest\'s pack', items: [{ name: 'Priest\'s pack', category: 'pack', weight: 24 }] },
          { label: 'Explorer\'s pack', items: [{ name: 'Explorer\'s pack', category: 'pack', weight: 59 }] },
        ],
      },
    ],
    fixed: [
      { name: 'Chain mail', category: 'armor', weight: 55 },
      { name: 'Holy symbol', category: 'gear', weight: 1 },
    ],
    startingGold: '5d4 × 10 gp',
  },
  {
    classId: 'ranger',
    choices: [
      {
        label: 'Armor',
        options: [
          { label: 'Scale mail', items: [{ name: 'Scale mail', category: 'armor', weight: 45 }] },
          { label: 'Leather armor', items: [{ name: 'Leather armor', category: 'armor', weight: 10 }] },
        ],
      },
      {
        label: 'Melee weapons',
        options: [
          { label: 'Two shortswords', items: [{ name: 'Shortsword', quantity: 2, category: 'weapon', weight: 2 }] },
          { label: 'Two simple melee weapons', items: [{ name: 'Simple melee weapon (your choice)', quantity: 2, category: 'weapon' }] },
        ],
      },
      {
        label: 'Pack',
        options: [
          { label: 'Dungeoneer\'s pack', items: [{ name: 'Dungeoneer\'s pack', category: 'pack', weight: 61.5 }] },
          { label: 'Explorer\'s pack', items: [{ name: 'Explorer\'s pack', category: 'pack', weight: 59 }] },
        ],
      },
    ],
    fixed: [
      { name: 'Longbow', category: 'weapon', weight: 2 },
      { name: 'Arrow', quantity: 20, category: 'consumable' },
      { name: 'Quiver', category: 'gear', weight: 1 },
    ],
    startingGold: '5d4 × 10 gp',
  },
  {
    classId: 'rogue',
    choices: [
      {
        label: 'Primary weapon',
        options: [
          { label: 'A rapier', items: [{ name: 'Rapier', category: 'weapon', weight: 2 }] },
          { label: 'A shortsword', items: [{ name: 'Shortsword', category: 'weapon', weight: 2 }] },
        ],
      },
      {
        label: 'Secondary weapon',
        options: [
          { label: 'A shortbow and quiver of 20 arrows', items: [
            { name: 'Shortbow', category: 'weapon', weight: 2 },
            { name: 'Arrow', quantity: 20, category: 'consumable' },
            { name: 'Quiver', category: 'gear', weight: 1 },
          ] },
          { label: 'A shortsword', items: [{ name: 'Shortsword', category: 'weapon', weight: 2 }] },
        ],
      },
      {
        label: 'Pack',
        options: [
          { label: 'Burglar\'s pack', items: [{ name: 'Burglar\'s pack', category: 'pack', weight: 46.5 }] },
          { label: 'Dungeoneer\'s pack', items: [{ name: 'Dungeoneer\'s pack', category: 'pack', weight: 61.5 }] },
          { label: 'Explorer\'s pack', items: [{ name: 'Explorer\'s pack', category: 'pack', weight: 59 }] },
        ],
      },
    ],
    fixed: [
      { name: 'Leather armor', category: 'armor', weight: 10 },
      { name: 'Dagger', quantity: 2, category: 'weapon', weight: 1 },
      { name: 'Thieves\' tools', category: 'tool', weight: 1 },
    ],
    startingGold: '4d4 × 10 gp',
  },
  {
    classId: 'sorcerer',
    choices: [
      {
        label: 'Primary weapon',
        options: [
          { label: 'A light crossbow and 20 bolts', items: [
            { name: 'Light crossbow', category: 'weapon', weight: 5 },
            { name: 'Crossbow bolt', quantity: 20, category: 'consumable' },
          ] },
          { label: 'Any simple weapon', items: [{ name: 'Simple weapon (your choice)', category: 'weapon' }] },
        ],
      },
      {
        label: 'Focus',
        options: [
          { label: 'Component pouch', items: [{ name: 'Component pouch', category: 'gear', weight: 2 }] },
          { label: 'Arcane focus', items: [{ name: 'Arcane focus (your choice)', category: 'gear', weight: 1 }] },
        ],
      },
      {
        label: 'Pack',
        options: [
          { label: 'Dungeoneer\'s pack', items: [{ name: 'Dungeoneer\'s pack', category: 'pack', weight: 61.5 }] },
          { label: 'Explorer\'s pack', items: [{ name: 'Explorer\'s pack', category: 'pack', weight: 59 }] },
        ],
      },
    ],
    fixed: [{ name: 'Dagger', quantity: 2, category: 'weapon', weight: 1 }],
    startingGold: '3d4 × 10 gp',
  },
  {
    classId: 'warlock',
    choices: [
      {
        label: 'Primary weapon',
        options: [
          { label: 'A light crossbow and 20 bolts', items: [
            { name: 'Light crossbow', category: 'weapon', weight: 5 },
            { name: 'Crossbow bolt', quantity: 20, category: 'consumable' },
          ] },
          { label: 'Any simple weapon', items: [{ name: 'Simple weapon (your choice)', category: 'weapon' }] },
        ],
      },
      {
        label: 'Focus',
        options: [
          { label: 'Component pouch', items: [{ name: 'Component pouch', category: 'gear', weight: 2 }] },
          { label: 'Arcane focus', items: [{ name: 'Arcane focus (your choice)', category: 'gear', weight: 1 }] },
        ],
      },
      {
        label: 'Pack',
        options: [
          { label: 'Scholar\'s pack', items: [{ name: 'Scholar\'s pack', category: 'pack', weight: 10 }] },
          { label: 'Dungeoneer\'s pack', items: [{ name: 'Dungeoneer\'s pack', category: 'pack', weight: 61.5 }] },
        ],
      },
    ],
    fixed: [
      { name: 'Leather armor', category: 'armor', weight: 10 },
      { name: 'Simple weapon (your choice)', category: 'weapon' },
      { name: 'Dagger', quantity: 2, category: 'weapon', weight: 1 },
    ],
    startingGold: '4d4 × 10 gp',
  },
  {
    classId: 'wizard',
    choices: [
      {
        label: 'Weapon',
        options: [
          { label: 'A quarterstaff', items: [{ name: 'Quarterstaff', category: 'weapon', weight: 4 }] },
          { label: 'A dagger', items: [{ name: 'Dagger', category: 'weapon', weight: 1 }] },
        ],
      },
      {
        label: 'Focus',
        options: [
          { label: 'Component pouch', items: [{ name: 'Component pouch', category: 'gear', weight: 2 }] },
          { label: 'Arcane focus', items: [{ name: 'Arcane focus (your choice)', category: 'gear', weight: 1 }] },
        ],
      },
      {
        label: 'Pack',
        options: [
          { label: 'Scholar\'s pack', items: [{ name: 'Scholar\'s pack', category: 'pack', weight: 10 }] },
          { label: 'Explorer\'s pack', items: [{ name: 'Explorer\'s pack', category: 'pack', weight: 59 }] },
        ],
      },
    ],
    fixed: [{ name: 'Spellbook', category: 'gear', weight: 3 }],
    startingGold: '4d4 × 10 gp',
  },
  {
    classId: 'artificer',
    choices: [
      {
        label: 'Primary weapon',
        options: [
          { label: 'Any two simple weapons', items: [{ name: 'Simple weapon (your choice)', quantity: 2, category: 'weapon' }] },
          { label: 'A light crossbow and 20 bolts', items: [
            { name: 'Light crossbow', category: 'weapon', weight: 5 },
            { name: 'Crossbow bolt', quantity: 20, category: 'consumable' },
          ] },
        ],
      },
      {
        label: 'Tool focus',
        options: [
          { label: 'Thieves\' tools', items: [{ name: 'Thieves\' tools', category: 'tool', weight: 1 }] },
          { label: 'Any artisan\'s tools', items: [{ name: 'Artisan\'s tools (your choice)', category: 'tool', weight: 5 }] },
        ],
      },
      {
        label: 'Pack',
        options: [
          { label: 'Dungeoneer\'s pack', items: [{ name: 'Dungeoneer\'s pack', category: 'pack', weight: 61.5 }] },
          { label: 'Explorer\'s pack', items: [{ name: 'Explorer\'s pack', category: 'pack', weight: 59 }] },
        ],
      },
    ],
    fixed: [
      { name: 'Studded leather armor', category: 'armor', weight: 13 },
      { name: 'Tinker\'s tools', category: 'tool', weight: 10 },
    ],
    startingGold: '5d4 × 10 gp',
  },
];

export function getClassStartingEquipment(classId: string): ClassStartingEquipment | undefined {
  return CLASS_STARTING_EQUIPMENT.find(e => e.classId === classId);
}
