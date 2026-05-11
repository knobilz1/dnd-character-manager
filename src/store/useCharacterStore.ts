import { create } from 'zustand';
import type { Character, Condition, ExhaustionLevel, SlotLevel } from '../types';
import { useLibraryStore } from './useLibraryStore';
import { emptySlotState } from '../data/mechanics';
import { getClass } from '../data/classes';

interface CharacterState {
  character: Character | null;
  load: (c: Character) => void;
  save: () => void;

  // HP
  setCurrentHP: (hp: number) => void;
  healHP: (amount: number) => void;
  damageHP: (amount: number) => void;
  setTempHP: (hp: number) => void;
  setMaxHP: (hp: number) => void;

  // Death saves
  addDeathSuccess: () => void;
  addDeathFailure: () => void;
  resetDeathSaves: () => void;

  // Conditions
  addCondition: (c: Condition) => void;
  removeCondition: (c: Condition) => void;
  setExhaustion: (level: ExhaustionLevel) => void;

  // Spell slots
  useSpellSlot: (level: SlotLevel) => void;
  restoreSpellSlot: (level: SlotLevel) => void;
  restoreAllSpellSlots: () => void;
  usePactSlot: () => void;
  restorePactSlots: () => void;

  // Spells
  toggleSpellPrepared: (spellId: string) => void;
  addSpellToBook: (spellId: string) => void;
  removeSpellFromBook: (spellId: string) => void;
  startConcentration: (spellId: string) => void;
  endConcentration: () => void;

  // Resources
  setResource: (key: string, value: number) => void;

  // Rest
  shortRest: () => void;
  longRest: () => void;

  // Misc
  toggleInspiration: () => void;
  setNotes: (notes: string) => void;
  setExperiencePoints: (xp: number) => void;
}

