import { create } from 'zustand';
import type { Character, BookId, AbilityKey, WizardStep, CharacterAppearance } from '../types';
import { WIZARD_STEPS } from '../types';
import { PACT_MAGIC_TABLE, emptySlotState } from '../data/mechanics';
import { getClass, baseClassId } from '../data/classes';
import { getSubclass } from '../data/subclasses';
import { getRace } from '../data/races';
import { getBackground } from '../data/backgrounds';
import { ALL_FEATS, featGrantedSpells } from '../data/feats';
import { computeAlwaysPreparedIds, syncAlwaysPrepared } from '../utils/alwaysPrepared';
import { computeCharacterDerived } from '../hooks/useCharacterDerived';
import { chosenAsi } from '../utils/racialAsi';
import { sanitizeCreatorDraft } from '../utils/sanitizeCreatorDraft';
import { effectiveFeatIds } from '../utils/effectiveFeats';



type Draft = Partial<Character> & {
  name: string;
  playerName: string;
  alignment: string;
  enabledBooks: BookId[];
  equipmentChoices?: Record<number, number>;  // class-choice index → option index
  equipmentTakeGold?: boolean;                // alternative: take starting gold instead of items
  appearance?: CharacterAppearance;
};

const INITIAL_DRAFT: Draft = {
  name: '',
  playerName: '',
  alignment: 'True Neutral',
  enabledBooks: ['PHB'],
  appearance: { gender: 'male' },
  classes: [],
  selectedSkillProficiencies: [],
  selectedFeats: [],
  classOptions: {
    fightingStyles: [],
    invocations: [],
    metamagic: [],
    maneuvers: [],
    infusions: [],
    optionalFeatures: [],
  },
  inventory: [],
  currencies: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
  equipmentChoices: {},
  equipmentTakeGold: false,
  spellbook: [],
  abilityScoreMethod: 'pointbuy',
  baseAbilityScores: { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 },
};

interface WizardState {
  step: WizardStep;
  draft: Draft;
  pointBuyRemaining: number;
  standardArrayUnassigned: number[];
  rolledValues: number[];
  rolledDice: number[][];

  setStep: (step: WizardStep) => void;
  goNext: () => void;
  goPrev: () => void;
  updateDraft: (patch: Partial<Draft>) => void;
  setPointBuyScore: (ability: AbilityKey, score: number) => void;
  assignStandardArray: (ability: AbilityKey, value: number) => void;
  rollAllDice: () => void;
  finalize: () => Character | null;
  reset: () => void;
}

const POINT_BUY_COSTS: Record<number, number> = {
  8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9,
};

function budgetForScores(scores: Partial<Record<AbilityKey, number>>): number {
  let spent = 0;
  for (const [, val] of Object.entries(scores)) {
    spent += POINT_BUY_COSTS[val as number] ?? 0;
  }
  return 27 - spent;
}

