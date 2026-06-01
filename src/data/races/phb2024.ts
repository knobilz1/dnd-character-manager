import type { Race } from '../../types';

/**
 * PHB 2024 Species
 * No fixed ASI — all species use the flexible +2/+1 or +1/+1/+1 system chosen at character creation.
 * Species replace "races" in 2024 terminology.
 */
export const PHB2024_RACES: Race[] = [
  // ─── Aasimar ───────────────────────────────────────────────────────────────
  {
    id: 'aasimar-2024',
    name: 'Aasimar',
    sourceBook: 'PHB2024',
    size: 'Medium',
    speed: 30,
    abilityScoreIncreases: {},
    darkvision: 60,
    resistances: ['necrotic', 'radiant'],
    languages: ['Common', 'one extra language'],
    isSubrace: false,
    traits: [
      { name: 'Flexible ASI (2024)', description: 'Increase one ability score by 2 and another by 1, or increase three different scores by 1 each.' },
      { name: 'Celestial Resistance', description: 'You have Resistance to Necrotic and Radiant damage.' },
      { name: 'Darkvision', description: 'You have Darkvision with a range of 60 feet.' },
      { name: 'Healing Hands', description: 'As a Magic action, you can touch a creature and roll a number of d4s equal to your Proficiency Bonus. The creature regains a number of Hit Points equal to the total rolled. Once you use this trait, you can\'t use it again until you finish a Long Rest.' },
      { name: 'Light Bearer', description: 'You know the Light cantrip. Charisma is your spellcasting ability for it.' },
      { name: 'Celestial Revelation (Level 3)', description: 'Starting at level 3, you can use a Bonus Action to transform for 1 minute (once per Long Rest). Choose one form each use: Heavenly Wings (Fly Speed = Speed; extra Radiant damage = Prof Bonus once per turn); Inner Radiance (shed Bright Light 10 ft + Dim 10 ft; creatures within 10 ft take Radiant = Prof Bonus at end of your turns); or Necrotic Shroud (creatures within 10 ft Cha save DC 8+Cha+Prof or Frightened until end of your next turn; +Necrotic damage = Prof Bonus once per turn).' },
    ],
  },

  // ─── Dragonborn ────────────────────────────────────────────────────────────
  {
    id: 'dragonborn-2024',
    name: 'Dragonborn',
    sourceBook: 'PHB2024',
    size: 'Medium',
    speed: 30,
    abilityScoreIncreases: {},
    darkvision: 60,
    languages: ['Common', 'Draconic'],
    isSubrace: false,
    traits: [
      { name: 'Flexible ASI (2024)', description: 'Increase one ability score by 2 and another by 1, or increase three different scores by 1 each.' },
      { name: 'Draconic Ancestry', description: 'Choose a dragon type: Black/Copper (Acid), Blue/Bronze (Lightning), Brass/Gold/Red (Fire), Green (Poison), Silver/White (Cold). Determines your Breath Weapon damage type and Damage Resistance.' },
      { name: 'Breath Weapon', description: 'When you take the Attack action, replace one attack with an exhalation: 15-ft Cone or 30-ft Line (5 ft wide). Each creature makes a Dex save (DC 8 + Con mod + Prof Bonus). Fail: 1d10 damage (ancestry type); success: half. Scales: 2d10 at level 5, 3d10 at 11, 4d10 at 17. Uses = Prof Bonus; all regain on Long Rest.' },
      { name: 'Damage Resistance', description: 'You have Resistance to the damage type associated with your Draconic Ancestry.' },
      { name: 'Darkvision', description: 'You have Darkvision with a range of 60 feet.' },
      { name: 'Draconic Flight (Level 5)', description: 'Starting at level 5, as a Bonus Action you can sprout spectral wings, gaining a Fly Speed equal to your Speed for 10 minutes. Once per Long Rest.' },
    ],
  },

  // ─── Dwarf ─────────────────────────────────────────────────────────────────
  {
    id: 'dwarf-2024',
    name: 'Dwarf',
    sourceBook: 'PHB2024',
    size: 'Medium',
    speed: 30,
    abilityScoreIncreases: {},
    darkvision: 120,
    resistances: ['poison'],
    languages: ['Common', 'Dwarvish'],
    isSubrace: false,
    traits: [
      { name: 'Flexible ASI (2024)', description: 'Increase one ability score by 2 and another by 1, or increase three different scores by 1 each.' },
      { name: 'Darkvision', description: 'You have Darkvision with a range of 120 feet.' },
      { name: 'Dwarven Resilience', description: 'You have Resistance to Poison damage and Advantage on saving throws to avoid or end the Poisoned condition.' },
      { name: 'Dwarven Toughness', description: 'Your Hit Point maximum increases by 1, and it increases by 1 again whenever you gain a level.' },
      { name: 'Stonecunning', description: 'As a Bonus Action, you gain Tremorsense with a range of 60 feet for 10 minutes (must be on or touching a stone surface). Uses = Prof Bonus; all regained on Long Rest.' },
    ],
    hpBonusPerLevel: 1,
  },

  // ─── Elf ───────────────────────────────────────────────────────────────────
  {
    id: 'elf-2024',
    name: 'Elf',
    sourceBook: 'PHB2024',
    size: 'Medium',
    speed: 30,
    abilityScoreIncreases: {},
    darkvision: 60,
    languages: ['Common', 'Elvish'],
    isSubrace: false,
    traits: [
      { name: 'Flexible ASI (2024)', description: 'Increase one ability score by 2 and another by 1, or increase three different scores by 1 each.' },
      { name: 'Darkvision', description: 'You have Darkvision with a range of 60 feet.' },
      { name: 'Elven Lineage', description: 'Choose one lineage — each grants a level 1 benefit and prepared spells (cast once/Long Rest or use slots; Int/Wis/Cha spellcasting, chosen at selection): Drow (Darkvision 120 ft, Dancing Lights; level 3: Faerie Fire; level 5: Darkness); High Elf (Prestidigitation cantrip, replaceable on Long Rest; level 3: Detect Magic; level 5: Misty Step); Wood Elf (Speed 35 ft, Druidcraft; level 3: Longstrider; level 5: Pass without Trace).' },
      { name: 'Fey Ancestry', description: 'You have Advantage on saving throws to avoid or end the Charmed condition.' },
      { name: 'Keen Senses', description: 'You have proficiency in the Insight, Perception, or Survival skill (choose one).' },
      { name: 'Trance', description: 'You don\'t need to sleep. Magic can\'t put you to sleep. You can finish a Long Rest in 4 hours of trancelike meditation while retaining consciousness.' },
    ],
  },

  // ─── Gnome ─────────────────────────────────────────────────────────────────
  {
    id: 'gnome-2024',
    name: 'Gnome',
    sourceBook: 'PHB2024',
    size: 'Small',
    speed: 30,
    abilityScoreIncreases: {},
    darkvision: 60,
    languages: ['Common', 'Gnomish'],
    isSubrace: false,
    traits: [
      { name: 'Flexible ASI (2024)', description: 'Increase one ability score by 2 and another by 1, or increase three different scores by 1 each.' },
      { name: 'Darkvision', description: 'You have Darkvision with a range of 60 feet.' },
      { name: 'Gnomish Cunning', description: 'You have Advantage on Intelligence, Wisdom, and Charisma saving throws.' },
      { name: 'Gnomish Lineage', description: 'Choose one (spellcasting ability: Int/Wis/Cha, chosen at selection): Forest Gnome — know Minor Illusion; always have Speak with Animals prepared (cast without slot = Prof Bonus times/Long Rest, or use slots); Rock Gnome — know Mending and Prestidigitation; spend 10 min casting Prestidigitation to create a Tiny clockwork device (AC 5, 1 HP, one Prestidigitation effect; max 3 at a time, each lasts 8 hrs).' },
    ],
  },

  // ─── Goliath ───────────────────────────────────────────────────────────────
  {
    id: 'goliath-2024',
    name: 'Goliath',
    sourceBook: 'PHB2024',
    size: 'Medium',
    speed: 35,
    abilityScoreIncreases: {},
    languages: ['Common', 'Giant'],
    isSubrace: false,
    traits: [
      { name: 'Flexible ASI (2024)', description: 'Increase one ability score by 2 and another by 1, or increase three different scores by 1 each.' },
      { name: 'Giant Ancestry', description: 'Choose one boon (uses = Prof Bonus; regain on Long Rest): Cloud\'s Jaunt — Bonus Action: teleport 30 ft to unoccupied space you can see; Fire\'s Burn — on hit dealing damage, deal +1d10 Fire; Frost\'s Chill — on hit dealing damage, deal +1d6 Cold and reduce target Speed by 10 ft until your next turn starts; Hill\'s Tumble — on hit dealing damage to Large-or-smaller creature, give it the Prone condition; Stone\'s Endurance — Reaction when taking damage: roll 1d12 + Con mod and reduce the damage by that total; Storm\'s Thunder — Reaction when a creature within 60 ft hits you: deal 1d8 Thunder to that creature.' },
      { name: 'Large Form (Level 5)', description: 'Starting at level 5, as a Bonus Action you can change size to Large for 10 minutes (Advantage on Strength checks, Speed +10 ft). Once per Long Rest.' },
      { name: 'Powerful Build', description: 'Advantage on saves to end the Grappled condition. Count as one size larger when determining carrying capacity.' },
    ],
  },

  // ─── Halfling ──────────────────────────────────────────────────────────────
  {
    id: 'halfling-2024',
    name: 'Halfling',
    sourceBook: 'PHB2024',
    size: 'Small',
    speed: 30,
    abilityScoreIncreases: {},
    languages: ['Common', 'one extra language'],
    isSubrace: false,
    traits: [
      { name: 'Flexible ASI (2024)', description: 'Increase one ability score by 2 and another by 1, or increase three different scores by 1 each.' },
      { name: 'Brave', description: 'You have Advantage on saving throws to avoid or end the Frightened condition.' },
      { name: 'Halfling Nimbleness', description: 'You can move through the space of any creature that is a size larger than you, but you can\'t stop in the same space.' },
      { name: 'Luck', description: 'When you roll a 1 on the d20 of a D20 Test, you can reroll the die and must use the new roll.' },
      { name: 'Naturally Stealthy', description: 'You can take the Hide action even when obscured only by a creature that is at least one size larger than you.' },
    ],
  },

  // ─── Human ─────────────────────────────────────────────────────────────────
  {
    id: 'human-2024',
    name: 'Human',
    sourceBook: 'PHB2024',
    size: 'Medium',
    speed: 30,
    abilityScoreIncreases: {},
    languages: ['Common', 'one extra language'],
    isSubrace: false,
    traits: [
      { name: 'Flexible ASI (2024)', description: 'Increase one ability score by 2 and another by 1, or increase three different scores by 1 each.' },
      { name: 'Size Choice', description: 'Your size is Medium (4–7 ft) or Small (2–4 ft), chosen when you select this species.' },
      { name: 'Resourceful', description: 'You gain Heroic Inspiration whenever you finish a Long Rest.' },
      { name: 'Skillful', description: 'You gain proficiency in one skill of your choice.' },
      { name: 'Versatile', description: 'You gain an Origin feat of your choice (see Chapter 5 feats). Skilled is recommended.' },
    ],
  },

  // ─── Orc ───────────────────────────────────────────────────────────────────
  {
    id: 'orc-2024',
    name: 'Orc',
    sourceBook: 'PHB2024',
    size: 'Medium',
    speed: 30,
    abilityScoreIncreases: {},
    darkvision: 120,
    languages: ['Common', 'Orc'],
    isSubrace: false,
    traits: [
      { name: 'Flexible ASI (2024)', description: 'Increase one ability score by 2 and another by 1, or increase three different scores by 1 each.' },
      { name: 'Adrenaline Rush', description: 'As a Bonus Action, you can take the Dash action and gain Temporary Hit Points equal to your Proficiency Bonus. Uses = Prof Bonus; all regained on Short or Long Rest.' },
      { name: 'Darkvision', description: 'You have Darkvision with a range of 120 feet.' },
      { name: 'Relentless Endurance', description: 'When you are reduced to 0 Hit Points but not killed outright, you can drop to 1 HP instead. Once per Long Rest.' },
    ],
  },

  // ─── Tiefling ──────────────────────────────────────────────────────────────
  {
    id: 'tiefling-2024',
    name: 'Tiefling',
    sourceBook: 'PHB2024',
    size: 'Medium',
    speed: 30,
    abilityScoreIncreases: {},
    darkvision: 60,
    languages: ['Common', 'Infernal'],
    isSubrace: false,
    traits: [
      { name: 'Flexible ASI (2024)', description: 'Increase one ability score by 2 and another by 1, or increase three different scores by 1 each.' },
      { name: 'Darkvision', description: 'You have Darkvision with a range of 60 feet.' },
      { name: 'Fiendish Legacy', description: 'Choose one legacy (spellcasting ability: Int/Wis/Cha, chosen at selection): Abyssal — Resistance to Poison; know Poison Spray; level 3: Ray of Sickness; level 5: Hold Person. Chthonic — Resistance to Necrotic; know Chill Touch; level 3: False Life; level 5: Ray of Enfeeblement. Infernal — Resistance to Fire; know Fire Bolt; level 3: Hellish Rebuke; level 5: Darkness. Each level 3/5 spell always prepared, cast once without slot per Long Rest (can use slots).' },
      { name: 'Otherworldly Presence', description: 'You know the Thaumaturgy cantrip. Charisma is your spellcasting ability for it.' },
    ],
  },
];
