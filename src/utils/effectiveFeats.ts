import { getBackground } from '../data/backgrounds';
import type { Character } from '../types';

/**
 * Every feat a character actually has: the ones they spent an ASI on, plus the Origin
 * feat their PHB 2024 background grants for free.
 *
 * The 2024 rules moved a feat onto every background ("Acolyte: Magic Initiate (Cleric)"),
 * and the data recorded it only as prose inside `feature.description`. Nothing read it,
 * so a 2024 character got no Origin feat at all — no Tough hit points, no Alert
 * initiative, no Magic Initiate spells (found 2026-08-15).
 *
 * Kept OUT of `selectedFeats` on purpose. That array means "feats bought with an ASI":
 * the creator's Feats step counts it against the ASI budget and sanitizeCreatorDraft
 * trims it to that budget, so an Origin feat stored there would either eat a class feat
 * slot or be deleted on the next draft edit. Anything asking "what feats does this
 * character have, mechanically" asks here instead.
 */
export function effectiveFeatIds(character: {
  selectedFeats?: string[];
  backgroundId?: string;
}): string[] {
  const picked = character.selectedFeats ?? [];
  const origin = character.backgroundId ? getBackground(character.backgroundId)?.originFeatId : undefined;
  // A character who also took the same feat with an ASI must not get it twice.
  return origin && !picked.includes(origin) ? [...picked, origin] : picked;
}

/** The Origin feat alone, for UI that wants to label where a feat came from. */
export function originFeatId(character: Pick<Character, 'backgroundId'>): string | undefined {
  return character.backgroundId ? getBackground(character.backgroundId)?.originFeatId : undefined;
}
