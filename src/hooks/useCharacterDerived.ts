import { useMemo } from 'react';
import type { Character, AbilityKey, AbilityScores } from '../types';
import { PROFICIENCY_BONUS, SKILL_ABILITY, abilityMod, totalCharacterLevel, FULL_CASTER_SLOTS, HALF_CASTER_SLOTS, ARTIFICER_SLOTS, THIRD_CASTER_SLOTS, cantripsKnownFor, maxPreparedSpellsFor, getMulticlassSpellSlots } from '../data/mechanics';
import { getClass } from '../data/classes';
import { getSubclass } from '../data/subclasses';
import { getRace } from '../data/races';
import { getBackground } from '../data/backgrounds';
import { ALL_FEATS } from '../data/feats';
import { ARMOR_STATS } from '../data/items';

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

/** Pure computation — safe to call outside React (no hooks). */
export function computeCharacterDerived(character: Character) {
    const race = getRace(character.raceId);
    const primaryClassLevel = character.classes[0];
    const primaryClassDef = primaryClassLevel ? getClass(primaryClassLevel.classId) : null;
    const totalLevel = totalCharacterLevel(character.classes);
    const profBonus = PROFICIENCY_BONUS[Math.min(totalLevel, 20)] ?? 2;

    // Hoist class levels — used throughout for features that scale with class level
    const barbLevel    = character.classes.find(c => c.classId === 'barbarian')?.level ?? 0;
    const bardLevel    = character.classes.find(c => c.classId === 'bard')?.level ?? 0;
    const monkLevel    = character.classes.find(c => c.classId === 'monk')?.level ?? 0;
    const rogueLevel   = character.classes.find(c => c.classId === 'rogue')?.level ?? 0;
    const paladinLevel = character.classes.find(c => c.classId === 'paladin')?.level ?? 0;
    const hasRemarkableAthlete = character.classes.some(cl => cl.subclassId === 'champion' && cl.level >= 7);

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
    // Barbarian Primal Champion (lv.20): +4 STR and CON (cap raised to 24 below)
    if (barbLevel >= 20) {
      finalScores.str = (finalScores.str ?? 10) + 4;
      finalScores.con = (finalScores.con ?? 10) + 4;
    }
    // Cap at 20 (unless a feature raises it); guard against undefined scores.
    // Primal Champion (Barbarian 20) raises STR and CON cap to 24.
    for (const k of Object.keys(finalScores) as AbilityKey[]) {
      const cap = barbLevel >= 20 && (k === 'str' || k === 'con') ? 24 : 20;
      finalScores[k] = Math.min(finalScores[k] ?? 10, cap);
    }

    const mods: Record<AbilityKey, number> = {
      str: abilityMod(finalScores.str ?? 10),
      dex: abilityMod(finalScores.dex ?? 10),
      con: abilityMod(finalScores.con ?? 10),
      int: abilityMod(finalScores.int ?? 10),
      wis: abilityMod(finalScores.wis ?? 10),
      cha: abilityMod(finalScores.cha ?? 10),
    };

    // AC — check for equipped armor/shield from inventory first
    const equippedArmor = character.inventory.find(item => item.category === 'armor' && item.equipped);
    const equippedShield = character.inventory.find(item => item.category === 'shield' && item.equipped);

    let ac: number;
    if (equippedArmor) {
      // Wearing armor: use its base AC + DEX (capped per armor type)
      const stats = ARMOR_STATS[equippedArmor.name];
      if (stats) {
        // Medium Armor Master feat: raises DEX cap from +2 to +3 when DEX score ≥ 16
        let effectiveDexCap = stats.dexCap;
        if (
          stats.armorType === 'medium' &&
          effectiveDexCap === 2 &&
          character.selectedFeats.includes('medium-armor-master') &&
          (finalScores.dex ?? 10) >= 16
        ) {
          effectiveDexCap = 3;
        }
        const dexBonus = effectiveDexCap === 0 ? 0
          : effectiveDexCap !== undefined ? Math.min(mods.dex, effectiveDexCap)
          : mods.dex;
        ac = stats.baseAC + dexBonus;
      } else {
        // Custom / magic armor not in table — fall back to 10 + DEX
        ac = 10 + mods.dex;
      }
    } else {
      // Unarmored: start at 10 + DEX, then apply any Unarmored Defense features
      ac = 10 + mods.dex;
      // Barbarian Unarmored Defense: +CON (applies regardless of which class is primary)
      if (character.classes.some(c => c.classId === 'barbarian')) {
        ac = Math.max(ac, 10 + mods.dex + mods.con);
      }
      // Monk Unarmored Defense: +WIS (only without a shield; applies regardless of primary class)
      if (!equippedShield && character.classes.some(c => c.classId === 'monk')) {
        ac = Math.max(ac, 10 + mods.dex + mods.wis);
      }
    }
    // Racial natural armor (Lizardfolk: 13+DEX, Tortle: 17, Loxodon: 12+CON)
    if (race?.naturalArmor) {
      const { base, mod, canUseWithArmor } = race.naturalArmor;
      const naturalAC = base + (mod ? mods[mod] : 0);
      // Always applies when unarmored; Loxodon can also compare against worn armor
      if (!equippedArmor || canUseWithArmor) {
        ac = Math.max(ac, naturalAC);
      }
    }
    // Dragon Hide feat (XGtE): AC = 13 + DEX when unarmored — take the better of this and the class formula
    if (!equippedArmor && character.selectedFeats.includes('dragon-hide')) {
      ac = Math.max(ac, 13 + mods.dex);
    }
    // Shield: +2 AC bonus regardless of armor (Monk loses Unarmored Defense above if shield equipped)
    if (equippedShield) ac += 2;

    // Fighting style AC bonuses
    const fightingStyles: string[] = character.classOptions?.fightingStyles ?? [];
    const armorStats = equippedArmor ? ARMOR_STATS[equippedArmor.name] : null;
    if (fightingStyles.includes('defense') && equippedArmor) ac += 1;
    if (fightingStyles.includes('mariner') && armorStats?.armorType !== 'heavy' && !equippedShield) ac += 1;

    // Saving throws — per PHB multiclassing rules, you only keep the saving throw
    // proficiencies of your FIRST class. Adding every class's saves is wrong.
    const savingThrowProficiencies = new Set<AbilityKey>();
    const primarySaveDef = getClass(character.classes[0]?.classId);
    if (primarySaveDef) primarySaveDef.savingThrows.forEach(s => savingThrowProficiencies.add(s));
    // Feat-granted saving throw proficiency (e.g. Resilient: chosen ability)
    const featChoices = character.featChoices ?? {};
    for (const featId of (character.selectedFeats ?? [])) {
      const feat = ALL_FEATS.find(f => f.id === featId);
      if (feat?.grantsSaveForChosenAbility && featChoices[featId]) {
        savingThrowProficiencies.add(featChoices[featId] as AbilityKey);
      }
    }
    // Rogue Slippery Mind (lv.15): WIS save proficiency
    if (rogueLevel >= 15) savingThrowProficiencies.add('wis');
    // Monk Diamond Soul (lv.14): proficiency in all saving throws
    if (monkLevel >= 14) {
      (['str','dex','con','int','wis','cha'] as AbilityKey[]).forEach(k => savingThrowProficiencies.add(k));
    }
    const savingThrows: Record<AbilityKey, number> = {} as Record<AbilityKey, number>;
    for (const k of Object.keys(mods) as AbilityKey[]) {
      savingThrows[k] = mods[k] + (savingThrowProficiencies.has(k) ? profBonus : 0);
    }
    // Paladin Aura of Protection (lv.6): +CHA mod (min +1) to all saving throws
    if (paladinLevel >= 6) {
      const aura = Math.max(1, mods.cha);
      for (const k of Object.keys(savingThrows) as AbilityKey[]) savingThrows[k] += aura;
    }

    // Feat-granted flat bonuses — computed before skills so passives can use them
    let featInitiativeBonus = 0;
    let featSpeedBonus = 0;
    let featPassivePerceptionBonus = 0;
    let featPassiveInvestigationBonus = 0;
    for (const featId of character.selectedFeats) {
      const feat = ALL_FEATS.find(f => f.id === featId);
      if (!feat) continue;
      featInitiativeBonus             += feat.initiativeBonus             ?? 0;
      featSpeedBonus                  += feat.speedBonus                  ?? 0;
      featPassivePerceptionBonus      += feat.passivePerceptionBonus      ?? 0;
      featPassiveInvestigationBonus   += feat.passiveInvestigationBonus   ?? 0;
    }

    // Skill bonuses — merge class choices with background-granted proficiencies
    const bg = getBackground(character.backgroundId);
    const skillProfs = new Set<string>([
      ...character.selectedSkillProficiencies,
      ...(bg?.skillProficiencies ?? []),
    ]);
    const expertiseSet = new Set<string>(character.expertiseSkills ?? []);

    // Subclass auto-expertise (fixed skills, no player choice required)
    const effectiveExpertiseSet = new Set<string>(expertiseSet);
    for (const cl of character.classes) {
      // Corsair (ToB) Ferocious Presence (lv.7): doubled proficiency in Intimidation
      if (cl.subclassId === 'tob-corsair' && cl.level >= 7) effectiveExpertiseSet.add('Intimidation');
      // Purple Dragon Knight (SCAG) Royal Envoy (lv.7): doubled proficiency in Persuasion
      if (cl.subclassId === 'scag-purple-dragon-knight' && cl.level >= 7) effectiveExpertiseSet.add('Persuasion');
    }
    // Knowledge Domain: chosen skills gain both proficiency AND expertise
    const kdAllowed = new Set(['Arcana', 'History', 'Nature', 'Religion']);
    const kdSkills = character.knowledgeDomainSkills ?? [];
    if (kdSkills.length > 0 && character.classes.some(cl => cl.subclassId === 'knowledge-domain')) {
      for (const skill of kdSkills) {
        if (kdAllowed.has(skill)) {
          skillProfs.add(skill);
          effectiveExpertiseSet.add(skill);
        }
      }
    }

    const skills: Record<string, number> = {};
    for (const [skill, ability] of Object.entries(SKILL_ABILITY)) {
      const base = mods[ability as AbilityKey];
      const prof = skillProfs.has(skill as any) ? profBonus : 0;
      // Expertise doubles proficiency bonus (must be proficient to have expertise)
      const expertiseBonus = (effectiveExpertiseSet.has(skill) && skillProfs.has(skill as any)) ? profBonus : 0;
      // Bard: Jack of All Trades = half prof on non-proficient skills
      const jackOfAllTrades = bardLevel >= 2 && !skillProfs.has(skill as any) ? Math.floor(profBonus / 2) : 0;
      // Champion Remarkable Athlete (lv.7): ceil(prof/2) to non-proficient STR/DEX/CON checks
      const remarkableBonus = hasRemarkableAthlete && !skillProfs.has(skill as any) && (ability === 'str' || ability === 'dex' || ability === 'con')
        ? Math.ceil(profBonus / 2) : 0;
      skills[skill] = base + prof + expertiseBonus + Math.max(jackOfAllTrades, remarkableBonus);
    }
    const passivePerception    = 10 + (skills['Perception']    ?? 0) + featPassivePerceptionBonus;
    const passiveInsight       = 10 + (skills['Insight']       ?? 0);
    const passiveInvestigation = 10 + (skills['Investigation'] ?? 0) + featPassiveInvestigationBonus;

    // Initiative — Bard Jack of All Trades (lv.2+) adds half prof bonus
    const initiative = mods.dex + featInitiativeBonus + (bardLevel >= 2 ? Math.floor(profBonus / 2) : 0);

    // Class-based speed bonuses
    // Monk Unarmored Movement: +10 ft at level 2, scaling up, only while unarmored and no shield
    const monkSpeedBonus = (monkLevel >= 2 && !equippedArmor && !equippedShield)
      ? monkLevel >= 18 ? 30 : monkLevel >= 14 ? 25 : monkLevel >= 10 ? 20 : monkLevel >= 6 ? 15 : 10
      : 0;
    // Barbarian Fast Movement: +10 ft at level 5+ when not wearing heavy armor
    const barbFastMovement = (barbLevel >= 5 && (!equippedArmor || ARMOR_STATS[equippedArmor.name]?.armorType !== 'heavy'))
      ? 10 : 0;

    // Speed (feat + class bonuses applied before exhaustion halving)
    const exhaustionLevel = character.exhaustionLevel ?? 0;
    const _baseSpeed = (race?.speed ?? 30) + featSpeedBonus + monkSpeedBonus + barbFastMovement;
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

    // Resource max overrides — ability-mod or prof-bonus based resources.
    const resourceMaxOverrides: Record<string, number> = {};
    if (character.classes.some(c => c.classId === 'bard')) {
      resourceMaxOverrides['bardic_inspiration'] = Math.max(1, mods.cha);
    }
    if (character.classes.some(c => c.classId === 'artificer')) {
      resourceMaxOverrides['flash_of_genius'] = Math.max(1, mods.int);
    }
    if (character.classes.some(c => c.subclassId === 'bladesinging')) {
      resourceMaxOverrides['bladesong'] = profBonus;
    }
    if (character.classes.some(c => c.subclassId === 'samurai')) {
      // Fighting Spirit is 3 fixed uses (not WIS-mod based in RAW XGtE)
      resourceMaxOverrides['fighting_spirit'] = 3;
    }
    // Way of the Ascendant Dragon (FToD): Wings Unfurled (lv6) and Aspect of the
    // Wyrm (lv11) both have proficiency-bonus uses per long rest. Level-gated so the
    // resource only exists once the feature is actually unlocked.
    if (character.classes.some(c => c.subclassId === 'way-of-the-ascendant-dragon')) {
      if (monkLevel >= 6)  resourceMaxOverrides['wings_unfurled']      = profBonus;
      if (monkLevel >= 11) resourceMaxOverrides['aspect_of_the_wyrm']  = profBonus;
    }

    // Exhaustion flags
    const exhaustionDisadvChecks = exhaustionLevel >= 1; // disadvantage on ability checks / skills
    const exhaustionDisadvSaves  = exhaustionLevel >= 3; // disadvantage on saving throws
    const exhaustionHpMaxHalved  = exhaustionLevel >= 4; // HP maximum is halved
    const baseSpeed = _baseSpeed; // keep reference for tooltip display

    // Class-scaling display values
    // Rogue Sneak Attack: 1d6 per 2 rogue levels (1d6 at lv1, 2d6 at lv3, … 10d6 at lv19)
    const sneakAttackDice = rogueLevel > 0 ? Math.ceil(rogueLevel / 2) : 0;
    // Monk Martial Arts die: d4/d6/d8/d10 by monk level
    const martialArtsDie = monkLevel >= 17 ? 10 : monkLevel >= 11 ? 8 : monkLevel >= 5 ? 6 : monkLevel > 0 ? 4 : 0;
    // Barbarian Rage damage bonus: +2 at lv1, +3 at lv9, +4 at lv16
    const rageDamageBonus = barbLevel >= 16 ? 4 : barbLevel >= 9 ? 3 : barbLevel > 0 ? 2 : 0;
    // Monk Ki save DC = 8 + proficiency bonus + WIS modifier (Stunning Strike,
    // Four Elements, Open Hand, Astral Self, etc.). Monks are non-casters, so this
    // is distinct from spellSaveDC (which is 0 for a pure monk).
    const kiSaveDC = monkLevel > 0 ? 8 + profBonus + mods.wis : 0;

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
      expertiseSkills: effectiveExpertiseSet,
      passivePerception,
      passiveInvestigation,
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
      passiveInsight,
      resourceMaxOverrides,
      sneakAttackDice,
      martialArtsDie,
      rageDamageBonus,
      kiSaveDC,
    };
}

export function useCharacterDerived(character: Character | null) {
  return useMemo(() => {
    if (!character) return null;
    return computeCharacterDerived(character);
  }, [character]);
}
