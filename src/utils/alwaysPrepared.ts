import type { ClassLevel, ClassOptionsState, PreparedSpell } from '../types';
import { getSubclass } from '../data/subclasses';

/** Shared by useCharacterStore and useCreatorStore.
 *
 *  Both stores previously carried byte-identical private copies of these two functions, so
 *  every rule change had to be made twice or the creator and the sheet would disagree about
 *  which spells a character has. Circle of the Land's land types were the change that made
 *  that cost real, so the pair moved here instead of being edited in both places. */

/** IDs of all always-prepared spells unlocked at the given class/subclass levels. */
export function computeAlwaysPreparedIds(
  classes: ClassLevel[],
  classOptions?: ClassOptionsState,
): string[] {
  const ids: string[] = [];
  for (const cl of classes) {
    const sub = cl.subclassId ? getSubclass(cl.subclassId) : undefined;
    if (!sub) continue;
    for (const [minLevelStr, spellIds] of Object.entries(sub.alwaysPreparedSpells ?? {})) {
      if (cl.level >= Number(minLevelStr)) ids.push(...spellIds);
    }
    // Choice-dependent spells (Circle of the Land). With no land type chosen the subclass
    // grants nothing — which is what it did for every Land druid before this existed.
    const chosen = classOptions?.landType;
    if (sub.landSpells && chosen) {
      for (const [minLevelStr, spellIds] of Object.entries(sub.landSpells[chosen] ?? {})) {
        if (cl.level >= Number(minLevelStr)) ids.push(...spellIds);
      }
    }
  }
  return [...new Set(ids)];
}

/** Ensure the spellbook contains all alwaysPrepared IDs, flagged correctly. */
export function syncAlwaysPrepared(
  spellbook: PreparedSpell[],
  alwaysPreparedIds: string[],
): PreparedSpell[] {
  const result = spellbook.map(s => ({
    ...s,
    isAlwaysPrepared: alwaysPreparedIds.includes(s.spellId),
    isPrepared: alwaysPreparedIds.includes(s.spellId) ? true : s.isPrepared,
  }));
  for (const id of alwaysPreparedIds) {
    if (!result.some(s => s.spellId === id)) {
      result.push({ spellId: id, isPrepared: true, isAlwaysPrepared: true });
    }
  }
  return result;
}
