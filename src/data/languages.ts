/**
 * Languages, and the choices races and backgrounds hand out.
 *
 * The race data stores an unchosen language as a LITERAL STRING in the languages array — eight
 * different phrasings of it, from "one extra language" to "one language of your creator's choice".
 * Nothing distinguished those from real languages, so a Human's printed sheet read
 * "Languages: Common, one extra language of your choice" and the player had nowhere to record
 * which language they actually took.
 *
 * `PLACEHOLDER` recognises them and turns them into a COUNT of picks owed; `LANGUAGES` is what the
 * player picks from. Backgrounds are simpler: they already carry a numeric `languages` count.
 */

/** Every language a character can choose. The 16 from the PHB tables plus the setting languages the
 *  race data actually uses (Gith, Leonin, Loxodon, Quori, Thri-kreen, Vedalken, Aquan, Auran). */
export const LANGUAGES: string[] = [
  // Standard
  'Common', 'Dwarvish', 'Elvish', 'Giant', 'Gnomish', 'Goblin', 'Halfling', 'Orc',
  // Exotic
  'Abyssal', 'Celestial', 'Deep Speech', 'Draconic', 'Infernal', 'Primordial', 'Sylvan',
  'Undercommon',
  // Primordial dialects, which the race data lists in their own right
  'Aquan', 'Auran', 'Ignan', 'Terran',
  // Setting languages present in the race data
  'Gith', 'Leonin', 'Loxodon', 'Quori', 'Thri-kreen', 'Vedalken',
].sort();

/**
 * How many picks this entry represents, or 0 if it names a real language.
 *
 * Matches on "choice"/"choose" or a leading "one "/"two ", which covers all eight phrasings found
 * in the data. Deliberately generous: a new phrasing is far more likely to be another placeholder
 * than a language literally called "one something", and mistaking a placeholder for a language is
 * the failure that printed one on a character sheet.
 */
export function placeholderPicks(entry: string): number {
  const s = entry.trim().toLowerCase();
  if (LANGUAGES.some(l => l.toLowerCase() === s)) return 0;
  if (!/choice|choose|^one |^two /.test(s)) return 0;
  return /^two |\btwo /.test(s) ? 2 : 1;
}

/** A race's real, named languages — placeholders removed. */
export function fixedLanguages(raceLanguages: string[] | undefined): string[] {
  return (raceLanguages ?? []).filter(l => placeholderPicks(l) === 0);
}

/** How many languages a race lets the player choose. */
export function racialLanguagePicks(raceLanguages: string[] | undefined): number {
  return (raceLanguages ?? []).reduce((n, l) => n + placeholderPicks(l), 0);
}
