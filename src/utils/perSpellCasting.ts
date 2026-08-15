import { getClass } from '../data/classes';
import { getSubclass } from '../data/subclasses';
import type { AbilityKey, Character, Spell } from '../types';

export interface SpellCasting {
  ability: AbilityKey;
  saveDC: number;
  attackBonus: number;
  /** The class the numbers came from, for a tooltip. */
  classId: string;
}

/**
 * The DC and attack bonus for ONE spell, from the class that actually grants it.
 *
 * PHB p.164: "Each spell you cast using a spell slot uses the spellcasting ability of the
 * class it came from." The sheet had a single character-wide DC taken from the first class
 * that casts anything, so a cleric 5 / wizard 5 rolled every wizard spell off Wisdom —
 * usually the wrong number by two or three, silently, on every spell all session.
 *
 * Falls back to the character-wide values when no class claims the spell: racial and
 * feat-granted spells name their own ability elsewhere, and an unclaimed spell should keep
 * behaving exactly as it did rather than lose its buttons.
 */
export function castingForSpell(
  character: Pick<Character, 'classes'>,
  spell: Spell,
  ctx: { mods: Record<string, number>; profBonus: number; fallback: Omit<SpellCasting, 'classId'> },
): SpellCasting {
  for (const cl of character.classes ?? []) {
    const cls = getClass(cl.classId);
    if (!cls) continue;
    const sub = cl.subclassId ? getSubclass(cl.subclassId) : undefined;

    // Third-caster subclasses (Eldritch Knight, Arcane Trickster) cast from the wizard
    // list with INT, while their base class casts nothing at all.
    const subCasts = !!sub?.spellcastingType && sub.spellcastingType !== 'none';
    const classCasts = !!cls.spellcastingType && cls.spellcastingType !== 'none';
    if (!classCasts && !subCasts) continue;

    const listId = subCasts ? (sub!.spellListClassId ?? cl.classId) : (cls.spellListClassId ?? cl.classId);
    if (!spell.classes.includes(listId)) continue;

    const ability = (subCasts ? 'int' : cls.spellcastingAbility) as AbilityKey | undefined;
    if (!ability) continue;
    const mod = ctx.mods[ability] ?? 0;
    return {
      ability,
      saveDC: 8 + ctx.profBonus + mod,
      attackBonus: ctx.profBonus + mod,
      classId: cl.classId,
    };
  }
  return { ...ctx.fallback, classId: character.classes?.[0]?.classId ?? '' };
}
