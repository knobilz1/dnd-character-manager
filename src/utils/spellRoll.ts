import type { Spell } from '../types';
import type { DamageDice } from './damageDice';
import { VALID_DAMAGE_DICE } from './damageDice';

/**
 * Turns a spell's own rules text into the dice a player would pick up.
 *
 * Every number here is read from the description rather than from a new data
 * field, because those descriptions were verified against the source books
 * during the per-book audits — a parallel `damage:` column would be a second
 * copy of the same numbers, free to drift from the text right beside it. The
 * cost is that irregular wording has to be excluded by hand (see UNPARSEABLE),
 * which is a short list precisely because the audits normalised the text.
 *
 * Nothing here guesses: a spell whose dice can't be read produces null and the
 * caller hides the button, which is the same contract parseDamageDice uses.
 */

export type SpellAttackKind = 'ranged' | 'melee';

/** "Make a ranged spell attack against the target." — 32 spells in the data. */
const ATTACK_RE = /make (?:a|another) (ranged|melee) spell attack/i;

/** Cure Wounds, Spiritual Weapon and Magic Stone add the caster's modifier to
 *  the dice; most spells don't. Captured in place so the flat bonus and the
 *  modifier can't be confused for each other. */
const MOD = String.raw`(?:\s*\+\s*your\s+spellcasting\s+ability\s+modifier)`;

/**
 * All four share one group layout — 1: count, 2: sides, 3: flat bonus, 4: the
 * spellcasting modifier if the text adds it — so one reader handles them all.
 *
 * The gap before "damage" is bounded to four words so a match can't reach
 * across a sentence and pair some duration's die with a later damage clause.
 */
const DAMAGE_PATTERNS = [
  // "the target takes 1d10 fire damage", "1d4 + 1 force damage"
  new RegExp(String.raw`(\d*)d(\d+)(?:\s*\+\s*(\d+))?(${MOD})?(?=(?:\s+\S+){0,4}?\s+damage\b)`, 'i'),
  // "takes force damage equal to 1d8 + your spellcasting ability modifier" — Spiritual Weapon
  new RegExp(String.raw`damage\s+equal\s+to\s+(\d*)d(\d+)(?:\s*\+\s*(\d+))?(${MOD})?`, 'i'),
];

const HEAL_PATTERNS = [
  // "regains a number of hit points equal to 1d8 + your spellcasting ability modifier"
  new RegExp(String.raw`regains?(?:\s+a\s+number\s+of)?\s+hit\s+points?\s+equal\s+to\s+(\d*)d(\d+)(?:\s*\+\s*(\d+))?(${MOD})?`, 'i'),
  // "regain 2d6 hit points" — Aura of Vitality, Healing Spirit, Regenerate
  new RegExp(String.raw`regains?\s+(\d*)d(\d+)(?:\s*\+\s*(\d+))?(${MOD})?\s+hit\s+points?`, 'i'),
];

/**
 * A cantrip's dice multiply at character levels 5, 11 and 17 — but only when the
 * text says the DAMAGE grows. Eldritch Blast gains beams instead and must not be
 * scaled, so matching "5th level" alone would be wrong; the word "increase" is
 * what separates them. All three ordinals are listed because the books phrase
 * the same ladder as "when you reach 5th level" and as "at 5th, 11th, and 17th
 * level", and only the last of those ever has the word "level" attached.
 */
const CANTRIP_SCALES_RE = /damage[\s\S]{0,80}?increase[sd]?\b[\s\S]{0,90}?(?:5th|11th|17th) level/i;

/** "the damage increases by 1d6 for each slot level above 1st", the shorter
 *  "Damage increases by 1d8 per slot above 2nd" the later books use, and the
 *  half-rate "+1d8 for every two slot levels above 2nd" (Spiritual Weapon,
 *  Flame Blade) — which must not be read as a per-level rate. */
const UPCAST_RE = /increase[sd]?\s+by\s+(\d*)d(\d+)\s+(?:for\s+(?:each|every)|per)\s+(?:(two|2)\s+)?(?:slot\s+)?(?:levels?\s+)?above/i;

/**
 * Spells whose first dice in the text are not the roll a player wants. Listed
 * rather than fixed with a cleverer regex, because each is irregular in its own
 * way and a regex broad enough to cover them would misread ordinary spells.
 */
const UNPARSEABLE = new Set([
  // Deals nothing at level 1-4; both its dice start at 5th and climb on their
  // own ladder, so any single number here is wrong for most characters.
  'booming-blade', 'booming-blade-2024',
  'green-flame-blade', 'green-flame-blade-2024',
  // "the total rolled" of expended Hit Dice — the dice are the character's, not the spell's.
  'arcane-vigor',
  // Healing equals twice the necrotic damage you just took; one roll can't say that.
  'life-transference',
  // "2d8 + 1d6 damage" — two different dice in one roll, which SpellRoll (one count,
  // one size) cannot express. The parser read the 2d8 and silently dropped the d6,
  // which is precisely the under-roll this module exists to prevent.
  'chaos-bolt',
]);

/** Spells whose real roll is a multiple of the dice written in their text.
 *
 *  Magic Missile's description describes ONE dart ("a dart deals 1d4 + 1 force damage"),
 *  so the parser offered 1d4+1 for a spell that throws three of them — under-rolling by
 *  two-thirds on one of the most-cast spells in the game. Each extra slot level adds a
 *  dart, and darts all resolve at once, so the whole volley is a single honest roll of
 *  Nd4+N. Kept as a tiny table rather than a regex: "three darts" is prose no dice
 *  pattern should be asked to understand. */