export const useCharacterStore = create<CharacterState>((set, get) => ({
  character: null,

  load: (c) => set({ character: c }),

  save: () => {
    const { character } = get();
    if (character) useLibraryStore.getState().updateCharacter(character);
  },

  setCurrentHP: (hp) =>
    set((s) => {
      if (!s.character) return s;
      const maxHP = s.character.maxHP;
      return { character: { ...s.character, currentHP: Math.min(Math.max(hp, 0), maxHP) } };
    }),

  healHP: (amount) =>
    set((s) => {
      if (!s.character) return s;
      const next = Math.min(s.character.currentHP + amount, s.character.maxHP);
      return { character: { ...s.character, currentHP: next } };
    }),

  damageHP: (amount) =>
    set((s) => {
      if (!s.character) return s;
      let { tempHP, currentHP } = s.character;
      const tempAbsorb = Math.min(tempHP, amount);
      tempHP -= tempAbsorb;
      currentHP = Math.max(0, currentHP - (amount - tempAbsorb));
      return { character: { ...s.character, currentHP, tempHP } };
    }),

  setTempHP: (hp) =>
    set((s) => s.character ? { character: { ...s.character, tempHP: Math.max(0, hp) } } : s),

  setMaxHP: (hp) =>
    set((s) => s.character ? { character: { ...s.character, maxHP: Math.max(1, hp) } } : s),

  addDeathSuccess: () =>
    set((s) => {
      if (!s.character) return s;
      const successes = Math.min(s.character.deathSaves.successes + 1, 3);
      return { character: { ...s.character, deathSaves: { ...s.character.deathSaves, successes } } };
    }),

  addDeathFailure: () =>
    set((s) => {
      if (!s.character) return s;
      const failures = Math.min(s.character.deathSaves.failures + 1, 3);
      return { character: { ...s.character, deathSaves: { ...s.character.deathSaves, failures } } };
    }),

  resetDeathSaves: () =>
    set((s) => s.character ? { character: { ...s.character, deathSaves: { successes: 0, failures: 0 } } } : s),

  addCondition: (c) =>
    set((s) => {
      if (!s.character || s.character.conditions.includes(c)) return s;
      return { character: { ...s.character, conditions: [...s.character.conditions, c] } };
    }),

  removeCondition: (c) =>
    set((s) => s.character ? { character: { ...s.character, conditions: s.character.conditions.filter((x) => x !== c) } } : s),

  setExhaustion: (level) =>
    set((s) => s.character ? { character: { ...s.character, exhaustionLevel: level } } : s),

  useSpellSlot: (level) =>
    set((s) => {
      if (!s.character) return s;
      const used = { ...s.character.spellSlotsUsed };
      used[level] = (used[level] ?? 0) + 1;
      return { character: { ...s.character, spellSlotsUsed: used } };
    }),

  restoreSpellSlot: (level) =>
    set((s) => {
      if (!s.character) return s;
      const used = { ...s.character.spellSlotsUsed };
      used[level] = Math.max(0, (used[level] ?? 0) - 1);
      return { character: { ...s.character, spellSlotsUsed: used } };
    }),

  restoreAllSpellSlots: () =>
    set((s) => s.character ? { character: { ...s.character, spellSlotsUsed: emptySlotState() } } : s),

  usePactSlot: () =>
    set((s) => {
      if (!s.character?.pactMagic) return s;
      const pm = s.character.pactMagic;
      if (pm.slotsUsed >= pm.slotsTotal) return s;
      return { character: { ...s.character, pactMagic: { ...pm, slotsUsed: pm.slotsUsed + 1 } } };
    }),

  restorePactSlots: () =>
    set((s) => {
      if (!s.character?.pactMagic) return s;
      return { character: { ...s.character, pactMagic: { ...s.character.pactMagic, slotsUsed: 0 } } };
    }),

  toggleSpellPrepared: (spellId) =>
    set((s) => {
      if (!s.character) return s;
      const spellbook = s.character.spellbook.map((sp) =>
        sp.spellId === spellId ? { ...sp, isPrepared: !sp.isPrepared } : sp
      );
      return { character: { ...s.character, spellbook } };
    }),

  addSpellToBook: (spellId) =>
    set((s) => {
      if (!s.character || s.character.spellbook.find(sp => sp.spellId === spellId)) return s;
      return { character: { ...s.character, spellbook: [...s.character.spellbook, { spellId, isPrepared: false, isAlwaysPrepared: false }] } };
    }),

  removeSpellFromBook: (spellId) =>
    set((s) => s.character ? { character: { ...s.character, spellbook: s.character.spellbook.filter(sp => sp.spellId !== spellId) } } : s),

  startConcentration: (spellId) =>
    set((s) => s.character ? { character: { ...s.character, concentrationSpellId: spellId } } : s),

  endConcentration: () =>
    set((s) => s.character ? { character: { ...s.character, concentrationSpellId: undefined } } : s),

  setResource: (key, value) =>
    set((s) => {
      if (!s.character) return s;
      const resources = s.character.resources.map((r) =>
        r.key === key ? { ...r, current: Math.max(0, Math.min(value, r.max)) } : r
      );
      return { character: { ...s.character, resources } };
    }),

  shortRest: () =>
    set((s) => {
      if (!s.character) return s;
      // Recharge short-rest resources
      const resources = s.character.resources.map((r) => {
        const cl = s.character!.classes.find((c) => {
          const def = getClass(c.classId);
          return def?.resources.some((rd) => rd.key === r.key && rd.rechargeOn === 'short');
        });
        if (cl) return { ...r, current: r.max };
        return r;
      });
      // Restore pact magic on short rest
      const pactMagic = s.character.pactMagic ? { ...s.character.pactMagic, slotsUsed: 0 } : undefined;
      return { character: { ...s.character, resources, pactMagic } };
    }),

  longRest: () =>
    set((s) => {
      if (!s.character) return s;
      const maxHP = s.character.maxHP;
      const resources = s.character.resources.map((r) => ({ ...r, current: r.max }));
      const pactMagic = s.character.pactMagic ? { ...s.character.pactMagic, slotsUsed: 0 } : undefined;
      return {
        character: {
          ...s.character,
          currentHP: maxHP,
          tempHP: 0,
          deathSaves: { successes: 0, failures: 0 },
          conditions: s.character.conditions.filter(c => c === 'Exhaustion'),
          exhaustionLevel: Math.max(0, s.character.exhaustionLevel - 1) as ExhaustionLevel,
          spellSlotsUsed: emptySlotState(),
          concentrationSpellId: undefined,
          resources,
          pactMagic,
        },
      };
    }),

  toggleInspiration: () =>
    set((s) => s.character ? { character: { ...s.character, inspiration: !s.character.inspiration } } : s),

  setNotes: (notes) =>
    set((s) => s.character ? { character: { ...s.character, notes } } : s),

  setExperiencePoints: (xp) =>
    set((s) => s.character ? { character: { ...s.character, experiencePoints: xp } } : s),
}));
