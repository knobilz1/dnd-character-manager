import type { Background } from '../types';

// GGR p.33 / PDF p.35
// Guild Spells: Cantrip: friends, message; 1st: command, ensnaring strike;
// 2nd: arcane lock, calm emotions, hold person; 3rd: clairvoyance, counterspell;
// 4th: compulsion, divination; 5th: dominate person
const azoriusFunctionary: Background = {
  id: 'ggr-azorius-functionary',
  name: 'Azorius Functionary',
  sourceBook: 'GGR',
  skillProficiencies: ['Insight', 'Intimidation'],
  toolProficiencies: [],
  languages: 2,
  equipment: [
    'An Azorius insignia',
    'a scroll containing the text of a law important to you',
    'a bottle of blue ink',
    'a pen',
    'a set of fine clothes',
    'a belt pouch containing 10 gp (Azorius-minted 1-zino coins)',
  ],
  feature: {
    name: 'Legal Authority',
    description: 'You have the authority to enforce the laws of Ravnica, and that status inspires a certain amount of respect and even fear in the populace. People mind their manners in your presence and avoid drawing your attention; they assume you have the right to be wherever you are. Showing your Azorius insignia gets you an audience with anyone you want to talk to. Guild Spells (if you have Spellcasting or Pact Magic): Cantrip — friends, message; 1st — command, ensnaring strike; 2nd — arcane lock, calm emotions, hold person; 3rd — clairvoyance, counterspell; 4th — compulsion, divination; 5th — dominate person.',
  },
  personalityTraits: [
    'I try never to let my judgment become clouded by emotion.',
    'I have infinite patience with the dolts and boors I\'m forced to deal with every day.',
    'When I give an order, I expect it to be obeyed.',
    'I just want things the way I like them: neat, orderly, and clean.',
    'I\'m very literal and don\'t appreciate metaphor or sarcasm.',
    'I always say exactly what I mean, no matter how many words it takes.',
  ],
  ideals: [
    'Order. The law is meant to ensure that the gears of society turn smoothly and quietly. (Lawful)',
    'Peace. The ultimate object of the law is to remove violence from society. (Good)',
    'Compliance. Coercion is a fine way of ensuring that the laws are obeyed. (Lawful)',
    'Punishment. A public display of consequences is an excellent deterrent for other criminals. (Evil)',
  ],
  bonds: [
    'I am beholden to an Azorius arrester who captured the criminal who killed my parents.',
    'I hope one day to write the laws, not just enforce them.',
    'I tried and failed to prevent a murder, and I have sworn to find and arrest the perpetrator.',
    'I successfully prevented a murder, and the would-be perpetrator wants me dead.',
  ],
  flaws: [
    'I\'m incapable of deception.',
    'I put too much trust in those who wield power within my guild.',
    'I\'m convinced of the significance of my work and blind to its limitations.',
  ],
};

