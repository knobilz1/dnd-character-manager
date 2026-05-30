import { create } from 'zustand';
import type { Character, BookId, AbilityKey, WizardStep, ClassLevel, PreparedSpell } from '../types';
import { WIZARD_STEPS } from '../types';
import { PACT_MAGIC_TABLE, emptySlotState } from '../data/mechanics';
import { getClass } from '../data/classes';
import { getSubclass } from '../data/subclasses';
import { getRace } from '../data/races';
import { ALL_FEATS } from '../data/feats';

/** IDs of all always-prepared spells unlocked at the given class/subclass levels. */
function computeAlwaysPreparedIds(classes: ClassLevel[]): string[] {
  const ids: string[] = [];
  for (const cl of classes) {
    const sub = cl.subclassId ? getSubclass(cl.subclassId) : undefined;
    if (!sub?.alwaysPreparedSpells) continue;
    for (const [minLevelStr, spellIds] of Object.entries(sub.alwaysPreparedSpells)) {
      if (cl.level >= Number(minLevelStr)) ids.push(...spellIds);
    }
  }
  return [...new Set(ids)];
}

/** Ensure the spellbook contains all alwaysPrepared IDs, flagged correctly. */
function syncAlwaysPrepared(spellbook: PreparedSpell[], alwaysPreparedIds: string[]): PreparedSpell[] {
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

type Draft = Partial<Character> & {
  name: string;
  playerName: string;
  alignment: string;
  enabledBooks: BookId[];
  equipmentChoices?: Record<number, number>;  // class-choice index → option index
  equipmentTakeGold?: boolean;                // alternative: take starting gold instead of items
};

const INITIAL_DRAFT: Draft = {
  name: '',
  playerName: '',
  alignment: 'True Neutral',
  enabledBooks: ['PHB'],
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
    set((s) => ({ draft: { ...s.draft, ...patch } })),

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

    // Apply player-choice feat ability increases to baseAbilityScores (mirrors levelUp logic).
    // Done early so HP calculation uses the correct post-feat CON.
    const draftFeatChoices = (draft.featChoices ?? {}) as Record<string, import('../types').AbilityKey>;
    let finalBaseScores = { ...(draft.baseAbilityScores ?? { str:10,dex:10,con:10,int:10,wis:10,cha:10 }) };
    for (const featId of (draft.selectedFeats ?? [])) {
      const feat = ALL_FEATS.find(f => f.id === featId);
      if (feat?.abilityScoreChoice && draftFeatChoices[featId]) {
        const key = draftFeatChoices[featId] as import('../types').AbilityKey;
        const racialBonus = ((race?.abilityScoreIncreases ?? {}) as Record<string, number>)[key] ?? 0;
        const maxBase = 20 - racialBonus;
        finalBaseScores = { ...finalBaseScores, [key]: Math.min(maxBase, (finalBaseScores[key] ?? 0) + 1) };
      }
    }

    const racialCon = (race?.abilityScoreIncreases as any)?.con ?? 0;
    const effectiveCon = (finalBaseScores.con ?? 10) + racialCon;
    const conMod = Math.floor((effectiveCon - 10) / 2);
    const level = primaryClass.level;
    // Per-level HP bonuses from subclass (e.g. Draconic Bloodline: +1), race (e.g. Hill Dwarf: +1),
    // and feats (e.g. Tough: +2). For feats with a retroactive bonus (Tough), modeling as +2/level
    // from level 1 gives the correct total (2 × totalLevel) at any starting level.
    const primarySub = primaryClass.subclassId ? getSubclass(primaryClass.subclassId) : undefined;
    const subHPBonusPerLevel = primarySub?.hpBonusPerLevel ?? 0;
    const raceHPBonusPerLevel = race?.hpBonusPerLevel ?? 0;
    const featHPBonusPerLevel = (draft.selectedFeats ?? []).reduce((sum, fid) => {
      const feat = ALL_FEATS.find(f => f.id === fid);
      return sum + (feat?.hpBonusPerLevel ?? 0);
    }, 0);
    const totalHPBonusPerLevel = subHPBonusPerLevel + raceHPBonusPerLevel + featHPBonusPerLevel;
    const lvl1HP = Math.max(1, hitDie + conMod) + totalHPBonusPerLevel;
    const perLevelHP = Math.max(1, Math.floor(hitDie / 2) + 1 + conMod) + totalHPBonusPerLevel;
    const maxHP = lvl1HP + (level - 1) * perLevelHP;

    // Compute pact magic if warlock
    let pactMagic = undefined;
    const warlockClass = draft.classes.find(c => c.classId === 'warlock');
    if (warlockClass) {
      const pm = PACT_MAGIC_TABLE[warlockClass.level];
      if (pm) pactMagic = { slotsTotal: pm.slots, slotsUsed: 0, slotLevel: pm.slotLevel };
    }

    // Compute ability mods needed for resource max overrides (Bardic Inspiration, Flash of Genius).
    // Mirrors computeResourceMaxOverrides in useCharacterStore: base + racial + feats.
    const racialCha = (race?.abilityScoreIncreases as any)?.cha ?? 0;
    const racialInt = (race?.abilityScoreIncreases as any)?.int ?? 0;
    let featCha = 0, featInt = 0;
    for (const featId of (draft.selectedFeats ?? [])) {
      const feat = ALL_FEATS.find(f => f.id === featId);
      if (feat?.abilityScoreIncrease) {
        featCha += feat.abilityScoreIncrease.cha ?? 0;
        featInt += feat.abilityScoreIncrease.int  ?? 0;
      }
    }
    const effectiveCha = (finalBaseScores.cha ?? 10) + racialCha + featCha;
    const effectiveInt = (finalBaseScores.int ?? 10) + racialInt + featInt;
    const chaMod = Math.floor((effectiveCha - 10) / 2);
    const intMod  = Math.floor((effectiveInt  - 10) / 2);

    // Build resources from both class and (if selected) subclass definitions.
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
    // Override Bardic Inspiration (uses CHA mod, not a level table) and Flash of Genius (INT mod).
    for (const r of resources) {
      if (r.key === 'bardic_inspiration') { const m = Math.max(1, chaMod); r.max = m; r.current = m; }
      if (r.key === 'flash_of_genius')    { const m = Math.max(1, intMod);  r.max = m; r.current = m; }
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
      backgroundId: draft.backgroundId!,
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
        computeAlwaysPreparedIds(draft.classes ?? []),
      ),
      innateSpellUses: (() => {
        const totalCharLevel = (draft.classes ?? []).reduce((sum, cl) => sum + cl.level, 0);
        const uses: Record<string, number> = {};
        for (const spell of (race?.innateSpells ?? [])) {
          if (spell.recharge === 'cantrip') continue;
          if ((spell.minCharLevel ?? 1) <= totalCharLevel) uses[spell.spellId] = 1;
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
      knowledgeDomainSkills: (draft.knowledgeDomainSkills as string[] | undefined) ?? [],
    };

    return character;
  },

  reset: () =>
    set({ step: 'books', draft: structuredClone(INITIAL_DRAFT), pointBuyRemaining: 27, standardArrayUnassigned: [15,14,13,12,10,8], rolledValues: [], rolledDice: [] }),
}));
