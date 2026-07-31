import type { AbilityKey, Race } from '../types';

/**
 * The racial ability increases actually in effect for a character.
 *
 * Races printed from Tasha's onward (MMoM, SJA, FToD, SCoC) and PHB's Variant Human let the player
 * choose where the increase goes, so their `abilityScoreIncreases` is empty and the real value lives
 * on the character as `racialAbilityChoice`. Nineteen call sites used to read
 * `race.abilityScoreIncreases` directly, which meant every one of those 42 races contributed +0 to
 * every ability — permanently, with no way for the player to supply the missing numbers.
 *
 * Always read racial increases through this function. `chosen` is ignored for a fixed-ASI race, so
 * it is safe to pass unconditionally.
 */
export function racialAsi(
  race: Race | undefined,
  chosen: Partial<Record<AbilityKey, number>> | undefined,
): Partial<Record<AbilityKey, number>> {
  if (race?.flexibleAsi) return chosen ?? {};
  return race?.abilityScoreIncreases ?? {};
}

/**
 * True when the player still owes a choice: the race is flexible and what is stored does not match
 * any of the legal distributions. Used to prompt, and to keep a half-made choice from counting.
 *
 * A distribution matches when the multiset of chosen increments equals it exactly — so "+2/+1" is
 * not satisfied by a lone +2, and stray zero entries never count.
 */
export function needsRacialAsi(
  race: Race | undefined,
  chosen: Partial<Record<AbilityKey, number>> | undefined,
): boolean {
  if (!race?.flexibleAsi) return false;
  const picked = Object.values(chosen ?? {}).filter((n): n is number => !!n).sort((a, b) => b - a);
  return !race.flexibleAsi.some(dist => {
    const want = [...dist].sort((a, b) => b - a);
    return want.length === picked.length && want.every((n, i) => n === picked[i]);
  });
}
