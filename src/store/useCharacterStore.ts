import { create } from 'zustand';
import type { Character, Condition, ExhaustionLevel, InventoryItem, SlotLevel, ASIChoice, AbilityKey, ClassOptionsState } from '../types';
import { getRace } from '../data/races';
import { useLibraryStore } from './useLibraryStore';
import { emptySlotState, PACT_MAGIC_TABLE, PROFICIENCY_BONUS, abilityMod, totalCharacterLevel } from '../data/mechanics';
import { getClass } from '../data/classes';
import { getSubclass } from '../data/subclasses';

/** Compute ability-mod / prof-bonus overrides for resources that scale off stats.
 *  Mirrors the logic in useCharacterDerived.ts so the store can apply correct maxes
 *  during long rest and level-up without depending on the hook. */
function computeResourceMaxOverrides(c: Character): Record<string, number> {
  const totalLvl = totalCharacterLevel(c.classes);
  const profBonus = PROFICIENCY_BONUS[Math.min(totalLvl, 20)] ?? 2;

  // Final ability scores = base + racial (feats omitted here; edge-case impact is minimal)
  const race = getRace(c.raceId);
  const racial = race?.abilityScoreIncreases ?? {};
  const score = (key: AbilityKey) =>
    (c.baseAbilityScores[key] ?? 10) + ((racial as Record<string, number>)[key] ?? 0);

  const overrides: Record<string, number> = {};
  if (c.classes.some(cl => cl.classId === 'bard'))
    overrides['bardic_inspiration'] = Math.max(1, abilityMod(score('cha')));
  if (c.classes.some(cl => cl.classId === 'artificer'))
    overrides['flash_of_genius'] = Math.max(1, abilityMod(score('int')));
  if (c.classes.some(cl => cl.subclassId === 'bladesinging'))
    overrides['bladesong'] = profBonus;
  if (c.classes.some(cl => cl.subclassId === 'samurai'))
    overrides['fighting_spirit'] = 3;
  return overrides;
}

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

  // Inventory
  addInventoryItem: (item: Omit<InventoryItem, 'id'>) => void;
  removeInventoryItem: (id: string) => void;
  setInventoryQuantity: (id: string, qty: number) => void;
  toggleInventoryEquipped: (id: string) => void;
  renameInventoryItem: (id: string, name: string) => void;
  setInventoryDescription: (id: string, description: string | undefined) => void;
  setItemCharges: (id: string, charges: number) => void;

  // Level up / hit dice
  levelUp: (classId: string, hpGained: number, hpRoll: number, subclassPick?: string, asiChoice?: ASIChoice) => void;
  updateClassOptions: (partial: Partial<ClassOptionsState>) => void;
  useHitDie: (classId: string) => void;
  restoreHitDie: (classId: string) => void;

  // Rest
  shortRest: () => void;
  longRest: () => void;

  // Misc
  toggleInspiration: () => void;
  setNotes: (notes: string) => void;
  setExperiencePoints: (xp: number) => void;
  updateCurrency: (coin: 'cp' | 'sp' | 'ep' | 'gp' | 'pp', value: number) => void;
  setPortrait: (dataUrl: string | undefined) => void;
}