// GGR p.40 / PDF p.42
// Guild Spells: Cantrip: fire bolt, sacred flame; 1st: guiding bolt, heroism;
// 2nd: aid, scorching ray; 3rd: beacon of hope, blinding smite;
// 4th: death ward, wall of fire; 5th: flame strike
const borosLegionnaire: Background = {
  id: 'ggr-boros-legionnaire',
  name: 'Boros Legionnaire',
  sourceBook: 'GGR',
  skillProficiencies: ['Athletics', 'Intimidation'],
  toolProficiencies: ['One type of gaming set'],
  languages: 1,
  equipment: [
    'A Boros insignia',
    'a feather from an angel\'s wing',
    'a tattered piece of a Boros banner (souvenir from a famous battle)',
    'a set of common clothes',
    'a belt pouch containing 2 gp (Boros-minted 1-zino coins)',
  ],
  feature: {
    name: 'Legion Station',
    description: 'You have an established place in the hierarchy of the Boros Legion. You can requisition simple equipment for temporary use, and you can gain access to any Boros garrison in Ravnica, where you can rest in safety and receive the attention of medics. You are also paid a salary of 1 gp (a Boros-minted 1-zino coin) per week, which (combined with free lodging in your garrison) enables you to maintain a poor lifestyle between adventures. Language: choose one of Celestial, Draconic, Goblin, or Minotaur. Guild Spells (if you have Spellcasting or Pact Magic): Cantrip — fire bolt, sacred flame; 1st — guiding bolt, heroism; 2nd — aid, scorching ray; 3rd — beacon of hope, blinding smite; 4th — death ward, wall of fire; 5th — flame strike.',
  },
  personalityTraits: [
    'I face problems head-on. A simple, direct solution is the best path to success.',
    'I have a crude sense of humor and love to joke, especially in tense situations.',
    'I place no stock in the fancy trappings of wealth or the pretensions of polite society.',
    'I\'m confident in my own abilities and like to think out loud.',
    'I have a strong sense of justice and would rather die than see an innocent person harmed.',
    'I always keep my word and expect others to do the same.',
  ],
  ideals: [
    'Justice. Bring wrongdoers to heel; the world will be a better place for it. (Lawful)',
    'Loyalty. I never betray those who fight beside me. (Good)',
    'Courage. There is no greater act than standing between the innocent and those who would harm them. (Good)',
    'Duty. It is not for me to question the orders I am given. (Lawful)',
  ],
  bonds: [
    'I would lay down my life for the people I served with.',
    'An angel of the Boros Legion once gave me a moment of personal attention, and I have tried to live up to that ever since.',
    'My honor was besmirched, and I am trying to clear my name.',
    'Someone I loved died because I failed in my duty. I will not let that happen again.',
  ],
  flaws: [
    'I have trouble trusting those who haven\'t proven themselves in battle.',
    'I follow orders without question, even when I shouldn\'t.',
    'I judge others harshly and can be inflexible about the rules.',
  ],
};

// GGR p.46 / PDF p.48
// Guild Spells: Cantrip: encode thoughts, mage hand; 1st: disguise self, sleep;
// 2nd: detect thoughts, pass without trace; 3rd: gaseous form, meld into stone, nondetection;
// 4th: arcane eye, freedom of movement; 5th: modify memory
const dimirOperative: Background = {
  id: 'ggr-dimir-operative',
  name: 'Dimir Operative',
  sourceBook: 'GGR',
  skillProficiencies: ['Deception', 'Stealth'],
  toolProficiencies: ['Disguise kit'],
  languages: 1,
  equipment: [
    'A Dimir insignia',
    'three small knives',
    'a set of dark-colored common clothes',
    'starting equipment of your secondary guild background (choice)',
  ],
  feature: {
    name: 'False Identity',
    description: 'You maintain a false identity as a member of another guild. You have documentation, established acquaintances, and disguises that allow you to assume that persona and fit into the secondary guild. Whenever you choose, you can drop this identity and blend into the guildless masses of the city. Guild Spells (if you have Spellcasting or Pact Magic): Cantrip — encode thoughts, mage hand; 1st — disguise self, sleep; 2nd — detect thoughts, pass without trace; 3rd — gaseous form, meld into stone, nondetection; 4th — arcane eye, freedom of movement; 5th — modify memory.',
  },
  personalityTraits: [
    'I\'m good at hiding my true thoughts and feelings.',
    'When I\'m in doubt about revealing something, I assume it\'s a secret, and I don\'t share it.',
    'I like to sound mysterious, because wisdom hidden grows deeper with time.',
    'I have no patience with people who get in my way.',
    'Combat is meant to be quick, clean, and one-sided.',
    'I never show my anger. I just plot my revenge.',
  ],
  ideals: [
    'Control. I like pulling the strings. (Lawful)',
    'Secrets. I collect secrets and never reveal them. (Any)',
    'Knowledge. I want to know as much as I can about this city and how it works. (Any)',
    'Nihilism. I don\'t believe in anything, and anyone who does is a fool. (Neutral)',
  ],
  bonds: [
    'I discovered a secret I can\'t let anyone else uncover—including my guild superiors.',
    'I formed a close friendship or romance with someone in the guild I\'m infiltrating.',
    'The Dimir agent who recruited me was unmasked and killed. My revenge on the killers will be thorough and painful.',
    'Someone has discovered my true identity.',
  ],
  flaws: [
    'I like secrets so much that I\'m reluctant to share details of a plan even with those who need to know.',
    'I would let my friends die rather than reveal my true identity.',
    'I put too much trust in the people who give me orders.',
  ],
};

