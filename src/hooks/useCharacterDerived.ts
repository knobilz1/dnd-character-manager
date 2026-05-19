import { useMemo } from 'react';
import type { Character, AbilityKey, AbilityScores } from '../types';
import { PROFICIENCY_BONUS, SKILL_ABILITY, abilityMod, totalCharacterLevel, FULL_CASTER_SLOTS, HALF_CASTER_SLOTS, ARTIFICER_SLOTS, THIRD_CASTER_SLOTS, cantripsKnownFor, maxPreparedSpellsFor, getMulticlassSpellSlots } from '../data/mechanics';
import { getClass } from '../data/classes';
import { getSubclass } from '../data/subclasses';
import { getRace } from '../data/races';
import { getBackground } from '../data/backgrounds';
import { ALL_FEATS } from '../data/feats';

// Eldritch Knight and Arcane Trickster get spellcasting via subclass.
// Look up the effective spellcasting type for a class+subclass combo.
function effectiveSpellcasting(classId: string, subclassId: string | undefined) {
  const def = getClass(classId);
  if (def && def.spellcastingType !== 'none') {
    return { type: def.spellcastingType, ability: def.spellcastingAbility };
  }
  if (!subclassId) return null;
  const sub = getSubclass(subclassId);
  if (sub?.spellcastingType && sub.spellcastingType !== 'none') {
    // Third-caster subclasses use Int by RAW (EK, AT). Allow subclass to specify if added later.
    return { type: sub.spellcastingType, ability: 'int' as AbilityKey };
  }
  return null;
}

