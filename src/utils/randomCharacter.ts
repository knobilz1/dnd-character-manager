import { ALL_RACES } from '../data/races';
import { ALL_CLASSES } from '../data/classes';
import { ALL_SUBCLASSES } from '../data/subclasses';
import { ALL_BACKGROUNDS } from '../data/backgrounds';
import { ALL_SPELLS } from '../data/spells';
import {
  cantripsKnownFor, spellsKnownFor, maxPreparedSpellsFor, computeMaxSpellLevel,
} from '../data/mechanics';
import { bookEnabled } from './bookEnabled';
import { chosenAsi } from './racialAsi';
import type { AbilityKey, BookId, Race, SkillName } from '../types';

/**
 * Roll a whole level-1 character out of the books the player enabled.
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
  baseAbilityScores: Record<AbilityKey, number>;
  selectedSkillProficiencies: SkillName[];
  spellbook: { spellId: string; isPrepared: boolean }[];
  racialAbilityChoice?: Record<string, number>;
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

export function rollRandomCharacter(
  books: BookId[], rand: () => number = Math.random,
): RandomCharacter | null {
  const races = selectableRaces(books);
  const classes = ALL_CLASSES.filter(c => bookEnabled(c, books));
  const backgrounds = ALL_BACKGROUNDS.filter(b => bookEnabled(b, books));
  // Every one of these is required by finalize(); with no books enabled there is nothing to roll
  // and the caller shows that rather than building half a character.
  if (!races.length || !classes.length || !backgrounds.length) return null;

  const race = pick(races, rand);
  const cls = pick(classes, rand);
  const background = pick(backgrounds, rand);

  // Only a subclass the character would ACTUALLY have at level 1 — cleric domains, sorcerous
  // origins, warlock patrons. Handing a level-1 fighter a martial archetype would be a character
  // the creator itself refuses to build.
  const subclasses = cls.subclassLevel === 1
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

  return {
    raceId: race.id,
    classId: cls.id,
    subclassId: subclass?.id,
    backgroundId: background.id,
    baseAbilityScores,
    selectedSkillProficiencies,
    spellbook: rollSpells(cls.id, subclass?.id, books, baseAbilityScores, rand),
    racialAbilityChoice,
  };
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
  scores: Record<AbilityKey, number>, rand: () => number,
): { spellId: string; isPrepared: boolean }[] {
  const cls = ALL_CLASSES.find(c => c.id === classId);
  if (!cls || cls.spellcastingType === 'none') return [];

  // Spell entries name the 2014 class, so a 2024 class or a subclass caster has to resolve
  // through spellListClassId — the exact bug that left the sheet's own picker empty (v0.25.5).
  const sub = subclassId ? ALL_SUBCLASSES.find(s => s.id === subclassId) : undefined;
  const listId = sub?.spellListClassId ?? cls.spellListClassId ?? classId;

  const maxLevel = computeMaxSpellLevel(cls.spellcastingType ?? 'none', classId, 1);
  const usable = ALL_SPELLS.filter(s =>
    bookEnabled(s, books) && s.classes?.includes(listId) && s.level <= maxLevel);

  const cantrips = shuffled(usable.filter(s => s.level === 0), rand)
    .slice(0, cantripsKnownFor(classId, 1));

  const known = spellsKnownFor(classId, 1);
  const isWizard = classId === 'wizard' || classId === 'wizard-2024';
  const abilityMod = Math.floor(((scores[spellAbilityOf(classId)] ?? 10) - 10) / 2);
  const prepared = maxPreparedSpellsFor(classId, 1, abilityMod);
  const count = isWizard ? 6 : known > 0 ? known : (prepared ?? 0);

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