// GGR p.53 / PDF p.55
// Guild Spells: Cantrip: dancing lights, spare the dying; 1st: entangle, ray of sickness;
// 2nd: protection from poison, ray of enfeeblement, spider climb;
// 3rd: animate dead, plant growth; 4th: giant insect, grasping vine;
// 5th: cloudkill, insect plague
const golgariAgent: Background = {
  id: 'ggr-golgari-agent',
  name: 'Golgari Agent',
  sourceBook: 'GGR',
  skillProficiencies: ['Nature', 'Survival'],
  toolProficiencies: ['Poisoner\'s kit'],
  languages: 1,
  equipment: [
    'A Golgari insignia',
    'a poisoner\'s kit',
    'a pet beetle or spider',
    'a set of common clothes',
    'a belt pouch containing 10 gp worth of mixed coins',
  ],
  feature: {
    name: 'Undercity Paths',
    description: 'You know hidden, underground pathways that you can use to bypass crowds, obstacles, and observation as you move through the city. When you aren\'t in combat, you and companions you can lead can travel between any two locations in the city twice as fast as your speed would normally allow. The paths of the undercity are haunted by dangers that rarely brave the light of the surface world, so your journey isn\'t guaranteed to be safe. Language: choose one of Elvish, Giant, or Kraul. Guild Spells (if you have Spellcasting or Pact Magic): Cantrip — dancing lights, spare the dying; 1st — entangle, ray of sickness; 2nd — protection from poison, ray of enfeeblement, spider climb; 3rd — animate dead, plant growth; 4th — giant insect, grasping vine; 5th — cloudkill, insect plague.',
  },
  personalityTraits: [
    'I have accepted my death. Hence, I don\'t fear it.',
    'I like to remind people of their inevitable demise.',
    'Sometimes I give voice to the whispers of the rot, which I hear but no one else does.',
    'I do my best to discourage anyone from approaching or talking to me.',
    'Like roots growing through stone, I am relentless and determined in my action.',
    'Like a wild animal, I lash out viciously when I\'m provoked—and I\'m easily provoked.',
  ],
  ideals: [
    'Stoicism. All of us are part of the cyclical march of nature, which will continue with or without us. (Neutral)',
    'Nature. The natural world is more important than the edifices of the city and civilization. (Neutral)',
    'Interdependence. We are all part of nature\'s web. (Lawful)',
    'Ambition. The time of Golgari ascendance is at hand, and I intend to have a prominent place in the new world order. (Evil)',
  ],
  bonds: [
    'I cherish the finger of a family member who was petrified by a medusa.',
    'I have an identical twin who is as different from me as any person could be.',
    'I want to lead one faction of the guild to a new position of dominance.',
    'I am forever grateful to the reclaimer who found me floating facedown in the sewer, moments from death.',
  ],
  flaws: [
    'Death comes for us all, so you can\'t expect me to take care of someone who can\'t fight it off.',
    'I feel a need for revenge against those who enjoy the privilege of living above ground.',
    'I can\'t help but pocket any trinket or coin I come across, no matter how worthless.',
  ],
};