export function useCharacterDerived(character: Character | null) {
  return useMemo(() => {
    if (!character) return null;

    const race = getRace(character.raceId);
    const primaryClassLevel = character.classes[0];
    const primaryClassDef = primaryClassLevel ? getClass(primaryClassLevel.classId) : null;
    const totalLevel = totalCharacterLevel(character.classes);
    const profBonus = PROFICIENCY_BONUS[Math.min(totalLevel, 20)] ?? 2;

    // Final ability scores = base + racial + feat bonuses
    const finalScores: AbilityScores = { ...character.baseAbilityScores };
    if (race) {
      for (const [key, val] of Object.entries(race.abilityScoreIncreases)) {
        finalScores[key as AbilityKey] = (finalScores[key as AbilityKey] ?? 10) + (val ?? 0);
      }
    }
    for (const featId of character.selectedFeats) {
      const feat = ALL_FEATS.find(f => f.id === featId);
      if (feat?.abilityScoreIncrease) {
        for (const [key, val] of Object.entries(feat.abilityScoreIncrease)) {
          finalScores[key as AbilityKey] = (finalScores[key as AbilityKey] ?? 10) + (val ?? 0);
        }
      }
    }
    // Cap at 20 (unless a feature raises it); guard against undefined scores
    for (const k of Object.keys(finalScores) as AbilityKey[]) {
      finalScores[k] = Math.min(finalScores[k] ?? 10, 20);
    }

    const mods: Record<AbilityKey, number> = {
      str: abilityMod(finalScores.str ?? 10),
      dex: abilityMod(finalScores.dex ?? 10),
      con: abilityMod(finalScores.con ?? 10),
      int: abilityMod(finalScores.int ?? 10),
      wis: abilityMod(finalScores.wis ?? 10),
      cha: abilityMod(finalScores.cha ?? 10),
    };

    // AC (unarmored default; classes with Unarmored Defense use different formulas)
    let ac = 10 + mods.dex;
    if (primaryClassDef?.id === 'barbarian') ac = 10 + mods.dex + mods.con;
    else if (primaryClassDef?.id === 'monk') ac = 10 + mods.dex + mods.wis;

    // Saving throws — per PHB multiclassing rules, you only keep the saving throw
    // proficiencies of your FIRST class. Adding every class's saves is wrong.
    const savingThrowProficiencies = new Set<AbilityKey>();
    const primarySaveDef = getClass(character.classes[0]?.classId);
    if (primarySaveDef) primarySaveDef.savingThrows.forEach(s => savingThrowProficiencies.add(s));
    const savingThrows: Record<AbilityKey, number> = {} as Record<AbilityKey, number>;
    for (const k of Object.keys(mods) as AbilityKey[]) {
      savingThrows[k] = mods[k] + (savingThrowProficiencies.has(k) ? profBonus : 0);
    }

    // Skill bonuses — merge class choices with background-granted proficiencies
    const bg = getBackground(character.backgroundId);
    const skillProfs = new Set<string>([
      ...character.selectedSkillProficiencies,
      ...(bg?.skillProficiencies ?? []),
    ]);
    const skills: Record<string, number> = {};
    for (const [skill, ability] of Object.entries(SKILL_ABILITY)) {
      const base = mods[ability as AbilityKey];
      const prof = skillProfs.has(skill as any) ? profBonus : 0;
      // Bard: Jack of All Trades = half prof on non-proficient skills
      const bardLevel = character.classes.find(c => c.classId === 'bard')?.level ?? 0;
      const jackOfAllTrades = bardLevel >= 2 && !skillProfs.has(skill as any) ? Math.floor(profBonus / 2) : 0;
      skills[skill] = base + prof + jackOfAllTrades;
    }
    const passivePerception = 10 + (skills['Perception'] ?? 0);

    // Initiative
    const initiative = mods.dex;

    // Speed (adjusted for exhaustion)
    const exhaustionLevel = character.exhaustionLevel ?? 0;
    const _baseSpeed = race?.speed ?? 30;
    const speed = exhaustionLevel >= 5 ? 0
      : exhaustionLevel >= 2 ? Math.floor(_baseSpeed / 2)
      : _baseSpeed;

    // Spellcasting (incl. third-caster subclasses Eldritch Knight / Arcane Trickster).
    const primaryEff = primaryClassLevel
      ? effectiveSpellcasting(primaryClassLevel.classId, primaryClassLevel.subclassId)
      : null;
    let spellcastingAbility: AbilityKey | null = null;
    let spellSaveDC = 0;
    let spellAttackBonus = 0;
    if (primaryEff?.ability) {
      spellcastingAbility = primaryEff.ability;
      spellSaveDC = 8 + profBonus + mods[spellcastingAbility];
      spellAttackBonus = profBonus + mods[spellcastingAbility];
    }

    // Spell slot totals — counts each class's effective spellcasting type (from subclass if needed).
    const slotTotals: Record<number, number> = {};
    const spellcasterClasses = character.classes
      .map(cl => ({ cl, eff: effectiveSpellcasting(cl.classId, cl.subclassId) }))
      .filter(x => x.eff && (x.eff.type as string) !== 'none' && (x.eff.type as string) !== 'pact') as Array<{ cl: typeof character.classes[number]; eff: { type: 'full' | 'half' | 'third'; ability: AbilityKey } }>;

    if (spellcasterClasses.length === 1) {
      const { cl, eff } = spellcasterClasses[0];
      const table = eff.type === 'full' ? FULL_CASTER_SLOTS :
        eff.type === 'half' ? (cl.classId === 'artificer' ? ARTIFICER_SLOTS : HALF_CASTER_SLOTS) :
        THIRD_CASTER_SLOTS;
      const row = table[Math.min(Math.max(cl.level, 1), 20)] ?? [];
      row.forEach((count, idx) => { slotTotals[idx + 1] = count; });
    } else if (spellcasterClasses.length > 1) {
      const row = getMulticlassSpellSlots(
        spellcasterClasses.map(({ cl, eff }) => ({ type: eff.type, level: cl.level }))
      );
      row.forEach((count, idx) => { slotTotals[idx + 1] = count; });
    }

    // Number of prepared spells (for prepared casters only) and max spell level
    let maxPreparedSpells: number | null = null;
    let cantripsKnown = 0;
    if (primaryClassDef && spellcastingAbility) {
      const casterLevel = primaryClassLevel?.level ?? 0;
      const spellMod = mods[spellcastingAbility];
      maxPreparedSpells = maxPreparedSpellsFor(primaryClassDef.id, casterLevel, spellMod);
      cantripsKnown = cantripsKnownFor(primaryClassDef.id, casterLevel);
      // Eldritch Knight and Arcane Trickster learn cantrips via their subclass
      // (2 at level 3, 3 at level 10). The base Fighter/Rogue class has 0 cantrips
      // so cantripsKnownFor returns 0 — override it here.
      if (cantripsKnown === 0 && primaryClassLevel?.subclassId) {
        const sub = getSubclass(primaryClassLevel.subclassId);
        if (sub?.spellcastingType === 'third') {
          cantripsKnown = casterLevel >= 10 ? 3 : casterLevel >= 3 ? 2 : 0;
        }
      }
    }

    // Highest leveled slot the character has access to
    let maxSpellLevel = 0;
    for (let lvl = 9; lvl >= 1; lvl--) {
      if ((slotTotals[lvl] ?? 0) > 0) { maxSpellLevel = lvl; break; }
    }
    if (character.pactMagic && character.pactMagic.slotLevel > maxSpellLevel) {
      maxSpellLevel = character.pactMagic.slotLevel;
    }

    // Exhaustion flags
    const exhaustionDisadvChecks = exhaustionLevel >= 1; // disadvantage on ability checks / skills
    const exhaustionDisadvSaves  = exhaustionLevel >= 3; // disadvantage on saving throws
    const exhaustionHpMaxHalved  = exhaustionLevel >= 4; // HP maximum is halved
    const baseSpeed = _baseSpeed; // keep reference for tooltip display

    return {
      finalScores,
      mods,
      profBonus,
      ac,
      initiative,
      speed,
      baseSpeed,
      savingThrows,
      savingThrowProficiencies,
      skills,
      allSkillProficiencies: skillProfs,
      passivePerception,
      spellcastingAbility,
      spellSaveDC,
      spellAttackBonus,
      slotTotals,
      maxPreparedSpells,
      maxSpellLevel,
      cantripsKnown,
      totalLevel,
      primaryClassDef,
      exhaustionLevel,
      exhaustionDisadvChecks,
      exhaustionDisadvSaves,
      exhaustionHpMaxHalved,
    };
  }, [character]);
}
