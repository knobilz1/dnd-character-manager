import type { ItemCategory } from '../types';

export interface StoreItem {
  name: string;
  category: ItemCategory;
  weight?: number;
  description?: string;
  priceCp: number;      // price in copper pieces
  priceLabel: string;   // human-readable, e.g. "5 sp"
  qty?: number;         // stack size added on purchase (default 1)
}

export interface StoreSection {
  label: string;
  items: StoreItem[];
}

export const TOWN_STORE: StoreSection[] = [
  {
    label: 'Provisions',
    items: [
      { name: 'Rations (1 day)',   category: 'consumable', weight: 2,   priceCp: 50,   priceLabel: '5 sp',  description: 'Dry food suitable for extended travel, including hard tack, dried fruit, and jerky.' },
      { name: 'Waterskin',         category: 'gear',       weight: 5,   priceCp: 20,   priceLabel: '2 sp',  description: 'Holds up to 4 pints of liquid. A full waterskin weighs 5 lb.' },
      { name: 'Torch',             category: 'gear',       weight: 1,   priceCp: 1,    priceLabel: '1 cp',  description: 'Burns for 1 hour, shedding bright light in a 20-ft. radius and dim light for an additional 20 ft.' },
      { name: 'Candle',            category: 'gear',       weight: 0,   priceCp: 1,    priceLabel: '1 cp',  description: 'Burns for 1 hour, shedding bright light in a 5-ft. radius and dim light for an additional 5 ft.' },
      { name: 'Oil (flask)',        category: 'consumable', weight: 1,   priceCp: 10,   priceLabel: '1 sp',  description: 'Fuels lanterns and lamps for 6 hours. Can be ignited as a splash weapon.' },
      { name: 'Lantern, hooded',   category: 'gear',       weight: 2,   priceCp: 500,  priceLabel: '5 gp',  description: 'Burns oil. Sheds bright light in a 30-ft. radius and dim light for an additional 30 ft. for 6 hours per flask.' },
    ],
  },
  {
    label: 'Healing & Medicine',
    items: [
      { name: 'Potion of Healing',  category: 'consumable', weight: 0.5, priceCp: 5000,  priceLabel: '50 gp',  description: 'Restores 2d4+2 hit points. Drinking or administering to another creature takes an action.' },
      { name: "Healer's kit",       category: 'gear',       weight: 3,   priceCp: 500,   priceLabel: '5 gp',   description: '10 uses. As an action, stabilize a dying creature without a Medicine check.' },
      { name: 'Antitoxin (vial)',   category: 'consumable', weight: 0,   priceCp: 5000,  priceLabel: '50 gp',  description: 'Advantage on saving throws against poison for 1 hour.' },
      { name: 'Holy water (flask)', category: 'consumable', weight: 1,   priceCp: 2500,  priceLabel: '25 gp',  description: 'Deals 2d6 radiant damage to fiends and undead on a hit. Action to splash or throw up to 20 ft.' },
      { name: 'Herbalism kit',      category: 'tool',       weight: 3,   priceCp: 500,   priceLabel: '5 gp',   description: 'Used to craft antitoxin and healing potions. Proficiency lets you identify plants.' },
    ],
  },
  {
    label: 'Ammunition',
    items: [
      { name: 'Arrows (20)',          category: 'consumable', weight: 1,   priceCp: 100, priceLabel: '1 gp',  description: 'Ammunition for shortbows and longbows. After battle, you can recover half your expended arrows.' },
      { name: 'Crossbow bolts (20)',  category: 'consumable', weight: 1.5, priceCp: 100, priceLabel: '1 gp',  description: 'Ammunition for all crossbows. After battle, you can recover half your expended bolts.' },
      { name: 'Sling bullets (20)',   category: 'consumable', weight: 1.5, priceCp: 4,   priceLabel: '4 cp',  description: 'Ammunition for slings.' },
      { name: 'Blowgun needles (50)', category: 'consumable', weight: 1,   priceCp: 100, priceLabel: '1 gp',  description: 'Ammunition for blowguns.' },
    ],
  },
  {
    label: 'Gear & Tools',
    items: [
      { name: 'Rope, hempen (50 feet)', category: 'gear', weight: 10,  priceCp: 100,  priceLabel: '1 gp',   description: '2 hit points. DC 17 Strength check to break.' },
      { name: 'Tinderbox',              category: 'gear', weight: 1,   priceCp: 50,   priceLabel: '5 sp',   description: 'Includes flint, steel, and tinder. Starting a fire takes 1 action (tinder nearby) or 1 minute.' },
      { name: 'Crowbar',                category: 'gear', weight: 5,   priceCp: 200,  priceLabel: '2 gp',   description: 'Grants advantage on Strength checks where leverage can be applied.' },
      { name: 'Grappling hook',         category: 'gear', weight: 4,   priceCp: 200,  priceLabel: '2 gp',   description: 'Allows climbing walls and scaling obstacles when combined with rope.' },
      { name: 'Hammer',                 category: 'gear', weight: 3,   priceCp: 100,  priceLabel: '1 gp',   description: 'Used to drive pitons and other small spikes.' },
      { name: 'Shovel',                 category: 'gear', weight: 5,   priceCp: 200,  priceLabel: '2 gp',   description: 'Used for digging.' },
      { name: 'Backpack',               category: 'gear', weight: 5,   priceCp: 200,  priceLabel: '2 gp',   description: 'Holds up to 30 lb. worth of equipment, with a capacity of 1 cubic foot.' },
      { name: 'Mirror, steel',          category: 'gear', weight: 0.5, priceCp: 500,  priceLabel: '5 gp',   description: 'A polished steel mirror, useful for seeing around corners or signaling.' },
      { name: "Thieves' tools",         category: 'tool', weight: 1,   priceCp: 2500, priceLabel: '25 gp',  description: 'Required to pick locks or disarm traps. Proficiency required.' },
      { name: "Climber's kit",          category: 'gear', weight: 12,  priceCp: 2500, priceLabel: '25 gp',  description: 'Pitons, boot tips, gloves, and harness. Action to anchor yourself — when anchored, you can\'t fall more than 25 ft from the anchor point or climb more than 25 ft away without undoing it.' },
      { name: 'Piton',                  category: 'gear', weight: 0.25,priceCp: 5,    priceLabel: '5 cp',   description: 'A metal spike hammered into rock or wood as an anchor for climbing.' },
      { name: 'Ink (1-ounce bottle)',   category: 'gear', weight: 0,   priceCp: 1000, priceLabel: '10 gp',  description: 'Black ink suitable for writing.' },
      { name: 'Parchment (one sheet)', category: 'gear', weight: 0,   priceCp: 10,   priceLabel: '1 sp',   description: 'A sheet of treated animal skin suitable for writing and maps.' },
    ],
  },
  {
    label: 'Spellcasting',
    items: [
      { name: 'Component pouch',             category: 'gear', weight: 2,  priceCp: 2500,  priceLabel: '25 gp',  description: 'A watertight leather belt pouch with compartments for material spellcasting components. Serves as a spellcasting focus.' },
      { name: 'Spellbook',                   category: 'gear', weight: 3,  priceCp: 5000,  priceLabel: '50 gp',  description: 'Holds up to 100 spells. Replacing one costs 10 gp and 2 days per spell level.' },
      { name: 'Arcane focus (crystal)',       category: 'gear', weight: 1,  priceCp: 1000,  priceLabel: '10 gp',  description: 'A specially constructed crystal used as a spellcasting focus.' },
      { name: 'Arcane focus (orb)',           category: 'gear', weight: 3,  priceCp: 2000,  priceLabel: '20 gp',  description: 'A specially constructed orb used as a spellcasting focus.' },
      { name: 'Arcane focus (wand)',          category: 'gear', weight: 1,  priceCp: 1000,  priceLabel: '10 gp',  description: 'A specially constructed wand used as a spellcasting focus.' },
      { name: 'Arcane focus (rod)',           category: 'gear', weight: 2,  priceCp: 1000,  priceLabel: '10 gp',  description: 'A specially constructed rod used as a spellcasting focus.' },
      { name: 'Arcane focus (staff)',         category: 'gear', weight: 4,  priceCp: 500,   priceLabel: '5 gp',   description: 'A specially constructed staff used as a spellcasting focus.' },
      { name: 'Holy symbol (amulet)',         category: 'gear', weight: 1,  priceCp: 500,   priceLabel: '5 gp',   description: 'An amulet depicting a deity\'s symbol, used as a divine spellcasting focus.' },
      { name: 'Holy symbol (emblem)',         category: 'gear', weight: 0,  priceCp: 500,   priceLabel: '5 gp',   description: 'A symbol emblazoned on a shield or cloak, used as a divine spellcasting focus.' },
      { name: 'Druidic focus (sprig of mistletoe)', category: 'gear', weight: 0, priceCp: 100, priceLabel: '1 gp', description: 'A sprig of mistletoe used as a druidic spellcasting focus.' },
      { name: 'Druidic focus (yew wand)',     category: 'gear', weight: 1,  priceCp: 1000,  priceLabel: '10 gp',  description: 'A yew wand used as a druidic spellcasting focus.' },
      { name: 'Druidic focus (wooden staff)', category: 'gear', weight: 4,  priceCp: 500,   priceLabel: '5 gp',   description: 'A wooden staff carved with nature symbols, used as a druidic spellcasting focus.' },
    ],
  },
  {
    label: 'Spell Components',
    items: [
      { name: 'Pearl',                   category: 'treasure', weight: 0, priceCp: 10000,   priceLabel: '100 gp',    description: 'Required component for Identify (100 gp pearl).' },
      { name: 'Diamond (50 gp)',         category: 'treasure', weight: 0, priceCp: 5000,    priceLabel: '50 gp',     description: 'Required component for Chromatic Orb.' },
      { name: 'Diamond (300 gp)',        category: 'treasure', weight: 0, priceCp: 30000,   priceLabel: '300 gp',    description: 'Required component for Revivify.' },
      { name: 'Diamond (500 gp)',        category: 'treasure', weight: 0, priceCp: 50000,   priceLabel: '500 gp',    description: 'Required component for Raise Dead.' },
      { name: 'Diamond (1,000 gp)',      category: 'treasure', weight: 0, priceCp: 100000,  priceLabel: '1,000 gp',  description: 'Required component for Resurrection and Clone.' },
      { name: 'Ivory & gem statuette (1,500 gp)', category: 'treasure', weight: 0, priceCp: 150000,  priceLabel: '1,500 gp',  description: 'Required component for Contingency. A statuette of yourself carved from ivory and decorated with gems.' },
      { name: 'Diamond (25,000 gp)',     category: 'treasure', weight: 0, priceCp: 2500000, priceLabel: '25,000 gp', description: 'Required component for True Resurrection.' },
      { name: 'Incense & herbs (10 gp)', category: 'consumable', weight: 0, priceCp: 1000,  priceLabel: '10 gp',    description: 'Required component for Find Familiar (charcoal, incense, and herbs worth 10 gp).' },
      { name: 'Powdered silver',         category: 'gear',     weight: 0, priceCp: 10000,   priceLabel: '100 gp',    description: 'Required component for Magic Circle (holy water or powdered silver and iron worth 100 gp).' },
      { name: 'Onyx (gem)',              category: 'treasure', weight: 0, priceCp: 15000,   priceLabel: '150 gp',    description: 'Required component for Create Undead (one 150 gp black onyx stone per corpse).' },
      { name: 'Jewel (1,000 gp)',        category: 'treasure', weight: 0, priceCp: 100000,  priceLabel: '1,000 gp',  description: 'Required component for Planar Binding. Consumed by the spell.' },
    ],
  },
  {
    label: 'Clothing',
    items: [
      { name: 'Clothes, common',    category: 'gear', weight: 3, priceCp: 50,   priceLabel: '5 sp',   description: 'Everyday clothing including a shirt, pants, shoes, and possibly a belt.' },
      { name: 'Traveler\'s clothes', category: 'gear', weight: 4, priceCp: 200,  priceLabel: '2 gp',   description: 'Sturdy clothing suited for long journeys, including a heavy cloak and boots.' },
      { name: 'Clothes, fine',      category: 'gear', weight: 6, priceCp: 1500, priceLabel: '15 gp',  description: 'Elegant clothing made of quality fabric, suitable for court or formal occasions.' },
      { name: 'Robes',              category: 'gear', weight: 4, priceCp: 100,  priceLabel: '1 gp',   description: 'Long, flowing ceremonial or scholarly robes.' },
    ],
  },
];