// GGR p.60 / PDF p.62
// Guild Spells: Cantrip: fire bolt, produce flame; 1st: compelled duel, speak with animals, thunderwave;
// 2nd: beast sense, shatter; 3rd: conjure animals, conjure barrage;
// 4th: dominate beast, stoneskin; 5th: destructive wave
const gruulAnarch: Background = {
  id: 'ggr-gruul-anarch',
  name: 'Gruul Anarch',
  sourceBook: 'GGR',
  skillProficiencies: ['Animal Handling', 'Athletics'],
  toolProficiencies: ['Herbalism kit'],
  languages: 1,
  equipment: [
    'A Gruul insignia',
    'a hunting trap',
    'an herbalism kit',
    'the skull of a boar',
    'a set of traveler\'s clothes',
    'a belt pouch containing 10 gp (Azorius 1-zino coins)',
  ],
  feature: {
    name: 'Rubblebelt Refuge',
    description: 'You are intimately familiar with areas of the city that most people shun: ruined neighborhoods where wurms rampaged, overgrown parks that no hand has tended in decades, and the vast, sprawling rubblebelts of broken terrain that civilized folk have long abandoned. You can find a suitable place for you and your allies to hide or rest in these areas. In addition, you can find food and fresh water in these areas for yourself and up to five other people each day. Language: choose one of Draconic, Giant, Goblin, or Sylvan. Guild Spells (if you have Spellcasting or Pact Magic): Cantrip — fire bolt, produce flame; 1st — compelled duel, speak with animals, thunderwave; 2nd — beast sense, shatter; 3rd — conjure animals, conjure barrage; 4th — dominate beast, stoneskin; 5th — destructive wave.',
  },
  personalityTraits: [
    'Unlike people, the beasts of the wild are friends who won\'t stab me in the back.',
    'Go ahead and insult me—I dare you.',
    'I scorn those who can\'t survive away from the comforts of the city.',
    'Don\'t tell me I\'m not allowed to do something.',
    'Laws are for people who are afraid to face their inner beasts.',
    'I smear the blood of my enemies over my skin.',
  ],
  ideals: [
    'Anarchy. No person or law or custom can tell another what to do. (Chaotic)',
    'Nature. We weren\'t born tame or domesticated, so we shouldn\'t have to live that way. (Neutral)',
    'Might. The strongest are meant to dominate the weak. (Evil)',
    'Tradition. The Old Ways must be preserved and upheld. (Any)',
  ],
  bonds: [
    'I am determined that one day I will lead my clan—or a new one.',
    'I would give my life for my clan chieftain.',
    'I am devoted to a sacred site in the midst of the rubblebelt.',
    'My weapon is made from the first raktusk I ever hunted.',
  ],
  flaws: [
    'If you question my courage, I will never back down.',
    'I\'m so convinced of my superiority over soft, civilized people that I\'ll take great risks to prove it.',
    'I\'m easily manipulated by people I find attractive.',
  ],
};

