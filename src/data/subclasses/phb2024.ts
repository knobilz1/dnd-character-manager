import type { Subclass } from '../../types';

export const PHB2024_SUBCLASSES: Subclass[] = [

  // ═══════════════════════════ BARBARIAN ════════════════════════════════════

  { id: 'berserker-2024', name: 'Path of the Berserker', classId: 'barbarian-2024', sourceBook: 'PHB2024',
    description: 'The Path of the Berserker channels fury into overwhelming aggression.',
    features: [
      { name: 'Frenzy', level: 3, description: 'When you use Reckless Attack while Raging: your first successful Strength melee hit that turn deals extra damage equal to a number of d6s = your Rage Damage bonus (same damage type as the weapon).' },
      { name: 'Mindless Rage', level: 6, description: 'You are Immune to the Charmed and Frightened conditions while Raging. If you have those conditions when you enter Rage, they end on you.' },
      { name: 'Retaliation', level: 10, description: 'When you take damage from a creature within 5 feet of you, you can use your Reaction to make one melee weapon attack against that creature.' },
      { name: 'Intimidating Presence', level: 14, description: 'Bonus Action: 30-ft Emanation — each creature you choose makes a Wis save (DC 8+Str mod+Prof) or has the Frightened condition for 1 min (repeat save end of each turn). Once per Long Rest; restore by expending a Rage use (no action).' },
    ],
  },

  { id: 'wild-heart', name: 'Path of the Wild Heart', classId: 'barbarian-2024', sourceBook: 'PHB2024',
    description: 'Draw power from the spirits of wild beasts.',
    features: [
      { name: 'Animal Speaker', level: 3, description: 'Cast Beast Sense and Speak with Animals as Rituals (Wisdom spellcasting ability).' },
      { name: 'Rage of the Wilds', level: 3, description: 'On each Rage activation, choose one: Bear (Resistance to all damage except Force, Necrotic, Psychic, Radiant); Eagle (Disengage + Dash both part of Rage Bonus Action; can take both as BA while Raging); Wolf (allies have Advantage on melee attacks vs. enemies within 5 ft of you while Raging).' },
      { name: 'Aspect of the Wilds', level: 6, description: 'Choose one (change on Long Rest): Owl — Darkvision 60 ft or +60 ft; Panther — Climb Speed = Speed; Salmon — Swim Speed = Speed.' },
      { name: 'Nature Speaker', level: 10, description: 'Cast Commune with Nature as a Ritual (Wisdom).' },
      { name: 'Power of the Wilds', level: 14, description: 'On each Rage activation, also choose one: Falcon (Fly Speed = Speed, must not be wearing armor); Lion (enemies within 5 ft Disadvantage on attacks vs. non-you targets); Ram (hit Large-or-smaller with melee → target knocked Prone).' },
    ],
  },

  { id: 'world-tree', name: 'Path of the World Tree', classId: 'barbarian-2024', sourceBook: 'PHB2024',
    description: 'Channel the vast power of Yggdrasil, the World Tree.',
    features: [
      { name: 'Vitality of the Tree', level: 3, description: 'On Rage activation: gain Temp HP = Barbarian level. While Raging, start of each turn: choose a creature within 10 ft → give it Temp HP = total of your Rage Damage bonus dice (vanish when Rage ends).' },
      { name: 'Branches of the Tree', level: 6, description: 'Reaction when a creature you can see starts its turn within 30 ft while Raging: Str save (DC 8+Str mod+Prof) or teleport to unoccupied space within 5 ft of you (or nearest). Can also reduce its Speed to 0 until end of its turn.' },
      { name: 'Battering Roots', level: 10, description: 'Your reach increases by 10 ft with Heavy or Versatile melee weapons. Hits with those weapons can use Push or Topple mastery in addition to the weapon\'s normal mastery.' },
      { name: 'Travel Along the Tree', level: 14, description: 'On Rage activation and as Bonus Action while Raging: teleport 60 ft to an unoccupied space you can see. Once per Rage, expand to 150 ft and bring up to 6 willing creatures within 10 ft (each to unoccupied space within 10 ft of destination).' },
    ],
  },

  { id: 'zealot-2024', name: 'Path of the Zealot', classId: 'barbarian-2024', sourceBook: 'PHB2024',
    description: 'Channel divine fury into devastating combat prowess.',
    features: [
      { name: 'Divine Fury', level: 3, description: 'While Raging: first hit on each turn with a weapon or Unarmed Strike deals +1d6 + ½ Barbarian level extra Necrotic or Radiant damage (your choice each hit).' },
      { name: 'Warrior of the Gods', level: 3, description: 'Pool of 4d12s (increases: 5d12 at level 6, 6d12 at 12, 7d12 at 17). Bonus Action: expend any number, roll them, regain that many HP. Regain all dice on Long Rest.' },
      { name: 'Fanatical Focus', level: 6, description: 'Once per active Rage, if you fail a save, reroll it with a bonus equal to your Rage Damage bonus; must use the new roll.' },
      { name: 'Zealous Presence', level: 10, description: 'Bonus Action: up to 10 allies within 60 ft gain Advantage on attacks and saves until start of your next turn. Once per Long Rest; restore with a Rage use (no action).' },
      { name: 'Rage of the Gods', level: 14, description: 'On Rage activation, assume divine warrior form (1 min or 0 HP; once per Long Rest): Fly Speed = Speed + hover; Resistance to Necrotic, Psychic, Radiant. Reaction (expend Rage use): when creature within 30 ft drops to 0 HP, set HP to Barbarian level instead.' },
    ],
  },

  // ═══════════════════════════ BARD ═════════════════════════════════════════

  { id: 'college-of-dance', name: 'College of Dance', classId: 'bard-2024', sourceBook: 'PHB2024',
    description: 'Weave dance and combat into magical performance.',
    features: [
      { name: 'Dazzling Footwork', level: 3, description: 'While wearing no armor or shield: Advantage on Cha (Performance) involving dance; Unarmored Defense (AC = 10+Dex+Cha). Agile Strikes: when spending a Bardic Inspiration die (action/BA/Reaction), make one Unarmed Strike as part of same. Bardic Damage: Unarmed Strikes use Dex; damage = Bardic die roll + Dex mod Bludgeoning (doesn\'t expend die).' },
      { name: 'Inspiring Movement', level: 6, description: 'Reaction + 1 Bardic Inspiration use when an enemy ends turn within 5 ft of you: move up to half your Speed + 1 ally within 30 ft can Reaction-move up to half their Speed. No OAs provoked.' },
      { name: 'Tandem Footwork', level: 6, description: 'Roll Initiative without being Incapacitated: expend 1 Bardic Inspiration die, roll it — you and all allies within 30 ft who hear/see you gain that result as a bonus to Initiative.' },
      { name: 'Leading Evasion', level: 14, description: 'When subjected to a Dex save for half damage: no damage on success, half on fail. Can share benefit with up to 2 creatures within 5 ft making same save. Not usable while Incapacitated.' },
    ],
  },

  { id: 'college-of-glamour-2024', name: 'College of Glamour', classId: 'bard-2024', sourceBook: 'PHB2024',
    description: 'Wield the beguiling magic of the Feywild.',
    features: [
      { name: 'Beguiling Magic', level: 3, description: 'Always have Charm Person and Mirror Image prepared. After casting an Enchantment/Illusion with a slot: 1 creature within 60 ft makes a Wis save or is Charmed or Frightened (your choice) for 1 min (repeat save end of turns). Once per Long Rest; restore by expending 1 Bardic Inspiration (no action).' },
      { name: 'Mantle of Inspiration', level: 3, description: 'Bonus Action + 1 Bardic Inspiration die: roll it; up to Cha mod (min 1) creatures within 60 ft each gain Temp HP = 2× roll and can Reaction-move up to their Speed (no OAs).' },
      { name: 'Mantle of Majesty', level: 6, description: 'Always have Command prepared. Bonus Action: cast Command without a slot + assume unearthly appearance for 1 min. While active: cast Command as Bonus Action without slot each turn. Creatures Charmed by you auto-fail saves vs. this Command. Once per Long Rest; restore with level 3+ slot (no action).' },
      { name: 'Unbreakable Majesty', level: 14, description: 'Bonus Action: majestic presence for 1 min (or Incapacitated). First time per turn an attacker targets you with an attack: Cha save (spell save DC) or attack misses. Once per Short/Long Rest.' },
    ],
    alwaysPreparedSpells: { 3: ['charm-person', 'mirror-image'] },
  },

  { id: 'college-of-lore-2024', name: 'College of Lore', classId: 'bard-2024', sourceBook: 'PHB2024',
    description: 'A repository of secret knowledge and cutting wit.',
    features: [
      { name: 'Bonus Proficiencies', level: 3, description: 'Gain proficiency in 3 skills of your choice.' },
      { name: 'Cutting Words', level: 3, description: 'Reaction when a creature within 60 ft makes a damage roll or succeeds on an ability check or attack roll: expend 1 Bardic Inspiration die, roll it, subtract from the roll. Can be used after seeing the result.' },
      { name: 'Magical Discoveries', level: 6, description: 'Learn 2 spells from the Cleric, Druid, or Wizard spell lists (must be cantrips or level ≤ slot level). Always prepared as Bard spells; can replace one on level-up.' },
      { name: 'Peerless Skill', level: 14, description: 'When you fail an ability check or attack roll: expend 1 Bardic Inspiration die, roll it, add to your d20 (potentially turning failure into success). On failure, the die is not expended.' },
    ],
  },

  { id: 'college-of-valor-2024', name: 'College of Valor', classId: 'bard-2024', sourceBook: 'PHB2024',
    description: 'Combine martial mastery with bard inspiration.',
    features: [
      { name: 'Combat Inspiration', level: 3, description: 'Creature with your Bardic Inspiration die can use it two ways: Defense — Reaction when hit: roll die, add to AC against that attack; Offense — after hitting with attack: roll die, add to damage roll.' },
      { name: 'Martial Training', level: 3, description: 'Proficiency with Martial weapons, Medium armor, and Shields. Can use a Simple or Martial weapon as your spellcasting focus.' },
      { name: 'Extra Attack', level: 6, description: 'Attack twice with the Attack action. Can replace one attack with a cantrip (action casting time).' },
      { name: 'Battle Magic', level: 14, description: 'After casting a spell that uses your action, make 1 weapon attack as a Bonus Action.' },
    ],
  },

  // ═══════════════════════════ CLERIC ════════════════════════════════════════

  { id: 'life-domain-2024', name: 'Life Domain', classId: 'cleric-2024', sourceBook: 'PHB2024',
    description: 'Channeling vibrant positive energy, the Life Domain focuses on healing and preservation.',
    features: [
      { name: 'Disciple of Life', level: 3, description: 'When a spell you cast with a slot restores HP: that creature regains extra HP = 2 + slot level (on the turn cast).' },
      { name: 'Preserve Life', level: 3, description: 'Magic action + Channel Divinity: restore HP total = 5× Cleric level, distributed among Bloodied creatures within 30 ft (max half HP max per creature).' },
      { name: 'Blessed Healer', level: 6, description: 'After casting a slot spell that heals other creatures, you regain HP = 2 + slot level.' },
      { name: 'Supreme Healing', level: 17, description: 'When rolling dice to restore HP with a spell or Channel Divinity, use the maximum value on each die instead of rolling.' },
    ],
    alwaysPreparedSpells: { 3: ['aid', 'bless', 'cure-wounds', 'lesser-restoration'], 5: ['mass-healing-word', 'revivify'], 7: ['aura-of-life', 'death-ward'], 9: ['greater-restoration', 'mass-cure-wounds'] },
  },

  { id: 'light-domain-2024', name: 'Light Domain', classId: 'cleric-2024', sourceBook: 'PHB2024',
    description: 'Wield the power of radiance and fire against darkness.',
    features: [
      { name: 'Radiance of the Dawn', level: 3, description: 'Magic action + Channel Divinity: 30-ft Emanation. Dispels magical Darkness. Each creature you choose in the area: Con save → fail = 2d10+Cleric level Radiant damage; success = half.' },
      { name: 'Warding Flare', level: 3, description: 'Reaction when a creature within 30 ft makes an attack roll: impose Disadvantage on that roll. Uses = Wis mod (min 1); regain all on Long Rest.' },
      { name: 'Improved Warding Flare', level: 6, description: 'Regain Warding Flare uses on Short or Long Rest. When using it: also give the target Temp HP = 2d6+Wis mod.' },
      { name: 'Corona of Light', level: 17, description: 'Magic action: emit sunlight aura for 1 min (or dismiss, no action). Bright Light 60 ft, Dim 30 ft. Enemies in Bright Light: Disadvantage on saves vs. your Radiance of the Dawn and any Fire/Radiant spells you cast. Uses = Wis mod (min 1); regain all on Long Rest.' },
    ],
    alwaysPreparedSpells: { 3: ['burning-hands', 'faerie-fire', 'scorching-ray', 'see-invisibility'], 5: ['daylight', 'fireball'], 7: ['arcane-eye', 'wall-of-fire'], 9: ['flame-strike', 'scrying'] },
  },

  { id: 'trickery-domain-2024', name: 'Trickery Domain', classId: 'cleric-2024', sourceBook: 'PHB2024',
    description: 'Deception and misdirection are your divine gifts.',
    features: [
      { name: 'Blessing of the Trickster', level: 3, description: 'Magic action: you or a willing creature within 30 ft gains Advantage on Dex (Stealth) checks until your next Long Rest or until used again.' },
      { name: 'Invoke Duplicity', level: 3, description: 'Bonus Action + Channel Divinity: create a visual illusion of yourself in an unoccupied space within 30 ft (lasts 1 min). Benefits: cast spells as if in illusion\'s space; Advantage on attacks vs. creatures within 5 ft of illusion; Bonus Action to move illusion 30 ft.' },
      { name: 'Trickster\'s Transposition', level: 6, description: 'When you Bonus-Action-move your Invoke Duplicity illusion, you can teleport to swap places with it instead.' },
      { name: 'Improved Duplicity', level: 17, description: 'Shared Distraction: you and allies have Advantage on attacks vs. creatures within 5 ft of your illusion. Healing Illusion: when the illusion ends, you or a creature within 5 ft regains HP = Cleric level.' },
    ],
    alwaysPreparedSpells: { 3: ['charm-person', 'disguise-self', 'invisibility', 'pass-without-trace'], 5: ['hypnotic-pattern', 'nondetection'], 7: ['confusion', 'dimension-door'], 9: ['dominate-person', 'modify-memory'] },
  },

  { id: 'war-domain-2024', name: 'War Domain', classId: 'cleric-2024', sourceBook: 'PHB2024',
    description: 'Martial prowess and divine power combine in the War Domain.',
    features: [
      { name: 'War Priest', level: 3, description: 'Bonus Action: make one weapon attack or Unarmed Strike. Uses = Wis mod (min 1); regain on Short or Long Rest.' },
      { name: 'Guided Strike', level: 3, description: 'Channel Divinity + Reaction when a creature misses an attack roll: add +10 to that roll, potentially turning the miss into a hit.' },
      { name: 'War God\'s Blessing', level: 6, description: 'Expend Channel Divinity to cast Shield of Faith or Spiritual Weapon without a spell slot. The spell requires no Concentration and lasts 1 minute (ends if cast again, you are Incapacitated, or you die).' },
      { name: 'Avatar of Battle', level: 17, description: 'Resistance to Bludgeoning, Piercing, and Slashing damage from nonmagical attacks.' },
    ],
    alwaysPreparedSpells: { 3: ['guiding-bolt', 'magic-weapon', 'shield-of-faith', 'spiritual-weapon'], 5: ['crusaders-mantle', 'spirit-guardians'], 7: ['fire-shield', 'freedom-of-movement'], 9: ['hold-monster', 'steel-wind-strike'] },
  },

  // ═══════════════════════════ DRUID ═════════════════════════════════════════

  { id: 'circle-of-the-land-2024', name: 'Circle of the Land', classId: 'druid-2024', sourceBook: 'PHB2024',
    description: 'Draw power from the natural world and a particular terrain.',
    features: [
      { name: 'Land\'s Aid', level: 3, description: 'Magic action + Wild Shape use: create a 10-ft Sphere within 60 ft. Each chosen creature: Con save or 2d6 Necrotic (half on success); 1 chosen creature regains 2d6 HP. Scales: 3d6 at level 10, 4d6 at level 14.' },
      { name: 'Natural Recovery', level: 6, description: 'On each Long Rest: cast one of your Circle Spells once without a spell slot. Also, on a Short Rest: recover spell slots totaling ≤ half Druid level (round up), no slot level 6+. Once per Long Rest.' },
      { name: 'Nature\'s Ward', level: 10, description: 'Immunity to the Poisoned condition. Resistance to damage type matching your current land type (Arid→Fire, Polar→Cold, Temperate→Lightning, Tropical→Poison).' },
      { name: 'Nature\'s Sanctuary', level: 14, description: 'Magic action + Wild Shape use: create a 15-ft Cube on the ground within 120 ft for 1 min (or Incapacitated/death). You and allies have Half Cover inside; allies gain your Nature\'s Ward Resistance there. Bonus Action: move the Cube up to 60 ft (must remain within 120 ft of you).' },
    ],
  },

  { id: 'circle-of-the-moon-2024', name: 'Circle of the Moon', classId: 'druid-2024', sourceBook: 'PHB2024',
    description: 'Transform into powerful beasts with enhanced abilities.',
    features: [
      { name: 'Circle Forms', level: 3, description: 'Wild Shape improvements: max CR = Druid level ÷ 3 (round down); base AC = maximum of Beast AC or 13 + Wis mod; Temp HP = 3× Druid level when entering Wild Shape.' },
      { name: 'Improved Circle Forms', level: 6, description: 'While Wild Shaped — Lunar Radiance: attacks deal normal or Radiant damage (your choice each hit). Increased Toughness: add Wis mod to Constitution saving throws.' },
      { name: 'Moonlight Step', level: 10, description: 'Bonus Action: teleport up to 30 ft to an unoccupied space you can see + Advantage on your next attack roll before end of turn. Uses = Wis mod (min 1); regain on Long Rest. Also restore uses by expending a level 2+ spell slot per use (no action).' },
      { name: 'Lunar Form', level: 14, description: 'Improved Lunar Radiance: once per turn, your Wild Shape attack hit deals +2d10 Radiant extra damage. Shared Moonlight: when you use Moonlight Step, you can also teleport 1 willing creature within 10 ft to an unoccupied space within 10 ft of your destination.' },
    ],
    alwaysPreparedSpells: { 3: ['cure-wounds', 'moonbeam', 'starry-wisp'], 5: ['conjure-animals'], 7: ['fount-of-moonlight'], 9: ['mass-cure-wounds'] },
  },

  { id: 'circle-of-the-sea', name: 'Circle of the Sea', classId: 'druid-2024', sourceBook: 'PHB2024',
    description: 'Command the power of stormy waves and the deep ocean.',
    features: [
      { name: 'Wrath of the Sea', level: 3, description: 'Bonus Action + Wild Shape use: create a 5-ft Emanation of ocean spray around yourself for 10 min (or dismissed, re-manifested, or Incapacitated). On manifestation and as a Bonus Action on subsequent turns: choose a creature in the Emanation → Con save (spell save DC) or take Cold damage = Wis mod (min 1) d6s; if Large-or-smaller, also pushed up to 15 ft away.' },
      { name: 'Aquatic Affinity', level: 6, description: 'Your Wrath of the Sea Emanation expands to 10 ft. You also gain a Swim Speed equal to your Speed.' },
      { name: 'Stormborn', level: 10, description: 'While your Wrath of the Sea Emanation is active: you gain a Fly Speed equal to your Speed, and Resistance to Cold, Lightning, and Thunder damage.' },
      { name: 'Oceanic Gift', level: 14, description: 'You can manifest your Wrath of the Sea Emanation around a willing creature within 60 ft of you instead of yourself (using your spell save DC and Wis mod). You can manifest it around both yourself and another creature by expending 2 Wild Shape uses.' },
    ],
    alwaysPreparedSpells: { 3: ['fog-cloud', 'gust-of-wind', 'ray-of-frost', 'shatter', 'thunderwave'], 5: ['lightning-bolt', 'water-breathing'], 7: ['control-water', 'ice-storm'], 9: ['conjure-elemental', 'hold-monster'] },
  },

  { id: 'circle-of-stars', name: 'Circle of Stars', classId: 'druid-2024', sourceBook: 'PHB2024',
    description: 'Tap into the magic of constellations and the night sky.',
    features: [
      { name: 'Star Map', level: 3, description: 'Hold star map (created on Long Rest): always have Guidance and Guiding Bolt prepared. Cast Guiding Bolt without slot = Wis mod (min 1) times per Long Rest.' },
      { name: 'Starry Form', level: 3, description: 'Bonus Action (Wild Shape use): take on a constellation form for 10 min instead of Wild Shape. Choose one: Archer (BA: Luminous Arrow: ranged spell attack, 1d8+Wis mod Radiant); Chalice (when casting healing spell: also restore 1d8+Wis mod HP to yourself or creature within 30 ft); Dragon (automatically succeed Int/Wis saves once per turn, minimum 10 on those checks).' },
      { name: 'Cosmic Omen', level: 6, description: 'After Long Rest: roll d6 — odd = Woe, even = Weal. Reaction when creature within 30 ft makes a D20 Test: add Weal (+1d6) or Woe (−1d6). Uses = Wis mod (min 1); regain on Long Rest.' },
      { name: 'Twinkling Constellations', level: 10, description: 'While in Starry Form: you can change the constellation form as Bonus Action. Archer: now fires 2 Luminous Arrows; Chalice: now restores 2d8+Wis mod. Dragon: now gives Fly Speed 20 ft (hover).' },
      { name: 'Full of Stars', level: 14, description: 'While in Starry Form: Resistance to Bludgeoning, Piercing, and Slashing damage. You can see Invisible creatures within 30 ft.' },
    ],
  },

  // ═══════════════════════════ FIGHTER ═══════════════════════════════════════

  { id: 'battle-master-2024', name: 'Battle Master', classId: 'fighter-2024', sourceBook: 'PHB2024',
    description: 'Master tactical combat maneuvers.',
    features: [
      { name: 'Combat Superiority', level: 3, description: 'Superiority Dice: 4d8 (→5d8 at 7, →6d8 at 15). Regain all on Short/Long Rest. Die increases: d10 at 10, d12 at 18. Know 3 maneuvers at level 3 (+2 at levels 7, 10, and 15; replace 1 each time). Save DC = 8+Prof+Str or Dex (your choice). Choose from: Commander\'s Strike, Disarming Attack, Distracting Strike, Evasive Footwork, Feinting Attack, Goading Attack, Lunging Attack, Maneuvering Attack, Menacing Attack, Parry, Precision Attack, Pushing Attack, Rally, Riposte, Sweeping Attack, Tactical Assessment, Trip Attack.' },
      { name: 'Student of War', level: 3, description: 'Proficiency with one type of Artisan\'s Tools and one skill from the Fighter skill list.' },
      { name: 'Know Your Enemy', level: 7, description: 'Bonus Action: discern the Immunities, Resistances, and Vulnerabilities of one creature within 30 ft. Once per Long Rest; restore with 1 Superiority Die (no action).' },
      { name: 'Improved Combat Superiority', level: 10, description: 'Your Superiority Dice become d10s.' },
      { name: 'Relentless', level: 15, description: 'Once per turn when you use a maneuver, you can roll 1d8 instead of expending a Superiority Die (doesn\'t cost a die; add the roll to the effect as normal).' },
      { name: 'Ultimate Combat Superiority', level: 18, description: 'Your Superiority Dice become d12s.' },
    ],
  },

  { id: 'champion-2024', name: 'Champion', classId: 'fighter-2024', sourceBook: 'PHB2024',
    description: 'Push your physical excellence to its absolute peak.',
    features: [
      { name: 'Improved Critical', level: 3, description: 'Weapon attacks score a critical hit on a roll of 19 or 20.' },
      { name: 'Remarkable Athlete', level: 3, description: 'Advantage on Initiative rolls and Strength (Athletics) checks. After scoring a critical hit with a weapon: move up to half your Speed without provoking Opportunity Attacks.' },
      { name: 'Additional Fighting Style', level: 7, description: 'Choose a second Fighting Style feat.' },
      { name: 'Heroic Warrior', level: 10, description: 'During combat, at the start of each of your turns: gain Heroic Inspiration if you don\'t already have it.' },
      { name: 'Superior Critical', level: 15, description: 'Critical hit range expands: 18–20.' },
      { name: 'Survivor', level: 18, description: 'Defy Death: Advantage on death saving throws; rolling 18–20 on a death save counts as rolling a 20. Heroic Rally: at the start of each of your turns, if you are Bloodied and have at least 1 HP, regain HP = 5 + Con mod.' },
    ],
  },

  { id: 'eldritch-knight-2024', name: 'Eldritch Knight', classId: 'fighter-2024', sourceBook: 'PHB2024',
    description: 'Combine martial skill with Abjuration and Evocation magic.',
    spellcastingType: 'third',
    spellListClassId: 'wizard',
    features: [
      { name: 'Spellcasting', level: 3, description: 'Int-based third-caster. Arcane Focus. Use the Eldritch Knight prepared spells table. Spells are prepared (can change on level-up; no restriction on spell school). Cantrips: 2 (gain 1 more at levels 10 and 14).' },
      { name: 'War Bond', level: 3, description: '1-hour ritual bonds 1 weapon (can\'t be disarmed; Bonus Action to summon to hand). Can have up to 2 weapons bonded; bonding a third breaks an existing bond.' },
      { name: 'War Magic', level: 7, description: 'When you take the Attack action, you can replace one of the attacks with casting a Wizard cantrip that has an action casting time.' },
      { name: 'Eldritch Strike', level: 10, description: 'When you hit a creature with a weapon attack: that creature has Disadvantage on the next saving throw it makes against a spell you cast before the end of your next turn.' },
      { name: 'Arcane Charge', level: 15, description: 'When you use Action Surge: you can teleport up to 30 ft to a seen unoccupied space before or after the additional action.' },
      { name: 'Improved War Magic', level: 18, description: 'When you take the Attack action, you can replace two of the attacks with casting a Wizard spell of level 1 or 2 (action casting time).' },
    ],
  },

  { id: 'psi-warrior-2024', name: 'Psi Warrior', classId: 'fighter-2024', sourceBook: 'PHB2024',
    description: 'Awaken psionic powers to augment your combat.',
    features: [
      { name: 'Psionic Power', level: 3, description: 'Psionic Energy Dice (PED): d6→d8 at 5→d10 at 11→d12 at 17; count = 2× Prof Bonus. Regain 1 on Short Rest, all on Long Rest. Protective Field (Reaction when you or ally within 30 ft takes damage: roll 1 PED, reduce damage by roll + Int mod); Psionic Strike (once per turn after weapon hit on target within 30 ft: expend 1 PED, deal Force = roll + Int mod); Telekinetic Movement (Magic action: move loose Large-or-smaller object or willing creature within 30 ft up to 30 ft; once per Short/Long Rest, restore with 1 PED).' },
      { name: 'Telekinetic Adept', level: 7, description: 'Psi-Powered Leap (Bonus Action: Fly Speed = 2× Speed until end of turn; 1 PED; once per Short/Long Rest, restore with PED). Telekinetic Thrust: on Psionic Strike hit, also force Str save (DC 8 + Int mod + Prof) or Prone or horizontal teleport 10 ft.' },
      { name: 'Guarded Mind', level: 10, description: 'Resistance to Psychic damage. If Charmed or Frightened at start of turn: expend 1 PED (no action) to end both conditions on yourself.' },
      { name: 'Bulwark of Force', level: 15, description: 'Bonus Action: choose up to Int mod (min 1) creatures within 30 ft (can include yourself) → each has Half Cover (+2 AC, +2 Dex saves) until start of your next turn. Once per Long Rest; restore with 1 PED (no action).' },
      { name: 'Telekinetic Master', level: 18, description: 'Always have Telekinesis prepared; cast without slot or material components (Intelligence), no Concentration needed. On each of your turns while concentrating on it (including the cast turn): can make 1 weapon attack as a Bonus Action. Once per Long Rest; restore with 1 PED (no action).' },
    ],
  },

  // ═══════════════════════════ MONK ══════════════════════════════════════════

  { id: 'warrior-of-mercy-2024', name: 'Warrior of Mercy', classId: 'monk-2024', sourceBook: 'PHB2024',
    description: 'Combine healing and harm through practiced touch.',
    features: [
      { name: 'Implements of Mercy', level: 3, description: 'Proficiency with Insight, Medicine, and Herbalism Kit. Hand of Harm (once per turn): when Unarmed Strike hits, spend 1 Focus Point → +1 Martial Arts die + Wis mod Necrotic damage. Hand of Healing (Magic action + 1 Focus Point): touch creature to restore 1 Martial Arts die + Wis mod HP. When using Flurry of Blows: can replace 1 Unarmed Strike with Hand of Healing (no extra Focus cost).' },
      { name: 'Physician\'s Touch', level: 6, description: 'Hand of Healing: also end one of Blinded/Deafened/Paralyzed/Poisoned/Stunned on the target. Hand of Harm: also impose the Poisoned condition on the target until end of its next turn.' },
      { name: 'Flurry of Healing and Harm', level: 11, description: 'When using Flurry of Blows: can replace each Unarmed Strike with Hand of Healing (no Focus cost). Can also use Hand of Harm on a Flurry hit without Focus cost (once per turn). Total uses of these benefits = Wis mod (min 1); regain on Long Rest.' },
      { name: 'Hand of Ultimate Mercy', level: 17, description: 'Magic action + 5 Focus Points: touch a creature dead up to 24 hrs → return it to life with HP = 4d10+Wis mod. Once per Long Rest.' },
    ],
  },

  { id: 'warrior-of-open-hand-2024', name: 'Warrior of the Open Hand', classId: 'monk-2024', sourceBook: 'PHB2024',
    description: 'Perfect unarmed combat to push, topple, and stun foes.',
    features: [
      { name: 'Open Hand Technique', level: 3, description: 'Each Flurry of Blows hit can impose one: Addle (no Opportunity Attacks until start of its next turn); Push (Str save or pushed 15 ft away from you); Topple (Dex save or knocked Prone).' },
      { name: 'Wholeness of Body', level: 6, description: 'Bonus Action: roll your Martial Arts die and regain that many HP + Wis mod (min 1). Uses = Wis mod (min 1); regain all on Long Rest.' },
      { name: 'Fleet Step', level: 11, description: 'When you take a Bonus Action other than Step of the Wind: can also take Step of the Wind immediately after for free.' },
      { name: 'Quivering Palm', level: 17, description: 'When you hit a creature with an Unarmed Strike: spend 4 Focus Points to start imperceptible vibrations (last for days = Monk level). On your turn, forgo 1 attack to end vibrations on a target in same plane: Con save (DC = ki save) or 10d12 Force damage; success = half. Only one creature can be affected at a time.' },
    ],
  },

  { id: 'warrior-of-shadow-2024', name: 'Warrior of Shadow', classId: 'monk-2024', sourceBook: 'PHB2024',
    description: 'Harness the power of darkness and illusion.',
    features: [
      { name: 'Shadow Arts', level: 3, description: 'Darkness: expend 1 Focus Point to cast Darkness without components; you can see through the area; can move the area up to 60 ft at the start of each of your turns. Darkvision: gain 60 ft darkvision (or +60 ft if you already have it). Shadowy Figments: you know the Minor Illusion cantrip (Wisdom).' },
      { name: 'Shadow Step', level: 6, description: 'Bonus Action while in Dim Light or Darkness: teleport up to 60 ft to unoccupied Dim Light or Darkness space you can see + Advantage on first melee attack this turn.' },
      { name: 'Improved Shadow Step', level: 11, description: 'Shadow Step: spend 1 Focus Point to remove the Dim Light/Darkness requirement. Can also make an Unarmed Strike immediately after teleporting (as part of the Bonus Action).' },
      { name: 'Cloak of Shadows', level: 17, description: 'Magic action + 3 Focus Points while in Dim Light or Darkness: gain the Invisible condition + become partially incorporeal (move through occupied spaces as Difficult Terrain; shunted if ending there) + Shadow Flurry (use Flurry of Blows without Focus cost). Lasts 1 min or until Incapacitated or you end your turn in Bright Light.' },
    ],
  },

  { id: 'warrior-of-elements-2024', name: 'Warrior of the Elements', classId: 'monk-2024', sourceBook: 'PHB2024',
    description: 'Command the primal forces of air, earth, fire, and water.',
    features: [
      { name: 'Elemental Attunement', level: 3, description: 'Know Elementalism (Wis). Start of turn: spend 1 Focus Point → imbued with elemental energy for 10 min (or Incapacitated). While active: reach +10 ft for Unarmed Strikes; Elemental Strikes deal Acid/Cold/Fire/Lightning/Thunder (your choice) instead of normal type; on that damage, target makes Str save or moves 10 ft toward or away from you.' },
      { name: 'Elemental Burst', level: 6, description: 'Magic action + 2 Focus Points: 20-ft Sphere within 120 ft. Each creature in sphere: Dex save or 3× Martial Arts die (chosen elemental type); success = half.' },
      { name: 'Stride of the Elements', level: 11, description: 'While Elemental Attunement is active: also gain Fly Speed and Swim Speed each equal to your Speed.' },
      { name: 'Elemental Epitome', level: 17, description: 'While Elemental Attunement is active: choose Resistance to one Acid/Cold/Fire/Lightning/Thunder type (change at start of each turn). Destructive Stride: when using Step of the Wind, Speed +20 ft; creatures of your choice entering space within 5 ft of your path take 1 Martial Arts die (once per turn). Empowered Strikes: once per turn, +1 Martial Arts die extra Elemental damage on Unarmed hit.' },
    ],
  },

  // ═══════════════════════════ PALADIN ═══════════════════════════════════════

  { id: 'oath-of-devotion-2024', name: 'Oath of Devotion', classId: 'paladin-2024', sourceBook: 'PHB2024',
    description: 'Uphold the highest ideals of justice and order.',
    features: [
      { name: 'Sacred Weapon', level: 3, description: 'Attack action + Channel Divinity: imbue held Melee weapon for 10 min. Benefits: +Cha mod to attacks (min +1); weapon deals Radiant or another chosen type; emits Bright Light 20 ft + Dim Light 20 ft. Ends if not carrying weapon.' },
      { name: 'Aura of Devotion', level: 7, description: 'You and allies within your Aura of Protection (10/30 ft) are Immune to the Charmed condition.' },
      { name: 'Smite of Protection', level: 15, description: 'When you cast Divine Smite: you and allies in your Aura of Protection gain Half Cover (+2 AC, +2 Dex saves) until the start of your next turn.' },
      { name: 'Holy Nimbus', level: 20, description: 'Bonus Action (once per Long Rest; restore with level 5 slot): imbue aura for 10 min. Holy Ward (Advantage on saves forced by Fiends/Undead); Radiant Damage (enemies starting turn in your aura take Radiant = Cha mod + Prof Bonus); Sunlight (aura filled with sunlight).' },
    ],
    alwaysPreparedSpells: { 3: ['protection-from-evil-and-good', 'shield-of-faith'], 5: ['aid', 'zone-of-truth'], 9: ['beacon-of-hope', 'dispel-magic'], 13: ['freedom-of-movement', 'guardian-of-faith'], 17: ['commune', 'flame-strike'] },
  },

  { id: 'oath-of-glory-2024', name: 'Oath of Glory', classId: 'paladin-2024', sourceBook: 'PHB2024',
    description: 'Inspire greatness and achieve legendary deeds.',
    features: [
      { name: 'Inspiring Smite', level: 3, description: 'Immediately after casting Divine Smite + Channel Divinity: distribute Temp HP = 2d8+Paladin level among creatures within 30 ft.' },
      { name: 'Peerless Athlete', level: 3, description: 'Bonus Action + Channel Divinity: 1 hour. Advantage on Str (Athletics) and Dex (Acrobatics) checks. Long and High Jump distance +10 ft.' },
      { name: 'Aura of Alacrity', level: 7, description: 'Your Speed +10 ft. Allies entering or starting turn in your Aura of Protection: Speed +10 ft until end of their next turn.' },
      { name: 'Glorious Defense', level: 15, description: 'Reaction when you or a creature within 10 ft is hit by an attack: grant AC bonus = Cha mod (min +1). If that attack misses: make 1 weapon attack against the attacker (if in range). Uses = Cha mod (min 1); regain on Long Rest.' },
      { name: 'Living Legend', level: 20, description: 'Bonus Action (once per Long Rest; restore with level 5 slot): 10 min. Charismatic (Advantage on all Cha checks); Saving Throw Reroll (Reaction when failing save → reroll, must use new result); Unerring Strike (once per turn when missing with weapon attack → cause it to hit instead).' },
    ],
    alwaysPreparedSpells: { 3: ['guiding-bolt', 'heroism'], 5: ['enhance-ability', 'magic-weapon'], 9: ['haste', 'protection-from-energy'], 13: ['compulsion', 'freedom-of-movement'], 17: ['legend-lore', 'yolandes-regal-presence'] },
  },

  { id: 'oath-of-the-ancients-2024', name: 'Oath of the Ancients', classId: 'paladin-2024', sourceBook: 'PHB2024',
    description: 'Side with nature and the light against the darkness.',
    features: [
      { name: 'Nature\'s Wrath', level: 3, description: 'Magic action + Channel Divinity: chosen creatures within 15 ft — Str save or Restrained for 1 min (repeat save end of each turn).' },
      { name: 'Aura of Warding', level: 7, description: 'You and allies within your Aura of Protection: Resistance to Necrotic, Psychic, and Radiant damage.' },
      { name: 'Undying Sentinel', level: 15, description: 'When reduced to 0 HP (not outright killed): drop to 1 HP + regain HP = 3× Paladin level instead. Once per Long Rest. Also: can\'t be magically aged; cease visibly aging.' },
      { name: 'Elder Champion', level: 20, description: 'Bonus Action (once per Long Rest; restore with level 5 slot): 1 min. Diminish Defiance (enemies in aura: Disadvantage on saves vs. your spells and Channel Divinity); Regeneration (start of each turn: regain 10 HP); Swift Spells (action-casting-time spells can be cast as Bonus Action instead).' },
    ],
    alwaysPreparedSpells: { 3: ['ensnaring-strike', 'speak-with-animals'], 5: ['misty-step', 'moonbeam'], 9: ['plant-growth', 'protection-from-energy'], 13: ['ice-storm', 'stoneskin'], 17: ['commune-with-nature', 'tree-stride'] },
  },

  { id: 'oath-of-vengeance-2024', name: 'Oath of Vengeance', classId: 'paladin-2024', sourceBook: 'PHB2024',
    description: 'Punish those who have committed great evils.',
    features: [
      { name: 'Vow of Enmity', level: 3, description: 'Attack action + Channel Divinity: Advantage on attacks vs. one creature within 30 ft for 1 min. If target drops to 0 HP: can transfer vow to different creature within 30 ft (no action required).' },
      { name: 'Relentless Avenger', level: 7, description: 'When hitting a creature with an Opportunity Attack: reduce that creature\'s Speed to 0 until end of turn + move up to half your Speed (no OAs from this movement; Reaction).' },
      { name: 'Soul of Vengeance', level: 15, description: 'Reaction when a creature under your Vow of Enmity makes or misses an attack roll: make one melee attack against it (if within range).' },
      { name: 'Avenging Angel', level: 20, description: 'Bonus Action (once per Long Rest; restore with level 5 slot): 10 min. Flight (spectral wings, Fly Speed 60 ft, hover). Frightful Aura (enemy starting turn in your Aura of Protection: Wis save or Frightened 1 min or until damage; attacks vs. Frightened creatures have Advantage).' },
    ],
    alwaysPreparedSpells: { 3: ['bane', 'hunters-mark'], 5: ['hold-person', 'misty-step'], 9: ['haste', 'protection-from-energy'], 13: ['banishment', 'dimension-door'], 17: ['hold-monster', 'scrying'] },
  },

  // ═══════════════════════════ RANGER ════════════════════════════════════════

  { id: 'beast-master-2024', name: 'Beast Master', classId: 'ranger-2024', sourceBook: 'PHB2024',
    description: 'Bond with a primal beast companion.',
    features: [
      { name: 'Primal Companion', level: 3, description: 'Summon a primal beast (choose: Land/Sea/Sky; see stat blocks). Friendly to you and allies; obeys commands. Acts on your turn; can move + use Reaction on its own. Only takes Dodge action unless you use Bonus Action to command it or sacrifice an attack from your Attack action. Restore with Magic action + spell slot (returns 1 min later). Replace on Long Rest. Beasts: Land (Med, AC 13+Wis, HP 5+5×level, 40/Climb 40 ft, Str/Dex 14, Con 15, Wis 14, Strike 1d8+2+Wis B/P/S; if 20+ ft before hit: +1d6+Prone); Sky (Sm, AC 13+Wis, HP 4+4×level, 10/Fly 60 ft, Dex 16, Con 13, Wis 14, Flyby, Strike 1d4+3+Wis Slashing); Sea (Med, AC 13+Wis, HP 5+5×level, 5/Swim 60 ft, Darkvision 90 ft, Amphibious, Strike 1d6+2+Wis B/P, Grappled on hit).' },
      { name: 'Exceptional Training', level: 7, description: 'Bonus Action command beast: can also take Dash/Disengage/Dodge/Help as its action. Beast attacks can deal Force or normal damage.' },
      { name: 'Bestial Fury', level: 11, description: 'Beast\'s Strike action can be used twice. First hit per turn vs. Hunter\'s Mark target: +Hunter\'s Mark extra Force damage.' },
      { name: 'Share Spells', level: 15, description: 'Spells targeting yourself also affect your Primal Companion (if within 30 ft).' },
    ],
  },

  { id: 'fey-wanderer-2024', name: 'Fey Wanderer', classId: 'ranger-2024', sourceBook: 'PHB2024',
    description: 'Channel the beguiling magic of the Feywild.',
    features: [
      { name: 'Dreadful Strikes', level: 3, description: 'When you hit a creature with a weapon: +1d4 Psychic damage (once per turn per target). Becomes 1d6 at level 11.' },
      { name: 'Otherworldly Glamour', level: 3, description: 'Add Wis mod (min +1) to Cha checks. Gain proficiency in Deception, Performance, or Persuasion (choose 1).' },
      { name: 'Beguiling Twist', level: 7, description: 'Advantage on saves vs. Charmed and Frightened. Reaction when you or a creature within 120 ft succeeds on a save vs. Charmed/Frightened: force a different creature within 120 ft to make a Wis save or be Charmed or Frightened (your choice) for 1 min (repeat save end of turns).' },
      { name: 'Fey Reinforcements', level: 11, description: 'Cast Summon Fey without Material components. Cast once without a slot per Long Rest. When casting without Concentration: duration 1 min instead.' },
      { name: 'Misty Wanderer', level: 15, description: 'Cast Misty Step without a slot = Wis mod (min 1) times per Long Rest. When casting: can also bring 1 willing creature within 5 ft (appears within 5 ft of destination).' },
    ],
    alwaysPreparedSpells: { 3: ['charm-person'], 5: ['misty-step'], 9: ['summon-fey'], 13: ['dimension-door'], 17: ['mislead'] },
  },

  { id: 'gloom-stalker-2024', name: 'Gloom Stalker', classId: 'ranger-2024', sourceBook: 'PHB2024',
    description: 'Strike from darkness with supernatural speed.',
    features: [
      { name: 'Dread Ambusher', level: 3, description: 'Ambusher\'s Leap: first turn in combat, Speed +10 ft. Dreadful Strike: once per turn on weapon hit: +2d6 Psychic; uses = Wis mod (min 1), regain on Long Rest. Initiative Bonus: +Wis mod.' },
      { name: 'Umbral Sight', level: 3, description: 'Darkvision 60 ft (or +60 ft if you already have it). While entirely in Darkness: Invisible to creatures relying on Darkvision to see you.' },
      { name: 'Iron Mind', level: 7, description: 'Proficiency in Wis saves. If already proficient: gain proficiency in Int or Cha saves instead.' },
      { name: 'Stalker\'s Flurry', level: 11, description: 'Dreadful Strike: +2d8 Psychic. When activating Dreadful Strike: also choose one extra effect — Sudden Strike (make another attack same weapon vs. different creature within 5 ft of target + within range); OR Mass Fear (target and creatures within 10 ft: Wis save or Frightened until start of your next turn).' },
      { name: 'Shadowy Dodge', level: 15, description: 'Reaction when a creature makes an attack roll against you: impose Disadvantage on it. Whether hit or miss, teleport up to 30 ft to an unoccupied space you can see.' },
    ],
    alwaysPreparedSpells: { 3: ['disguise-self'], 5: ['rope-trick'], 9: ['fear'], 13: ['greater-invisibility'], 17: ['seeming'] },
  },

  { id: 'hunter-2024', name: 'Hunter', classId: 'ranger-2024', sourceBook: 'PHB2024',
    description: 'Master techniques for hunting any quarry.',
    features: [
      { name: 'Hunter\'s Lore', level: 3, description: 'While a creature is marked by your Hunter\'s Mark: you know its Immunities, Resistances, and Vulnerabilities.' },
      { name: 'Hunter\'s Prey', level: 3, description: 'Choose one (change on Short/Long Rest): Colossus Slayer — weapon hit vs. creature missing any HP: +1d8 damage (once per turn); Horde Breaker — once per turn on weapon attack, make another attack same weapon vs. different creature within 5 ft + weapon range.' },
      { name: 'Defensive Tactics', level: 7, description: 'Choose one (change on Short/Long Rest): Escape the Horde (Opportunity Attacks have Disadvantage against you); Multiattack Defense (after being hit, attacker has Disadvantage on all other attacks vs. you this turn).' },
      { name: 'Superior Hunter\'s Prey', level: 11, description: 'Once per turn when dealing damage to a Hunter\'s Mark target: also deal that spell\'s extra damage to a different creature within 30 ft.' },
      { name: 'Superior Hunter\'s Defense', level: 15, description: 'Reaction when taking damage: gain Resistance to that damage type and to the same type until end of current turn.' },
    ],
  },

  // ═══════════════════════════ ROGUE ═════════════════════════════════════════

  { id: 'arcane-trickster-2024', name: 'Arcane Trickster', classId: 'rogue-2024', sourceBook: 'PHB2024',
    description: 'Enhance your roguery with Enchantment and Illusion magic.',
    spellcastingType: 'third',
    spellListClassId: 'wizard',
    features: [
      { name: 'Spellcasting', level: 3, description: 'Int-based third-caster. Arcane Focus. Prepared caster (change 1 spell on level-up; no school restriction). Cantrips: 3 (Mage Hand always + 2 Wizard cantrips). Gain 1 more cantrip at level 10.' },
      { name: 'Mage Hand Legerdemain', level: 3, description: 'Cast Mage Hand as Bonus Action; the hand is Invisible. Control the hand as Bonus Action; make Dex (Sleight of Hand) checks through it.' },
      { name: 'Magical Ambush', level: 9, description: 'When you have the Invisible condition when you cast a spell, each creature you target with the spell has Disadvantage on any saving throw it makes against the spell on the same turn.' },
      { name: 'Versatile Trickster', level: 13, description: 'When you use the Trip Cunning Strike option on a creature, you can also use Trip on a second creature within 5 ft of your spectral Mage Hand.' },
      { name: 'Spell Thief', level: 17, description: 'Reaction immediately after a creature casts a spell targeting you or an area that includes you: make an Int save vs. the caster\'s spell save DC. On a success: negate the spell\'s effect on you + you have the spell prepared for 8 hours (if it\'s level 1+ and a level you can cast); the creature can\'t cast it during that time. Once per Long Rest.' },
    ],
  },

  { id: 'assassin-2024', name: 'Assassin', classId: 'rogue-2024', sourceBook: 'PHB2024',
    description: 'Strike fast and lethally from surprise.',
    features: [
      { name: 'Assassinate', level: 3, description: 'Advantage on Initiative rolls. Surprising Strikes: in the first round of each combat, you have Advantage on attack rolls against creatures that haven\'t taken a turn yet. On a Sneak Attack hit against such a creature: it takes extra damage = Rogue level (weapon type).' },
      { name: 'Assassin\'s Tools', level: 3, description: 'Proficiency with Disguise Kit and Poisoner\'s Kit. Craft disguise in 1 min (Disguise Kit). Can make doses of poison (Poisoner\'s Kit, per poison rules).' },
      { name: 'Infiltration Expertise', level: 9, description: 'Masterful Mimicry: can unerringly mimic another person\'s speech/handwriting after 1 hour of study. Roving Aim: your Speed is not reduced to 0 by Steady Aim.' },
      { name: 'Envenom Weapons', level: 13, description: 'When you use the Poison option of Cunning Strike and the target fails its save: also deal +2d6 Poison damage (ignores Resistance to Poison damage).' },
      { name: 'Death Strike', level: 17, description: 'When you hit with a Sneak Attack in the first round of combat: the target must make a Con save (DC 8 + Dex mod + Prof) or the attack\'s damage is doubled.' },
    ],
  },

  { id: 'soulknife-2024', name: 'Soulknife', classId: 'rogue-2024', sourceBook: 'PHB2024',
    description: 'Manifest blades of psionic energy.',
    features: [
      { name: 'Psionic Power', level: 3, description: 'Psionic Energy Dice (PED): d6→d8 at 5→d10 at 11→d12 at 17; count = 2× Prof Bonus. Regain 1 on Bonus Action, all on Long Rest. Psi-Bolstered Knack: when you fail an ability check using a proficient skill or tool → roll 1 PED, add result to check (die expended only if it then succeeds). Psychic Whispers (Magic action + 1 PED): up to Prof Bonus creatures you can see can communicate telepathically with you (and you with them) for hours = roll. First use per Long Rest: free (no PED).' },
      { name: 'Psychic Blades', level: 3, description: 'Manifest blade as part of attack with your Bonus Action: melee weapon (Dex-based, Finesse, Light, Thrown 60/120) dealing 1d6+Dex Psychic. After attacking, blade vanishes. Can manifeset 2 blades (1 main + 1 off-hand BA attack). Psychic blades can\'t be disarmed.' },
      { name: 'Soul Blades', level: 9, description: 'Homing Strikes: spend 1 PED on a missed Psychic Blade attack → roll PED, add to attack roll (potentially turning miss to hit). Psychic Teleportation: Bonus Action + 1 PED: throw blade up to 10× PED roll feet; teleport to land where blade lands; blade vanishes.' },
      { name: 'Psychic Veil', level: 13, description: 'Cast Invisibility on yourself without material, no Concentration: 1 hr. Once per Long Rest; restore with 1 PED (no action).' },
      { name: 'Rend Mind', level: 17, description: 'When you deal Sneak Attack damage with Psychic Blades: target makes Wis save (DC 8 + Dex mod + Prof) or Stunned for 1 min (repeat save end of turns). Once per Long Rest; restore with 3 PED (no action).' },
    ],
  },

  { id: 'thief-2024', name: 'Thief', classId: 'rogue-2024', sourceBook: 'PHB2024',
    description: 'Master of stealth, speed, and acquiring others\' possessions.',
    features: [
      { name: 'Fast Hands', level: 3, description: 'Cunning Action options: also Sleight of Hand check, use thieves\' tools, or use an object.' },
      { name: 'Second-Story Work', level: 3, description: 'Climb Speed = Speed. Jump distance uses Dexterity instead of Strength.' },
      { name: 'Supreme Sneak', level: 9, description: 'New Cunning Strike option: Stealth Attack (1d6). If you have the Invisible condition from the Hide action, this attack doesn\'t end Invisible if you end your turn behind Three-Quarters or Total Cover.' },
      { name: 'Use Magic Device', level: 13, description: 'Attune to 4 magic items (instead of 3). Charges: when expending charges from a magic item, roll 1d6; on a 6, the charges are not expended. Scrolls: you can use any Spell Scroll, using Intelligence as your spellcasting ability; cantrips and level 1 spells work reliably; higher-level spells require an Intelligence (Arcana) check DC 10 + spell level (fail → scroll disintegrates).' },
      { name: 'Thief\'s Reflexes', level: 17, description: 'In the first round of combat: take 2 turns. Take first turn at your Initiative, second at Initiative −10. Can\'t use Action Surge on either turn.' },
    ],
  },

  // ═══════════════════════════ SORCERER ══════════════════════════════════════

  { id: 'aberrant-mind-2024', name: 'Aberrant Mind', classId: 'sorcerer-2024', sourceBook: 'PHB2024',
    description: 'Your mind brushes the Far Realm, granting alien psionic power.',
    features: [
      { name: 'Psionic Spells', level: 3, description: 'Always have prepared (by tier): level 3 — Arms of Hadar, Calm Emotions, Detect Thoughts, Dissonant Whispers, Mind Sliver; level 5 — Hunger of Hadar, Sending; level 7 — Evard\'s Black Tentacles, Summon Aberration; level 9 — Rary\'s Telepathic Bond, Telekinesis. Can replace one of these on level-up with a Divination or Enchantment spell of the same level.' },
      { name: 'Telepathic Speech', level: 3, description: 'Bonus Action: establish telepathic connection with 1 creature within 30 ft; lasts 1 min or until you end it (no action). While connected: telepathic communication in any language; speaking doesn\'t break concentration.' },
      { name: 'Psionic Sorcery', level: 6, description: 'When casting a Psionic Spell: can expend Sorcery Points equal to the spell\'s level instead of using a spell slot. No V, S, or M components required (except consumed/costly materials).' },
      { name: 'Psychic Defenses', level: 6, description: 'Resistance to Psychic damage. Advantage on saves vs. Charmed and Frightened.' },
      { name: 'Revelation in Flesh', level: 14, description: 'Bonus Action: spend 1+ SP → alter body for 10 min per SP spent. Each SP grants one benefit: Glistening Flight (Fly Speed = Speed, hover); Aquatic Adaptation (Swim Speed = 2× Speed, breathe water); See the Invisible (see Invisible within 60 ft not behind Total Cover); Wormlike Movement (squeeze through 1-inch spaces; spend 5 ft to escape nonmagical restraints or Grappled).' },
      { name: 'Warping Implosion', level: 18, description: 'Magic action (once per Long Rest; restore with 5 SP): teleport to seen unoccupied space within 120 ft. Each creature within 30 ft of your old location: Str save (spell DC) or pulled 30 ft toward it and 3d10 Force damage; success = half damage only.' },
    ],
  },

  { id: 'clockwork-soul-2024', name: 'Clockwork Soul', classId: 'sorcerer-2024', sourceBook: 'PHB2024',
    description: 'Tap the cosmic force of order for reliable, balanced magic.',
    features: [
      { name: 'Clockwork Magic', level: 3, description: 'Always have prepared (by tier): level 3 — Aid, Alarm, Lesser Restoration, Protection from Evil and Good; level 5 — Dispel Magic, Protection from Energy; level 7 — Freedom of Movement, Summon Construct; level 9 — Greater Restoration, Wall of Force. Can replace one of these on level-up with a spell of the same level from any list.' },
      { name: 'Restore Balance', level: 3, description: 'Reaction when a creature within 60 ft is about to roll a D20 Test with Advantage or Disadvantage: cancel the Advantage or Disadvantage. Uses = Prof Bonus; regain on Long Rest.' },
      { name: 'Bastion of Law', level: 6, description: 'Magic action: expend 1–5 SP; target creature within 30 ft gains Ward dice = SP spent (d8s). When taking damage, roll remaining dice: reduce damage by total, then remove those dice. Ward lasts until Long Rest or re-cast.' },
      { name: 'Trance of Order', level: 14, description: 'Bonus Action (once per Long Rest; restore with 5 SP): Clockwork state for 1 min. D20 Tests: minimum 10 on each roll. Also: attacks vs. you can\'t have Advantage.' },
      { name: 'Clockwork Cavalcade', level: 18, description: 'Magic action (once per Long Rest; restore with 7 SP): call mechanical servants. In a 30-ft Cube: Heal — restore up to 100 HP total distributed among creatures of your choice; Repair — instantly repair damaged objects (as Mending); Dispel — end all active spells of level 6 or lower on chosen creatures and objects. Once per Long Rest; restore with 7 SP (no action).' },
    ],
  },

  { id: 'draconic-bloodline-2024', name: 'Draconic Bloodline', classId: 'sorcerer-2024', sourceBook: 'PHB2024',
    description: 'Your innate magic flows from draconic blood.',
    features: [
      { name: 'Draconic Resilience', level: 3, description: 'HP max increases by +3 at level 3, then +1 per additional Sorcerer level. While not wearing armor: AC = 10 + Dex mod + Cha mod.' },
      { name: 'Draconic Ancestor', level: 3, description: 'Choose a dragon type (Acid/Cold/Fire/Lightning/Poison). This determines your Elemental Affinity damage type.' },
      { name: 'Elemental Affinity', level: 6, description: 'Choose Acid, Cold, Fire, Lightning, or Poison → gain Resistance to that damage type. When casting a spell that deals that damage type: add Cha mod to one damage roll.' },
      { name: 'Dragon Wings', level: 14, description: 'Bonus Action: sprout spectral wings for 1 hour (or dismiss). Fly Speed 60 ft. Once per Long Rest; restore with 3 SP (no action).' },
      { name: 'Dragon Companion', level: 18, description: 'Always have Summon Dragon prepared; cast it without Material components. Cast once without a slot per Long Rest. When casting without Concentration: duration → 1 min.' },
    ],
    hpBonusPerLevel: 1,
  },

  { id: 'wild-magic-2024', name: 'Wild Magic', classId: 'sorcerer-2024', sourceBook: 'PHB2024',
    description: 'Harness the chaos of untamed arcane magic.',
    features: [
      { name: 'Wild Magic Surge', level: 3, description: 'Once per turn, after casting a Sorcerer spell with a slot, you can roll a d20. On a 20: roll on the Wild Magic Surge table (see PHB 2024 p.149–150). If the surge is a spell, it can\'t be affected by Metamagic.' },
      { name: 'Tides of Chaos', level: 3, description: 'Give yourself Advantage on one D20 Test (declare before rolling). After using: to use it again, you must either finish a Long Rest or cast a Sorcerer spell with a slot (which then automatically triggers a Wild Magic Surge).' },
      { name: 'Bend Luck', level: 6, description: 'Reaction when another creature makes a D20 Test: expend 1 SP → roll 1d4 and apply result as a bonus or penalty to the roll (before the outcome is determined).' },
      { name: 'Controlled Chaos', level: 14, description: 'Roll twice on the Wild Magic Surge table and choose which result to use.' },
      { name: 'Tamed Surge', level: 18, description: 'After casting a Sorcerer spell with a slot: instead of rolling a Wild Magic Surge, you can choose any effect from the Wild Magic Surge table (except the final row; must still make any required rolls for that effect). Once per Long Rest.' },
    ],
  },

  // ═══════════════════════════ WARLOCK ═══════════════════════════════════════

  { id: 'archfey-patron-2024', name: 'The Archfey', classId: 'warlock-2024', sourceBook: 'PHB2024',
    description: 'Your patron is a lord or lady of the fey, a creature of legend and trickery.',
    features: [
      { name: 'Archfey Spells', level: 3, description: 'Always have Calm Emotions, Faerie Fire, Misty Step, Phantasmal Force, Sleep prepared; level 5: Blink, Plant Growth; level 7: Dominate Beast, Greater Invisibility; level 9: Dominate Person, Seeming.' },
      { name: 'Steps of the Fey', level: 3, description: 'Cast Misty Step without a slot = Cha mod (min 1) times per Long Rest. Each casting: choose one effect — Refreshing Step (you or creature within 10 ft gains 1d10 Temp HP); Taunting Step (creatures within 5 ft of vacated space: Wis save or Disadvantage vs. non-you until start of your next turn).' },
      { name: 'Misty Escape', level: 6, description: 'Cast Misty Step as Reaction when taking damage. Additional option: Disappearing Step (Invisible until start of next turn or until you attack/deal damage/cast); Dreadful Step (creatures within 5 ft of vacated or arrival space: Wis save or 2d10 Psychic).' },
      { name: 'Beguiling Defenses', level: 10, description: 'Immunity to Charmed condition. Reaction when creature within 60 ft hits you with an attack: halve the damage + force the attacker Wis save or take that same Psychic damage. Once per Long Rest; restore with Pact slot (no action).' },
      { name: 'Bewitching Magic', level: 14, description: 'After casting an Enchantment or Illusion spell (action + slot): also cast Misty Step as part of same action (no slot).' },
    ],
    alwaysPreparedSpells: { 3: ['calm-emotions', 'faerie-fire', 'misty-step', 'phantasmal-force', 'sleep'], 5: ['blink', 'plant-growth'], 7: ['dominate-beast', 'greater-invisibility'], 9: ['dominate-person', 'seeming'] },
  },

  { id: 'celestial-patron-2024', name: 'The Celestial', classId: 'warlock-2024', sourceBook: 'PHB2024',
    description: 'A powerful celestial grants you access to healing light.',
    features: [
      { name: 'Celestial Spells', level: 3, description: 'Always have Aid, Cure Wounds, Guiding Bolt, Lesser Restoration, Light, Sacred Flame prepared; level 5: Daylight, Revivify; level 7: Guardian of Faith, Wall of Fire; level 9: Greater Restoration, Summon Celestial.' },
      { name: 'Healing Light', level: 3, description: 'Pool of d6s = 1+Warlock level; regain all on Long Rest. Bonus Action: expend up to Cha mod (min 1) dice → roll → heal yourself or creature within 60 ft that many HP.' },
      { name: 'Radiant Soul', level: 6, description: 'Resistance to Radiant damage. Once per turn when a spell deals Radiant or Fire damage: add Cha mod to the damage roll against one target.' },
      { name: 'Celestial Resilience', level: 10, description: 'Gain Temp HP = Warlock level + Cha mod when using Magical Cunning or finishing a Short/Long Rest. Also give up to 5 visible creatures Temp HP = half Warlock level + Cha mod.' },
      { name: 'Searing Vengeance', level: 14, description: 'When you or ally within 60 ft is about to make a death saving throw: that creature regains HP = half its HP max, ends Prone condition, and creatures within 30 ft of it take 2d8+Cha mod Radiant + Blinded until end of current turn. Once per Long Rest.' },
    ],
    alwaysPreparedSpells: { 3: ['aid', 'cure-wounds', 'guiding-bolt', 'lesser-restoration', 'light', 'sacred-flame'], 5: ['daylight', 'revivify'], 7: ['guardian-of-faith', 'wall-of-fire'], 9: ['greater-restoration', 'summon-celestial'] },
  },

  { id: 'fiend-patron-2024', name: 'The Fiend', classId: 'warlock-2024', sourceBook: 'PHB2024',
    description: 'A fiend of tremendous power has entered into a pact with you.',
    features: [
      { name: 'Fiend Spells', level: 3, description: 'Always have Burning Hands, Command, Scorching Ray, Suggestion prepared; level 5: Fireball, Stinking Cloud; level 7: Fire Shield, Wall of Fire; level 9: Geas, Insect Plague.' },
      { name: 'Dark One\'s Blessing', level: 3, description: 'When you reduce an enemy to 0 HP: gain Temp HP = Cha mod + Warlock level (min 1). Also triggered when an ally within 10 ft reduces an enemy to 0 HP.' },
      { name: 'Dark One\'s Own Luck', level: 6, description: 'When making an ability check or saving throw: add 1d10 to the roll (after seeing roll, before effects). Uses = Cha mod (min 1); max once per roll; regain on Long Rest.' },
      { name: 'Fiendish Resilience', level: 10, description: 'Choose 1 damage type (not Force) at the end of each Short or Long Rest: gain Resistance to it.' },
      { name: 'Hurl Through Hell', level: 14, description: 'Once per turn when you hit a creature with an attack roll: target Cha save (spell DC) or disappear to a nightmare plane; takes 8d10 Psychic damage (if not a Fiend) + Incapacitated until end of your next turn. Once per Long Rest; restore with Pact slot (no action).' },
    ],
    alwaysPreparedSpells: { 3: ['burning-hands', 'command', 'scorching-ray', 'suggestion'], 5: ['fireball', 'stinking-cloud'], 7: ['fire-shield', 'wall-of-fire'], 9: ['geas', 'insect-plague'] },
  },

  { id: 'great-old-one-2024', name: 'The Great Old One', classId: 'warlock-2024', sourceBook: 'PHB2024',
    description: 'Your patron is a mysterious entity of the Far Realm.',
    features: [
      { name: 'Great Old One Spells', level: 3, description: 'Always have prepared (by tier): level 3 — Detect Thoughts, Dissonant Whispers, Phantasmal Force, Tasha\'s Hideous Laughter; level 5 — Clairvoyance, Hunger of Hadar; level 7 — Confusion, Summon Aberration; level 9 — Modify Memory, Telekinesis.' },
      { name: 'Awakened Mind', level: 3, description: 'Bonus Action: choose a creature you can see within 30 ft → telepathic communication for Warlock level minutes (range = Cha mod miles). Ends if you use it on a different creature.' },
      { name: 'Psychic Spells', level: 3, description: 'When casting a Warlock spell that deals damage: can change the damage type to Psychic. When casting an Enchantment or Illusion Warlock spell: can cast it without Verbal or Somatic components.' },
      { name: 'Clairvoyant Combatant', level: 6, description: 'When forming a telepathic bond with Awakened Mind: force the creature to make a Wis save or have Disadvantage on attacks against you and give you Advantage on attacks against it for the bond\'s duration. Once per Short/Long Rest; restore with a Pact slot (no action).' },
      { name: 'Eldritch Hex', level: 10, description: 'Always have Hex prepared. When casting Hex and choosing an ability score: the target also has Disadvantage on saving throws using that ability for the duration.' },
      { name: 'Thought Shield', level: 10, description: 'Your thoughts can\'t be read telepathically (unless you allow it). Resistance to Psychic damage. When you take Psychic damage, the attacker takes the same amount.' },
      { name: 'Create Thrall', level: 14, description: 'Cast Summon Aberration without Concentration (duration → 1 min); the aberration gains Temp HP = Warlock level + Cha mod. Your first hit per turn against a target of your Hex deals bonus Psychic damage equal to Hex\'s extra damage.' },
    ],
    alwaysPreparedSpells: { 3: ['detect-thoughts', 'dissonant-whispers', 'phantasmal-force', 'tashas-hideous-laughter'], 5: ['clairvoyance', 'hunger-of-hadar'], 7: ['confusion', 'summon-aberration'], 9: ['modify-memory', 'telekinesis'] },
  },

  // ═══════════════════════════ WIZARD ════════════════════════════════════════

  { id: 'abjurer-2024', name: 'School of Abjuration', classId: 'wizard-2024', sourceBook: 'PHB2024',
    description: 'Expert in protective and warding magic.',
    features: [
      { name: 'Abjuration Savant', level: 3, description: 'Add 2 Abjuration spells (level 1–2) to spellbook for free. Each time you gain a new slot level, add 1 free Abjuration spell of that level.' },
      { name: 'Arcane Ward', level: 3, description: 'When casting an Abjuration spell with a slot: create a ward on yourself (HP max = 2×Wizard level+Int mod). Ward absorbs damage first. If ward = 0, you take the rest. When casting Abjuration slot spell: ward regains HP = 2×slot level. Bonus Action: expend slot → ward regains 2×slot level HP. Ward lasts until disrupted; create once per Long Rest (costs casting any Abjuration slot spell).' },
      { name: 'Projected Ward', level: 6, description: 'Reaction when a creature within 30 ft takes damage: your Arcane Ward absorbs the damage instead (remaining damage goes to the creature, using its Resistances).' },
      { name: 'Spell Breaker', level: 10, description: 'Always have Counterspell and Dispel Magic prepared. Cast Dispel Magic as a Bonus Action; add Prof to its ability check. If either spell fails to stop a spell: slot not expended.' },
      { name: 'Spell Resistance', level: 14, description: 'Advantage on saves against spells. Resistance to spell damage.' },
    ],
  },

  { id: 'diviner-2024', name: 'School of Divination', classId: 'wizard-2024', sourceBook: 'PHB2024',
    description: 'Pierce the veil of time and space to know the unknowable.',
    features: [
      { name: 'Divination Savant', level: 3, description: 'Add 2 Divination spells (level 1–2) free. Each new slot level: +1 free Divination spell.' },
      { name: 'Portent', level: 3, description: 'After each Long Rest: roll 2d20 and record results. Can replace any D20 Test (you or visible creature) with one portent roll (choose before rolling; once per turn; each die usable once). Unused portent dice vanish on next Long Rest.' },
      { name: 'Expert Divination', level: 6, description: 'Casting a Divination spell with level 2+ slot: regain 1 expended slot of lower level than used (max level 5).' },
      { name: 'The Third Eye', level: 10, description: 'Bonus Action: choose one benefit (lasts until Short/Long Rest; once per Short/Long Rest): Darkvision 120 ft; Greater Comprehension (read any language); See Invisibility.' },
      { name: 'Greater Portent', level: 14, description: 'Roll 3d20 for Portent instead of 2.' },
    ],
  },

  { id: 'evoker-2024', name: 'School of Evocation', classId: 'wizard-2024', sourceBook: 'PHB2024',
    description: 'Channel raw magical energy into devastatingly powerful effects.',
    features: [
      { name: 'Evocation Savant', level: 3, description: 'Add 2 Evocation spells (level 1–2) free. Each new slot level: +1 free Evocation spell.' },
      { name: 'Potent Cantrip', level: 3, description: 'When a cantrip you cast misses or the target succeeds on its save: the target still takes half the cantrip\'s damage (no other effects).' },
      { name: 'Sculpt Spells', level: 6, description: 'When casting an Evocation spell affecting creatures you can see: choose up to 1 + spell level of them → they auto-succeed on the save and take no damage on a success.' },
      { name: 'Empowered Evocation', level: 10, description: 'Add your Int mod to one damage roll of any Wizard Evocation spell you cast.' },
      { name: 'Overchannel', level: 14, description: 'When casting a Wizard spell (slot level 1–5) dealing damage: deal maximum damage. First use per Long Rest: no cost. Each additional use before Long Rest: take 2d12 Necrotic per slot level immediately after casting (ignores Resistance/Immunity); each subsequent use before Long Rest adds 1d12 per slot level.' },
    ],
  },

  { id: 'illusionist-2024', name: 'School of Illusion', classId: 'wizard-2024', sourceBook: 'PHB2024',
    description: 'Master the art of deception through magical illusions.',
    features: [
      { name: 'Illusion Savant', level: 3, description: 'Add 2 Illusion spells (level 1–2) free. Each new slot level: +1 free Illusion spell.' },
      { name: 'Improved Illusions', level: 3, description: 'Cast Illusion spells without Verbal components. Illusion spells with range ≥10 ft: range increases by 60 ft. Know Minor Illusion as free cantrip; can create both sound and image simultaneously; cast as Bonus Action.' },
      { name: 'Phantasmal Creatures', level: 6, description: 'Always have Summon Beast and Summon Fey prepared; can change their school to Illusion (creature appears spectral). Can cast the Illusion version without a slot once per Long Rest per spell (half HP when cast without slot).' },
      { name: 'Illusory Self', level: 10, description: 'Reaction when a creature hits you with an attack: interpose an illusory duplicate — the attack auto-misses, illusion dissipates. Once per Short/Long Rest; restore with level 2+ slot (no action).' },
      { name: 'Illusory Reality', level: 14, description: 'When casting an Illusion spell with a slot: Bonus Action to make 1 inanimate nonmagical object within the illusion real for 1 minute (can\'t deal damage or inflict conditions).' },
    ],
  },
];
