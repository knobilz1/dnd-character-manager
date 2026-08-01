/**
 * Tool proficiencies, and the choices classes and backgrounds hand out.
 *
 * Like languages, an unmade choice is stored as free text inside a `toolProficiencies` array —
 * "One type of artisan's tools or one musical instrument", "Three musical instruments of your
 * choice" — and was printed on the sheet verbatim, with nowhere to record what was picked.
 *
 * Unlike languages, the choice is CATEGORISED: a bard's three picks must be instruments, and a
 * monk's single pick may be artisan's tools OR an instrument. So a grant parses to a count plus
 * the set of categories it may be spent in, and each grant gets its own picker rather than being
 * pooled — pooling would let a bard spend instrument picks on smith's tools.
 *
 * All 18 distinct choice strings across every class, background and race fit this grammar; the
 * parser is checked against them rather than against invented examples.
 */

export type ToolCategory = 'artisan' | 'instrument' | 'gaming';

/** PHB p.154. */
export const ARTISAN_TOOLS = [
  "Alchemist's supplies", "Brewer's supplies", "Calligrapher's supplies", "Carpenter's tools",
  "Cartographer's tools", "Cobbler's tools", "Cook's utensils", "Glassblower's tools",
  "Jeweler's tools", "Leatherworker's tools", "Mason's tools", "Painter's supplies",
  "Potter's tools", "Smith's tools", "Tinker's tools", "Weaver's tools", "Woodcarver's tools",
];

export const MUSICAL_INSTRUMENTS = [
  'Bagpipes', 'Drum', 'Dulcimer', 'Flute', 'Horn', 'Lute', 'Lyre', 'Pan flute', 'Shawm', 'Viol',
];

export const GAMING_SETS = [
  'Dice set', 'Dragonchess set', 'Playing card set', 'Three-Dragon Ante set',
];

export const TOOLS_BY_CATEGORY: Record<ToolCategory, string[]> = {
  artisan: ARTISAN_TOOLS,
  instrument: MUSICAL_INSTRUMENTS,
  gaming: GAMING_SETS,
};

export interface ToolGrant {
  /** How many to pick. */
  count: number;
  /** Which categories the picks may come from — more than one when the grant says "or". */
  categories: ToolCategory[];
  /** An explicit either/or between NAMED tools rather than categories: the one grant in the data
   *  reading "Navigator's tools or thieves' tools". Without this it parsed as a fixed proficiency
   *  and printed the word "or" on the character sheet. */
  named?: string[];
}

/**
 * Parse a tool-proficiency string into a choice, or null when it names a specific tool.
 *
 * A string only counts as a choice if it names a CATEGORY. "Herbalism kit" and "Thieves' tools"
 * are specific grants and return null, which is what keeps them printing as proficiencies rather
 * than silently becoming an unfillable picker.
 */
export function parseToolGrant(entry: string): ToolGrant | null {
  const s = entry.toLowerCase();
  const categories: ToolCategory[] = [];
  if (/artisan/.test(s)) categories.push('artisan');
  if (/musical instrument/.test(s)) categories.push('instrument');
  if (/gaming set/.test(s)) categories.push('gaming');
  if (categories.length === 0) {
    // No category named. An explicit "A or B" between two real tools is still a choice — the data
    // has exactly one ("Navigator's tools or thieves' tools"), and left unparsed it printed the
    // word "or" on the sheet as though it were a proficiency.
    if (/ or /i.test(entry)) {
      const named = entry.split(/ or /i).map(x => x.trim()).filter(Boolean);
      if (named.length > 1) return { count: 1, categories: [], named };
    }
    return null;
  }
  // "One type of artisan's tools or ONE musical instrument" is a single pick, so only an explicit
  // leading multiple counts. Three is the largest the data uses (the bard's instruments).
  const count = /\bthree\b|\b3\b/.test(s) ? 3 : /\btwo\b|\b2\b/.test(s) ? 2 : 1;
  return { count, categories };
}

/** The tools a grant list names outright — choices removed. */
export function fixedTools(entries: string[] | undefined): string[] {
  return (entries ?? []).filter(t => parseToolGrant(t) === null);
}

/** Every option a grant allows, in catalog order. */
export function toolOptions(grant: ToolGrant): string[] {
  return grant.named ?? grant.categories.flatMap(c => TOOLS_BY_CATEGORY[c]);
}