// GGR p.66 / PDF p.68
// Guild Spells: Cantrip: produce flame, shocking grasp; 1st: chaos bolt, create or destroy water, unseen servant;
// 2nd: heat metal, rope trick; 3rd: call lightning, elemental weapon, glyph of warding;
// 4th: conjure minor elementals, divination, Otiluke's resilient sphere;
// 5th: animate objects, conjure elemental
const izzetEngineer: Background = {
  id: 'ggr-izzet-engineer',
  name: 'Izzet Engineer',
  sourceBook: 'GGR',
  skillProficiencies: ['Arcana', 'Investigation'],
  toolProficiencies: ['One type of artisan\'s tools'],
  languages: 1,
  equipment: [
    'An Izzet insignia',
    'one set of artisan\'s tools (your choice)',
    'the charred and twisted remains of a failed experiment',
    'a hammer',
    'a block and tackle',
    'a set of common clothes',
    'a belt pouch containing 5 gp (Azorius 1-zino coins)',
  ],
  feature: {
    name: 'Urban Infrastructure',
    description: 'You have a basic knowledge of the structure of buildings, including the stuff behind the walls. You can also find blueprints of a specific building in order to learn the details of its construction, giving you knowledge of entry points, structural weaknesses, or secret spaces. Your access to such information isn\'t unlimited, and obtaining or using it may get you in trouble with the law. Language: choose one of Draconic, Goblin, or Vedalken. Guild Spells (if you have Spellcasting or Pact Magic): Cantrip — produce flame, shocking grasp; 1st — chaos bolt, create or destroy water, unseen servant; 2nd — heat metal, rope trick; 3rd — call lightning, elemental weapon, glyph of warding; 4th — conjure minor elementals, divination, Otiluke\'s resilient sphere; 5th — animate objects, conjure elemental.',
  },
  personalityTraits: [
    'I have a hard time staying focused on... oh, and my brain tends to jump from one... did I mention focus?',
    'I get really excited about my ideas and I can\'t wait to share them.',
    'Whatever I do, I give it all I\'ve got.',
    'Life\'s an experiment, and I can\'t wait to see what happens.',
    'Great ideas are fine, but great results are what counts.',
    'If you can guess what I\'m about to do, that means I\'ve run out of imagination.',
  ],
  ideals: [
    'Creativity. Half the world\'s troubles come from stodgy thinking. We need innovative solutions. (Chaotic)',
    'Discovery. Every experiment has the potential to reveal more secrets of the multiverse. (Any)',
    'Science. A rigorous application of logical principles will lead us toward progress. (Lawful)',
    'Fun. I love my job! Despite the dangerous working conditions, there\'s nothing I\'d rather do. (Chaotic)',
  ],
  bonds: [
    'I have dedicated my life to finding a solution to a scientific problem.',
    'I\'m convinced it was sabotage that destroyed my first laboratory, and I seek revenge.',
    'I have the schematics for an invention I hope to build one day.',
    'I would do anything the guildmaster told me to do.',
  ],
  flaws: [
    'If there\'s a plan, I\'ll probably forget it. If I don\'t forget it, I\'ll probably ignore it.',
    'Nothing is ever simple, and if it seems simple, I\'ll find a way to make it complicated.',
    'I tend to ignore sleep for days when I\'m conducting research.',
    'I\'m convinced there\'s not a soul in Ravnica who can match my boundless intellect.',
  ],
};

