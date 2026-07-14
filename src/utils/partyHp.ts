import type { Character } from '../types';

/**
 * Whether a party member's HP is actually a known number.
 *
 * `Character.currentHP` / `maxHP` are typed as required numbers, but for the DM
 * Console's party that type is a promise nobody keeps. Party members don't come
 * from the character creator — they arrive as raw JSON POSTed to the LAN port,
 * and party_listener.rs's `/character` handler only checks that `name` and
 * `classes` are present before handing it to usePartyStore. Anything else on the
 * network can send a character with no HP at all.
 *
 * From there it compounds: applyDmActions does `c.currentHP - dmg`, which is
 * `undefined - 5` → NaN, and writes that NaN back into the store (dmActions.ts
 * already predicted exactly this in a comment, but only guarded the *action's*
 * amount, not the character's own HP). The NaN then reaches the DM every turn
 * via dmPrompt.ts's statusLine as literal `HP NaN/undefined`.
 *
 * Deliberately NOT coerced to 0. "0 HP" is not a safe default here — it tells
 * the DM the character is dying, and the model will narrate them into death
 * saves. HP that isn't known has to READ as not known, everywhere.
 */
export function hasKnownHp(c: Pick<Character, 'currentHP' | 'maxHP'>): boolean {
  return Number.isFinite(c.currentHP) && Number.isFinite(c.maxHP);
}
