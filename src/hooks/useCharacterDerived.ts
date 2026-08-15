import { useMemo } from 'react';
import type { Character, AbilityKey, AbilityScores } from '../types';
import { PROFICIENCY_BONUS, SKILL_ABILITY, abilityMod, totalCharacterLevel, FULL_CASTER_SLOTS, HALF_CASTER_SLOTS, ARTIFICER_SLOTS, THIRD_CASTER_SLOTS, cantripsKnownFor, maxPreparedSpellsFor, spellsKnownFor, getMulticlassSpellSlots } from '../data/mechanics';
import { getClass, baseClassId, classLevel } from '../data/classes';
import { getSubclass } from '../data/subclasses';
import { getSubclassOptions, picksAllowed } from '../data/subclassOptions';
import { getRace } from '../data/races';
import { getBackground } from '../data/backgrounds';
import { fixedLanguages, racialLanguagePicks } from '../data/languages';
import { fixedTools, parseToolGrant } from '../data/tools';
import { ALL_FEATS, featPickGroups, resolvedFeatPicks } from '../data/feats';
import { activeFightingStyles } from '../data/fightingStyles';
import { SKILL_NAMES } from '../data/mechanics';
import { ARTISAN_TOOLS, MUSICAL_INSTRUMENTS, GAMING_SETS } from '../data/tools';
import { ARMOR_STATS } from '../data/items';
import { chosenAsi } from '../utils/racialAsi';
import { conditionsCausing } from '../data/conditionEffects';
import { armorPenalty } from '../utils/armorProficiency';
import { effectiveFeatIds } from '../utils/effectiveFeats';

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

/** The class a character's spellcasting is read from — the first one that actually casts, NOT
 *  `classes[0]`. A fighter 5 / wizard 5 is stored fighter-first, and reading spellcasting off the
 *  fighter left the wizard with correct spell slots, a save DC of 0 and no cantrips.
 *
 *  Exported because the sheet, the sidebar and the spell panel each need this answer without
 *  running the whole derive, and each of them previously reached for `classes[0]` on its own —
 *  which is how a fighter/wizard got rendered as a known-caster rather than a prepared one.
 *  One definition, so they cannot drift apart again.
 *
 *  Pact counts: a warlock casts, even though its slots live outside the multiclass slot table. */
export function casterClassOf(character: Character) {
  return character.classes.find(
    cl => effectiveSpellcasting(cl.classId, cl.subclassId)?.ability,
  ) ?? character.classes[0];
}