export const useCharacterStore = create<CharacterState>((set, get) => ({
  character: null,

  load: (c) => {
    // Migrate old characters that were created before the resources field existed.
    // If resources is empty but the character has classes, compute them from the
    // class/subclass definitions at the character's current level. For classes with
    // genuinely no tracked resources (Ranger, Rogue), the loop produces nothing and
    // the empty array remains — so the migration is safe for all classes.
    let resources = c.resources ?? [];
    if (resources.length === 0 && (c.classes?.length ?? 0) > 0) {
      for (const cl of c.classes!) {
        const def = getClass(cl.classId);
        if (!def) continue;
        const sub = cl.subclassId ? getSubclass(cl.subclassId) : undefined;
        for (const rd of [...def.resources, ...(sub?.resources ?? [])]) {
          const max = rd.maxPerLevel[cl.level] ?? 0;
          if (max === 'unlimited' || max > 0) {
            const normMax = max === 'unlimited' ? 99 : max as number;
            resources.push({ key: rd.key, current: normMax, max: normMax });
          }
        }
      }
    }

    // Old schema stored HP as hitPoints.max/current/temp; new schema uses maxHP/currentHP/tempHP.
    const oldHP = (c as any).hitPoints as { max?: number; current?: number; temp?: number } | undefined;

    // Insert any subclass resources that didn't exist when the character was saved.
    // This handles e.g. a Bladesinging Wizard or Hexblade Warlock created before
    // those subclass resources were added to the data layer.
    for (const cl of (c.classes ?? [])) {
      const sub = cl.subclassId ? getSubclass(cl.subclassId) : undefined;
      for (const rd of (sub?.resources ?? [])) {
        if (resources.some(r => r.key === rd.key)) continue; // already present
        const rawMax = rd.maxPerLevel[cl.level] ?? 0;
        const normMax = rawMax === 'unlimited' ? 99 : rawMax as number;
        if (normMax > 0) resources.push({ key: rd.key, current: normMax, max: normMax });
      }
    }

    // Pre-compute ability-mod / profBonus overrides.
    // These must be applied AFTER the maxPerLevel re-sync below (otherwise re-sync
    // overwrites the corrected values back to the table defaults).
    const loadOverrides = computeResourceMaxOverrides(c);

    // Re-sync resource maxes against current class definitions.
    // Needed when class data changes after a character was saved (e.g. arcane_recovery
    // was previously 1 at all levels; now it's ceil(level/2)).
    // Proportionally scales current: full → still full, empty → still empty.
    // Skip keys managed by loadOverrides — their max is not level-table-based.
    resources = resources.map(r => {
      if (loadOverrides[r.key] != null) return r; // handled in override pass below
      for (const cl of (c.classes ?? [])) {
        const def = getClass(cl.classId);
        const classDef = def?.resources.find(rd => rd.key === r.key);
        const sub = cl.subclassId ? getSubclass(cl.subclassId) : undefined;
        const subDef = sub?.resources?.find(rd => rd.key === r.key);
        const rd = classDef ?? subDef;
        if (!rd) continue;
        const rawMax = rd.maxPerLevel[cl.level] ?? 0;
        const normMax = rawMax === 'unlimited' ? 99 : rawMax as number;
        if (normMax !== r.max) {
          const newCurrent = r.max > 0
            ? Math.min(Math.round(r.current / r.max * normMax), normMax)
            : normMax;
          return { ...r, max: normMax, current: newCurrent };
        }
        return r;
      }
      return r;
    });

    // Apply overrides last so they are never overwritten by the re-sync pass above.
    resources = resources.map(r =>
      loadOverrides[r.key] != null
        ? { ...r, max: loadOverrides[r.key]!, current: Math.min(r.current, loadOverrides[r.key]!) }
        : r
    );

    set({
      // Defensive defaults for characters created before fields like
      // classOptions existed in the schema.
      character: {
        ...c,
        maxHP: c.maxHP ?? oldHP?.max ?? 10,
        currentHP: c.currentHP ?? oldHP?.current ?? c.maxHP ?? oldHP?.max ?? 10,
        tempHP: c.tempHP ?? oldHP?.temp ?? 0,
        exhaustionLevel: c.exhaustionLevel ?? 0,
        classOptions: c.classOptions ?? {
          fightingStyles: [],
          invocations: [],
          metamagic: [],
          maneuvers: [],
          infusions: [],
          optionalFeatures: [],
        },
        // Ensure all 9 slot levels are present; {} is truthy so can't use ?? alone.
        spellSlotsUsed: (c.spellSlotsUsed && Object.keys(c.spellSlotsUsed).length === 9)
          ? c.spellSlotsUsed
          : { ...emptySlotState(), ...(c.spellSlotsUsed ?? {}) },
        resources,
        // Strip 'Exhaustion' from the conditions array — it is tracked via exhaustionLevel.
        // Older characters may have it set both ways; migrate to the canonical representation.
        conditions: (c.conditions ?? []).filter((cond) => cond !== 'Exhaustion'),
        selectedFeats: c.selectedFeats ?? [],
        selectedSkillProficiencies: c.selectedSkillProficiencies ?? [],
        spellbook: c.spellbook ?? [],
        inventory: c.inventory ?? [],
        hitDiceUsed: c.hitDiceUsed ?? {},
        currencies: c.currencies ?? { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
        experiencePoints: c.experiencePoints ?? 0,
        enabledBooks: c.enabledBooks ?? ['PHB'],
        deathSaves: c.deathSaves ?? { successes: 0, failures: 0 },
        notes: c.notes ?? '',
        alignment: c.alignment ?? '',
        playerName: c.playerName ?? '',
      },
    });
  },

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

  addInventoryItem: (item) =>
    set((s) => {
      if (!s.character) return s;
      const id = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID() : `item-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
      const next: InventoryItem = { id, source: 'manual', ...item };
      return { character: { ...s.character, inventory: [...(s.character.inventory ?? []), next] } };
    }),

  removeInventoryItem: (id) =>
    set((s) => s.character
      ? { character: { ...s.character, inventory: (s.character.inventory ?? []).filter(i => i.id !== id) } }
      : s),

  setInventoryQuantity: (id, qty) =>
    set((s) => {
      if (!s.character) return s;
      const safeQty = Math.max(0, Math.floor(qty));
      if (safeQty === 0) {
        return { character: { ...s.character, inventory: (s.character.inventory ?? []).filter(i => i.id !== id) } };
      }
      const inventory = (s.character.inventory ?? []).map(i => i.id === id ? { ...i, quantity: safeQty } : i);
      return { character: { ...s.character, inventory } };
    }),

  toggleInventoryEquipped: (id) =>
    set((s) => {
      if (!s.character) return s;
      const inventory = (s.character.inventory ?? []).map(i =>
        i.id === id ? { ...i, equipped: !i.equipped } : i
      );
      return { character: { ...s.character, inventory } };
    }),

  renameInventoryItem: (id, name) =>
    set((s) => {
      if (!s.character) return s;
      const inventory = (s.character.inventory ?? []).map(i =>
        i.id === id ? { ...i, name } : i
      );
      return { character: { ...s.character, inventory } };
    }),

  setInventoryDescription: (id, description) =>
    set((s) => {
      if (!s.character) return s;
      const inventory = (s.character.inventory ?? []).map(i =>
        i.id === id ? { ...i, description: description || undefined } : i
      );
      return { character: { ...s.character, inventory } };
    }),

  setItemCharges: (id, charges) =>
    set((s) => {
      if (!s.character) return s;
      const inventory = (s.character.inventory ?? []).map(i =>
        i.id === id ? { ...i, charges: Math.max(0, Math.min(charges, i.maxCharges ?? charges)) } : i
      );
      return { character: { ...s.character, inventory } };
    }),

  levelUp: (classId, hpGained, hpRoll, subclassPick, asiChoice) =>
    set((s) => {
      if (!s.character) return s;
      // Find the matching class entry; if the character doesn't have this class yet
      // (multiclass dip), append a new ClassLevel.
      let foundClass = false;
      const classes = s.character.classes.map(cl => {
        if (cl.classId !== classId) return cl;
        foundClass = true;
        return {
          ...cl,
          level: cl.level + 1,
          subclassId: cl.subclassId ?? subclassPick,
          hitPointsRolled: [...(cl.hitPointsRolled ?? []), hpRoll],
        };
      });
      if (!foundClass) {
        classes.push({ classId, level: 1, subclassId: subclassPick, hitPointsRolled: [hpRoll] });
      }
      // Apply HP gain. Heal the character by the gained amount so a level-up while
      // damaged increases both max and current HP without overhealing past the new max.
      // 'let' so we can bump them again below if a CON ASI raises the modifier.
      let newMaxHP = s.character.maxHP + hpGained;
      let newCurrentHP = Math.min(newMaxHP, s.character.currentHP + hpGained);

      // Rebuild resources from class+subclass definitions at the new level.
      const classDef = getClass(classId);
      const subDef = (() => {
        const cl = classes.find(c => c.classId === classId);
        return cl?.subclassId ? getSubclass(cl.subclassId) : undefined;
      })();
      const allRds = [...(classDef?.resources ?? []), ...(subDef?.resources ?? [])];
      const newLevel = classes.find(c => c.classId === classId)!.level;
      const oldResources = new Map(s.character.resources.map(r => [r.key, r] as const));
      const resources = [...s.character.resources];
      for (const rd of allRds) {
        const max = rd.maxPerLevel[newLevel] ?? 0;
        const normalisedMax = max === 'unlimited' ? 99 : max;
        const existing = oldResources.get(rd.key);
        if (existing) {
          // Bump the max; keep current usage but don't exceed the new max.
          const idx = resources.findIndex(r => r.key === rd.key);
          if (idx >= 0) {
            resources[idx] = { ...existing, max: normalisedMax, current: Math.min(existing.current + Math.max(0, normalisedMax - existing.max), normalisedMax) };
          }
        } else if (normalisedMax > 0) {
          // New resource unlocked at this level.
          resources.push({ key: rd.key, current: normalisedMax, max: normalisedMax });
        }
      }

      // Apply ability-mod / prof-bonus resource overrides after the maxPerLevel pass.
      // Uses the *new* class array (post level-up) so profBonus is already updated.
      {
        const tempChar = { ...s.character, classes };
        const overrides = computeResourceMaxOverrides(tempChar);
        for (const [key, correctMax] of Object.entries(overrides)) {
          const idx = resources.findIndex(r => r.key === key);
          if (idx >= 0) {
            resources[idx] = { ...resources[idx]!, max: correctMax, current: Math.min(resources[idx]!.current, correctMax) };
          }
        }
      }

      // Refresh pact magic if this is a warlock level up.
      let pactMagic = s.character.pactMagic;
      if (classId === 'warlock') {
        const pm = PACT_MAGIC_TABLE[newLevel];
        if (pm) {
          pactMagic = {
            slotsTotal: pm.slots,
            slotLevel: pm.slotLevel,
            slotsUsed: Math.min(s.character.pactMagic?.slotsUsed ?? 0, pm.slots),
          };
        }
      }

      // Apply ASI or feat choice
      // Hoist race/racial lookup so we can use racialCon in the CON-mod delta check below.
      const race = getRace(s.character.raceId);
      const racialBonuses = race?.abilityScoreIncreases ?? {};
      const racialCon = (racialBonuses as Partial<Record<AbilityKey, number>>).con ?? 0;
      // Old CON modifier (before this ASI) — used to detect a modifier increase.
      const oldConMod = Math.floor(((s.character.baseAbilityScores.con ?? 10) + racialCon - 10) / 2);

      let baseAbilityScores = { ...s.character.baseAbilityScores };
      let selectedFeats = [...(s.character.selectedFeats ?? [])];
      if (asiChoice) {
        if (asiChoice.type === 'feat') {
          if (!selectedFeats.includes(asiChoice.featId)) {
            selectedFeats = [...selectedFeats, asiChoice.featId];
          }
        } else {
          for (const [k, inc] of Object.entries(asiChoice.increases)) {
            const key = k as AbilityKey;
            const racial = (racialBonuses as Partial<Record<AbilityKey, number>>)[key] ?? 0;
            const maxBase = 20 - racial;
            baseAbilityScores = {
              ...baseAbilityScores,
              [key]: Math.min(maxBase, (baseAbilityScores[key] ?? 0) + (inc as number)),
            };
          }
        }
      }

      // Per 5e PHB: "Whenever your Constitution modifier increases by 1, your hit
      // point maximum increases by 1 for each level you have attained."
      // hpGained (calculated in LevelUpDialog) used the old CON mod, so we need
      // to patch both the retroactive levels AND the current level's HP grant.
      const newConMod = Math.floor(((baseAbilityScores.con ?? 10) + racialCon - 10) / 2);
      const conModDelta = newConMod - oldConMod;
      if (conModDelta > 0) {
        const newTotalLevel = classes.reduce((sum, cl) => sum + cl.level, 0);
        const retroHP = conModDelta * newTotalLevel;
        newMaxHP += retroHP;
        newCurrentHP = Math.min(newMaxHP, newCurrentHP + retroHP);
      }

      return {
        character: {
          ...s.character,
          classes,
          maxHP: newMaxHP,
          currentHP: newCurrentHP,
          resources,
          pactMagic,
          baseAbilityScores,
          selectedFeats,
        },
      };
    }),

  updateClassOptions: (partial) =>
    set((s) => {
      if (!s.character) return s;
      const existing = s.character.classOptions ?? { fightingStyles: [], invocations: [], metamagic: [], maneuvers: [], infusions: [], optionalFeatures: [] };
      return { character: { ...s.character, classOptions: { ...existing, ...partial } } };
    }),

  useHitDie: (classId) =>
    set((s) => {
      if (!s.character) return s;
      const cl = s.character.classes.find(c => c.classId === classId);
      if (!cl) return s;
      const used = s.character.hitDiceUsed?.[classId] ?? 0;
      if (used >= cl.level) return s; // none remaining
      return {
        character: {
          ...s.character,
          hitDiceUsed: { ...(s.character.hitDiceUsed ?? {}), [classId]: used + 1 },
        },
      };
    }),

  restoreHitDie: (classId) =>
    set((s) => {
      if (!s.character) return s;
      const used = s.character.hitDiceUsed?.[classId] ?? 0;
      if (used <= 0) return s;
      return {
        character: {
          ...s.character,
          hitDiceUsed: { ...(s.character.hitDiceUsed ?? {}), [classId]: used - 1 },
        },
      };
    }),

  shortRest: () =>
    set((s) => {
      if (!s.character) return s;
      // Build a set of resource keys that recharge on a short rest, from class AND subclass.
      const shortRestKeys = new Set<string>();
      for (const cl of s.character.classes) {
        const def = getClass(cl.classId);
        if (!def) continue;
        for (const rd of def.resources) {
          if (rd.rechargeOn === 'short') shortRestKeys.add(rd.key);
        }
        const sub = cl.subclassId ? getSubclass(cl.subclassId) : undefined;
        for (const rd of sub?.resources ?? []) {
          if (rd.rechargeOn === 'short') shortRestKeys.add(rd.key);
        }
      }
      // Bard level 5+ (Font of Inspiration): bardic inspiration also recharges on short rest.
      const bardLevel = s.character.classes.find(c => c.classId === 'bard')?.level ?? 0;
      if (bardLevel >= 5) shortRestKeys.add('bardic_inspiration');

      // Apply ability-mod / prof-bonus overrides so restoring to r.max gives the correct value
      // even if r.max was set from a stale level-table entry (e.g. bardic inspiration with high CHA).
      const srOverrides = computeResourceMaxOverrides(s.character);
      const resources = s.character.resources.map((r) => {
        if (!shortRestKeys.has(r.key)) return r;
        const correctMax = srOverrides[r.key] ?? r.max;
        return { ...r, max: correctMax, current: correctMax };
      });
      // Restore pact magic on short rest
      const pactMagic = s.character.pactMagic ? { ...s.character.pactMagic, slotsUsed: 0 } : undefined;
      return { character: { ...s.character, resources, pactMagic } };
    }),

  longRest: () =>
    set((s) => {
      if (!s.character) return s;
      const maxHP = s.character.maxHP;
      // Re-apply ability-mod / prof-bonus overrides so the stored max stays accurate
      // even if the character's stats changed since the last level-up.
      const overrides = computeResourceMaxOverrides(s.character);
      const resources = s.character.resources.map((r) => {
        const correctMax = overrides[r.key] ?? r.max;
        return { ...r, max: correctMax, current: correctMax };
      });
      const pactMagic = s.character.pactMagic ? { ...s.character.pactMagic, slotsUsed: 0 } : undefined;
      // Restore up to half (rounded down, min 1) of each class's used hit dice.
      const hitDiceUsed: Record<string, number> = { ...(s.character.hitDiceUsed ?? {}) };
      for (const cl of s.character.classes) {
        const used = hitDiceUsed[cl.classId] ?? 0;
        if (used > 0) {
          const regain = Math.max(1, Math.floor(cl.level / 2));
          hitDiceUsed[cl.classId] = Math.max(0, used - regain);
        }
      }
      return {
        character: {
          ...s.character,
          currentHP: maxHP,
          tempHP: 0,
          deathSaves: { successes: 0, failures: 0 },
          // Exhaustion is tracked via exhaustionLevel only; conditions list
          // should never contain 'Exhaustion'. Per 5e RAW, a long rest does NOT
          // remove conditions — only specific spells/effects do. Preserve them.
          conditions: s.character.conditions,
          exhaustionLevel: Math.max(0, s.character.exhaustionLevel - 1) as ExhaustionLevel,
          spellSlotsUsed: emptySlotState(),
          concentrationSpellId: undefined,
          resources,
          pactMagic,
          hitDiceUsed,
        },
      };
    }),

  toggleInspiration: () =>
    set((s) => s.character ? { character: { ...s.character, inspiration: !s.character.inspiration } } : s),

  setNotes: (notes) =>
    set((s) => s.character ? { character: { ...s.character, notes } } : s),

  setExperiencePoints: (xp) =>
    set((s) => s.character ? { character: { ...s.character, experiencePoints: xp } } : s),

  updateCurrency: (coin, value) =>
    set((s) => {
      if (!s.character) return s;
      return { character: { ...s.character, currencies: { ...s.character.currencies, [coin]: Math.max(0, Math.floor(value)) } } };
    }),

  setPortrait: (dataUrl) =>
    set((s) => s.character ? { character: { ...s.character, portrait: dataUrl } } : s),
}));