const MULTI_DART = new Map<string, { base: number; perSlotLevel: number }>([
  ['magic-missile', { base: 3, perSlotLevel: 1 }],
  ['magic-missile-2024', { base: 3, perSlotLevel: 1 }],
]);

export interface SpellRoll {
  dice: DamageDice;
  /** Flat bonus folded in: a literal "+1" (Magic Missile) and/or the caster's
   *  spellcasting modifier where the text asks for it (Cure Wounds). */
  modifier: number;
  kind: 'damage' | 'healing';
  /** True when the spell was cast above its base level, its "At Higher Levels"
   *  text exists, and this parser could not read a dice increase out of it —
   *  so `dice` may be short. The caller must say so rather than present the
   *  number as final; silently under-rolling an upcast Spiritual Weapon is the
   *  same class of bug as rolling 1d6 for a greatsword. */
  unscaled?: boolean;
}

/** Which kind of attack roll the spell calls for, if any. */
export function spellAttackKind(spell: Spell): SpellAttackKind | null {
  const m = ATTACK_RE.exec(spell.description);
  return m ? (m[1].toLowerCase() as SpellAttackKind) : null;
}

/** How many times a cantrip's damage dice have multiplied. PHB p.201: character
 *  level, not class level — a wizard 4 / cleric 1 rolls two dice, not one. */
export function cantripTier(charLevel: number): number {
  if (charLevel >= 17) return 4;
  if (charLevel >= 11) return 3;
  if (charLevel >= 5) return 2;
  return 1;
}

export interface SpellRollOpts {
  /** Total level across all classes — drives cantrip scaling. */
  charLevel: number;
  /** The slot actually being spent. Defaults to the spell's own level. */
  slotLevel?: number;
  /** The caster's spellcasting modifier, for the spells whose text adds it. */
  spellMod?: number;
}

/** Earliest match across a set of patterns — a spell that words its dice two
 *  ways should roll the one it mentions first, not the one listed first here. */
function firstMatch(text: string, patterns: RegExp[]): RegExpExecArray | null {
  let best: RegExpExecArray | null = null;
  for (const re of patterns) {
    const m = re.exec(text);
    if (m && (!best || m.index < best.index)) best = m;
  }
  return best;
}

/**
 * The dice for one casting, scaled for cantrip level and for the slot spent.
 * Returns null when the text can't be read, so callers hide the control rather
 * than roll a number nobody can check.
 */
export function spellRoll(spell: Spell, opts: SpellRollOpts): SpellRoll | null {
  if (UNPARSEABLE.has(spell.id)) return null;

  // Damage wins ties: Vampiric Touch both deals and heals, and the damage is
  // what you roll — the healing is derived from it.
  const dmg = spell.damageType ? firstMatch(spell.description, DAMAGE_PATTERNS) : null;
  const m = dmg ?? firstMatch(spell.description, HEAL_PATTERNS);
  if (!m) return null;
  const kind: SpellRoll['kind'] = dmg ? 'damage' : 'healing';

  const sides = parseInt(m[2], 10) as DamageDice['sides'];
  if (!VALID_DAMAGE_DICE.includes(sides)) return null;
  let count = m[1] ? parseInt(m[1], 10) : 1;
  if (!Number.isFinite(count) || count < 1 || count > 100) return null;

  let modifier = m[3] ? parseInt(m[3], 10) : 0;
  if (m[4]) modifier += opts.spellMod ?? 0;

  let unscaled = false;
  if (spell.level === 0) {
    if (CANTRIP_SCALES_RE.test(spell.description)) count *= cantripTier(opts.charLevel);
  } else {
    const extra = (opts.slotLevel ?? spell.level) - spell.level;
    const up = spell.atHigherLevels ? UPCAST_RE.exec(spell.atHigherLevels) : null;
    // Only scale when the extra dice match the base die. "increases by 1d6" on a
    // d8 spell is a second, differently-sized roll, and folding it into this one
    // would report a total the player can't reproduce at the table.
    if (up && parseInt(up[2], 10) === sides) {
      const per = up[1] ? parseInt(up[1], 10) : 1;
      const step = up[3] ? 2 : 1; // "for every two slot levels above"
      count += per * Math.floor(extra / step);
    } else if (extra > 0 && spell.atHigherLevels) {
      unscaled = true;
    }
  }

  // Volley spells: the text describes one projectile, the casting throws several, and
  // both the dice and the per-dart flat bonus multiply.
  const darts = MULTI_DART.get(spell.id);
  if (darts) {
    const total = darts.base + darts.perSlotLevel * Math.max(0, (opts.slotLevel ?? spell.level) - spell.level);
    count *= total;
    modifier *= total;
    unscaled = false; // the ladder is known exactly, so nothing is being guessed at
  }

  return { dice: { count, sides }, modifier, kind, ...(unscaled ? { unscaled } : {}) };
}

/** "8d6", "1d4 + 1" — what the button says it will roll. */
export function formatSpellRoll(r: SpellRoll): string {
  const dice = `${r.dice.count}d${r.dice.sides}`;
  if (r.modifier === 0) return dice;
  return `${dice} ${r.modifier > 0 ? '+' : '−'} ${Math.abs(r.modifier)}`;
}
