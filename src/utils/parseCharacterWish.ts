import { ALL_CLASSES } from '../data/classes';
import { ALL_BACKGROUNDS } from '../data/backgrounds';
import { selectableRaces } from './randomCharacter';
import { bookEnabled } from './bookEnabled';
import type { BookId } from '../types';

/**
 * Read a player's one-line wish ("a lvl 4 warrior, don't care about background, make it cool")
 * and pull out only the parts the RULES can act on.
 *
 * Deliberately plain string matching, not a language-model call. The roller's whole design is
 * that mechanics are decided by pure, seedable code and the model only writes fiction — letting a
 * model choose the class would put it back on the wrong side of that line, and would also add a
 * network round-trip to a button that currently feels instant. Everything this can't resolve is
 * left alone and handed to the fiction step, which is exactly where free text belongs.
 *
 * Matching resolves against the ENABLED BOOKS only, so a wish can never name something the
 * creator itself would refuse to build. Anything unmatched comes back in `ignored` for the UI to
 * show — silently dropping half a request is worse than admitting it.
 */

export interface CharacterWish {
  /** Resolved and available in the enabled books. */
  classId?: string;
  /** Selectable race ids the wish allows. Usually one — but naming a PARENT race ("dwarf",
   *  "elf" under the 2014 PHB) yields all of its subraces, because the parent itself is not
   *  playable and the player plainly meant "one of those". */
  raceIds?: string[];
  /** What to call the race choice in the UI ("Dwarf", "Hill Dwarf"). */
  raceLabel?: string;
  backgroundId?: string;
  /** An explicit level 1–20. */
  level?: number;
  /** "any level", "random level" — the caller rolls one. */
  randomLevel?: boolean;
  /** Bits of the wish that named nothing recognisable — reported, not applied. */
  ignored: string[];
  /** The original text, passed through to the fiction step as the concept. */
  text: string;
}

/** Everyday words for classes. A player types "warrior", not "Fighter"; refusing to understand
 *  that makes the box feel broken. Kept small on purpose — each entry is a word people actually
 *  use, not a thesaurus dump. */
const CLASS_WORDS: Record<string, string> = {
  warrior: 'fighter', soldier: 'fighter', knight: 'fighter', swordsman: 'fighter',
  mage: 'wizard', wizard: 'wizard', sorceror: 'sorcerer', witch: 'warlock',
  thief: 'rogue', assassin: 'rogue', sneak: 'rogue',
  priest: 'cleric', healer: 'cleric', cleric: 'cleric',
  archer: 'ranger', hunter: 'ranger', tracker: 'ranger',
  brute: 'barbarian', berserker: 'barbarian',
  singer: 'bard', minstrel: 'bard',
  monk: 'monk', paladin: 'paladin', druid: 'druid', artificer: 'artificer',
};

/** Longest names first so "half-elf" wins over "elf" and "hill dwarf" over "dwarf" — the same
 *  compound-id trap that made modelRace('half-elf') silently return human for months.
 *
 *  Ties break toward the SHORTER id so genuine same-name duplicates resolve predictably rather
 *  than by array order. Note that bare "elf" resolves to `elf-2024`, which is correct and not a
 *  tie at all: the 2014 Elf is a PARENT race that only holds subraces, so `selectableRaces`
 *  excludes it — High Elf and Wood Elf are what a 2014 player actually picks. */
function byLongestName<T extends { id: string; name: string }>(xs: T[]): T[] {
  return [...xs].sort((a, b) => b.name.length - a.name.length || a.id.length - b.id.length);
}

export function parseCharacterWish(text: string, books: BookId[]): CharacterWish {
  const wish: CharacterWish = { ignored: [], text: text.trim() };
  // Hyphens become spaces on BOTH sides of every comparison. Nobody types the
  // hyphen in "Half-Orc" — and with it load-bearing, "half orc fighter" failed
  // the exact-name pass, had no parent-race fallback (Half-Orc has no
  // subraces), and rolled a random race: the player asked for a half-orc and
  // watched a dragonborn come out. One character, silently ignored.
  const lower = ` ${text.toLowerCase().replace(/[^a-z0-9\- ]+/g, ' ').replace(/-/g, ' ')} `;
  const has = (word: string) => lower.includes(` ${word.toLowerCase().replace(/-/g, ' ')} `);

  // ── class ────────────────────────────────────────────────────────────────
  const classes = ALL_CLASSES.filter(c => bookEnabled(c, books));
  for (const c of byLongestName(classes)) {
    if (has(c.name)) { wish.classId = c.id; break; }
  }
  if (!wish.classId) {
    for (const [word, id] of Object.entries(CLASS_WORDS)) {
      if (!has(word)) continue;
      const hit = classes.find(c => c.id === id || c.id.startsWith(`${id}-`));
      if (hit) { wish.classId = hit.id; break; }
    }
  }

  // ── race ─────────────────────────────────────────────────────────────────
  // Exact selectable match first ("hill dwarf", "elf" under PHB 2024).
  const selectable = selectableRaces(books);
  for (const r of byLongestName(selectable)) {
    if (has(r.name)) { wish.raceIds = [r.id]; wish.raceLabel = r.name; break; }
  }
  // Then PARENT races, matched on the parentRaceId itself.
  //
  // Under the 2014 PHB a bare "a dwarf warrior" matched nothing and the race came out random —
  // the request silently ignored. There is no race RECORD named "Dwarf" to match against: the
  // subraces simply carry `parentRaceId: 'dwarf'`, and only "Hill Dwarf" / "Mountain Dwarf"
  // exist as entries. So group the selectable subraces by their parent id and match the player's
  // word against that.
  if (!wish.raceIds) {
    const byParent = new Map<string, typeof selectable>();
    for (const r of selectable) {
      if (!r.parentRaceId) continue;
      const list = byParent.get(r.parentRaceId) ?? [];
      list.push(r);
      byParent.set(r.parentRaceId, list);
    }
    // Longest parent id first, so "half-elf" is never swallowed by "elf".
    for (const parentId of [...byParent.keys()].sort((a, b) => b.length - a.length)) {
      if (!has(parentId)) continue;
      const kids = byParent.get(parentId)!;
      wish.raceIds = kids.map(k => k.id);
      // Title-case the id for display; there is no record to read a name from.
      wish.raceLabel = parentId.replace(/-/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase());
      break;
    }
  }

  // ── background ───────────────────────────────────────────────────────────
  // "don't care about background" must NOT match the background named... nothing, but the word
  // "background" alone is not a request, so only real background names count.
  for (const b of byLongestName(ALL_BACKGROUNDS.filter(x => bookEnabled(x, books)))) {
    if (has(b.name)) { wish.backgroundId = b.id; break; }
  }

  // ── level ────────────────────────────────────────────────────────────────
  // "random level" is checked FIRST: "a random level fighter" contains no digits, but
  // "level 4 or random" should still take the explicit number, so an explicit level wins.
  if (/\b(?:random|any|surprise\s+me\s+on(?:\s+the)?)\s+(?:starting\s+)?(?:lvl|level|lv)\b/i.test(text)
      || /\b(?:lvl|level|lv)\s*[:=]?\s*(?:random|any)\b/i.test(text)) {
    wish.randomLevel = true;
  }
  // "level 4", "lvl.7", "lv 12" — and bare "a level 5 wizard".
  const m = /\b(?:lvl|level|lv)\s*\.?\s*:?\s*(\d{1,2})\b/i.exec(text);
  if (m) {
    const n = parseInt(m[1], 10);
    if (n >= 1 && n <= 20) { wish.level = n; wish.randomLevel = false; }
  }

  return wish;
}
