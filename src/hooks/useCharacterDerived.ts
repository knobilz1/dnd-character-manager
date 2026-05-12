import { useMemo } from 'react';
import type { Character, AbilityKey, AbilityScores } from '../types';
import { PROFICIENCY_BONUS, SKILL_ABILITY, abilityMod, totalCharacterLevel, FULL_CASTER_SLOTS, HALF_CASTER_SLOTS, THIRD_CASTER_SLOTS, cantripsKnownFor, maxPreparedSpellsFor, getMulticlassSpellSlots } from '../data/mechanics';
import { getClass } from '../data/classes';
import { getRace } from '../data/races';
import { ALL_FEATS } from '../data/feats';

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
    // Cap at 20 (unless a feature raises it)
    for (const k of Object.keys(finalScores) as AbilityKey[]) {
      finalScores[k] = Math.min(finalScores[k], 20);
    }

    const mods: Record<AbilityKey, number> = {
      str: abilityMod(finalScores.str),
      dex: abilityMod(finalScores.dex),
      con: abilityMod(finalScores.con),
      int: abilityMod(finalScores.int),
      wis: abilityMod(finalScores.wis),
      cha: abilityMod(finalScores.cha),
    };

    // AC (unarmored default; classes with Unarmored Defense use different formulas)
    let ac = 10 + mods.dex;
    if (primaryClassDef?.id === 'barbarian') ac = 10 + mods.dex + mods.con;
    else if (primaryClassDef?.id === 'monk') ac = 10 + mods.dex + mods.wis;

    // Saving throws
    const savingThrowProficiencies = new Set<AbilityKey>();
    for (const cl of character.classes) {
      const def = getClass(cl.classId);
      if (def) def.savingThrows.forEach(s => savingThrowProficiencies.add(s));
    }
    const savingThrows: Record<AbilityKey, number> = {} as Record<AbilityKey, number>;
    for (const k of Object.keys(mods) as AbilityKey[]) {
      savingThrows[k] = mods[k] + (savingThrowProficiencies.has(k) ? profBonus : 0);
    }

    // Skill bonuses
    const skillProfs = new Set(character.selectedSkillProficiencies);
    // Add background-granted skills
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

    // Speed
    const speed = race?.speed ?? 30;

    // Spellcasting
    let spellcastingAbility: AbilityKey | null = null;
    let spellSaveDC = 0;
    let spellAttackBonus = 0;
    if (primaryClassDef?.spellcastingAbility) {
      spellcastingAbility = primaryClassDef.spellcastingAbility;
      spellSaveDC = 8 + profBonus + mods[spellcastingAbility];
      spellAttackBonus = profBonus + mods[spellcastingAbility];
    }

    // Spell slot totals.
    // Single-class: use that class's direct slot table.
    // Multi-class: 5e multiclass rule — sum effective caster levels (full=1, half=1/2 floor,
    // third=1/3 floor; pact-only doesn't contribute) and look up combined slots.
    const slotTotals: Record<number, number> = {};
    const spellcasterClasses = character.classes
      .map(cl => ({ cl, def: getClass(cl.classId) }))
      .filter(x => x.def && x.def.spellcastingType !== 'none' && x.def.spellcastingType !== 'pact');

    if (spellcasterClasses.length === 1) {
      const { cl, def } = spellcasterClasses[0];
      const table = def!.spellcastingType === 'full' ? FULL_CASTER_SLOTS :
        def!.spellcastingType === 'half' ? HALF_CASTER_SLOTS : THIRD_CASTER_SLOTS;
      const row = table[Math.min(Math.max(cl.level, 1), 20)] ?? [];
      row.forEach((count, idx) => { slotTotals[idx + 1] = count; });
    } else if (spellcasterClasses.length > 1) {
      const row = getMulticlassSpellSlots(
        spellcasterClasses.map(({ cl, def }) => ({
          type: def!.spellcastingType as 'full' | 'half' | 'third' | 'pact' | 'none',
          level: cl.level,
        }))
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
    }

    // Highest leveled slot the character has access to
    let maxSpellLevel = 0;
    for (let lvl = 9; lvl >= 1; lvl--) {
      if ((slotTotals[lvl] ?? 0) > 0) { maxSpellLevel = lvl; break; }
    }
    if (character.pactMagic && character.pactMagic.slotLevel > maxSpellLevel) {
      maxSpellLevel = character.pactMagic.slotLevel;
    }

    return {
      finalScores,
      mods,
      profBonus,
      ac,
      initiative,
      speed,
      savingThrows,
      skills,
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
    };
  }, [character]);
}