export const useCreatorStore = create<WizardState>((set, get) => ({
  step: 'books',
  draft: structuredClone(INITIAL_DRAFT),
  pointBuyRemaining: 27,
  standardArrayUnassigned: [15, 14, 13, 12, 10, 8],
  rolledValues: [],
  rolledDice: [],

  setStep: (step) => set({ step }),

  goNext: () => {
    const idx = WIZARD_STEPS.indexOf(get().step);
    if (idx < WIZARD_STEPS.length - 1) set({ step: WIZARD_STEPS[idx + 1] });
  },

  goPrev: () => {
    const idx = WIZARD_STEPS.indexOf(get().step);
    if (idx > 0) set({ step: WIZARD_STEPS[idx - 1] });
  },

  updateDraft: (patch) =>
    // Every edit passes through the sanitizer, so a class or level change trims
    // the choices that no longer fit (subclass below its unlock level, spells
    // off the new list or above the new cap, over-budget maneuvers/invocations/
    // feats). At the chokepoint rather than in StepClass, so new steps and the
    // random-character path can't forget it. See sanitizeCreatorDraft.
    set((s) => ({ draft: sanitizeCreatorDraft({ ...s.draft, ...patch }) })),

  setPointBuyScore: (ability, score) =>
    set((s) => {
      const scores = { ...(s.draft.baseAbilityScores ?? { str:8,dex:8,con:8,int:8,wis:8,cha:8 }) };
      scores[ability] = score;
      const remaining = budgetForScores(scores);
      return {
        draft: { ...s.draft, baseAbilityScores: scores },
        pointBuyRemaining: remaining,
      };
    }),

  assignStandardArray: (ability, value) =>
    set((s) => {
      const current = { ...(s.draft.baseAbilityScores ?? { str:8,dex:8,con:8,int:8,wis:8,cha:8 }) };
      const oldValue = current[ability];
      current[ability] = value;
      const stdArr = [15, 14, 13, 12, 10, 8];
      // Remove the newly assigned value from the pool
      let unassigned = s.standardArrayUnassigned.filter(v => v !== value);
      // Only return the old value to the pool if it was actually taken from the pool.
      // If it's still present in standardArrayUnassigned it was never taken (it's just
      // the initial default of 8), so don't push a phantom duplicate back in.
      if (oldValue && stdArr.includes(oldValue) && !s.standardArrayUnassigned.includes(oldValue)) {
        unassigned.push(oldValue);
      }
      unassigned = unassigned.sort((a,b) => b-a);
      return {
        draft: { ...s.draft, baseAbilityScores: current },
        standardArrayUnassigned: unassigned,
      };
    }),

  rollAllDice: () =>
    set((s) => {
      const results = Array.from({ length: 6 }, () => {
        const dice = Array.from({ length: 4 }, () => Math.floor(Math.random() * 6) + 1).sort((a, b) => a - b);
        return { dice, total: dice[1] + dice[2] + dice[3] };
      });
      return {
        rolledValues: results.map(r => r.total),
        rolledDice: results.map(r => r.dice),
        draft: { ...s.draft, baseAbilityScores: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 } },
      };
    }),

  finalize: () => {
    const { draft } = get();
    if (!draft.raceId || !draft.classes?.length || !draft.backgroundId) return null;

    const primaryClass = draft.classes[0];
    const classDef = getClass(primaryClass.classId);

    // Compute maxHP — level 1 grants max-die + Con mod; each subsequent level
    // grants average of (hitDie/2 + 1 + Con mod) per 5e fixed-HP rules, with a
    // minimum of 1 hit point per level (even with very low Con).
    const hitDie = classDef?.hitDie ?? 8;
    const race = getRace(draft.raceId!);
    // C7 — under PHB 2024 the ability increase comes from the BACKGROUND, so every place that
    // previously asked only the race has to ask for the origin total instead. Getting this
    // wrong is silent: HP would be computed from a CON that is 2 lower than the sheet shows.
    const originAsi = (k: import('../types').AbilityKey) =>
      ((chosenAsi(race, draft.racialAbilityChoice) as Record<string, number>)[k] ?? 0)
      + ((chosenAsi(getBackground(draft.backgroundId!), draft.backgroundAbilityChoice) as Record<string, number>)[k] ?? 0);

    // Apply player-choice feat ability increases to baseAbilityScores (mirrors levelUp logic).
    // Done early so HP calculation uses the correct post-feat CON.
    const draftFeatChoices = (draft.featChoices ?? {}) as Record<string, import('../types').AbilityKey>;
    let finalBaseScores = { ...(draft.baseAbilityScores ?? { str:10,dex:10,con:10,int:10,wis:10,cha:10 }) };
    for (const featId of (draft.selectedFeats ?? [])) {
      const feat = ALL_FEATS.find(f => f.id === featId);
      if (feat?.abilityScoreChoice && draftFeatChoices[featId]) {
        const key = draftFeatChoices[featId] as import('../types').AbilityKey;
        const racialBonus = originAsi(key);
        const maxBase = 20 - racialBonus;
        finalBaseScores = { ...finalBaseScores, [key]: Math.min(maxBase, (finalBaseScores[key] ?? 0) + 1) };
      }
    }

    const racialCon = originAsi('con');
    const effectiveCon = (finalBaseScores.con ?? 10) + racialCon;
    const conMod = Math.floor((effectiveCon - 10) / 2);
    const level = primaryClass.level;
    // Per-level HP bonuses from subclass (e.g. Draconic Bloodline: +1), race (e.g. Hill Dwarf: +1),
    // and feats (e.g. Tough: +2). For feats with a retroactive bonus (Tough), modeling as +2/level
    // from level 1 gives the correct total (2 × totalLevel) at any starting level.
    const primarySub = primaryClass.subclassId ? getSubclass(primaryClass.subclassId) : undefined;
    const subHPBonusPerLevel = primarySub?.hpBonusPerLevel ?? 0;
    const raceHPBonusPerLevel = race?.hpBonusPerLevel ?? 0;
    // effectiveFeatIds: a 2024 background grants a free Origin feat, and Tough from the
    // Farmer background has to count toward hit points like any other.
    const featHPBonusPerLevel = effectiveFeatIds(draft).reduce((sum, fid) => {
      const feat = ALL_FEATS.find(f => f.id === fid);
      return sum + (feat?.hpBonusPerLevel ?? 0);
    }, 0);
    const totalHPBonusPerLevel = subHPBonusPerLevel + raceHPBonusPerLevel + featHPBonusPerLevel;
    // Flat, one-time HP grants that don't scale with level (Boon of Fortitude: +40).
    const featFlatHP = effectiveFeatIds(draft).reduce((sum, fid) => {
      const feat = ALL_FEATS.find(f => f.id === fid);
      return sum + (feat?.hpBonus ?? 0);
    }, 0);
    const lvl1HP = Math.max(1, hitDie + conMod) + totalHPBonusPerLevel;
    const perLevelHP = Math.max(1, Math.floor(hitDie / 2) + 1 + conMod) + totalHPBonusPerLevel;
    const maxHP = lvl1HP + (level - 1) * perLevelHP + featFlatHP;

    // Compute pact magic if warlock
    let pactMagic = undefined;
    const warlockClass = draft.classes.find(c => baseClassId(c.classId) === 'warlock');
    if (warlockClass) {
      const pm = PACT_MAGIC_TABLE[warlockClass.level];
      if (pm) pactMagic = { slotsTotal: pm.slots, slotsUsed: 0, slotLevel: pm.slotLevel };
    }

    // Build resources from both class and (if selected) subclass definitions.
    // These maxima come from each class's level table; the ~70 resources that
    // scale on an ability mod or proficiency bonus instead are corrected below,
    // once the character exists to compute them from.
    const resources = [];
    for (const cl of draft.classes) {
      const def = getClass(cl.classId);
      if (!def) continue;
      const sub = cl.subclassId ? getSubclass(cl.subclassId) : undefined;
      const allRds = [...def.resources, ...(sub?.resources ?? [])];
      for (const rd of allRds) {
        const max = rd.maxPerLevel[cl.level] ?? 0;
        if (max === 'unlimited' || max > 0) {
          resources.push({ key: rd.key, current: max === 'unlimited' ? 99 : max, max: max === 'unlimited' ? 99 : max });
        }
      }
    }

    const character: Character = {
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      name: draft.name,
      playerName: draft.playerName,
      alignment: draft.alignment,
      enabledBooks: draft.enabledBooks,
      raceId: draft.raceId!,
      // These three are CHOICES the creator collects and then had no way to hand on: they were read
      // while computing HP and resource maxima but never written onto the character, so a
      // creator-built character arrived at the sheet with the picker blank and the bonus at +0.
      // Found while adding the background picker — the racial one (C6a) had the same hole, and it
      // went unnoticed because C6a was verified by seeding localStorage directly, which skips the
      // creator entirely. Verify a fix on the path a user actually takes.
      racialAbilityChoice: draft.racialAbilityChoice,
      backgroundAbilityChoice: draft.backgroundAbilityChoice,
      innateSpellAbility: draft.innateSpellAbility,
      subclassOptions: draft.subclassOptions,
      backgroundId: draft.backgroundId!,
      backgroundCustom: draft.backgroundCustom,
      classes: draft.classes!,
      abilityScoreMethod: draft.abilityScoreMethod ?? 'manual',
      baseAbilityScores: finalBaseScores,
      selectedSkillProficiencies: draft.selectedSkillProficiencies ?? [],
      selectedFeats: draft.selectedFeats ?? [],
      classOptions: draft.classOptions ?? {
        fightingStyles: [],
        invocations: [],
        metamagic: [],
        maneuvers: [],
        infusions: [],
        optionalFeatures: [],
      },
      inventory: draft.inventory ?? [],
      hitDiceUsed: {},
      spellbook: syncAlwaysPrepared(
        draft.spellbook ?? [],
        computeAlwaysPreparedIds(draft.classes ?? [], draft.classOptions, draft.subclassOptions),
      ),
      innateSpellUses: (() => {
        const totalCharLevel = (draft.classes ?? []).reduce((sum, cl) => sum + cl.level, 0);
        const uses: Record<string, number> = {};
        for (const spell of (race?.innateSpells ?? [])) {
          if (spell.recharge === 'cantrip') continue;
          if ((spell.minCharLevel ?? 1) <= totalCharLevel) uses[spell.spellId] = 1;
        }
        // Feat spells too — a character made with Magic Initiate should walk out of the creator
        // with its once-per-rest spell available. `load()` also seeds these, so this is belt and
        // braces; the alternative is depending on which path a new character takes to the sheet.
        for (const gs of featGrantedSpells(draft as Character)) {
          if (gs.recharge === 'cantrip') continue;
          uses[`feat:${gs.featId}:${gs.spellId}`] = 1;
        }
        return uses;
      })(),
      currentHP: maxHP,
      maxHP,
      tempHP: 0,
      deathSaves: { successes: 0, failures: 0 },
      conditions: [],
      exhaustionLevel: 0,
      spellSlotsUsed: emptySlotState(),
      pactMagic,
      resources,
      inspiration: false,
      experiencePoints: 0,
      notes: '',
      currencies: draft.currencies ?? { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
      expertiseSkills: (draft.expertiseSkills as string[] | undefined) ?? [],
      featChoices: draftFeatChoices,
      // This object is a WHITELIST: a field the draft carries but this block doesn't name is
      // silently dropped on finish. `selectedLanguages` and `selectedToolProficiencies` were
      // already missing — harmless only because the creator offered no picker for them, and live
      // data loss the moment one is added. Copied through explicitly rather than spreading the
      // draft, because half these fields are re-derived above and a spread would undo that.
      selectedLanguages: draft.selectedLanguages ?? [],
      raceOptions: draft.raceOptions ?? {},
      selectedToolProficiencies: draft.selectedToolProficiencies ?? {},
      selectedFeatPicks: draft.selectedFeatPicks ?? {},
      selectedFeatExpertise: draft.selectedFeatExpertise ?? [],
      selectedFeatSpells: draft.selectedFeatSpells ?? {},
      knowledgeDomainSkills: (draft.knowledgeDomainSkills as string[] | undefined) ?? [],
      appearance: draft.appearance ?? { gender: 'male' },
    };

    // Resources whose max is an ability mod or proficiency bonus, not a level-table
    // entry, carry a placeholder `maxPerLevel: 1` in the data — computeCharacterDerived
    // owns the real table (~70 keys) and the sheet has always applied it.
    //
    // This used to duplicate exactly two of those rules here (bardic_inspiration,
    // flash_of_genius), so every other one saved at its placeholder: a creator-built
    // Light Domain cleric stored Warding Flare 1/1, a paladin Divine Sense 1/1. Load
    // then treats an already-saved resource as pre-existing and CLAMPS current to the
    // real max (`Math.min(r.current, ov)` in useCharacterStore.load), so the character
    // opened its very first sheet showing 1 of 4 — three-quarters spent before play.
    //
    // Delegating instead of copying is the same cure the store's own comment
    // prescribes; the two-copies shape is what let them drift in the first place.
    const overrides = computeCharacterDerived(character).resourceMaxOverrides;
    character.resources = character.resources.map(r =>
      overrides[r.key] == null ? r : { ...r, max: overrides[r.key], current: overrides[r.key] }
    );

    return character;
  },

  reset: () =>
    set({ step: 'books', draft: structuredClone(INITIAL_DRAFT), pointBuyRemaining: 27, standardArrayUnassigned: [15,14,13,12,10,8], rolledValues: [], rolledDice: [] }),
}));

// DEV-only escape hatch for headless 3D-model review (scripts/hair-shot.mjs).
// Lets an automated browser jump straight to the Appearance step with a chosen
// race/gender/hair without clicking through the whole wizard. Tree-shaken out of
// production builds by the import.meta.env.DEV guard.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as Window & { __creator?: typeof useCreatorStore }).__creator = useCreatorStore;
}
