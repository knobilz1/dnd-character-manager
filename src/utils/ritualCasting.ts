import { baseClassId } from '../data/classes';
import { effectiveFeatIds } from './effectiveFeats';
import type { Character } from '../types';

/** Classes whose Spellcasting feature includes Ritual Casting (PHB/TCE). Sorcerer, ranger,
 *  paladin, warlock and the third-casters are absent on purpose — they have no such feature,
 *  and the Ritual button was being offered to all of them. */
const RITUAL_CLASSES = new Set(['bard', 'cleric', 'druid', 'wizard', 'artificer']);

/**
 * Whether this character may cast a ritual-tagged spell as a ritual.
 *
 * Two separate questions, and the panel used to ask neither: does the character have ritual
 * casting at all, and does this particular spell qualify right now? A 2014 sorcerer with
 * Detect Magic was shown a Ritual button they have no feature for, and a cleric could
 * ritual a spell they had not prepared.
 *
 * The wizard is the exception that makes the rule worth encoding: they ritual straight out
 * of the spellbook, so preparation is irrelevant to them and required for everyone else.
 *
 * Scope note: the 2024 rules generalise this ("cast a prepared spell with the Ritual tag as
 * a Ritual"), which is exactly the prepared-only branch below, so 2024 characters of these
 * classes land in the right place without an edition switch. Subclass grants that hand
 * ritual casting to an otherwise-ineligible class (Warlock's Book of Ancient Secrets, the
 * Ritual Caster feat) are handled explicitly.
 */
export function canRitualCast(
  character: Pick<Character, 'classes' | 'selectedFeats' | 'backgroundId' | 'classOptions'>,
  isPrepared: boolean,
): boolean {
  const classes = character.classes ?? [];
  const hasRitualClass = classes.some((cl) => RITUAL_CLASSES.has(baseClassId(cl.classId)));
  const feats = effectiveFeatIds(character);
  const hasRitualFeat = feats.includes('ritual-caster') || feats.includes('ritual-caster-2024');
  const hasTomeSecrets = (character.classOptions?.invocations ?? []).includes('book-of-ancient-secrets');

  if (!hasRitualClass && !hasRitualFeat && !hasTomeSecrets) return false;

  // A wizard (and anyone casting from a ritual book of their own) reads the ritual off the
  // page rather than out of memory, so preparation never applies to them.
  const castsFromABook =
    classes.some((cl) => baseClassId(cl.classId) === 'wizard') || hasRitualFeat || hasTomeSecrets;
  return castsFromABook || isPrepared;
}
