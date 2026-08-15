import { ALL_RACES } from '../data/races';
import { ALL_CLASSES } from '../data/classes';
import { ALL_SUBCLASSES } from '../data/subclasses';
import { ALL_BACKGROUNDS } from '../data/backgrounds';
import { ALL_SPELLS } from '../data/spells';
import {
  cantripsKnownFor, spellsKnownFor, maxPreparedSpellsFor, computeMaxSpellLevel, asiSlotsAt,
} from '../data/mechanics';
import { bookEnabled } from './bookEnabled';
import { chosenAsi } from './racialAsi';
import type { AbilityKey, BookId, Race, SkillName } from '../types';

/**
 * Roll a whole character out of the books the player enabled, at any level 1–20.
 *
 * Deliberately built as a PURE function over an injected `rand`, not as a pile of Math.random
 * calls inside a click handler: a generator you cannot seed is a generator you cannot test, and
 * the failure mode here is a character that is subtly illegal — three skills for a class that
 * grants two, a cleric with no domain, a wizard with an empty spellbook — which nobody notices
 * until session one.
 *
 * It picks everything the RULES require and nothing they don't. Equipment and languages keep
 * their defaults; the creator's own steps remain the place to fiddle. What comes out is meant to
 * be playable as-is, not merely non-empty.
 */