// GGR p.72 / PDF p.74
// Guild Spells: Cantrip: friends, guidance; 1st: command, illusory script;
// 2nd: enthrall, ray of enfeeblement, zone of truth;
// 3rd: bestow curse, speak with dead, spirit guardians;
// 4th: blight, death ward, Leomund's secret chest; 5th: geas
const orzhovRepresentative: Background = {
  id: 'ggr-orzhov-representative',
  name: 'Orzhov Representative',
  sourceBook: 'GGR',
  skillProficiencies: ['Intimidation', 'Religion'],
  toolProficiencies: [],
  languages: 2,
  equipment: [
    'An Orzhov insignia',
    'a foot-long chain made of ten gold coins',
    'vestments',
    'a set of fine clothes',
    'a belt pouch containing 1 pp (an Orzhov-minted 10-zino coin)',
  ],
  feature: {
    name: 'Leverage',
    description: 'You can exert leverage over one or more individuals below you in the guild\'s hierarchy and demand their help as needs warrant. For example, you can have a message carried across a neighborhood, procure a short carriage ride without paying, or have others clean up a bloody mess you left in an alley. The DM decides if your demands are reasonable and if subordinates are available to fulfill them. As your status in the guild improves, you gain influence over more people, including ones in greater positions of power. Guild Spells (if you have Spellcasting or Pact Magic): Cantrip — friends, guidance; 1st — command, illusory script; 2nd — enthrall, ray of enfeeblement, zone of truth; 3rd — bestow curse, speak with dead, spirit guardians; 4th — blight, death ward, Leomund\'s secret chest; 5th — geas.',
  },
  personalityTraits: [
    'I am always willing to act in accordance with the financial incentive offered.',
    'Debts are never meant to be forgiven.',
    'I am accustomed to enjoying the finest pleasures money can buy.',
    'I want to make sure everyone is aware of how wealthy, powerful, and important I am.',
    'I hate it when people try to make light of a serious situation.',
    'No one could doubt that I am a cut above the masses of pitiful peasants.',
  ],
  ideals: [
    'Wealth. I will do whatever it takes to become as rich as the oligarchs. (Evil)',
    'Power. One day, I will be the one giving orders. (Evil)',
    'Stability. The economy functions best when chaos is kept under control and everyone knows their place. (Lawful)',
    'Eternity. I want to live forever—in the flesh as long as possible, and as a spirit afterward. (Any)',
  ],
  bonds: [
    'The unbearable weight of my debt has driven me to desperation.',
    'I\'m duty-bound to obey the dictates of an ancestor on the Ghost Council.',
    'An oligarch publicly humiliated me, and I will exact revenge on that whole family.',
    'I want to prove myself more worthy than an older sibling and thereby ensure a greater inheritance.',
  ],
  flaws: [
    'I hold a scandalous secret that could ruin my family—but could also earn me the favor of the Ghost Council.',
    'I\'ll brave any risk if the monetary reward is great enough.',
    'I have little respect for anyone who isn\'t wealthy.',
  ],
};

// GGR p.79 / PDF p.81
// Guild Spells: Cantrip: fire bolt, vicious mockery; 1st: burning hands, dissonant whispers, hellish rebuke;
// 2nd: crown of madness, enthrall, flaming sphere; 3rd: fear, haste;
// 4th: confusion, wall of fire; 5th: dominate person
const rakdosCultist: Background = {
  id: 'ggr-rakdos-cultist',
  name: 'Rakdos Cultist',
  sourceBook: 'GGR',
  skillProficiencies: ['Acrobatics', 'Performance'],
  toolProficiencies: ['One type of musical instrument'],
  languages: 1,
  equipment: [
    'A Rakdos insignia',
    'a musical instrument (your choice)',
    'a costume',
    'a hooded lantern made of wrought iron',
    'a 10-foot length of chain with sharply spiked links',
    'a tinderbox',
    '10 torches',
    'a set of common clothes',
    'a belt pouch containing 10 gp (mix of Azorius and Boros 1-zino coins)',
    'a bottle of sweet, red juice',
  ],
  feature: {
    name: 'Fearsome Reputation',
    description: 'People recognize you as a member of the Cult of Rakdos, and they\'re careful not to draw your anger or ridicule. You can get away with minor criminal offenses, such as refusing to pay for food at a restaurant or breaking down a door at a local shop, if no legal authorities witness the crime. Most people are too daunted by you to report your wrongdoing to the Azorius. Language: choose either Abyssal or Giant. Guild Spells (if you have Spellcasting or Pact Magic): Cantrip — fire bolt, vicious mockery; 1st — burning hands, dissonant whispers, hellish rebuke; 2nd — crown of madness, enthrall, flaming sphere; 3rd — fear, haste; 4th — confusion, wall of fire; 5th — dominate person.',
  },
  personalityTraits: [
    'I revel in mayhem; the more destructive, the better.',
    'Everything is funny to me, and the most hilarious and bloodiest things leave me cackling with sadistic glee.',
    'I enjoy testing other people\'s patience.',
    'I can\'t stand it when things are predictable, so I like to add a little chaos to every situation.',
    'I enjoy breaking delicate works of art. And fingers, which are sort of the same.',
    'I derive genuine pleasure from the pain of others.',
  ],
  ideals: [
    'Hedonism. Death comes for everyone, so take as much pleasure as you can from every moment of life. (Neutral)',
    'Creativity. I strive to find more ways to express my art through pain. (Chaotic)',
    'Freedom. No one tells me what to do. (Chaotic)',
    'Spectacle. People are inspired by the greatness they see in art. (Any)',
  ],
  bonds: [
    'I have belonged to the same performance troupe for years, and these people mean everything to me.',
    'A blood witch told me I have a special destiny to fulfill, and I\'m trying to figure out what it is.',
    'I want to be better at my chosen form of performance than any other member of my troupe.',
    'I am devoted to Rakdos and live to impress him.',
  ],
  flaws: [
    'When violence breaks out, I lose myself in rage, and it\'s sometimes hard to stop.',
    'I\'m easily manipulated by offers of violence and mayhem.',
    'I put too much stock in what Rakdos thinks of me.',
  ],
};

