import type { Character, InventoryItem } from '../types';
import { baseClassId } from '../data/classes';

/**
 * Attunement: the three-item cap that the sheet has never enforced.
 *
 * Whether an item needs attunement is read from its own description rather than a
 * new data field — the same call spellRoll.ts makes, and for the same reason: those
 * descriptions were checked against the source books during the per-book item
 * audits, so a parallel `requiresAttunement:` column would be a second copy of the
 * same fact, free to drift from the sentence right beside it.
 *
 * Measured over src/data/items.ts: 360 of 521 magic items say so, in phrasings from
 * "Requires attunement" to "(requires attunement by a creature with the Mark of
 * Warding)". A single case-insensitive match covers every one, and there is no
 * negated phrasing anywhere in the file to trip it up.
 */

const ATTUNEMENT_RE = /requires?\s+attunement/i;

/** PHB p.138 — three, for everyone without a feature that says otherwise. */
export const BASE_ATTUNEMENT_SLOTS = 3;

export function requiresAttunement(item: InventoryItem): boolean {
  return ATTUNEMENT_RE.test(item.description ?? '');
}

/**
 * How many items this character may be attuned to at once.
 *
 * Artificer's ladder is TCE p.107/111/113 — Magic Item Adept (10th) 4, Savant
 * (14th) 5, Master (18th) 6. The Gold Bloodline sorcerer's Treasure Hunter (14th)
 * raises it to 5. Both are class/subclass LEVEL checks, not total character level:
 * an artificer 10 / fighter 5 gets 4 slots, and a fighter 15 does not.
 */
export function attunementSlots(character: Character): number {
  let slots = BASE_ATTUNEMENT_SLOTS;
  for (const cl of character.classes ?? []) {
    if (baseClassId(cl.classId) === 'artificer') {
      const fromArtificer = cl.level >= 18 ? 6 : cl.level >= 14 ? 5 : cl.level >= 10 ? 4 : BASE_ATTUNEMENT_SLOTS;
      slots = Math.max(slots, fromArtificer);
    }
    if (cl.subclassId === 'tob-gold-bloodline' && cl.level >= 14) slots = Math.max(slots, 5);
  }
  return slots;
}

/** Items currently attuned. Counts rows, not quantity: attuning to a stack of two
 *  identical rings is still two separate attunements, and the sheet has no way to
 *  attune to one of a stack — so a stack counts once and the player splits the row
 *  if they really hold two. */
export function attunedItems(character: Character): InventoryItem[] {
  return (character.inventory ?? []).filter(i => i.attuned);
}

/** Whether `item` can be attuned right now — false when the cap is already full,
 *  so the UI can explain instead of silently doing nothing. */
export function canAttune(character: Character, item: InventoryItem): boolean {
  if (item.attuned) return true; // already attuned; toggling off is always allowed
  if (!requiresAttunement(item)) return false;
  return attunedItems(character).length < attunementSlots(character);
}