/** The PHB's standard array, best-first. */
const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];
const ABILITY_ORDER: AbilityKey[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

export interface RandomCharacter {
  raceId: string;
  classId: string;
  subclassId?: string;
  backgroundId: string;
  /** 1–20. Everything below is rolled AT this level, not at 1. */
  level: number;
  baseAbilityScores: Record<AbilityKey, number>;
  selectedSkillProficiencies: SkillName[];
  spellbook: { spellId: string; isPrepared: boolean }[];
  racialAbilityChoice?: Record<string, number>;
  /** How many ASI slots were spent as +2 ability points, for the caller to explain. */
  asiSlotsSpent: number;
}

function pick<T>(xs: T[], rand: () => number): T {
  return xs[Math.floor(rand() * xs.length)];
}

/** Fisher-Yates, so "take the first N" is a fair sample rather than a biased one. */
function shuffled<T>(xs: T[], rand: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Races a player can actually choose: the picker's rule, so the two can't disagree about what
 *  exists. A parent that only holds subraces is not itself playable. */
export function selectableRaces(books: BookId[]): Race[] {
  const available = ALL_RACES.filter(r => bookEnabled(r, books) && !r.hidden);
  const parentIds = new Set(
    available.filter(r => r.isSubrace).map(r => r.parentRaceId).filter(Boolean) as string[],
  );
  return available.filter(r => r.isSubrace || !parentIds.has(r.id));
}

/** Standard array down the class's own priority order: its primary abilities first, then
 *  Constitution (nobody wants a d6 barbarian), then whatever is left. A random assignment makes
 *  a wizard with 8 Intelligence, which is a joke character rather than a random one. */
function assignAbilities(primary: AbilityKey[]): Record<AbilityKey, number> {
  const order: AbilityKey[] = [];
  for (const a of primary) if (!order.includes(a)) order.push(a);
  if (!order.includes('con')) order.push('con');
  for (const a of ABILITY_ORDER) if (!order.includes(a)) order.push(a);

  const out = {} as Record<AbilityKey, number>;
  order.forEach((a, i) => { out[a] = STANDARD_ARRAY[i] ?? 8; });
  return out;
}

/** What the player asked for, if anything. Every field is an id that has ALREADY been resolved
 *  against the enabled books by `parseCharacterWish` — this function does not interpret text. */
export interface RollWish {
  classId?: string;
  /** Allowed race ids. More than one when the player named a PARENT race and any of its
   *  subraces will do. */
  raceIds?: string[];
  backgroundId?: string;
  /** Character level to build at. Omitted means 1 — the default the creator has always used. */
  level?: number;
}

/** Narrow a pool to one requested id, falling back to the whole pool if it isn't there.
 *
 *  The fallback is deliberate: an unavailable request must not produce `null` and lose the roll.
 *  The caller resolves ids against the enabled books first and tells the player what it
 *  understood, so by the time a wish reaches here a miss means the data changed underneath —
 *  and a random legal character still beats an error dialog. */
function narrow<T extends { id: string }>(pool: T[], ids: string | string[] | undefined): T[] {
  if (!ids) return pool;
  const want = new Set(Array.isArray(ids) ? ids : [ids]);
  if (!want.size) return pool;
  const hit = pool.filter(x => want.has(x.id));
  return hit.length ? hit : pool;
}

export function rollRandomCharacter(
  books: BookId[], rand: () => number = Math.random, wish: RollWish = {},
): RandomCharacter | null {
  const races = narrow(selectableRaces(books), wish.raceIds);
  const classes = narrow(ALL_CLASSES.filter(c => bookEnabled(c, books)), wish.classId);
  const backgrounds = narrow(ALL_BACKGROUNDS.filter(b => bookEnabled(b, books)), wish.backgroundId);
  // Every one of these is required by finalize(); with no books enabled there is nothing to roll
  // and the caller shows that rather than building half a character.
  if (!races.length || !classes.length || !backgrounds.length) return null;

  const race = pick(races, rand);
  const cls = pick(classes, rand);
  const background = pick(backgrounds, rand);
  const level = Math.max(1, Math.min(20, Math.floor(wish.level ?? 1)));

  // Only a subclass the character would ACTUALLY have AT THIS LEVEL — cleric domains at 1,
  // martial archetypes at 3. Handing a level-1 fighter an archetype builds a character the
  // creator itself refuses to build; withholding one from a level-5 fighter builds an
  // incomplete one.
  const subclasses = level >= cls.subclassLevel
    ? ALL_SUBCLASSES.filter(s => s.classId === cls.id && bookEnabled(s, books) && !s.hidden)
    : [];
  const subclass = subclasses.length ? pick(subclasses, rand) : undefined;

  const baseAbilityScores = assignAbilities(cls.primaryAbility ?? []);

  const selectedSkillProficiencies = shuffled(cls.skillChoices?.from ?? [], rand)
    .slice(0, cls.skillChoices?.count ?? 0);

  // A race with a flexible increase has to spend it or the character walks out at +0 — the same
  // hole the creator's own picker exists to close.
  const racialAbilityChoice = race.flexibleAsi
    ? spendFlexibleAsi(race, cls.primaryAbility ?? [], rand)
    : undefined;

  // Ability Score Improvements owed by this level. Spent as +2 ability points rather than feats:
  // both are legal, but points are always available while a feat can fail its prerequisites, and
  // a roll that silently skips them hands back a level-12 character with level-1 ability scores.
  const asiSlots = asiSlotsAt(cls.id, level);
  const asiSlotsSpent = spendAsiPoints(baseAbilityScores, cls.primaryAbility ?? [], asiSlots,
    race, racialAbilityChoice);

  return {
    raceId: race.id,
    classId: cls.id,
    subclassId: subclass?.id,
    backgroundId: background.id,
    level,
    baseAbilityScores,
    selectedSkillProficiencies,
    spellbook: rollSpells(cls.id, subclass?.id, books, baseAbilityScores, rand, level),
    racialAbilityChoice,
    asiSlotsSpent,
  };
}

/** Spend ASI slots as +2 ability points down the class's priority order, mutating `scores`.
 *
 *  5e caps an ability at 20 INCLUDING racial/origin increases, so the ceiling on the base score
 *  is 20 minus whatever the origin already granted. Points that cannot be placed anywhere are
 *  dropped rather than pushing a score illegal — a level-20 character can genuinely run out of
 *  useful places to put them, and an over-20 score is the kind of error nobody notices on a sheet.
 *
 *  Returns the number of slots actually spent, so the caller can say so. */
function spendAsiPoints(
  scores: Record<AbilityKey, number>, primary: AbilityKey[], slots: number,
  race: Race, racialChoice: Record<string, number> | undefined,
): number {
  if (slots <= 0) return 0;
  const origin = chosenAsi(race, racialChoice) as Record<string, number>;
  const capFor = (k: AbilityKey) => 20 - (origin[k] ?? 0);

  const order: AbilityKey[] = [];
  for (const a of [...primary, 'con' as AbilityKey, ...ABILITY_ORDER]) {
    if (!order.includes(a)) order.push(a);
  }

  let spent = 0;
  for (let s = 0; s < slots; s++) {
    let placed = 0;
    for (let p = 0; p < 2; p++) {
      const target = order.find(k => (scores[k] ?? 10) < capFor(k));
      if (!target) break;
      scores[target] = (scores[target] ?? 10) + 1;
      placed++;
    }
    if (placed === 0) break;   // everything is at its cap; further slots have nowhere to go
    spent++;
  }
  return spent;
}

/** Put a flexible racial increase where the class wants it.
 *
 *  `flexibleAsi` is a list of legal DISTRIBUTIONS — `[[2,1]]`, or `[[2,1],[1,1,1]]` — and
 *  `needsAsiChoice` only accepts a choice whose multiset matches one of them exactly. So one
 *  distribution is picked whole and its amounts are spent down the class's priority order,
 *  biggest first: a random spread that happens to sum correctly would still be rejected. */
function spendFlexibleAsi(
  race: Race, primary: AbilityKey[], rand: () => number,
): Record<string, number> | undefined {
  const distributions = race.flexibleAsi;
  if (!distributions?.length) return undefined;
  const amounts = [...pick(distributions, rand)].sort((a, b) => b - a);

  const wanted: AbilityKey[] = [];
  for (const a of [...primary, 'con' as AbilityKey, ...ABILITY_ORDER]) {
    if (!wanted.includes(a)) wanted.push(a);
  }
  const out: Record<string, number> = {};
  amounts.forEach((amount, i) => { out[wanted[i] ?? ABILITY_ORDER[i]] = amount; });
  return out;
}

/** Cantrips and spells for a level-1 caster, honouring the same limits the creator's spell step
 *  enforces: cantrips known, spells known for a known-caster, prepared count for a prepared one,
 *  and a wizard's six-spell starting spellbook.
 *
 *  Non-casters get an empty list rather than a plausible-looking one — a fighter carrying two
 *  cantrips is worse than a fighter carrying none. */
function rollSpells(
  classId: string, subclassId: string | undefined, books: BookId[],
  scores: Record<AbilityKey, number>, rand: () => number, level: number,
): { spellId: string; isPrepared: boolean }[] {
  const cls = ALL_CLASSES.find(c => c.id === classId);
  if (!cls || cls.spellcastingType === 'none') return [];

  // Spell entries name the 2014 class, so a 2024 class or a subclass caster has to resolve
  // through spellListClassId — the exact bug that left the sheet's own picker empty (v0.25.5).
  const sub = subclassId ? ALL_SUBCLASSES.find(s => s.id === subclassId) : undefined;
  const listId = sub?.spellListClassId ?? cls.spellListClassId ?? classId;

  // Every one of these helpers already took a level; the roller passed a hardcoded 1, which is
  // what limited a "level 9 wizard" to two cantrips and a handful of first-level spells.
  const maxLevel = computeMaxSpellLevel(cls.spellcastingType ?? 'none', classId, level);
  const usable = ALL_SPELLS.filter(s =>
    bookEnabled(s, books) && s.classes?.includes(listId) && s.level <= maxLevel);

  const cantrips = shuffled(usable.filter(s => s.level === 0), rand)
    .slice(0, cantripsKnownFor(classId, level));

  const known = spellsKnownFor(classId, level);
  const isWizard = classId === 'wizard' || classId === 'wizard-2024';
  const abilityMod = Math.floor(((scores[spellAbilityOf(classId)] ?? 10) - 10) / 2);
  const prepared = maxPreparedSpellsFor(classId, level, abilityMod);
  // A wizard's spellbook is six spells at level 1 and two more per level after — the class's own
  // rule, not the prepared count, which is a different and smaller number.
  const count = isWizard ? 6 + (level - 1) * 2 : known > 0 ? known : (prepared ?? 0);

  const levelled = shuffled(usable.filter(s => s.level > 0), rand).slice(0, count);

  return [
    ...cantrips.map(s => ({ spellId: s.id, isPrepared: true })),
    // A wizard's spellbook is not the same thing as their prepared list, but a level-1 wizard
    // preparing everything they know is close enough to right and far better than a sheet whose
    // spells are all greyed out.
    ...levelled.map(s => ({ spellId: s.id, isPrepared: true })),
  ];
}

/** Mirrors StepSpells' own map. Only used to size a prepared caster's list. */
function spellAbilityOf(classId: string): AbilityKey {
  if (/wizard|artificer/.test(classId)) return 'int';
  if (/bard|sorcerer|warlock|paladin-2024/.test(classId)) return 'cha';
  return 'wis';
}

/** What the race's increase actually came to, for display. Kept here so a caller can show the
 *  rolled character without re-deriving it. */
export function racialIncreaseSummary(raceId: string, choice?: Record<string, number>): string {
  const race = ALL_RACES.find(r => r.id === raceId);
  if (!race) return '';
  const inc = chosenAsi(race, choice) as Record<string, number>;
  return Object.entries(inc).map(([k, v]) => `${k.toUpperCase()} +${v}`).join(', ');
}