// GGR p.86 / PDF p.88
// Guild Spells: Cantrip: druidcraft, friends; 1st: aid, animal friendship, charm person;
// 2nd: animal messenger, calm emotions, warding bond; 3rd: plant growth, speak with plants;
// 4th: aura of life, conjure minor elementals; 5th: awaken, commune with nature
const selesnyaInitiate: Background = {
  id: 'ggr-selesnya-initiate',
  name: 'Selesnya Initiate',
  sourceBook: 'GGR',
  skillProficiencies: ['Nature', 'Persuasion'],
  toolProficiencies: ['One type of artisan\'s tools or one musical instrument'],
  languages: 1,
  equipment: [
    'A Selesnya insignia',
    'a healer\'s kit',
    'robes',
    'a set of common clothes',
    'a belt pouch containing 5 gp (Azorius 1-zino coins)',
  ],
  feature: {
    name: 'Conclave\'s Shelter',
    description: 'As a member of the Selesnya Conclave, you can count on your guild mates to provide shelter and aid. You and your companions can find a place to hide or rest in any Selesnya enclave in the city, unless you have proven to be a danger to them. The members of the enclave will shield you from the law or anyone else searching for you, though they will not risk their lives in this effort. In addition, as a guild member you can receive free healing and care at a Selesnya enclave, though you must provide any material components needed for spells. Language: choose one of Elvish, Loxodon, or Sylvan. Guild Spells (if you have Spellcasting or Pact Magic): Cantrip — druidcraft, friends; 1st — aid, animal friendship, charm person; 2nd — animal messenger, calm emotions, warding bond; 3rd — plant growth, speak with plants; 4th — aura of life, conjure minor elementals; 5th — awaken, commune with nature.',
  },
  personalityTraits: [
    'I never raise my voice or lose my temper.',
    'I feel the pains and joys of everyone around me, friend or foe.',
    'I would rather make a friend than thwart an enemy.',
    'I\'m always straining to peer into another reality that seems to be just beyond my senses.',
    'I\'m uneasy if I can\'t see plants growing or feel soil beneath my feet.',
    'Nature offers rich and abundant metaphors for understanding the complexities of life.',
  ],
  ideals: [
    'Harmony. Nothing is more beautiful than voices and actions aligned in common purpose. (Good)',
    'Order. Like a well-pruned tree, society thrives when everything is kept in good order. (Lawful)',
    'Life. Preserving life and nature is always a worthwhile endeavor. (Good)',
    'Evangelism. When all have joined the Selesnya Conclave, Ravnica will finally know peace. (Any)',
  ],
  bonds: [
    'I would give my life in the defense of the small enclave where I first encountered Mat\'Selesnya.',
    'I love beasts and plants of all kinds, and am loath to harm them.',
    'A healer nursed me to recovery from a mortal illness.',
    'Every member of the conclave is my kin, and I would fight for any one of them.',
  ],
  flaws: [
    'I\'m terrified of getting into a fight where my side is outnumbered.',
    'I enjoy comfort and quiet, and prefer to avoid extra effort.',
    'I have a fierce temper that doesn\'t reflect the inner calm I seek.',
  ],
};

