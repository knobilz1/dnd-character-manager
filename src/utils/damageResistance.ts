import type { Character, DamageType } from '../types';
import { getRace } from '../data/races';

/**
 * Resistance halving, for the one path that can apply it: damage that arrives WITH a type.
 *
 * `Race.resistances` was stored on dozens of races and rendered on the sheet, and could never
 * actually do anything, because `damageHP(amount)` took a bare number — there was no damage type
 * to be resistant to. This is the missing half.
 *
 * Typed damage is OPTIONAL by design. Most hits at a table are "the goblin got you for 6", and
 * making every player classify every hit to record it would cost more than resistance is worth.
 * With no type the behaviour is exactly what it was before, so nothing that worked gets slower.
 *
 * Races only. Barbarian Rage, Draconic Resilience, the Dwarven poison trait's *advantage* (which
 * is not resistance) and magic-item resistances all live in description prose with no structured
 * field; inventing a field nothing populates is how R6's `recharge` sat inert for months. When one
 * of those grows a real field, add it here — this is the single place that decides.
 */
export function resistancesOf(character: Character): DamageType[] {
  return getRace(character.raceId)?.resistances ?? [];
}

export function isResistantTo(character: Character, type: DamageType | undefined): boolean {
  return !!type && resistancesOf(character).includes(type);
}

/**
 * The damage actually taken after resistance.
 *
 * PHB p.197: resistance halves, and the halving is applied AFTER all other modifiers, rounding
 * down. Untyped damage is returned unchanged — an unknown type is not evidence of vulnerability.
 */
export function applyResistance(
  character: Character,
  amount: number,
  type?: DamageType,
): number {
  return isResistantTo(character, type) ? Math.floor(amount / 2) : amount;
}
