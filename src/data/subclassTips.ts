/**
 * Short gameplay-style tips for every subclass.
 * One paragraph, max ~150 words each.
 * Keyed by subclass id.
 */
export const SUBCLASS_TIPS: Record<string, string> = {

  // ── Artificer ────────────────────────────────────────────────────────────
  'alchemist':
    "An Artificer who brews experimental elixirs that produce random beneficial effects — healing, speed, flight, and more. You're the party's field medic and utility provider, handing out potions as a bonus action. Less combat-focused than other Artificers; best for players who want to support the group through preparation and quick thinking rather than direct damage.",
  'armorer':
    "An Artificer who integrates their armour into a powered exosuit. Guardian mode turns you into a frontline tank with thunderous gauntlets; Infiltrator mode makes you a fast, stealthy operative with a built-in lightning launcher. You're the most durable Artificer — you wade into fights instead of watching from the back.",
  'artillerist':
    "An Artificer who conjures a magical cannon — a flamethrower that blasts enemies in a cone, a force ballista that picks off targets at range, or a protector that gives nearby allies temporary HP. You're the group's dedicated damage-dealer and battlefield setup artist. Excellent when you can plant the cannon in a good position; it works every turn without spending spell slots.",
  'battle-smith':
    "An Artificer with a Steel Defender companion that tanks and distracts enemies while you fight with a weapon using Intelligence. You're self-sufficient and never truly alone — your construct is a permanent ally. One of the strongest Artificer subclasses in sustained combat; great for players who want a bonded mechanical partner.",

  // ── Barbarian ────────────────────────────────────────────────────────────
  'berserker':
    "The simplest and most aggressive barbarian. Frenzy lets you make an extra attack every turn, but you'll rack up exhaustion if you use it every fight — save it for the big moments. Great for players who want to stand in front, take hits, and hit back harder. No tricks, no strategy, just pure violence.",
  'totem-warrior':
    'A spiritual warrior who binds to an animal spirit for different buffs. Bear totem makes you nearly impossible to kill (resistance to almost all damage). Eagle gives limited flight. Wolf helps allies hit your target. More tactical than Berserker — you pick your power at level 3 and it shapes your whole role in the party.',
  'ancestral-guardian':
    "A protective barbarian whose ancestors haunt whatever enemy you're hitting. Enemies you focus on have disadvantage attacking anyone but you. You're not the biggest damage dealer, but you're exceptional at keeping your allies safe. Great pick if your group has squishy casters who need a reliable meat shield.",
  'storm-herald':
    'You wrap yourself in an elemental aura while raging — fire, thunder, or ice. Each option deals reliable damage to nearby enemies or buffs allies. Less burst damage than Berserker, more consistent. Pairs well with parties that need area-of-effect pressure without a dedicated blaster.',
  'zealot':
    "A fanatic warrior who is very hard to kill — even death itself can't stop you easily. Raised from death with no expensive materials, and your Divine Fury adds radiant or necrotic damage to your strikes. If your DM runs a campaign where death is common, you'll be back up faster than anyone.",
  'path-of-wild-magic':
    "Each time you rage, a random magical effect triggers around you — some help, some are chaotic, all are memorable. You can also detect magic and cast Bolstering Magic to help allies. Perfect if you enjoy unpredictable, cinematic moments and don't mind occasionally making things weird for the party.",
  'path-of-the-beast':
    'You grow natural weapons while raging: claws for multiple hits, a bite that heals you with temporary HP, or a spiked tail that strikes back at anyone who hits you as a reaction. Very flexible — you pick which form fits the fight. Rewards players who like adapting on the fly and want to feel genuinely monstrous in combat.',
  'scag-battlerager':
    'Dwarf-only. You charge into battle in spiked armor, dealing damage just by grappling enemies — they take spikes, you stay close. Extremely up-close and personal; you want to be hugging your enemies the entire fight. Not subtle, but incredibly satisfying for players who like wrestling their way through problems.',
  'scag-totem-warrior-elk-tiger':
    'Expanded Totem Warrior options from SCAG. Elk totem dramatically boosts your movement speed during rage, letting you close distance or chase fleeing enemies. Tiger gives a long jump. These supplement the PHB Totem Warrior choices — useful situational add-ons rather than a standalone build.',
  'tob-path-of-the-kraken':
    'A sea-themed barbarian with tentacle-like reach. While raging you can grab and drag enemies, denying their movement and setting up your allies. Great crowd controller at melee range. Most thematically powerful in coastal or underwater campaigns, but useful anywhere enemies clump together.',
  'tob-path-of-the-shark':
    "A relentless predator who smells blood and capitalises on wounded enemies. Once an enemy is hurt, you deal bonus damage and press your attacks harder. Snowballs well mid-fight — the lower an enemy's HP, the more dangerous you become. Great for campaigns with long, attritional battles.",

  // ── Bard ─────────────────────────────────────────────────────────────────
  'college-of-lore':
    'The most versatile bard. You steal spells from other class lists (Magical Secrets earlier than usual) and use Cutting Words to subtract from enemy rolls at a key moment. Great all-rounder for players who want to be the cleverest person at the table — a debuffer, supporter, and spell powerhouse all in one.',
  'college-of-valor':
    'A battle-ready bard who wears medium armor, uses shields, and eventually makes two attacks per turn. You sacrifice some pure support output for real combat presence. Good for players who want to be in the thick of it rather than lingering at the back, inspiring from a distance.',
  'college-of-glamour':
    'A fey-touched performer who can enthral crowds and wrap allies in a magical refuge. You shine brightest in social encounters and at keeping allies safe. Not a strong damage dealer — your power comes from your presence, your charm, and making sure enemies are looking at you instead of your friends.',
  'college-of-swords':
    "A blade-spinning duelist who channels Bardic Inspiration into Blade Flourishes — parrying blows, flinging enemies back, or dealing area damage. You're more combat-focused than most bards, relying on close-range fights and acrobatic weapon work. Good for players who want bard flavour with actual martial capability.",
  'college-of-whispers':
    'A manipulative spy who steals the identities of the dead and delivers psychic stabs with their words. You thrive in intrigue-heavy campaigns — your Mantle of Whispers lets you impersonate someone after they die. In combat you deal solid burst psychic damage, but your real power is between fights.',
  'college-of-creation':
    'An artistic bard who breathes life into objects — animating them to fight, creating items from nothing, or summoning a Performance of Creation. Your animated item acts as a free bonus ally on the battlefield. Great for players who like the idea of an artist who makes their art do the fighting.',
  'college-of-eloquence':
    'The ultimate support and debuffer. Your Bardic Inspiration is restored when you talk (Unsettling Words), and your crowd-control spells are nearly impossible to resist. If you want to be indispensable in every scene — combat, social, exploration — this subclass makes you the best at all of it.',
  'tob-college-of-the-shanty':
    "A sea-shanty bard whose songs have real power on the water — rallying exhausted sailors, calming storms, or boosting a ship's crew. Support-oriented with strong group buffs. If your campaign involves ships and crews, this bard feels indispensable; in dungeon-crawl campaigns the nautical flavour loses some impact.",
  'tob-college-of-the-siren':
    "A beguiling performer who lures and compels enemies with voice and appearance. Strong in social scenarios and capable of charming enemies mid-combat. You'll feel most powerful in settings with lots of NPC interaction and political intrigue — and when an enemy is charmed, they become your biggest fan.",

  // ── Cleric ───────────────────────────────────────────────────────────────
  'life-domain':
    'The definitive healer. Your healing spells restore significantly more HP thanks to Disciple of Life, Preserve Life lets you spread emergency healing across multiple injured allies at once, and at higher levels every healing spell also restores HP to yourself as a side effect. If your party needs someone whose job is to keep everyone standing, this is the subclass. Expect to spend a lot of turns patching up your friends.',
  'knowledge-domain':
    "A scholarly cleric who can temporarily borrow another class's skills and read minds. You're at your best in campaigns heavy on investigation and social puzzles. You contribute meaningfully outside of combat, though in pure dungeon crawls you'll feel less powerful than more combat-oriented domains.",
  'light-domain':
    'An offensive blaster who happens to be a cleric. You throw fireballs, blind enemies with radiant flashes, and shield allies from magical attacks. Plays more like a combat mage than a healer — great if you want to deal damage AND offer some divine support, without committing fully to either role.',
  'nature-domain':
    'A druid-flavoured cleric who charms animals and plants, controls weather-related spells, and ignores environmental damage. Most powerful in wilderness campaigns; a bit weaker in pure dungeon settings. You wear heavy armour and have solid spells, but your niche features are situational.',
  'tempest-domain':
    "A thunder-and-lightning cleric who maximises electrical and thunder damage rolls. You're an aggressive, heavy-armour-wearing storm priest who deals devastating damage with the right spells. Great for players who want a combat-first cleric — you'll spend less time healing and more time calling down lightning.",
  'trickery-domain':
    "A deceptive, chaotic cleric who conjures illusory clones, turns invisible, and generally causes mayhem. Better at stealth and trickery than raw healing, though the spell list is solid. You're the party's agent of chaos — best in campaigns where being unpredictable is a real asset.",
  'war-domain':
    'A battle-priest who gets bonus attacks and can empower crucial hit rolls. You fight on the front lines and hold your own in melee while still providing divine support. If you want a cleric who actually wants to be in the fight rather than hiding behind allies, this is your subclass.',
  'forge-domain':
    "A divine craftsman who enhances weapons and armour, gains fire resistance, and eventually creates anything you need from pure magic. You're tougher than most clerics, start with heavy armour, and have solid offensive options. A well-rounded choice for players who want tanky resilience with strong utility.",
  'grave-domain':
    'A cleric of life and death who protects the dying (zeroing out damage that would drop an ally to 0), negates critical hits against your team, and smites undead hard. A more versatile healer than Life Domain — you deal with death in all its forms rather than just pouring HP into allies.',
  'order-domain':
    "A commanding cleric who shouts orders to allies as a bonus action, granting them immediate attacks. You're an outstanding force multiplier in martial-heavy parties — giving your fighter or paladin a free swing every time you cast a spell is enormously powerful at any level.",
  'peace-domain':
    "One of the best support subclasses in the game. You bond party members together so they can share damage and grant each other attack bonuses. You're the glue that makes a good party into an exceptional one — every session your presence makes your teammates measurably more effective.",
  'twilight-domain':
    'A guardian cleric who creates a dome of calming twilight granting darkvision and advantage on Wisdom saves to all allies inside. You wear heavy armour, can fly, and make it very hard for enemies to frighten or charm your team. Excellent defensive support in any campaign.',
  'scag-arcana-domain':
    "An arcane-divine hybrid who borrows wizard cantrips at level 1 and gains access to powerful wizard spells added to the cleric list at higher levels. You blur the line between cleric and wizard — casting arcane magic through divine faith. Best for players who've always wanted to combine both classes without committing to a full multiclass.",
  'tob-island-domain':
    'A cleric tied to islands, shoals, and coastal wilds. You gain nature and water utility spells and strong defensive features for seafaring and island survival. Most impactful in maritime campaigns; in pure dungeon settings some features sit unused, but the spell list remains solid.',
  'tob-sea-domain':
    "A servant of the ocean who commands waves and tides, grants water-breathing, and deals crushing water damage. You're most effective in naval or aquatic settings — your domain spells and channel divinity are built around the sea. In landlocked campaigns you're a solid cleric with flavourful spells.",

  // ── Druid ────────────────────────────────────────────────────────────────
  'circle-of-the-land':
    "A spellcasting-focused druid who recovers spell slots on short rests and gets bonus thematic spells based on your terrain. You're a more powerful blaster and controller than a typical druid, but you rely on Wild Shape much less. Great if you prefer staying in your humanoid form and raining spells down.",
  'circle-of-the-moon':
    "The Wild Shape specialist. You transform into powerful beasts and function as the party's second tank — diving in as a giant bear or elemental and absorbing huge amounts of punishment. Your beast HP effectively doubles your survivability. Best for players who love the shapeshifter fantasy and don't mind less casting.",
  'circle-of-dreams':
    "A fey-touched druid who hands out bonus healing when casting spells and can teleport short distances through fey crossings. You're an excellent healer-mobility hybrid — you're never far from where you need to be, and your bonus healing keeps allies in the fight longer.",
  'circle-of-the-shepherd':
    "A summoner druid who bolsters spirits and animal companions. You can flood the battlefield with creatures and stack their damage. Powerful but complex — you're effectively managing a small army every combat. Best for experienced players who enjoy tactical resource management and an ever-growing menagerie.",
  'circle-of-spores':
    "A necromantic druid who animates corpses and coats yourself in damaging spores that punish anything that hits you. You can make melee weapon attacks with bonus necrotic damage, which is unusual for druids. Dark, unconventional, and genuinely fun for players who want something that doesn't feel like a typical nature character.",
  'circle-of-stars':
    "A celestial druid who channels constellations for different bonuses — a healing archer form, extra HP on heals, or flash healing to allies at range. You're a fantastic all-rounder: reliable healer, capable blaster, and useful diviner all in one, without being overshadowed in any role.",
  'circle-of-wildfire':
    'A fire-wielding druid who summons a burning spirit that deals damage AND heals allies simultaneously. Your fire spells never harm your own spirit. Great for players who want a druid that burns everything down while still contributing to party survivability — the spirit basically acts as a second team member.',
  'tob-circle-of-the-shoal':
    'A druid tied to shallow coastal waters with excellent movement and combat abilities in aquatic environments. You can capsize boats and call fish swarms to your aid. Mainly useful in aquatic or island-themed campaigns — on dry land, many of your features go unused, but your basic druid spell list carries you.',
  'tob-circle-of-the-tides':
    "A tidal druid who pushes enemies and allies with waves of force, controlling the flow of battle. You're a support and crowd-control caster who keeps enemies off-balance and repositions allies. Most impactful in open outdoor or water encounters — tight dungeon corridors limit some of your push effects.",

  // ── Fighter ──────────────────────────────────────────────────────────────
  'champion':
    'The most straightforward fighter. Your critical hit range expands so you land crits on a 19 (and eventually 18). No special resources, no decisions to track — just consistent, reliable damage every single fight. Perfect for new players or anyone who wants to focus on the rest of the game rather than managing complex combat mechanics.',
  'battle-master':
    'A tactical genius who uses Superiority Dice to trip, disarm, push, terrify, or redirect enemies. You have a plan every turn and can turn the tide of a fight with the right maneuver at the right moment. Best for players who enjoy strategy and want to feel like the smartest fighter at the table.',
  'eldritch-knight':
    'A fighter who weaves magic into their combat style. You gain wizard spells for protection and control — Shield, Absorb Elements, and better options at higher levels. Great for players who want martial reliability with a magical edge, without fully committing to a caster class.',
  'arcane-archer':
    "A marksman who infuses arrows with magical effects — seeking shots that curve around cover, banishing blasts, blinding shadows, or mind-controlling grazes. Excellent ranged combatant with strong utility. Best for players who want a magical archer fantasy and don't mind that your special shots are limited uses per rest.",
  'cavalier':
    "A mounted combat specialist who excels at protecting allies and locking enemies in place. On foot you're a solid defender; on a mount you become a lance-charging unstoppable force. Best in campaigns with outdoor spaces — tight dungeons can limit your mounted advantage, but your defender abilities work anywhere.",
  'samurai':
    'A stoic warrior who digs deep when needed. Fighting Spirit grants advantage and temporary HP when you need it most, and at higher levels you can survive a killing blow. Incredibly durable and straightforward — you just keep fighting when others would fall. Great for players who want resilience over complexity.',
  'psi-warrior':
    'A telekinetic fighter who pushes and pulls enemies, creates protective psychic shields, and surges with psychic power. You have solid battlefield control through pure mind-power. Great for players who want a sci-fi or psychic flavour in a fantasy setting — mechanically reliable with good crowd control.',
  'rune-knight':
    'A giant-touched warrior who carves runes onto weapons and armour and can grow to enormous size. You hit harder, take up more space, grant advantages to allies through rune effects, and are genuinely frightening up close. Strong in almost any melee situation — flexible and powerful at every level.',
  'echo-knight':
    'A mysterious fighter who summons a shadowy duplicate of themselves to fight alongside them. You effectively have two positions on the battlefield and can swap with your echo to reposition. Confusing for enemies, endlessly creative for you. One of the more complex fighters — but incredibly rewarding when you master it.',
  'scag-purple-dragon-knight':
    'A charismatic knight and battlefield leader who inspires allies to push through pain and rally from the brink. You give your companions the ability to spend Hit Dice in combat and shout encouragement across the field. Less personally powerful than other fighters — this is a support subclass for players who want to lead, not just fight.',
  'tob-corsair':
    'A swashbuckling sea-fighter who terrifies enemies with presence and controls the battlefield through fear. Your Ferocious Presence can frighten multiple enemies at once, and Intimidation is your signature weapon. Fun and thematic — great for players who want to feel like a legendary pirate captain who owns whatever room they walk into.',
  'tob-captain':
    "A commander who hands out bonus dice to allies, letting them add to attack rolls or saves at critical moments. You're the team's tactical officer — less personally powerful but a tremendous force multiplier. Best when your party is willing to coordinate, and when you have at least one or two strong martial allies to empower.",

  // ── Monk ─────────────────────────────────────────────────────────────────
  'way-of-the-open-hand':
    'The purest monk. Your Flurry of Blows can push, knock prone, or prevent enemy reactions — giving you reliable combat control on top of solid damage. No fancy tricks, just excellent execution of the core monk fantasy. Perfect for players who want to feel like a martial arts master without managing complex resource trees.',
  'way-of-shadow':
    "A ninja-style monk who blends into darkness, casts silence, and teleports between shadows. You're excellent in stealth-focused play and can set up ambushes or escape situations other monks can't. Best in parties that like to be sneaky — in open combat against alert enemies some of your tools lose their edge.",
  'way-of-the-four-elements':
    "A monk who bends fire, water, earth, and air through ki. You get elemental blasts, walls, and movement effects. Broad and flexible, but very ki-hungry — you'll burn through your most limited resource fast. Best for players drawn to the Avatar-style fantasy who accept the trade-off of running dry quickly.",
  'way-of-the-drunken-master':
    "An elusive, unpredictable fighter who mimics a drunkard's stumbling movement to dodge attacks and reposition constantly. You can disengage as a bonus action after attacking, making you nearly impossible to pin down. Great for hit-and-run tactics and players who find staying in one place boring.",
  'way-of-the-kensei':
    "A weapons-mastery monk who turns any weapon into a monk weapon. You deal more damage, parry blows with your blade, and fire ki-powered shots at range. Best for players who've always wanted a samurai-style precision fighter who blends weapon mastery with unarmed discipline.",
  'way-of-the-sun-soul':
    'A monk who fires blasts of radiant energy instead of punching. You can stay at range — unusual for monks — and send waves of fire across the battlefield. Good for players who want monk flavour and ki management without being in constant melee range every single turn.',
  'way-of-mercy':
    "A healer-monk who wears a plague doctor mask, cures disease and poison, and eventually siphons life from enemies to restore allies. You're a solid secondary healer in combat while still dealing respectable damage. The gothic aesthetic and dual heal/harm identity make this one of the most flavorful monk paths.",
  'way-of-the-ascendant-dragon':
    'A draconic monk who infuses strikes with elemental energy, breathes out dragon breath cones, and eventually flies. You deal devastating elemental bursts and have excellent combat versatility. Feels like an upgraded, flashier version of Way of the Open Hand — great for players who want their monk to feel legendary.',
  'way-of-the-astral-self':
    'A monk who summons spectral arms from their astral body. The arms let you use Wisdom for attacks, hit at extra reach, and eventually summon a full visage that lets you see in darkness and gives an edge on Insight and Intimidation. Perfect for monks built around Wisdom — and one of the most visually dramatic subclasses in the game.',
  'cobalt-soul':
    "An investigator-monk who can expose an enemy's weaknesses mid-fight. Once exposed, you and your allies exploit specific vulnerabilities for bonus damage and extra effects. Rewards patient, tactical play — you do more work up front to set up devastating payoffs. Excellent against bosses and named enemies.",
  'scag-way-of-long-death':
    'A dark monk who feeds off the death energy of fallen enemies. When a creature dies near you, you gain temporary HP. At higher levels you channel death to terrify enemies or become briefly immune to damage. A grim, relentless fighter who genuinely thrives when surrounded by carnage.',
  'scag-way-of-sun-soul':
    'An earlier version of Way of the Sun Soul with similar radiant blast abilities. You fire blasts of burning energy, ignite enemies, and blind them with searing light. Works best paired with darkvision — blinding enemies you can still see is a devastating combination, and your area denial spells reward smart positioning.',
  'tob-way-of-the-depths':
    "A cold, crushing monk who fills enemies' lungs with water and makes them unable to breathe or speak. Up close you're terrifying — failing your saves leaves opponents silenced and suffocating. Most impactful in aquatic or horror-flavoured campaigns, and genuinely frightening when you can keep enemies adjacent.",
  'tob-way-of-the-lighthouse':
    'A radiant beacon monk who emits blinding flashes and guides allies through darkness. You draw enemy attention and control where they look, making you a disruptive presence on the battlefield. Strong thematic fit for nautical or dungeon campaigns where light and darkness matter mechanically.',

  // ── Paladin ──────────────────────────────────────────────────────────────
  'oath-of-devotion':
    "The classic paladin. You're a holy champion with powerful smites, an aura that adds your CHA to nearby allies' saving throws, and a reliable suite of divine powers. Excellent all-rounder — strong melee damage, some healing, and meaningful protection for your whole party just by standing nearby.",
  'oath-of-the-ancients':
    'A nature-pact paladin who protects light against darkness. Your Aura of Warding eventually grants resistance to ALL spell damage to nearby allies — one of the strongest defensive auras in the game. More druidic in flavour than a typical paladin, but still a dominant frontliner in any campaign.',
  'oath-of-vengeance':
    'A relentless hunter who vows destruction on a specific enemy. You can charm, frighten, slow, and teleport to your quarry — they cannot escape you. Best for players who want to feel like a supernatural bounty hunter. Campaigns with major villains or recurring enemies let this subclass truly sing.',
  'oath-of-conquest':
    'A tyrant paladin who terrorises enemies into submission. You frighten multiple foes at once and deal psychic damage to anything that tries to move while scared. Excellent crowd controller — you make the battlefield a waking nightmare. Great for players who want to dominate rather than just fight.',
  'oath-of-redemption':
    "A pacifist paladin who absorbs damage meant for allies and tries to resolve conflict without bloodshed. When forced to fight, you're a selfless shield. Best in roleplay-heavy campaigns with moral complexity — if your DM runs a game where talking your way out matters, you'll have some of the most impactful moments at the table.",
  'oath-of-glory':
    "A heroic paladin who inspires greatness — your Aura of Alacrity at level 7 boosts every nearby ally's movement speed, and after each divine smite you spread healing to nearby teammates. You're the party's mythic champion, and your presence makes everyone around you faster and harder to stop. Great support paladin for groups who want a rallying, inspirational frontliner.",
  'oath-of-the-watchers':
    'A guardian against extraplanar threats — aberrations, celestials, fiends, fey. You grant allies advantage on saves against magic and can banish outsiders back to their plane. Extremely powerful in campaigns featuring otherworldly enemies. If your DM is running a planar or cosmic campaign, this oath is tailor-made for it.',
  'scag-oath-of-crown':
    'A law-and-order paladin sworn to a kingdom and its ruler. You can swap places with allies to intercept deadly attacks and compel absolute loyalty. Best in campaigns where the party serves a liege lord — the more your story is tied to political and royal intrigue, the more this subclass shines.',
  'tob-oath-of-greed':
    'A gold-hoarding, treasure-hungry paladin who draws divine power from accumulated wealth. You curse enemies with poverty and channel avarice into combat. Hilarious in premise and surprisingly effective in practice — best in dungeon-crawling campaigns where wealth piles up fast and the loot feels legendary.',
  'tob-oath-of-the-deep':
    "A paladin sworn to the ocean's crushing depths. You gain aquatic combat bonuses, water-breathing, and can curse enemies to feel the pressure of the abyss. Excellent in maritime or undersea campaigns — your oath features are built for the sea, though your base paladin abilities remain strong anywhere.",

  // ── Ranger ───────────────────────────────────────────────────────────────
  'hunter':
    "A versatile, reliable ranger who picks combat upgrades from a menu at each tier — multi-target attacks, defensive reflexes, or burst damage. Every session you're useful and consistent. A great pick for new players who want a ranger without complex companion mechanics, and for veterans who want flexibility in how they build.",
  'beast-master':
    'A ranger bonded with an animal companion who fights at your side. Your companion can attack, distract, and assist in various ways. Best in roleplay-heavy games where having a loyal animal partner adds to your story. The emotional attachment to your companion is one of the most memorable things this subclass creates.',
  'gloom-stalker':
    'A dungeon-crawler built to devastate the first round of combat. You strike first in darkness, deal bonus damage on your opening turn, and are invisible to darkvision. If your DM runs ambush encounters or dark environments often, this is consistently the most powerful ranger subclass — you win fights before they fully start.',
  'horizon-walker':
    'A planar traveler who hunts rifts between worlds and teleports short distances every turn. You deal consistent bonus damage against extraplanar creatures and gain excellent mobility. Works well in any campaign, but shines brightest in cosmopolitan or planar settings where outsiders and portals are common.',
  'monster-slayer':
    "A specialist hunter of magical and supernatural threats. You expose a creature's defenses to allies and make it harder for them to use their spells against you. Very strong against spellcasters and legendary monsters — weaker against mundane enemies. Best in campaigns where the big threats are magical in nature.",
  'fey-wanderer':
    "A charismatic ranger touched by the Feywild who blends enchantment magic, psychic damage, and social grace. You add Wisdom to Charisma checks and eventually summon a fey spirit to fight alongside you. One of the best rangers for social-heavy campaigns — you're as effective at the negotiation table as in the forest.",
  'swarmkeeper':
    'A ranger bound to a swarm of tiny creatures that carry you, assist attacks, and drag enemies around the battlefield. You have excellent positioning and harassment — your swarm does things no weapon can. Unique and fun for players who enjoy unusual flavour and creative crowd-control options.',
  'drakewarden':
    "A ranger who bonds with a growing dragon companion. Early on the drake is a scout and breath weapon platform; by high levels you're riding it into battle. The payoff builds slowly, but few things in the game match the moment you charge into combat on the back of your own dragon.",
  'tob-ocean-hunter':
    "A sea ranger who is lethal in aquatic environments — tracking prey across open water, striking from below the waves, and thriving in naval warfare. Strongest in coastal or undersea campaigns. On dry land you're a competent ranger with a good spell list, but the ocean is where you become truly legendary.",

  // ── Rogue ────────────────────────────────────────────────────────────────
  'thief':
    'A nimble, practical burglar who acts faster than anyone else. Fast Hands lets you pick locks, palm objects, or use items as a bonus action; Second-Story Work lets you climb at full speed; and at level 13 you can use any magic item regardless of class restrictions. Great for creative, resourceful players who enjoy finding unconventional solutions — your toolkit rewards lateral thinking.',
  'assassin':
    'A deadly ambusher who deals catastrophic damage when attacking with surprise. You can auto-crit surprised enemies, and disguise yourself as anyone. Most powerful at the start of fights you set up; after the surprise is gone you rely on standard Sneak Attack. Best when stealth and infiltration are central to how your DM runs encounters.',
  'arcane-trickster':
    "A magic-using rogue who adds enchantment and illusion spells to the sneak attack toolkit. Distract enemies with a conjured hand, charm a guard, or vanish mid-fight. If you've ever wanted to play a rogue who has a few tricks up their sleeve — literally — this is the most popular rogue subclass for good reason.",
  'inquisitive':
    "A detective rogue who reads tells, spots liars, and always finds an angle to Sneak Attack. As long as you're paying attention in a fight, you can Sneak Attack anyone who attacked you recently — no ally required. Great in roleplay-heavy campaigns and ideal if you want a rogue who's the sharpest mind at the table.",
  'mastermind':
    "A manipulator who works best supporting allies from a distance. You can Help an ally attack from 30 feet away as a bonus action and impersonate anyone flawlessly. Less directly powerful than other rogues in pure combat — but in political intrigue, heist scenarios, or spy campaigns, you're the most valuable player.",
  'phantom':
    'A death-touched rogue who collects soul trinkets from kills, whispers to the recently dead for secrets, and eventually flies through walls as a ghost. The gothic aesthetic is one of the strongest in the game. If you want to be the unsettling, mysterious rogue with a connection to death, this is your subclass.',
  'scout':
    "An outdoorsy rogue who fights like a skirmisher — attacking and retreating without provoking opportunity attacks and reacting to ambushes with immediate movement. You're the party's advance scout and wilderness expert. Great for parties who travel a lot, and for players who want a ranger-rogue fantasy with simpler mechanics.",
  'soulknife':
    "A psychic rogue who creates blades of pure thought and communicates telepathically. You never need a weapon — your ki blades always appear — and you can pass secrets to allies silently. Reliable, self-sufficient, and effective in any campaign. A great pick if you want a rogue who's always prepared regardless of what equipment the dungeon strips away.",
  'swashbuckler':
    "A dashing duelist who doesn't need allies nearby to Sneak Attack — as long as you're fighting one-on-one. You attack and disengage in a single move, never triggering opportunity attacks. Best for players who want to be a solo operator: flashy, mobile, and completely capable of handling enemies on your own.",
  'scag-mastermind':
    "An earlier take on the Mastermind with similar manipulation and impersonation abilities. You're the party's master spy — getting information, placing yourself in the right rooms, and controlling social situations. Best in campaigns where who you are matters as much as what you can do.",
  'scag-swashbuckler':
    'The original swashbuckling rogue — mobile, charming, and built for elegant one-on-one dueling. You rely on Charisma, attack freely, and disengage without a thought. An earlier take on the same pirate-duelist fantasy as the XGtE version, with slightly different wording. Great for any campaign that needs a dashing, self-sufficient fighter.',
  'tob-smuggler':
    "A criminal operator who hides cargo, bribes officials, and moves contraband through any checkpoint. Your social and subterfuge skills are exceptional in urban campaigns with legal systems and trade economies. In pure dungeon crawls the flavour loses some punch — but wherever there's a city and guards, you're in your element.",

  // ── Sorcerer ─────────────────────────────────────────────────────────────
  'draconic-bloodline':
    "A sorcerer with dragon ancestry who gains natural armour, extra HP per level, and eventually wings. You're tougher than other sorcerers and your chosen draconic damage type becomes more powerful over time. A solid all-rounder — great first sorcerer subclass for players who want reliable, hard-to-kill blasting.",
  'wild-magic':
    "Your magic surges unpredictably — random effects can help or hinder you and the party, and you can deliberately trigger surges to bend luck itself. Chaotic, cinematic, and endlessly entertaining. Perfect for players who love the unexpected and are happy to occasionally set their DM's plans on fire in the best possible way.",
  'divine-soul':
    "A sorcerer touched by divine power who gains access to Cleric spells alongside Sorcerer spells. You're effectively a hybrid of both classes without multiclassing — healing when the party needs it, blasting when you don't. Ideal for groups without a dedicated healer who still want someone who can do it all.",
  'shadow-magic':
    'Empowered by the Shadowfell, you summon hound-like shadows, see in magical darkness, and can survive a killing blow on a lucky roll. Stealthy, durable, and dark in tone. Great for gothic or underworld campaigns — and players who love the idea of cheating death as a regular part of their kit.',
  'storm-sorcery':
    "A storm-empowered sorcerer who can fly 10 feet as a bonus action whenever you cast a spell, making you extremely hard to pin down. You excel with thunder and lightning spells and build speed across water. Shines brightest in maritime or aerial campaigns, but the constant free movement is useful in any encounter — you're never standing still.",
  'aberrant-mind':
    'A sorcerer connected to eldritch forces who develops telepathy, mind-bending control spells, and the ability to morph spells into psychic effects. You can rewrite your damage types on the fly and reach into enemy minds. Best for players drawn to a Lovecraftian, cerebral flavour — you feel like something slightly wrong in the best way.',
  'clockwork-soul':
    "Connected to the cosmic machinery of order, you cancel advantage and disadvantage, summon orderly protection, and resist the chaos of wild magic. You're a reliable, structured blaster who makes the battlefield predictable in your favour. Great for players who want power without the randomness of Wild Magic.",
  'scag-storm-sorcery':
    "An earlier version of Storm Sorcery with lightning, wind, and maritime-themed abilities. You fly short distances, cast with stormy flair, and feel at home on a ship's deck in a hurricane. Solid in naval and stormy outdoor environments — a sorcerer who commands the weather.",
  'tob-gold-bloodline':
    'A greedy, treasure-obsessed sorcerer whose power literally comes from accumulated gold. You can channel wealth into spells and your magic resonates with precious metals. Thematic and surprisingly effective in dungeon-crawling campaigns where gold piles up — the richer you get, the more dangerous you become.',
  'tob-salt-bloodline':
    "A sorcerer tied to the sea's preserving salt. You deal necrotic damage with salt-infused magic, preserve things from decay, and draw power from desiccation. Niche but genuinely flavourful in coastal, desert, or undead-heavy campaigns — and the aesthetic of a sorcerer who dries things out is memorably unique.",

  // ── Warlock ──────────────────────────────────────────────────────────────
  'the-fiend':
    "A warlock who bargained with a devil. Dark One's Blessing gives you temporary HP every time you drop an enemy, you can choose resistance to any damage type on a rest, and your expanded spell list includes Fireball and Flame Strike. One of the strongest warlock pacts for pure combat — as long as enemies keep falling, you stay topped up and hard to kill.",
  'the-great-old-one':
    "A warlock linked to an incomprehensible entity. You gain telepathy at level 1, can shield your mind from intrusion, and at level 14 can create a thrall — charming a creature into a loyal agent bound to your will. Best in roleplay and mystery-heavy campaigns where knowing what people think is as valuable as hitting them. You're a manipulator and an investigator more than a brute force damage dealer.",
  'the-archfey':
    'Bound to a powerful fey lord, you charm crowds with your presence, turn invisible and teleport when hit (Misty Escape), and at level 14 plunge a creature into Dark Delirium — a hallucinatory stupor that charms or frightens them for a minute. Heavy on enchantment and illusion — great for players who enjoy psychological control. In combat you disorient more than destroy, making you feel completely different from most warlocks.',
  'hexblade':
    'A warlock bonded to a mysterious magical weapon who fights in melee using Charisma. You wear medium armour, wield a weapon, and can curse enemies to die and return as spectral servants. The most martial warlock by far — if you want to be a front-line warrior powered by eldritch bargaining, this is the path.',
  'the-celestial':
    "A warlock pacted with a powerful good entity who gains actual healing abilities. You fill a healer role while still dealing warlock damage — great for parties without a dedicated healer who don't want to fully multiclass. You're a genuine hybrid: part divine healer, part eldritch blaster.",
  'the-fathomless':
    'Bound to a deep-sea entity, you command a grasping tentacle, speak to marine creatures, and drag enemies toward a watery fate. Excellent control and battlefield denial. Most thematically powerful in nautical campaigns, but the tentacle and control toolkit work in any encounter where enemies clump together.',
  'the-genie':
    'A warlock tied to a powerful genie with an extradimensional vessel as a home base. Your spell list expands based on genie type — djinn for lightning, efreeti for fire, dao for earth, marid for water. One of the most versatile patron choices — strong utility, strong damage, and a useful safe haven to rest in.',
  'scag-the-undying':
    "A warlock pacted with an immortal entity who gradually becomes harder to kill. You regain HP when nearby creatures die, resist more damage types, and eventually resist the ravages of aging. Best for survival-focused players who want to feel unkillable — you're not the most powerful warlock, but you are the most persistent.",
  'tob-ghost-ship-patron':
    "Bound to a haunted vessel from the ethereal plane, you gain ghostly abilities — phasing through walls, commanding undead, and terrifying enemies with your patron's unearthly presence. Excellent in haunted or naval campaigns where the line between the living world and the spirit world is thin.",
  'tob-sea-goddess-patron':
    "A warlock who serves a divine ocean goddess, commanding waves and storms. You gain water manipulation, limited healing through salt water, and devastating sea-storm combat powers. Most effective in maritime campaigns — the sea goddess's power is tied to the ocean, and the further from the coast you are, the more it's tested.",

  // ── Wizard ───────────────────────────────────────────────────────────────
  'school-of-evocation':
    "The blaster wizard. You shape your explosive spells to protect allies — Fireball right in the middle of a melee scrum without hurting your team. Pure offensive power. If you want to be the party's main damage dealer and watch your enemies explode turn after turn, this is the optimal choice for that fantasy.",
  'school-of-abjuration':
    "A defensive wizard who builds a magical ward that absorbs damage before you start losing HP. You're far more durable than any other wizard and excel at counterspelling. Great for players who want to be a frontline arcane support rather than a glass cannon — you'll survive situations that destroy other wizards.",
  'school-of-illusion':
    'A deceptive wizard who creates illusions so convincing they briefly become real. You can misdirect, confuse, and reshape the battlefield with images, sounds, and phantoms. Best for creative, lateral-thinking players — your power scales with how clever you are, not just what spells you know.',
  'school-of-conjuration':
    'A wizard who teleports short distances, summons creatures more reliably, and conjures useful objects. You can call allies from across the planes and position yourself exactly where you need to be. Great for players who love having a summoned army and the freedom to appear anywhere in a fight.',
  'school-of-divination':
    'A fate-manipulating wizard who rolls two dice at the start of each day and can swap them in for any roll — enemy or ally — at will. You can cancel critical hits or guarantee a critical success on a crucial moment. One of the most impactful support subclasses in the game; you control probability itself.',
  'school-of-enchantment':
    'A mind-controlling wizard who turns enemies into allies, makes creatures ignore your spells, and dominates the social game. Heavy on charm and compulsion — best for players who prefer psychological control over direct damage. In the right campaign, an enchanter can win fights without throwing a single offensive spell.',
  'school-of-necromancy':
    'A wizard who raises the dead as permanent animated servants, gradually building an undead army. You drain life from enemies to replenish your allies and become genuinely terrifying in large fights where corpses pile up. Best for players who want to command a growing horde — each dungeon leaves you with more troops than you entered with.',
  'school-of-transmutation':
    "A shapeshifting alchemist who temporarily boosts allies' ability scores, transforms materials, and becomes a polymorph expert at high levels. You're an incredibly flexible support — you can solve problems outside combat as easily as in it, and Polymorph gives you access to some of the most powerful forms in the game.",
  'war-magic':
    'A battle-hardened wizard who trades deep spell mastery for combat resilience. You can defend yourself while maintaining concentration and gain bonuses from your cantrips. Good for wizards who want to stay in the fray longer and feel more like a battlemage than a scholar hiding at the back.',
  'order-of-scribes':
    "A bookworm wizard whose spellbook becomes a magical familiar and near-indestructible companion. You can change your spell's damage type on the fly and cast emergency spells for free occasionally. Great for players who love their spellbook as a character prop — and who want flexibility and resourcefulness over raw power.",
  'chronurgy-magic':
    'A time-manipulating wizard who freezes enemies in place, slows their reactions, and can alter initiative order to reshape who acts when. You control the when of a fight more than the what. Excellent at shutting down threats before they act — in skilled hands, this is one of the most impactful wizard archetypes.',
  'graviturgy-magic':
    "A gravity-bending wizard who moves enemies and allies freely across the battlefield, crushes targets with increased gravity, and makes creatures fly or plummet. Excellent battlefield control with satisfying visual flair. Great for players who want to feel like they're directing the whole encounter rather than just casting the biggest spell.",
  'bladesinging':
    "A wizard who dances with a blade while casting spells. You add Intelligence to your AC, move with balletic grace, and can attack twice in a turn. You're fragile but devastating when executed well. Best for players who want a melee-wizard aesthetic and are willing to manage their resources carefully to stay alive.",
  'scag-bladesinging':
    'The original Bladesinger — a combat-dancer who blends arcane spells with elegant swordplay. Same core fantasy as the XGtE version: Intelligence-based AC, graceful melee presence, and a completely different combat style from every other wizard. A memorable, high-skill-ceiling subclass for players who want to feel uniquely deadly.',
  'tob-school-of-navigators':
    "A nautical wizard who uses stars and ocean currents to enhance their magic. You predict weather, navigate flawlessly, and amplify certain spells while at sea. Best in maritime campaigns where navigation and weather matter mechanically — on the open ocean you're an invaluable asset; in a dungeon you're a very good wizard with a nautical aesthetic.",
  'tob-school-of-the-tide-watchers':
    'A wizard who reads the magical tides of time and energy to gain brief foresight. You can sense threats before they arrive and prepare accordingly. Excellent in campaigns with many combats, where information about incoming encounters gives you a meaningful edge. A cerebral, preparation-focused subclass for patient players.',
};