/** Pure computation — safe to call outside React (no hooks). */
export function computeCharacterDerived(character: Character) {
    const race = getRace(character.raceId);
    const casterClassLevel = casterClassOf(character);
    const casterClassDef = casterClassLevel ? getClass(casterClassLevel.classId) : null;
    const totalLevel = totalCharacterLevel(character.classes);
    const profBonus = PROFICIENCY_BONUS[Math.min(totalLevel, 20)] ?? 2;

    // Hoist class levels — used throughout for features that scale with class level.
    // classLevel() collapses the PHB 2024 ids, so a 2024 character still gets these.
    const barbLevel    = classLevel(character.classes, 'barbarian');
    const bardLevel    = classLevel(character.classes, 'bard');
    const monkLevel    = classLevel(character.classes, 'monk');
    const rogueLevel   = classLevel(character.classes, 'rogue');
    const paladinLevel = classLevel(character.classes, 'paladin');
    const hasRemarkableAthlete = character.classes.some(cl => cl.subclassId === 'champion' && cl.level >= 7);

    // Final ability scores = base + racial + feat bonuses
    const finalScores: AbilityScores = { ...character.baseAbilityScores };
    if (race) {
      // via chosenAsi, not race.abilityScoreIncreases: flexible-ASI races store the real value on
      // the character, and reading the race directly gave all 42 of them +0 forever.
      for (const [key, val] of Object.entries(chosenAsi(race, character.racialAbilityChoice))) {
        finalScores[key as AbilityKey] = (finalScores[key as AbilityKey] ?? 10) + (val ?? 0);
      }
    }
    // C7 — PHB 2024 grants the ability increase through the BACKGROUND, not the species. 2014 and
    // GGR backgrounds carry no flexibleAsi, so this contributes nothing for them and the two
    // editions cannot double up.
    const bgDef = getBackground(character.backgroundId);
    for (const [key, val] of Object.entries(chosenAsi(bgDef, character.backgroundAbilityChoice))) {
      finalScores[key as AbilityKey] = (finalScores[key as AbilityKey] ?? 10) + (val ?? 0);
    }
    // Every feat that actually applies: ASI picks PLUS the PHB 2024 background's free
    // Origin feat, which used to exist only as prose and therefore granted nothing.
    // `selectedFeats` still means "bought with an ASI" — the creator budgets against it.
    const featIds = effectiveFeatIds(character);
    for (const featId of featIds) {
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

    const exhaustionLevel = character.exhaustionLevel ?? 0;
    /**
     * PHB 2024 replaced the exhaustion staircase with one rule: −2 on every D20 Test per
     * level and −5 ft of Speed per level, dead at 6. It is a different mechanic, not a
     * tuning change, so a 2024 character was being run under 2014's disadvantage ladder —
     * harsher in some places (disadvantage on every check from level 1) and blank in
     * others (no penalty at all to attacks until level 3).
     *
     * The penalty is folded into the DERIVED numbers (skills, saves, initiative, spell
     * attack, and weapon attacks via weaponAttackLine) rather than pushed out to every
     * roll button. That way the sheet displays the number you actually roll with, and no
     * call site can forget to apply it.
     */
    const uses2024Exhaustion = (character.enabledBooks ?? []).includes('PHB2024');
    const exhaustionD20Penalty = uses2024Exhaustion ? -2 * Math.min(exhaustionLevel, 6) : 0;

    // AC — check for equipped armor/shield from inventory first
    const equippedArmor = character.inventory.find(item => item.category === 'armor' && item.equipped);
    const equippedShield = character.inventory.find(item => item.category === 'shield' && item.equipped);

    let ac: number;
    if (equippedArmor) {
      // Wearing armor: use its base AC + DEX (capped per armor type)
      const stats = ARMOR_STATS[equippedArmor.name];
      if (stats) {
        // Medium Armor Master feat: raises DEX cap from +2 to +3 when DEX score ≥ 16.
        // Both editions carry the rule (PHB 2024 calls it Dexterous Wearer), and only the
        // 2014 id was checked — so the 2024 feat granted no AC at all.
        let effectiveDexCap = stats.dexCap;
        if (
          stats.armorType === 'medium' &&
          effectiveDexCap === 2 &&
          (featIds.includes('medium-armor-master')
            || featIds.includes('medium-armor-master-2024')) &&
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
      if (barbLevel > 0) {
        ac = Math.max(ac, 10 + mods.dex + mods.con);
      }
      // Monk Unarmored Defense: +WIS (only without a shield; applies regardless of primary class)
      if (!equippedShield && monkLevel > 0) {
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
    if (!equippedArmor && featIds.includes('dragon-hide')) {
      ac = Math.max(ac, 13 + mods.dex);
    }
    // Draconic Bloodline's scaly hide (PHB p.102): 13 + DEX unarmored. The subclass data
    // modelled the hit-point half of Draconic Resilience (hpBonusPerLevel) but never the
    // AC half, so a level-1 draconic sorcerer sat at 10 + DEX — three points light, all
    // game. The 2024 rework (Draconic Sorcery) instead grants 10 + DEX + CHA.
    if (!equippedArmor) {
      const draconic = character.classes.find(
        (cl) => cl.subclassId === 'draconic-bloodline' || cl.subclassId === 'draconic-bloodline-2024',
      );
      if (draconic?.subclassId === 'draconic-bloodline') ac = Math.max(ac, 13 + mods.dex);
      if (draconic?.subclassId === 'draconic-bloodline-2024') ac = Math.max(ac, 10 + mods.dex + mods.cha);
    }
    // Shield: +2 AC bonus regardless of armor (Monk loses Unarmored Defense above if shield equipped)
    if (equippedShield) ac += 2;

    // Fighting style AC bonuses
    // Includes styles taken as PHB 2024 feats, which land in selectedFeats rather than here.
    const fightingStyles: string[] = activeFightingStyles(character);
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
    for (const featId of featIds) {
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
      savingThrows[k] = mods[k] + (savingThrowProficiencies.has(k) ? profBonus : 0) + exhaustionD20Penalty;
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
    for (const featId of featIds) {
      const feat = ALL_FEATS.find(f => f.id === featId);
      if (!feat) continue;
      featInitiativeBonus             += feat.initiativeBonus             ?? 0;
      featSpeedBonus                  += feat.speedBonus                  ?? 0;
      featPassivePerceptionBonus      += feat.passivePerceptionBonus      ?? 0;
      featPassiveInvestigationBonus   += feat.passiveInvestigationBonus   ?? 0;
      // 2024 Alert scales with proficiency bonus rather than the flat +5 of the 2014 feat, so it
      // has no `initiativeBonus` to add. The entry used to carry `initiativeBonus: 0` with a
      // comment claiming it was "handled via prof bonus"; nothing handled it, and the feat added
      // nothing to initiative at all.
      if (feat.id === 'alert-2024') featInitiativeBonus += profBonus;
    }

    // Skill bonuses — merge class choices with background-granted proficiencies
    const bg = getBackground(character.backgroundId);
    // `?? []` is load-bearing, not defensive noise: characters saved before this field existed
    // carry it as undefined, and spreading undefined throws. That was survivable while only the
    // display used this function, but the store now delegates its resource maxima here — so a
    // throw would take out load() itself and make the character unopenable.
    // Feat proficiency picks are resolved once, here, and then routed by which catalog each pick
    // belongs to: skills below, tools further down, weapons in isProficientWithWeapon. That split
    // is what lets Skilled's "any combination of three skills or tools" be a single choice.
    const featPicks = featPickGroups(character);
    const featPicked = new Set(resolvedFeatPicks(character));
    const featPicksOwed = featPicks.reduce(
      (n, g) => n + (g.auto ? 0 : Math.max(0, g.count - g.picked.length)), 0);

    // Held BEFORE any feat pick, which is what decides whether Keen Mind and Observant hand out
    // proficiency or Expertise. Kept as its own set rather than computed after the fact: once the
    // picks are merged in, "were you already proficient" is unanswerable.
    const skillsBeforeFeats = new Set<string>([
      ...(character.selectedSkillProficiencies ?? []),
      ...(bg?.skillProficiencies ?? []),
    ]);
    const skillProfs = new Set<string>([
      ...skillsBeforeFeats,
      // Skilled, Skill Expert, Prodigy, Squat Nimbleness, Keen Mind, Observant and Boon of Skill
      // all named a skill in prose and granted none. Merged here, at the one place skills are
      // composed, rather than special-cased per feat.
      ...SKILL_NAMES.filter(s => featPicked.has(s)),
    ]);

    // Subclass-granted skill proficiencies. `selectedSkillProficiencies` is capped at the CLASS's
    // own `skillChoices.count`, so before this a College of Lore bard's "three skills of your
    // choice" was rendered as feature prose and never actually granted — the proficiencies did not
    // exist anywhere. Applying it here, at the single place skills are composed, covers every
    // subclass that declares a `grants: 'skill'` option group rather than special-casing each.
    for (const cl of character.classes) {
      for (const group of getSubclassOptions(cl.subclassId)) {
        if (group.grants !== 'skill') continue;
        if (cl.level < Math.min(...Object.keys(group.picksByLevel).map(Number))) continue;
        for (const picked of character.subclassOptions?.[group.key] ?? []) {
          skillProfs.add(picked);
          skillsBeforeFeats.add(picked);
        }
      }
    }
    // Keen Mind and Observant (2024) read "gain proficiency OR Expertise" — Expertise when you
    // already had the proficiency. The pick above covers the first half; this is the second, and
    // without it the feat did nothing at all for the characters most likely to take it.
    const featUpgradeExpertise = featPicks
      .filter(g => ALL_FEATS.find(f => f.id === g.featId)?.grantsPicks?.upgradeToExpertise)
      .flatMap(g => g.picked)
      .filter(s => skillsBeforeFeats.has(s));
    const expertiseSet = new Set<string>(character.expertiseSkills ?? []);
    // Feat-granted expertise. Its own slots and its own storage, because `expertiseSkills` is
    // sized by Rogue/Bard level in the creator — a feat's expertise put in there would either be
    // truncated or silently inflate the class allowance.
    const featExpertiseOwed = featIds
      .reduce((n, id) => n + (ALL_FEATS.find(f => f.id === id)?.grantsExpertise ?? 0), 0);
    const featExpertise = (character.selectedFeatExpertise ?? []).slice(0, featExpertiseOwed);

    // Subclass auto-expertise (fixed skills, no player choice required)
    const effectiveExpertiseSet = new Set<string>([...expertiseSet, ...featExpertise, ...featUpgradeExpertise]);
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
      skills[skill] = base + prof + expertiseBonus + Math.max(jackOfAllTrades, remarkableBonus) + exhaustionD20Penalty;
    }
    const passivePerception    = 10 + (skills['Perception']    ?? 0) + featPassivePerceptionBonus;
    const passiveInsight       = 10 + (skills['Insight']       ?? 0);
    const passiveInvestigation = 10 + (skills['Investigation'] ?? 0) + featPassiveInvestigationBonus;

    // Initiative — Bard Jack of All Trades (lv.2+) adds half prof bonus
    const initiative = mods.dex + featInitiativeBonus + (bardLevel >= 2 ? Math.floor(profBonus / 2) : 0) + exhaustionD20Penalty;

    // A3 — features that grant ADVANTAGE. The dice layer has carried a mode end to end all along
    // (useDiceStore 'normal' | 'advantage' | 'disadvantage'); the gap was that only exhaustion ever
    // selected one, so no feature the character actually had was ever volunteered.
    //
    // Split deliberately into two kinds. Auto-applying a SITUATIONAL advantage would make the sheet
    // assert something that is false more often than it is true, which is worse than staying quiet:
    // the player can already pick advantage by hand, so the cost of omitting is a click and the cost
    // of over-claiming is a wrong roll.
    const rangerLevel   = classLevel(character.classes, 'ranger');
    const fighterLevel  = classLevel(character.classes, 'fighter');
    const sorcererLevel = classLevel(character.classes, 'sorcerer');

    const advantage = {
      // Danger Sense (Barbarian 2): Dex saves against effects you can see. Volunteered because at a
      // table nearly every Dex save is against something visible; the roller's manual toggle is the
      // escape hatch for the rare case that it isn't.
      dexSaves: barbLevel >= 2,
      // Feral Instinct (Barbarian 7): advantage on initiative, unconditionally.
      initiative: barbLevel >= 7,
    };

    // Shown to the player, never auto-applied — each depends on state the sheet does not model.
    // Armor you lack proficiency with (PHB p.144): disadvantage on any Str/Dex check, save or
    // attack, and no spellcasting. The armorProficiencies lists existed on every class and were
    // read only by the PDF exports, so wearing plate as a wizard cost nothing.
    const armorPen = armorPenalty(character);

    const advantageNotes: string[] = [];
    if (barbLevel >= 2) advantageNotes.push('Danger Sense — advantage on Dex saves against effects you can see (not while blinded, deafened or incapacitated)');
    if (barbLevel >= 7) advantageNotes.push('Feral Instinct — advantage on initiative');
    if (rangerLevel >= 8) advantageNotes.push("Land's Stride — advantage on saves against plants that impede movement");
    if (fighterLevel >= 13 && character.classes.some(c => c.classId === 'fighter-2024')) advantageNotes.push('Studied Attacks — advantage on your next attack against a creature you missed');
    if (sorcererLevel >= 1 && character.classes.some(c => c.classId === 'sorcerer-2024')) advantageNotes.push('Innate Sorcery — advantage on Sorcerer spell attack rolls while active');

    // Class-based speed bonuses
    // Monk Unarmored Movement: +10 ft at level 2, scaling up, only while unarmored and no shield
    const monkSpeedBonus = (monkLevel >= 2 && !equippedArmor && !equippedShield)
      ? monkLevel >= 18 ? 30 : monkLevel >= 14 ? 25 : monkLevel >= 10 ? 20 : monkLevel >= 6 ? 15 : 10
      : 0;
    // Barbarian Fast Movement: +10 ft at level 5+ when not wearing heavy armor
    const barbFastMovement = (barbLevel >= 5 && (!equippedArmor || ARMOR_STATS[equippedArmor.name]?.armorType !== 'heavy'))
      ? 10 : 0;

    // Speed (feat + class bonuses applied before exhaustion halving)
    const _baseSpeed = (race?.speed ?? 30) + featSpeedBonus + monkSpeedBonus + barbFastMovement;
    // 2014 halves or zeroes EVERY speed, not just walking (PHB p.291); 2024 subtracts a
    // flat 5 ft per level instead, which can also reach 0.
    const exhaust = (v: number) => uses2024Exhaustion
      ? Math.max(0, v - 5 * exhaustionLevel)
      : exhaustionLevel >= 5 ? 0 : exhaustionLevel >= 2 ? Math.floor(v / 2) : v;
    const speed = exhaust(_baseSpeed);
    // Racial fly/swim/climb existed on the Race type but nothing set or read them, so
    // an Aarakocra sheet showed "30 ft" and nothing else. fly: 'walk' means "equal to
    // your walking speed" — it tracks walk bonuses, and every such Flight trait also
    // forbids flying in medium/heavy armor, so the armor check keys off 'walk' (the
    // Winged Tiefling's flat 30 has no armor clause).
    const wornType = equippedArmor ? ARMOR_STATS[equippedArmor.name]?.armorType : undefined;
    const wingsBound = race?.fly === 'walk' && (wornType === 'medium' || wornType === 'heavy');
    const flySpeed = race?.fly == null || wingsBound ? 0 : exhaust(race.fly === 'walk' ? _baseSpeed : race.fly);
    const swimSpeed = race?.swim ? exhaust(race.swim) : 0;
    const climbSpeed = race?.climb ? exhaust(race.climb) : 0;

    // Spellcasting (incl. third-caster subclasses Eldritch Knight / Arcane Trickster).
    const primaryEff = casterClassLevel
      ? effectiveSpellcasting(casterClassLevel.classId, casterClassLevel.subclassId)
      : null;
    let spellcastingAbility: AbilityKey | null = null;
    let spellSaveDC = 0;
    let spellAttackBonus = 0;
    if (primaryEff?.ability) {
      spellcastingAbility = primaryEff.ability;
      spellSaveDC = 8 + profBonus + mods[spellcastingAbility];
      spellAttackBonus = profBonus + mods[spellcastingAbility] + exhaustionD20Penalty;
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
        spellcasterClasses.map(({ cl, eff }) => ({
          type: eff.type, level: cl.level, roundUp: cl.classId === 'artificer',
        }))
      );
      row.forEach((count, idx) => { slotTotals[idx + 1] = count; });
    }

    // Number of prepared spells (for prepared casters only) and max spell level
    let maxPreparedSpells: number | null = null;
    let cantripsKnown = 0;
    let spellsKnown: number | null = null;
    let spellbookLimit: number | null = null;
    if (casterClassDef && spellcastingAbility) {
      const casterLevel = casterClassLevel?.level ?? 0;
      const spellMod = mods[spellcastingAbility];
      maxPreparedSpells = maxPreparedSpellsFor(casterClassDef.id, casterLevel, spellMod);
      cantripsKnown = cantripsKnownFor(casterClassDef.id, casterLevel);
      // Eldritch Knight and Arcane Trickster learn cantrips via their subclass
      // (2 at level 3, 3 at level 10). The base Fighter/Rogue class has 0 cantrips
      // so cantripsKnownFor returns 0 — override it here.
      if (cantripsKnown === 0 && casterClassLevel?.subclassId) {
        const sub = getSubclass(casterClassLevel.subclassId);
        if (sub?.spellcastingType === 'third') {
          // The subclass's OWN ladder, not a hardcoded copy of the Eldritch Knight's.
          // An Arcane Trickster knows 3 cantrips at level 3, not 2 — the creator offered
          // the third correctly and then the sheet reported "Cantrips: 3/2" in red and
          // refused the swap. sanitizeCreatorDraft has always read this array; the sheet
          // is the copy that drifted.
          cantripsKnown = sub.cantripsKnownByClassLevel?.[Math.min(casterLevel, 20) - 1]
            ?? (casterLevel >= 10 ? 3 : casterLevel >= 3 ? 2 : 0);
        }
      }

      // R15: how many spells the character may KNOW was computed in the creator and in the level-up
      // dialog but never here, so the sheet — the one screen you use every session — had no number
      // to enforce and `addSpellToBook` let a bard learn the entire bard list.
      //
      // Three different limits, and conflating them is the whole bug:
      //   known casters (bard, sorcerer, warlock, ranger) have a hard spells-known ceiling;
      //   wizards have a SPELLBOOK size instead, which grows by copying (PHB p.114: 6 at level 1,
      //     +2 per level) and is unrelated to how many they prepare;
      //   prepared casters (cleric, druid, paladin, artificer, 2024 bard/ranger) have NO book limit
      //     at all — their whole class list is available and only preparation is capped.
      // null therefore means "no limit applies", which is different from 0.
      spellsKnown = spellsKnownFor(casterClassDef.id, casterLevel) || null;
      if (spellsKnown === null && casterClassLevel?.subclassId) {
        const sub = getSubclass(casterClassLevel.subclassId);
        if (sub?.spellcastingType === 'third') {
          // spellListClassId is 'wizard', which has no SPELLS_KNOWN entry (wizards use a
          // spellbook), so this asked the wrong table and got null — i.e. "no limit", and
          // an Eldritch Knight could learn unlimited spells on the sheet. The subclass
          // carries its own 3-at-3rd-to-13-at-20th ladder; use that.
          spellsKnown = (sub.spellsKnownByClassLevel?.[Math.min(casterLevel, 20) - 1]
            ?? spellsKnownFor(sub.spellListClassId ?? casterClassDef.id, casterLevel)) || null;
        }
      }
      if (['wizard', 'wizard-2024'].includes(casterClassDef.id)) {
        spellbookLimit = 6 + 2 * Math.max(0, casterLevel - 1);
      }
    }

    // ── Tool proficiencies ───────────────────────────────────────────────────
    // Class and background grants only. `race.proficiencies` is a mixed bag — it holds skills and
    // weapons too (Athletics, Longsword) — so pulling tools from it would list a battleaxe as a
    // tool proficiency.
    const toolSources = [
      ...character.classes.flatMap(cl => getClass(cl.classId)?.toolProficiencies ?? []),
      ...(bgDef?.toolProficiencies ?? []),
      // Feats grant tools too — Chef's cook's utensils outright, Crafter's three artisan's tools
      // as a choice. They use `grantsTools` rather than `grantsProficiency` because anything the
      // grammar can't parse falls through to `fixedTools`, so an armour or weapon entry mixed in
      // here would print on the sheet as a tool proficiency.
      ...featIds.flatMap(id => ALL_FEATS.find(f => f.id === id)?.grantsTools ?? []),
    ];
    const chosenTools = character.selectedToolProficiencies ?? {};
    // One entry per grant, so each keeps its own allowed categories.
    const toolChoices = [...new Set(toolSources)]
      .map(text => ({ text, grant: parseToolGrant(text) }))
      .filter((x): x is { text: string; grant: NonNullable<ReturnType<typeof parseToolGrant>> } => !!x.grant)
      .map(x => ({ ...x, picked: chosenTools[x.text] ?? [] }));
    // The other half of the feat picks: anything picked that is a tool rather than a skill.
    // Skilled offers both pools in one grant, so the split has to happen at resolution, not at
    // the picker.
    const ALL_TOOL_NAMES = [...ARTISAN_TOOLS, ...MUSICAL_INSTRUMENTS, ...GAMING_SETS];
    const toolProficiencies = [...new Set([
      ...fixedTools(toolSources),
      ...toolChoices.flatMap(c => c.picked),
      ...ALL_TOOL_NAMES.filter(t => featPicked.has(t)),
    ])];
    const toolsOwed = toolChoices.reduce((n, c) => n + Math.max(0, c.grant.count - c.picked.length), 0);

    // ── Languages ────────────────────────────────────────────────────────────
    // The race's languages array mixes real languages with placeholder strings for choices the
    // player hasn't made ("one extra language of your choice"). Those placeholders were being
    // rendered as languages on the sheet and the printed sheet; here they become a COUNT instead,
    // and `character.selectedLanguages` supplies what was actually chosen.
    const languagesOwed =
      racialLanguagePicks(race?.languages)
      + (bgDef?.languages ?? 0)
      // Linguist's three languages were prose: the feat had no field and nothing counted them.
      + featIds.reduce((n, id) => n + (ALL_FEATS.find(f => f.id === id)?.grantsLanguages ?? 0), 0)
      + character.classes.reduce((n, cl) => n + (cl.subclassId ? getSubclassOptions(cl.subclassId)
          .filter(g => g.grants === 'language' && cl.level >= Math.min(...Object.keys(g.picksByLevel).map(Number)))
          .reduce((m, g) => m + picksAllowed(g, cl.level), 0) : 0), 0);
    const languages = [...new Set([
      ...fixedLanguages(race?.languages),
      ...(character.selectedLanguages ?? []),
      ...character.classes.flatMap(cl => cl.subclassId
        ? getSubclassOptions(cl.subclassId)
            .filter(g => g.grants === 'language')
            .flatMap(g => character.subclassOptions?.[g.key] ?? [])
        : []),
    ])];

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
    if (bardLevel > 0) {
      resourceMaxOverrides['bardic_inspiration'] = Math.max(1, mods.cha);
    }
    if (character.classes.some(c => baseClassId(c.classId) === 'artificer')) {
      resourceMaxOverrides['flash_of_genius'] = Math.max(1, mods.int);
    }
    if (character.classes.some(c => c.subclassId === 'bladesinging')) {
      resourceMaxOverrides['bladesong'] = profBonus;
    }
    // Feat counters whose size is your proficiency bonus. Their `grantedResources.max` is only a
    // level-1 seed; without an entry here the counter would freeze at that seed for the whole
    // campaign — the same bug that kept every racial prof-bonus trait at its level-1 value.
    // (2014 Lucky is a flat 3 and needs no override; it uses a different key, so a character
    // cannot end up holding both pools.)
    // Giff's Astral Spark: uses equal to proficiency bonus. Same shape as the feat pools below —
    // the race entry's `max` is only a level-1 seed.
    if (character.raceId === 'giff') resourceMaxOverrides['astral_spark'] = profBonus;

    const feats = new Set(featIds);
    for (const [featId, key] of [
      ['lucky-2024',                   'luck_points'],
      ['chef',                         'chef_treats'],
      ['poisoner',                     'poisoner_doses'],
      ['gift-of-the-chromatic-dragon', 'reactive_resistance'],
      ['gift-of-the-gem-dragon',       'telekinetic_reprisal'],
      ['gift-of-the-metallic-dragon',  'protective_wings'],
    ] as const) {
      if (feats.has(featId)) resourceMaxOverrides[key] = profBonus;
    }
    if (character.classes.some(c => c.subclassId === 'samurai')) {
      // Fighting Spirit is 3 fixed uses (not WIS-mod based in RAW XGtE)
      resourceMaxOverrides['fighting_spirit'] = 3;
    }
    // Psi Warrior / Soulknife (TCE): each grants its own Psionic Energy pool of 2 x proficiency
    // bonus. Separate keys, so a Fighter/Rogue holding both subclasses gets two pools, not one.
    // Mirrors computeResourceMaxOverrides in useCharacterStore — keep the two in sync.
    // Both editions size this pool at 2x proficiency bonus, so the -2024 subclasses
    // share the key and this branch; only the recharge wording differs, and that
    // lives on the subclass entry.
    if (character.classes.some(c => c.subclassId === 'psi-warrior' || c.subclassId === 'psi-warrior-2024')) {
      resourceMaxOverrides['psionic_energy_psi_warrior'] = profBonus * 2;
    }
    if (character.classes.some(c => c.subclassId === 'soulknife' || c.subclassId === 'soulknife-2024')) {
      resourceMaxOverrides['psionic_energy_soulknife'] = profBonus * 2;
    }
    // Proficiency-bonus subclass pools, level-gated to when the feature is actually gained.
    // Mirrors computeResourceMaxOverrides in useCharacterStore — keep the two in sync.
    if (character.classes.some(c => c.subclassId === 'phantom' && c.level >= 3)) {
      resourceMaxOverrides['wails_from_the_grave'] = profBonus;
    }
    if (character.classes.some(c => c.subclassId === 'circle-of-wildfire' && c.level >= 10)) {
      resourceMaxOverrides['cauterizing_flames'] = profBonus;
    }
    if (character.classes.some(c => c.subclassId === 'college-of-creation' && c.level >= 3)) {
      resourceMaxOverrides['performance_of_creation'] = profBonus;
    }
    if (character.classes.some(c => c.subclassId === 'peace-domain')) {
      resourceMaxOverrides['emboldening_bond'] = profBonus;
    }
    if (character.classes.some(c => c.subclassId === 'swarmkeeper' && c.level >= 7)) {
      resourceMaxOverrides['writhing_tide'] = profBonus;
    }
    if (character.classes.some(c => c.subclassId === 'swarmkeeper' && c.level >= 15)) {
      resourceMaxOverrides['swarming_dispersal'] = profBonus;
    }
    if (character.classes.some(c => c.subclassId === 'circle-of-stars' && c.level >= 2)) {
      resourceMaxOverrides['star_map'] = profBonus;
    }
    if (character.classes.some(c => c.subclassId === 'circle-of-stars' && c.level >= 6)) {
      resourceMaxOverrides['cosmic_omen'] = profBonus;
    }
    if (character.classes.some(c => c.subclassId === 'armorer' && c.level >= 15)) {
      resourceMaxOverrides['perfected_armor'] = profBonus;
    }
    if (character.classes.some(c => c.subclassId === 'clockwork-soul')) {
      resourceMaxOverrides['restore_balance'] = profBonus;
    }
    if (character.classes.some(c => c.subclassId === 'drakewarden' && c.level >= 15)) {
      resourceMaxOverrides['perfected_bond'] = profBonus;
    }
    // Echo Knight Unleash Incarnation (EGtW): Constitution modifier uses, minimum 1.
    if (character.classes.some(c => c.subclassId === 'echo-knight' && c.level >= 3)) {
      resourceMaxOverrides['unleash_incarnation'] = Math.max(1, mods.con);
    }
    // Dunamancy (EGtW): both are Intelligence modifier uses, minimum 1.
    if (character.classes.some(c => c.subclassId === 'chronurgy-magic' && c.level >= 6)) {
      resourceMaxOverrides['momentary_stasis'] = Math.max(1, mods.int);
    }
    if (character.classes.some(c => c.subclassId === 'graviturgy-magic' && c.level >= 10)) {
      resourceMaxOverrides['violent_attraction'] = Math.max(1, mods.int);
    }
    // TCE prof-bonus-per-long-rest features.
    if (character.classes.some(c => c.subclassId === 'the-fathomless')) {
      resourceMaxOverrides['tentacle_of_the_deeps'] = profBonus;
    }
    if (character.classes.some(c => c.subclassId === 'order-of-scribes' && c.level >= 6)) {
      resourceMaxOverrides['manifest_mind'] = profBonus;
    }
    if (character.classes.some(c => c.subclassId === 'path-of-wild-magic' && c.level >= 3)) {
      resourceMaxOverrides['magic_awareness'] = profBonus;
    }
    if (character.classes.some(c => c.subclassId === 'path-of-wild-magic' && c.level >= 6)) {
      resourceMaxOverrides['bolstering_magic'] = profBonus;
    }
    if (character.classes.some(c => c.subclassId === 'path-of-the-beast' && c.level >= 10)) {
      resourceMaxOverrides['infectious_fury'] = profBonus;
    }
    if (character.classes.some(c => c.subclassId === 'path-of-the-beast' && c.level >= 14)) {
      resourceMaxOverrides['call_the_hunt'] = profBonus;
    }
    if (character.classes.some(c => c.subclassId === 'twilight-domain' && c.level >= 6)) {
      resourceMaxOverrides['steps_of_night'] = profBonus;
    }
    if (character.classes.some(c => c.subclassId === 'rune-knight' && c.level >= 7)) {
      resourceMaxOverrides['runic_shield'] = profBonus;
    }
    if (character.classes.some(c => c.subclassId === 'the-genie' && c.level >= 6)) {
      resourceMaxOverrides['elemental_gift'] = profBonus;
    }
    if (character.classes.some(c => c.subclassId === 'rune-knight' && c.level >= 3)) {
      resourceMaxOverrides['giants_might'] = profBonus;
    }
    if (character.classes.some(c => c.subclassId === 'way-of-the-ascendant-dragon' && c.level >= 3)) {
      resourceMaxOverrides['breath_of_the_dragon'] = profBonus;
    }
    // Light Domain Warding Flare (PHB, and unchanged in 2024): Wisdom modifier uses,
    // minimum 1. The 2024 version recharges on a short rest from level 6 — that lives
    // on the subclass entry, not here; only the pool SIZE is shared.
    if (character.classes.some(c => c.subclassId === 'light-domain' || c.subclassId === 'light-domain-2024')) {
      resourceMaxOverrides['warding_flare'] = Math.max(1, mods.wis);
    }
    // Wisdom-modifier-per-long-rest features (PHB / XGtE / TCE), minimum 1 use each.
    {
      const wisUses = Math.max(1, mods.wis);
      const has = (id: string, lvl = 1) => character.classes.some(c => c.subclassId === id && c.level >= lvl);
      if (has('tempest-domain')) resourceMaxOverrides['wrath_of_the_storm'] = wisUses;
      if (has('war-domain') || has('war-domain-2024')) resourceMaxOverrides['war_priest'] = wisUses;
      // ── PHB 2024 Wisdom-modifier pools ──────────────────────────────────────
      // Their maxPerLevel in phb2024.ts is a placeholder 1 (the same convention the
      // 2014 entries use), so without these lines every one of them would sit at
      // 1 use forever — and load() would then clamp `current` to it, which is the
      // shape that made creator-built characters look part-spent.
      if (has('light-domain-2024', 17)) resourceMaxOverrides['corona_of_light'] = wisUses;
      if (has('circle-of-the-moon-2024', 10)) resourceMaxOverrides['moonlight_step'] = wisUses;
      if (has('circle-of-stars-2024', 3)) resourceMaxOverrides['star_map_2024'] = wisUses;
      if (has('circle-of-stars-2024', 6)) resourceMaxOverrides['cosmic_omen_2024'] = wisUses;
      if (has('warrior-of-mercy-2024', 11)) resourceMaxOverrides['flurry_of_healing_and_harm'] = wisUses;
      if (has('warrior-of-open-hand-2024', 6)) resourceMaxOverrides['wholeness_of_body'] = wisUses;
      if (has('fey-wanderer-2024', 15)) resourceMaxOverrides['misty_wanderer'] = wisUses;
      if (has('gloom-stalker-2024', 3)) resourceMaxOverrides['dreadful_strike'] = wisUses;
      if (has('grave-domain')) resourceMaxOverrides['eyes_of_the_grave'] = wisUses;
      if (has('grave-domain', 6)) resourceMaxOverrides['sentinel_at_deaths_door'] = wisUses;
      if (has('monster-slayer', 3)) resourceMaxOverrides['hunters_sense'] = wisUses;
      if (has('order-domain', 6)) resourceMaxOverrides['embodiment_of_the_law'] = wisUses;
      if (has('circle-of-spores', 6)) resourceMaxOverrides['fungal_infestation'] = wisUses;
    }
    // Battle Smith Arcane Jolt (TCE): Int modifier; Eloquence Infectious Inspiration: Cha modifier.
    if (character.classes.some(c => c.subclassId === 'battle-smith' && c.level >= 9)) {
      resourceMaxOverrides['arcane_jolt'] = Math.max(1, mods.int);
    }
    if (character.classes.some(c => c.subclassId === 'college-of-eloquence' && c.level >= 14)) {
      resourceMaxOverrides['infectious_inspiration'] = Math.max(1, mods.cha);
    }
    // Features found by the second-pass gap check: limited uses inside subclasses that
    // already had a resources block, so the main sweep skipped the whole entry.
    if (character.classes.some(c => c.subclassId === 'circle-of-dreams' && c.level >= 10)) {
      resourceMaxOverrides['hidden_paths'] = Math.max(1, mods.wis);
    }
    if (character.classes.some(c => c.subclassId === 'fey-wanderer' && c.level >= 15)) {
      resourceMaxOverrides['misty_wanderer'] = Math.max(1, mods.wis);
    }
    if (character.classes.some(c =>
        (c.subclassId === 'oath-of-glory' || c.subclassId === 'oath-of-glory-2024') && c.level >= 15)) {
      resourceMaxOverrides['glorious_defense'] = Math.max(1, mods.cha);
    }
    // ── PHB 2024 Charisma-modifier pools ────────────────────────────────────────
    // These carry placeholder maxima in phb2024.ts and are inert without these lines.
    // Three of them changed scaling between editions — 2014's Restore Balance and
    // Dark One's Own Luck are proficiency-bonus and 1/short-rest respectively — so
    // they use `_2024`-suffixed keys rather than sharing the 2014 ones. Sharing would
    // make a character holding both editions of the class last-write-wins, since
    // resourceMaxOverrides is a flat key -> number map.
    {
      const chaUses = Math.max(1, mods.cha);
      const has2024 = (id: string, lvl = 1) =>
        character.classes.some(c => c.subclassId === id && c.level >= lvl);
      if (has2024('clockwork-soul-2024', 3)) resourceMaxOverrides['restore_balance_2024'] = chaUses;
      if (has2024('archfey-patron-2024', 3)) resourceMaxOverrides['steps_of_the_fey'] = chaUses;
      if (has2024('fiend-patron-2024', 6)) resourceMaxOverrides['dark_ones_own_luck_2024'] = chaUses;
    }
    if (character.classes.some(c => c.subclassId === 'alchemist' && c.level >= 9)) {
      resourceMaxOverrides['restorative_reagents'] = Math.max(1, mods.int);
    }
    if (character.classes.some(c => c.subclassId === 'echo-knight' && c.level >= 15)) {
      resourceMaxOverrides['reclaim_potential'] = Math.max(1, mods.con);
    }
    // ToB Captain's Call: 1 + Charisma modifier uses (minimum 1) per long rest.
    if (character.classes.some(c => c.subclassId === 'tob-captain' && c.level >= 3)) {
      resourceMaxOverrides['captains_call'] = Math.max(1, 1 + mods.cha);
    }
    // Abjuration Arcane Ward (PHB, same formula in 2024): a hit point pool of
    // 2x wizard level + Int modifier. The 2024 subclass sits on `wizard-2024`, and
    // classLevel() matches on the exact class id — reading only 'wizard' returns 0
    // there, which would cap the ward at the Int modifier alone.
    {
      const abj2014 = character.classes.some(c => c.subclassId === 'school-of-abjuration');
      const abj2024 = character.classes.some(c => c.subclassId === 'abjurer-2024');
      if (abj2014 || abj2024) {
        const wizLevel = classLevel(character.classes, 'wizard')
          + classLevel(character.classes, 'wizard-2024');
        resourceMaxOverrides['arcane_ward'] = wizLevel * 2 + mods.int;
      }
    }
    // Paladin: Divine Sense = 1 + Cha mod; Cleansing Touch (14th) = Cha mod, min 1.
    if (paladinLevel > 0) {
      resourceMaxOverrides['divine_sense'] = Math.max(1, 1 + mods.cha);
      if (paladinLevel >= 14) resourceMaxOverrides['cleansing_touch'] = Math.max(1, mods.cha);
    }
    // Way of the Ascendant Dragon (FToD): Wings Unfurled (lv6) and Aspect of the
    // Wyrm (lv11) both have proficiency-bonus uses per long rest. Level-gated so the
    // resource only exists once the feature is actually unlocked.
    if (character.classes.some(c => c.subclassId === 'way-of-the-ascendant-dragon')) {
      if (monkLevel >= 6)  resourceMaxOverrides['wings_unfurled']      = profBonus;
      if (monkLevel >= 11) resourceMaxOverrides['aspect_of_the_wyrm']  = profBonus;
    }

    // Exhaustion flags
    // 2024 carries no disadvantage at any level — the flat penalty above is the whole rule.
    const exhaustionDisadvChecks = !uses2024Exhaustion && exhaustionLevel >= 1;
    // Level 3 imposes disadvantage on attack rolls AND saving throws (PHB p.291).
    // Only the saves half existed, so an exhausted character rolled attacks straight
    // — the more visible half of the penalty, and the one that comes up every turn.
    const exhaustionDisadvSaves  = !uses2024Exhaustion && exhaustionLevel >= 3;
    const exhaustionDisadvAttacks = !uses2024Exhaustion && exhaustionLevel >= 3;
    const exhaustionHpMaxHalved  = !uses2024Exhaustion && exhaustionLevel >= 4;

    // Conditions, which until now were labels the sheet displayed and nothing read.
    // Kept as the LIST of conditions responsible rather than a bare boolean, so the
    // roll button can say why it is rolling at disadvantage instead of silently
    // changing the number under the player.
    const conditionDisadvAttacks = conditionsCausing(character.conditions, 'disadvAttacks');
    const conditionAdvAttacks = conditionsCausing(character.conditions, 'advAttacks');
    const conditionDisadvChecks = conditionsCausing(character.conditions, 'disadvChecks');
    const conditionDisadvDexSaves = conditionsCausing(character.conditions, 'disadvDexSaves');
    const conditionAutoFailStrDexSaves = conditionsCausing(character.conditions, 'autoFailStrDexSaves');
    const conditionSpeedZero = conditionsCausing(character.conditions, 'speedZero');
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

    // Extra Attack existed only as feature text — the sheet never said a level-5
    // fighter swings twice. Read it off the features the character actually has at
    // their level, so subclass grants (Bladesinging 6, College of Valor 6) and the
    // fighter 11/20 ladder come along without a table here. Both editions' names are
    // in the data: "Extra Attack (3/4 attacks)" (2014), "Two/Three Extra Attacks" (2024).
    let attacksPerAction = 1;
    for (const cl of character.classes) {
      const feats = [
        ...(getClass(cl.classId)?.features ?? []),
        ...(cl.subclassId ? getSubclass(cl.subclassId)?.features ?? [] : []),
      ];
      for (const f of feats) {
        if (f.level > cl.level) continue;
        const isEA = f.name.startsWith('Extra Attack');
        const n = (isEA && f.name.includes('(4')) || f.name.startsWith('Three Extra Attacks') ? 4
          : (isEA && f.name.includes('(3')) || f.name.startsWith('Two Extra Attacks') ? 3
          : isEA ? 2 : 0;
        if (n > attacksPerAction) attacksPerAction = n;
      }
    }
    // The Pact of the Blade warlock's Extra Attack is the Thirsting Blade invocation.
    if ((character.classOptions?.invocations ?? []).includes('thirsting-blade')) {
      attacksPerAction = Math.max(attacksPerAction, 2);
    }

    return {
      finalScores,
      mods,
      profBonus,
      ac,
      initiative,
      speed,
      baseSpeed,
      flySpeed,
      swimSpeed,
      climbSpeed,
      attacksPerAction,
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
      spellsKnown,
      spellbookLimit,
      totalLevel,
      languages,
      languagesOwed,
      toolProficiencies,
      toolChoices,
      toolsOwed,
      featPicks,
      featPicksOwed,
      featExpertiseOwed,
      featExpertise,
      // Exported so the sheet, sidebar and spell panel all ask the SAME question the derive asked.
      // Each used to recompute `classes[0]` for itself, which is how a fighter/wizard got rendered
      // as a known-caster: the fighter isn't in the prepared-caster list, and nothing else looked.
      casterClassDef,
      exhaustionLevel,
      exhaustionDisadvChecks,
      exhaustionD20Penalty,
      uses2024Exhaustion,
      exhaustionDisadvSaves,
      exhaustionDisadvAttacks,
      conditionDisadvAttacks,
      conditionAdvAttacks,
      conditionDisadvChecks,
      conditionDisadvDexSaves,
      conditionAutoFailStrDexSaves,
      conditionSpeedZero,
      advantage,
      advantageNotes,
      armorPen,
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