// GGR p.93 / PDF p.95
// Guild Spells: Cantrip: acid splash, druidcraft; 1st: detect poison and disease, expeditious retreat, jump;
// 2nd: alter self, enhance ability, enlarge/reduce; 3rd: gaseous form, water breathing, wind wall;
// 4th: freedom of movement, polymorph; 5th: creation
const simicScientist: Background = {
  id: 'ggr-simic-scientist',
  name: 'Simic Scientist',
  sourceBook: 'GGR',
  skillProficiencies: ['Arcana', 'Medicine'],
  toolProficiencies: [],
  languages: 2,
  equipment: [
    'A Simic insignia',
    'a set of commoner\'s clothes',
    'a book of research notes',
    'an ink pen',
    'a bottle of squid ink',
    'a flask of oil (made from blubber)',
    'a vial of acid (derived from digestive juices)',
    'a vial of fish scales',
    'a vial of seaweed',
    'a vial of jellyfish stingers',
    'a glass bottle of unidentified slime',
    'a belt pouch containing 10 gp (Azorius 1-zino coins)',
  ],
  feature: {
    name: 'Researcher',
    description: 'When you attempt to learn or recall a magical or scientific fact, if you don\'t know the information, you know where and from whom you can obtain it. Usually this information comes from a Simic laboratory, a library, a university, or an independent scholar or other learned creature. Knowing where the information can be found doesn\'t automatically enable you to learn it; you might need to offer bribes, favors, or other incentives to induce people to reveal their secrets. Guild Spells (if you have Spellcasting or Pact Magic): Cantrip — acid splash, druidcraft; 1st — detect poison and disease, expeditious retreat, jump; 2nd — alter self, enhance ability, enlarge/reduce; 3rd — gaseous form, water breathing, wind wall; 4th — freedom of movement, polymorph; 5th — creation.',
  },
  personalityTraits: [
    'I can\'t wait to see what I become next!',
    'I am convinced that everything inclines toward constant improvement.',
    'I\'m eager to explain every detail of my most intricate experiments and theories to anyone who shows the least bit of interest.',
    'Life\'s an experiment, and I can\'t wait to see what happens.',
    'I employ a highly technical vocabulary to avoid imprecision and ambiguity in my communication.',
    'I\'m insatiably curious about the seemingly infinite forms and adaptations of life.',
  ],
  ideals: [
    'Change. All life is meant to progress toward perfection, and our work is to hurry it along. (Chaotic)',
    'Knowledge. Understanding the world is more important than what you do with your knowledge. (Neutral)',
    'Greater Good. I want to reshape the world into higher forms of life so that all can enjoy evolution. (Good)',
    'Superiority. My vast intellect and strength are directed toward increasing my sway over others. (Evil)',
  ],
  bonds: [
    'I helped create a krasis that I love like a pet—except it\'s the size of a building, and it might eat me.',
    'The other researchers in my clade are my family.',
    'The laboratory where I did my research contains everything that is precious to me.',
    'A former clade supervisor is now engaged in field research studying some of the largest beasts and monsters on Ravnica.',
  ],
  flaws: [
    'I have a rather embarrassing mutation that I do everything I can to keep hidden.',
    'Every social situation I\'m in seems to lead to my asking rude personal questions.',
    'I\'ll take any risk to earn recognition for my scientific brilliance.',
    'I have a tendency to take shortcuts in my research and any other tasks I have to complete.',
  ],
};

export const GGR_BACKGROUNDS: Background[] = [
  azoriusFunctionary,
  borosLegionnaire,
  dimirOperative,
  golgariAgent,
  gruulAnarch,
  izzetEngineer,
  orzhovRepresentative,
  rakdosCultist,
  selesnyaInitiate,
  simicScientist,
];
