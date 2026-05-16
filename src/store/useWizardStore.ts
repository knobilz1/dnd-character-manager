import { create } from 'zustand';
import type { Character, BookId, AbilityKey, WizardStep } from '../types';
import { WIZARD_STEPS } from '../types';
import { PACT_MAGIC_TABLE, emptySlotState } from '../data/mechanics';
import { getClass } from '../data/classes';
import { getSubclass } from '../data/subclasses';
import { getRace } from '../data/races';

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

  setStep: (step: WizardStep) => void;
  goNext: () => void;
  goPrev: () => void;
  updateDraft: (patch: Partial<Draft>) => void;
  setPointBuyScore: (ability: AbilityKey, score: number) => void;
  assignStandardArray: (ability: AbilityKey, value: number) => void;
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

export const useWizardStore = create<WizardState>((set, get) => ({
  step: 'books',
  draft: structuredClone(INITIAL_DRAFT),
  pointBuyRemaining: 27,
  standardArrayUnassigned: [15, 14, 13, 12, 10, 8],

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
      // Put old value back to unassigned if it was from standard array
      const stdArr = [15, 14, 13, 12, 10, 8];
      let unassigned = s.standardArrayUnassigned.filter(v => v !== value);
      if (oldValue && stdArr.includes(oldValue)) unassigned.push(oldValue);
      unassigned = unassigned.sort((a,b) => b-a);
      return {
        draft: { ...s.draft, baseAbilityScores: current },
        standardArrayUnassigned: unassigned,
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
    const racialCon = (race?.abilityScoreIncreases as any)?.con ?? 0;
    const effectiveCon = (draft.baseAbilityScores?.con ?? 10) + racialCon;
    const conMod = Math.floor((effectiveCon - 10) / 2);
    const level = primaryClass.level;
    const lvl1HP = Math.max(1, hitDie + conMod);
    const perLevelHP = Math.max(1, Math.floor(hitDie / 2) + 1 + conMod);
    const maxHP = lvl1HP + (level - 1) * perLevelHP;

    // Compute pact magic if warlock
    let pactMagic = undefined;
    const warlockClass = draft.classes.find(c => c.classId === 'warlock');
    if (warlockClass) {
      const pm = PACT_MAGIC_TABLE[warlockClass.level];
      if (pm) pactMagic = { slotsTotal: pm.slots, slotsUsed: 0, slotLevel: pm.slotLevel };
    }

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
      baseAbilityScores: draft.baseAbilityScores ?? { str:10,dex:10,con:10,int:10,wis:10,cha:10 },
      selectedSkillProficiencies: draft.selectedSkillProficiencies ?? [],
      selectedFeats: draft.selectedFeats ?? [],
      classOptions: draft.classOptions ?? {
        fightingStyles: [],
        invocations: [],
        metamagic: [],
        maneuvers: [],
        infusions: [],
      },
      inventory: draft.inventory ?? [],
      hitDiceUsed: {},
      spellbook: draft.spellbook ?? [],
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
    };

    return character;
  },

  reset: () =>
    set({ step: 'books', draft: structuredClone(INITIAL_DRAFT), pointBuyRemaining: 27, standardArrayUnassigned: [15,14,13,12,10,8] }),
}));
