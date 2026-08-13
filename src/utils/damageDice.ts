import type { RollDie } from '../store/useDiceStore';

/** Die sizes the roller can actually render (DICE in DiceRoller.tsx). */
export const VALID_DAMAGE_DICE: RollDie[] = [4, 6, 8, 10, 12, 20, 100];

export interface DamageDice {
  /** How many dice to roll and sum — the `2` in "2d6". */
  count: number;
  sides: RollDie;
}

/**
 * Parses a weapon/spell damage string into the dice to roll: "1d8" → 1×d8,
 * "2d6" → 2×d6, "d4" → 1×d4.
 *
 * The count is the whole point. This used to return only the die size, so a
 * greatsword button labelled "2d6+3" rolled a single d6 and added 3 — a live
 * wrong-numbers-at-the-table bug, not a cosmetic one. Anything that consumes
 * this must roll `count` dice, never one.
 *
 * Returns null for the sheet's "—" placeholder and for die sizes the roller has
 * no face for, so callers can hide the button rather than roll something wrong.
 *
 * Lives here rather than in a panel because SheetPage and SidebarPanel both
 * need it; they previously carried verbatim copies, which is the same
 * two-copies shape that already caused a real drift bug in this file's
 * neighbourhood (see ResourceCounter's comment in SheetPage.tsx).
 */
export function parseDamageDice(dice: string): DamageDice | null {
  if (!dice) return null;
  const m = /^\s*(\d*)\s*d\s*(\d+)/i.exec(dice);
  if (!m) return null;
  const count = m[1] ? parseInt(m[1], 10) : 1;
  const sides = parseInt(m[2], 10) as RollDie;
  if (!Number.isFinite(count) || count < 1 || count > 100) return null;
  return VALID_DAMAGE_DICE.includes(sides) ? { count, sides } : null;
}

/** "2d6" / "d8" — how a parsed damage roll should be written out. */
export function formatDamageDice(d: DamageDice): string {
  return `${d.count > 1 ? d.count : ''}d${d.sides}`;
}
