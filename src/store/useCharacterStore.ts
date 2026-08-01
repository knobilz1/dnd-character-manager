import { create } from 'zustand';
import type { Character, Condition, DamageType, ExhaustionLevel, InventoryItem, SlotLevel, ASIChoice, AbilityKey, ClassOptionsState, JournalEntry } from '../types';
import { getRace } from '../data/races';
import { ALL_FEATS } from '../data/feats';
import { useLibraryStore } from './useLibraryStore';
import { useBorrowedStore } from './useBorrowedStore';
import { emptySlotState, PACT_MAGIC_TABLE, totalCharacterLevel } from '../data/mechanics';
import { getClass, baseClassId, classLevel } from '../data/classes';
import { getSubclass } from '../data/subclasses';
import { getSpell } from '../data/spells';
import { computeAlwaysPreparedIds, syncAlwaysPrepared } from '../utils/alwaysPrepared';
import { chosenAsi } from '../utils/racialAsi';
import { computeCharacterDerived } from '../hooks/useCharacterDerived';
import { applyResistance } from '../utils/damageResistance';

/**
 * Resource maxima that scale off an ability modifier or proficiency bonus.
 *
 * This used to be a hand-maintained copy of the same 52 rules in useCharacterDerived, kept in step
 * by a comment. It drifted: the display side gained the PHB 2024 background ASI (C7), the level-20
 * Primal Champion bonus and the score cap at 20/24, and this copy did not — so a bard whose
 * background raised Charisma showed four Bardic Inspiration pips and was restored to three by a
 * long rest. Delegating removes the possibility rather than re-syncing it.
 *
 * computeCharacterDerived is pure and takes a Character, and neither module imports the other, so
 * this is a straight call. It computes more than the overrides, but only runs on load, level-up
 * and rest — never in a render path.
 */
function computeResourceMaxOverrides(c: Character): Record<string, number> {
  return computeCharacterDerived(c).resourceMaxOverrides;
}



interface CharacterState {
  character: Character | null;
  load: (c: Character) => void;
  save: () => void;

  // HP
  setCurrentHP: (hp: number) => void;
  healHP: (amount: number) => void;
  /** `type` is optional: with it, racial resistance halves the damage; without it, behaviour is
   *  unchanged. See utils/damageResistance.ts for why typed damage is opt-in. */
  damageHP: (amount: number, type?: DamageType) => void;
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
  /** maxPrepared: the derived prepared-spell cap, or null/undefined when no cap applies
   *  (known casters, spellbook casters). Passed in because the caller has the authoritative value. */
  toggleSpellPrepared: (spellId: string, maxPrepared?: number | null) => void;
  /** `limits` are the three separate ceilings; omit to add without a cap (migration/import paths). */
  addSpellToBook: (spellId: string, limits?: { known?: number | null; cantrips?: number | null; spellbook?: number | null }) => void;
  removeSpellFromBook: (spellId: string) => void;
  startConcentration: (spellId: string) => void;
  endConcentration: () => void;
  useInnateSpell: (spellId: string) => void;
  useFeatSpell: (featId: string, spellId: string) => void;
  setInnateSpellAbility: (ability: AbilityKey) => void;
  setRacialAbilityChoice: (v: Partial<Record<AbilityKey, number>>) => void;
  setBackgroundAbilityChoice: (v: Partial<Record<AbilityKey, number>>) => void;
  setSubclassOptions: (v: Record<string, string[]>) => void;

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
  useItemCharge: (itemId: string) => void;

  // Level up / hit dice
  levelUp: (classId: string, hpGained: number, hpRoll: number, subclassPick?: string, asiChoice?: ASIChoice, expertiseToAdd?: string[]) => void;
  updateClassOptions: (partial: Partial<ClassOptionsState>) => void;
  useHitDie: (classId: string) => void;
  restoreHitDie: (classId: string) => void;

  // Rest
  shortRest: () => void;
  longRest: () => void;

  // Misc
  toggleInspiration: () => void;
  setNotes: (notes: string) => void;
  /** Rewrite part of the player-authored background (name, traits, backstory).
   *  Merges, so one field can be edited without clearing the rest. */
  updateBackgroundCustom: (patch: Partial<import('../types').BackgroundCustom>) => void;
  setExperiencePoints: (xp: number) => void;
  updateCurrency: (coin: 'cp' | 'sp' | 'ep' | 'gp' | 'pp', value: number) => void;
  setPortrait: (dataUrl: string | undefined) => void;

  // Alternate Forms (Wild Shape, Path of the Beast, Armorer)
  // Companions (creatures the character controls but is not)
  addCompanion: (c: import('../types').Companion) => void;
  removeCompanion: (id: string) => void;
  setCompanionHP: (id: string, hp: number) => void;
  setCompanionActive: (id: string, active: boolean) => void;
  renameCompanion: (id: string, name: string) => void;

  activateWildShape: (form: import('../types').ActiveWildShape) => void;
  deactivateWildShape: () => void;
  damageWildShape: (amount: number) => void;
  healWildShape: (amount: number) => void;
  setArmorerMode: (mode: 'guardian' | 'infiltrator') => void;
  setPathOfBeastForm: (form: 'bite' | 'claws' | 'tail' | null) => void;
  // Journal
  setCampaignName: (name: string) => void;
  addJournalEntry: (entry: Omit<JournalEntry, 'id' | 'createdAt' | 'updatedAt'>) => void;
  updateJournalEntry: (id: string, patch: Partial<Pick<JournalEntry, 'title' | 'date' | 'sessionNumber' | 'content'>>) => void;
  deleteJournalEntry: (id: string) => void;
}

export const useCharacterStore = create<CharacterState>((set, get) => ({
  character: null,

  load: (c) => {
    // Migrate old characters that were created before the resources field existed.
    // If resources is empty but the character has classes, compute them from the
    // class/subclass definitions at the character's current level. For classes with
    // genuinely no tracked resources (Ranger, Rogue), the loop produces nothing and
    // the empty array remains — so the migration is safe for all classes.
    // Copy, don't alias: the insertion passes below push into this array, and pushing into
    // c.resources mutates the caller's character. That aliasing made load() non-idempotent —
    // a second load saw the freshly-pushed pre-override entries as if they had been saved,
    // took the Math.min branch, and clamped every override-managed resource back down.
    let resources = [...(c.resources ?? [])];
    // Psi Warrior and Soulknife used to share one 'psionic_energy' key. Splitting them leaves
    // saved characters holding a key no definition claims any more, and the resource panel
    // renders an unmatched key as its raw string — so rename rather than leave the orphan.
    // A character with both subclasses can only carry one saved entry; the other is inserted
    // fresh below. Neither subclass present means it was already dead data.
    if (resources.some(r => r.key === 'psionic_energy')) {
      const subs = (c.classes ?? []).map(cl => cl.subclassId);
      const renamed = subs.includes('psi-warrior') ? 'psionic_energy_psi_warrior'
        : subs.includes('soulknife') ? 'psionic_energy_soulknife'
        : null;
      resources = renamed
        ? resources.map(r => (r.key === 'psionic_energy' ? { ...r, key: renamed } : r))
        : resources.filter(r => r.key !== 'psionic_energy');
    }
    // Keys the character actually arrived with. Everything else in `resources` after the
    // insertion passes below is brand new, and a brand-new resource must start full.
    // This matters because override-managed keys (ability-mod / prof-bonus maxes) carry a
    // placeholder of 1 in maxPerLevel, so inserting them at the table value and then
    // clamping with Math.min left e.g. a Wis 18 Light Domain cleric on 1/4 Warding Flares.
    const preexisting = new Set(resources.map(r => r.key));
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

    // Insert race-granted resources (Breath Weapon, Relentless Endurance, ...). Races were a fourth
    // source of limited-use abilities with nowhere to live, so none of them could be tracked.
    // Keyed on TOTAL character level, unlike class/subclass resources which use class level.
    {
      const race = getRace(c.raceId);
      const totalLvl = totalCharacterLevel(c.classes ?? []);
      for (const rd of (race?.resources ?? [])) {
        if (resources.some(r => r.key === rd.key)) continue;
        const rawMax = rd.maxPerLevel[totalLvl] ?? 0;
        const normMax = rawMax === 'unlimited' ? 99 : rawMax as number;
        if (normMax > 0) resources.push({ key: rd.key, current: normMax, max: normMax });
      }
    }

    // Insert feat-granted resources (e.g. Lucky feat: 3 luck points).
    for (const featId of (c.selectedFeats ?? [])) {
      const feat = ALL_FEATS.find(f => f.id === featId);
      for (const fr of (feat?.grantedResources ?? [])) {
        if (!resources.some(r => r.key === fr.key)) {
          resources.push({ key: fr.key, current: fr.max, max: fr.max });
        }
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
      // Race resources first, and keyed on TOTAL character level rather than class level.
      // This loop used to consider only classes, so a race max never moved after creation —
      // a Shifter going 4 -> 5 kept 2 uses of Shifting instead of gaining the 3rd, and every
      // proficiency-bonus race trait was frozen at its level-1 value for the whole campaign.
      {
        const rd = (getRace(c.raceId)?.resources ?? []).find(x => x.key === r.key);
        if (rd) {
          const rawMax = rd.maxPerLevel[totalCharacterLevel(c.classes ?? [])] ?? 0;
          const normMax = rawMax === 'unlimited' ? 99 : rawMax as number;
          if (normMax !== r.max) {
            const newCurrent = r.max > 0
              ? Math.min(Math.round(r.current / r.max * normMax), normMax)
              : normMax;
            return { ...r, max: normMax, current: newCurrent };
          }
          return r;
        }
      }
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
    resources = resources.map(r => {
      const ov = loadOverrides[r.key];
      if (ov == null) return r;
      // Newly inserted this load → start full. Already-saved → clamp, so a stat drop
      // (or a level loss) lowers the max without silently refilling spent uses.
      return { ...r, max: ov, current: preexisting.has(r.key) ? Math.min(r.current, ov) : ov };
    });

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
        spellbook: syncAlwaysPrepared(
          c.spellbook ?? [],
          computeAlwaysPreparedIds(c.classes ?? [], c.classOptions, c.subclassOptions),
        ),
        // Migrate existing characters: add innate spell uses for any unlocked spells
        // that weren't tracked yet (cantrips are unlimited and not stored).
        innateSpellUses: (() => {
          const race = getRace(c.raceId);
          const merged = { ...(c.innateSpellUses ?? {}) };
          if (race?.innateSpells) {
            const totalLevel = totalCharacterLevel(c.classes ?? []);
            for (const spell of race.innateSpells) {
              if (spell.recharge === 'cantrip') continue;
              if ((spell.minCharLevel ?? 1) > totalLevel) continue;
              if (merged[spell.spellId] == null) merged[spell.spellId] = 1;
            }
          }
          // Feat-granted spells use prefixed keys: feat:FEATID:SPELLID
          for (const featId of (c.selectedFeats ?? [])) {
            const feat = ALL_FEATS.find(f => f.id === featId);
            for (const gs of feat?.grantedSpells ?? []) {
              if (gs.recharge === 'cantrip') continue;
              const key = `feat:${featId}:${gs.spellId}`;
              if (merged[key] == null) merged[key] = 1;
            }
          }
          return merged;
        })(),
        inventory: c.inventory ?? [],
        hitDiceUsed: c.hitDiceUsed ?? {},
        currencies: c.currencies ?? { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
        experiencePoints: c.experiencePoints ?? 0,
        enabledBooks: c.enabledBooks ?? ['PHB'],
        deathSaves: c.deathSaves ?? { successes: 0, failures: 0 },
        notes: c.notes ?? '',
        alignment: c.alignment ?? '',
        playerName: c.playerName ?? '',
        // Alternate forms migration
        activeWildShape: c.activeWildShape ?? null,
        armorerMode: c.armorerMode ?? 'guardian',
        pathOfBeastForm: c.pathOfBeastForm ?? null,
        campaignName: c.campaignName ?? '',
        journal: c.journal ?? [],
        expertiseSkills: c.expertiseSkills ?? [],
        featChoices: c.featChoices ?? {},
        knowledgeDomainSkills: c.knowledgeDomainSkills ?? [],
      },
    });
  },

  save: () => {
    const { character } = get();
    if (!character) return;
    // Every mutation on the sheet funnels through here, which makes this the
    // one place ownership has to be decided. A character borrowed from an
    // absent player must never reach useLibraryStore: that store is what
    // useDriveStore uploads, so it would put someone else's sheet in the
    // borrower's personal Google Drive backup for good. Branching at the
    // chokepoint covers the whole sheet; patching individual call sites would
    // leave every one that got missed still leaking.
    if (useBorrowedStore.getState().has(character.id)) {
      useBorrowedStore.getState().updateCharacter(character);
      return;
    }
    useLibraryStore.getState().updateCharacter(character);
  },

  setCurrentHP: (hp) =>
    set((s) => {
      if (!s.character) return s;
      // Exhaustion 4 halves the HP maximum (PHB p. 291); cap to that, not the raw max.
      const effMax = (s.character.exhaustionLevel ?? 0) >= 4
        ? Math.floor(s.character.maxHP / 2)
        : s.character.maxHP;
      return { character: { ...s.character, currentHP: Math.min(Math.max(hp, 0), effMax) } };
    }),

  healHP: (amount) =>
    set((s) => {
      if (!s.character) return s;
      const effMax = (s.character.exhaustionLevel ?? 0) >= 4
        ? Math.floor(s.character.maxHP / 2)
        : s.character.maxHP;
      const next = Math.min(s.character.currentHP + amount, effMax);
      return { character: { ...s.character, currentHP: next } };
    }),

  damageHP: (amount, type) =>
    set((s) => {
      if (!s.character) return s;
      // Resistance halves BEFORE temp HP absorbs anything (PHB p.197: halving is the last step of
      // computing the damage; temp HP then soaks what's left). Untyped damage is unchanged, which
      // is every call site that predates this.
      const dealt = applyResistance(s.character, amount, type);
      let { tempHP, currentHP } = s.character;
      const tempAbsorb = Math.min(tempHP, dealt);
      tempHP -= tempAbsorb;
      currentHP = Math.max(0, currentHP - (dealt - tempAbsorb));
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

  toggleSpellPrepared: (spellId, maxPrepared) =>
    set((s) => {
      if (!s.character) return s;
      const entry = s.character.spellbook.find((sp) => sp.spellId === spellId);
      if (!entry) return s;

      // Enforce the prepared-spell cap HERE rather than in the panel: this action is the single
      // chokepoint every preparation path funnels through, so a future caller can't bypass it.
      // The cap is passed in rather than recomputed — the caller derives it from the full ability
      // pipeline (base + racial + feats + ASI), which this store does not reproduce faithfully.
      // Un-preparing is always allowed, and cantrips/always-prepared spells never count (PHB: domain
      // and other always-prepared spells "don't count against the number of spells you can prepare").
      if (!entry.isPrepared && maxPrepared != null && maxPrepared > 0) {
        const spell = getSpell(spellId);
        if (spell && spell.level > 0) {
          const preparedCount = s.character.spellbook.filter((sp) => {
            if (!sp.isPrepared || sp.isAlwaysPrepared) return false;
            const sp2 = getSpell(sp.spellId);
            return sp2 && sp2.level > 0;
          }).length;
          if (preparedCount >= maxPrepared) return s; // at the cap — refuse
        }
      }

      const spellbook = s.character.spellbook.map((sp) =>
        sp.spellId === spellId ? { ...sp, isPrepared: !sp.isPrepared } : sp
      );
      return { character: { ...s.character, spellbook } };
    }),

  addSpellToBook: (spellId, limits) =>
    set((s) => {
      if (!s.character || s.character.spellbook.find(sp => sp.spellId === spellId)) return s;

      // R16/R2: cap learning HERE, next to the prepared-spell guard, because this action is the one
      // chokepoint every "learn a spell" path funnels through. Previously only the creator enforced
      // a limit, so a character built correctly could then open the sheet and learn the entire
      // class list — and the level-up dialog's own gate was bypassed by the sheet's Add Spell
      // browser, which called straight through.
      //
      // Cantrips, known spells and a wizard's spellbook are three SEPARATE ceilings; a cantrip must
      // never be refused because the spells-known list is full. `undefined`/`null` means no limit
      // applies to that kind, which is not the same as a limit of 0.
      const spell = getSpell(spellId);
      if (spell && limits) {
        const isCantrip = spell.level === 0;
        const cap = isCantrip ? limits.cantrips
          : limits.spellbook != null ? limits.spellbook
          : limits.known;
        if (cap != null && cap > 0) {
          const held = s.character.spellbook.filter((sp) => {
            if (sp.isAlwaysPrepared) return false;   // granted by subclass/race, never counted
            const sp2 = getSpell(sp.spellId);
            return sp2 && (sp2.level === 0) === isCantrip;
          }).length;
          if (held >= cap) return s;                 // at the ceiling — refuse
        }
      }
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

  useItemCharge: (itemId) =>
    set((s) => {
      if (!s.character) return s;
      const inventory = (s.character.inventory ?? []).map(i =>
        i.id === itemId ? { ...i, charges: Math.max(0, (i.charges ?? i.maxCharges ?? 1) - 1) } : i
      );
      return { character: { ...s.character, inventory } };
    }),

  levelUp: (classId, hpGained, hpRoll, subclassPick, asiChoice, expertiseToAdd) =>
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

      // Pre-compute ability-mod / prof-bonus overrides so we can skip those keys
      // in the maxPerLevel loop — otherwise the loop caps current down to the table
      // value and the subsequent override correction can't recover it.
      const tempChar = { ...s.character, classes };
      const levelUpOverrides = computeResourceMaxOverrides(tempChar);

      for (const rd of allRds) {
        if (levelUpOverrides[rd.key] != null) continue; // handled in override pass below
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

      // Apply ability-mod / prof-bonus overrides.
      // Handled separately so they never get capped to a lower maxPerLevel table value.
      for (const [key, correctMax] of Object.entries(levelUpOverrides)) {
        const existing = oldResources.get(key);
        const idx = resources.findIndex(r => r.key === key);
        const prevMax = existing?.max ?? 0;
        // Carry over any gains in max (e.g. profBonus tier went up this level-up).
        const currentGain = Math.max(0, correctMax - prevMax);
        if (idx >= 0) {
          resources[idx] = { ...resources[idx]!, max: correctMax, current: Math.min(resources[idx]!.current + currentGain, correctMax) };
        } else if (correctMax > 0) {
          // Resource first becomes available at this level (e.g. bladesong unlocks at wizard 2).
          resources.push({ key, current: correctMax, max: correctMax });
        }
      }

      // Refresh pact magic if this is a warlock level up.
      let pactMagic = s.character.pactMagic;
      if (baseClassId(classId) === 'warlock') {
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
      const racialBonuses = chosenAsi(race, s.character.racialAbilityChoice);
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
          // Apply player-chosen ability score increase from feat (e.g. Resilient, Athlete, etc.)
          if (asiChoice.abilityIncrease) {
            for (const [k, inc] of Object.entries(asiChoice.abilityIncrease)) {
              const key = k as AbilityKey;
              const racial = (racialBonuses as Partial<Record<AbilityKey, number>>)[key] ?? 0;
              const maxBase = 20 - racial;
              baseAbilityScores = {
                ...baseAbilityScores,
                [key]: Math.min(maxBase, (baseAbilityScores[key] ?? 0) + (inc as number)),
              };
            }
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

      // Sync always-prepared spells for newly unlocked subclass spell tables.
      const newSpellbook = syncAlwaysPrepared(
        s.character.spellbook,
        computeAlwaysPreparedIds(classes, s.character.classOptions, s.character.subclassOptions),
      );

      // Unlock any newly accessible innate spells (based on new total character level).
      const newTotalLevelForInnate = classes.reduce((sum, cl) => sum + cl.level, 0);
      const innateSpellUses = (() => {
        const merged = { ...(s.character.innateSpellUses ?? {}) };
        const race = getRace(s.character.raceId);
        if (race?.innateSpells) {
          for (const spell of race.innateSpells) {
            if (spell.recharge === 'cantrip') continue;
            if ((spell.minCharLevel ?? 1) > newTotalLevelForInnate) continue;
            if (merged[spell.spellId] == null) merged[spell.spellId] = 1;
          }
        }
        // Initialize uses for any feat-granted spells (covers feat just taken this level-up).
        for (const featId of selectedFeats) {
          const feat = ALL_FEATS.find(f => f.id === featId);
          for (const gs of feat?.grantedSpells ?? []) {
            if (gs.recharge === 'cantrip') continue;
            const key = `feat:${featId}:${gs.spellId}`;
            if (merged[key] == null) merged[key] = 1;
          }
        }
        return merged;
      })();

      // Merge expertise picks
      const expertiseSkills = [
        ...(s.character.expertiseSkills ?? []),
        ...(expertiseToAdd ?? []),
      ];

      // Derive featChoices: if the ASI feat has grantsSaveForChosenAbility, record it
      const newFeatChoices = { ...(s.character.featChoices ?? {}) };
      if (asiChoice?.type === 'feat' && asiChoice.abilityIncrease) {
        const feat = ALL_FEATS.find(f => f.id === asiChoice.featId);
        if (feat?.grantsSaveForChosenAbility) {
          const chosenAbility = Object.keys(asiChoice.abilityIncrease)[0] as AbilityKey;
          if (chosenAbility) newFeatChoices[asiChoice.featId] = chosenAbility;
        }
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
          spellbook: newSpellbook,
          innateSpellUses,
          expertiseSkills,
          featChoices: newFeatChoices,
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
      const bardLevel = classLevel(s.character.classes, 'bard');
      if (bardLevel >= 5) shortRestKeys.add('bardic_inspiration');
      // Feat-granted short-rest resources
      for (const featId of (s.character.selectedFeats ?? [])) {
        const feat = ALL_FEATS.find(f => f.id === featId);
        for (const fr of (feat?.grantedResources ?? [])) {
          if (fr.rechargeOn === 'short') shortRestKeys.add(fr.key);
        }
      }

      // Apply ability-mod / prof-bonus overrides so restoring to r.max gives the correct value
      // even if r.max was set from a stale level-table entry (e.g. bardic inspiration with high CHA).
      // Race-granted short-rest resources (Breath Weapon, Stone's Endurance, ...).
      for (const rd of (getRace(s.character.raceId)?.resources ?? [])) {
        if (rd.rechargeOn === 'short') shortRestKeys.add(rd.key);
      }

      // Partial short-rest recovery: "regain N on a Short Rest, all on a Long Rest".
      // Distinct from shortRestKeys, which refill completely.
      const partialRegain = new Map<string, number>();
      for (const cl of s.character.classes) {
        const def = getClass(cl.classId);
        const sub = cl.subclassId ? getSubclass(cl.subclassId) : undefined;
        for (const rd of [...(def?.resources ?? []), ...(sub?.resources ?? [])]) {
          if (rd.shortRestRegain && rd.shortRestRegain > 0) partialRegain.set(rd.key, rd.shortRestRegain);
        }
      }
      for (const rd of (getRace(s.character.raceId)?.resources ?? [])) {
        if (rd.shortRestRegain && rd.shortRestRegain > 0) partialRegain.set(rd.key, rd.shortRestRegain);
      }

      const srOverrides = computeResourceMaxOverrides(s.character);
      let resources = s.character.resources.map((r) => {
        const correctMax = srOverrides[r.key] ?? r.max;
        if (shortRestKeys.has(r.key)) return { ...r, max: correctMax, current: correctMax };
        const regain = partialRegain.get(r.key);
        if (regain) return { ...r, max: correctMax, current: Math.min(r.current + regain, correctMax) };
        return r;
      });

      // Bloodwell Vial (Tasha's): if one is equipped, regain 1d3 sorcery points per short rest.
      const hasBloodwellVial = (s.character.inventory ?? []).some(
        i => i.equipped && i.name.startsWith('Bloodwell Vial'),
      );
      if (hasBloodwellVial) {
        const d3 = Math.ceil(Math.random() * 3);
        resources = resources.map(r =>
          r.key === 'sorcery_points'
            ? { ...r, current: Math.min(r.current + d3, r.max) }
            : r,
        );
      }

      // Sorcerous Restoration (Sorcerer level 20): regain 4 sorcery points on short rest.
      const sorcererLevel = classLevel(s.character.classes, 'sorcerer');
      if (sorcererLevel >= 20) {
        resources = resources.map(r =>
          r.key === 'sorcery_points'
            ? { ...r, current: Math.min(r.current + 4, r.max) }
            : r,
        );
      }
      // Restore pact magic on short rest
      const pactMagic = s.character.pactMagic ? { ...s.character.pactMagic, slotsUsed: 0 } : undefined;
      // Restore short-rest innate spell uses (racial + feat-granted)
      const srInnateUses = (() => {
        const merged = { ...(s.character.innateSpellUses ?? {}) };
        const race = getRace(s.character.raceId);
        if (race?.innateSpells) {
          for (const spell of race.innateSpells) {
            if (spell.recharge === 'short') merged[spell.spellId] = 1;
          }
        }
        for (const featId of (s.character.selectedFeats ?? [])) {
          const feat = ALL_FEATS.find(f => f.id === featId);
          for (const gs of feat?.grantedSpells ?? []) {
            if (gs.recharge === 'short') merged[`feat:${featId}:${gs.spellId}`] = 1;
          }
        }
        return merged;
      })();
      // Restore charges on items that recharge on a short rest.
      // NOT gated on `equipped`: every charged item template is category 'magic', and
      // InventoryPanel only offers an equip toggle for armor/shield/weapon — so an
      // `i.equipped` condition here silently meant no item ever recharged at all.
      const srInventory = (s.character.inventory ?? []).map(i =>
        (i.maxCharges != null && i.recharge === 'short')
          ? { ...i, charges: i.maxCharges }
          : i
      );
      return { character: { ...s.character, resources, pactMagic, innateSpellUses: srInnateUses, inventory: srInventory } };
    }),

  longRest: () =>
    set((s) => {
      if (!s.character) return s;
      // Long rest reduces exhaustion by 1 first. The restored HP is capped at the
      // NEW (post-rest) effective max — so exhaustion 5→4 still halves it, but
      // exhaustion 4→3 lets you heal to full (PHB p. 186 + exhaustion table).
      const newExhaustionLevel = Math.max(0, s.character.exhaustionLevel - 1) as ExhaustionLevel;
      const effMax = newExhaustionLevel >= 4
        ? Math.floor(s.character.maxHP / 2)
        : s.character.maxHP;
      // Re-apply ability-mod / prof-bonus overrides so the stored max stays accurate
      // even if the character's stats changed since the last level-up.
      // Keys whose rule is not a rest at all (Divine Intervention's 7-day cooldown, the
      // Genie's 1d4-long-rests Limited Wish). A long rest must NOT hand these back — that
      // is the whole reason 'special' exists. The player resets them by hand.
      const specialKeys = new Set<string>();
      for (const cl of s.character.classes) {
        const def = getClass(cl.classId);
        const sub = cl.subclassId ? getSubclass(cl.subclassId) : undefined;
        for (const rd of [...(def?.resources ?? []), ...(sub?.resources ?? [])]) {
          if (rd.rechargeOn === 'special') specialKeys.add(rd.key);
        }
      }
      for (const rd of (getRace(s.character.raceId)?.resources ?? [])) {
        if (rd.rechargeOn === 'special') specialKeys.add(rd.key);
      }
      const overrides = computeResourceMaxOverrides(s.character);
      const resources = s.character.resources.map((r) => {
        const correctMax = overrides[r.key] ?? r.max;
        if (specialKeys.has(r.key)) return { ...r, max: correctMax };
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
      // Restore all innate spell uses (long rest covers both long and short recharge).
      const lrInnateUses = (() => {
        const merged = { ...(s.character.innateSpellUses ?? {}) };
        const race = getRace(s.character.raceId);
        if (race?.innateSpells) {
          const totalLevel = totalCharacterLevel(s.character.classes);
          for (const spell of race.innateSpells) {
            if (spell.recharge === 'cantrip') continue;
            if ((spell.minCharLevel ?? 1) > totalLevel) continue;
            merged[spell.spellId] = 1;
          }
        }
        for (const featId of (s.character.selectedFeats ?? [])) {
          const feat = ALL_FEATS.find(f => f.id === featId);
          for (const gs of feat?.grantedSpells ?? []) {
            if (gs.recharge !== 'cantrip') merged[`feat:${featId}:${gs.spellId}`] = 1;
          }
        }
        return merged;
      })();

      // Restore charges on items that recharge at dawn / long rest (both map to long rest here).
      // See the short-rest note above for why this is not gated on `equipped`.
      const lrInventory = (s.character.inventory ?? []).map(i =>
        (i.maxCharges != null && (i.recharge === 'dawn' || i.recharge === 'long' || i.recharge === 'short'))
          ? { ...i, charges: i.maxCharges }
          : i
      );

      return {
        character: {
          ...s.character,
          currentHP: effMax,
          tempHP: 0,
          deathSaves: { successes: 0, failures: 0 },
          // Exhaustion is tracked via exhaustionLevel only; conditions list
          // should never contain 'Exhaustion'. Per 5e RAW, a long rest does NOT
          // remove conditions — only specific spells/effects do. Preserve them.
          conditions: s.character.conditions,
          exhaustionLevel: newExhaustionLevel,
          spellSlotsUsed: emptySlotState(),
          concentrationSpellId: undefined,
          resources,
          pactMagic,
          hitDiceUsed,
          innateSpellUses: lrInnateUses,
          inventory: lrInventory,
          // Long rest reverts Wild Shape (druid reverts when resting)
          activeWildShape: null,
        },
      };
    }),

  useInnateSpell: (spellId) =>
    set((s) => {
      if (!s.character) return s;
      const innateSpellUses = { ...(s.character.innateSpellUses ?? {}), [spellId]: 0 };
      return { character: { ...s.character, innateSpellUses } };
    }),

  useFeatSpell: (featId, spellId) =>
    set((s) => {
      if (!s.character) return s;
      const key = `feat:${featId}:${spellId}`;
      const innateSpellUses = { ...(s.character.innateSpellUses ?? {}), [key]: 0 };
      return { character: { ...s.character, innateSpellUses } };
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

  // ── Alternate Forms ────────────────────────────────────────────────────
  // ── Companions ─────────────────────────────────────────────────────────────
  // A companion is a separate creature, so unlike Wild Shape its HP is its own pool and running
  // it to 0 does NOT revert or damage the character — a downed companion stays in the list at 0
  // so it can be healed or, for a beast, replaced by bonding a new one over 8 hours.
  addCompanion: (c) =>
    set((s) => s.character
      ? { character: { ...s.character, companions: [...(s.character.companions ?? []), c] } }
      : s),

  removeCompanion: (id) =>
    set((s) => s.character
      ? { character: { ...s.character, companions: (s.character.companions ?? []).filter(c => c.id !== id) } }
      : s),

  setCompanionHP: (id, hp) =>
    set((s) => s.character
      ? { character: { ...s.character, companions: (s.character.companions ?? []).map(c =>
          c.id === id ? { ...c, currentHP: Math.max(0, hp) } : c) } }
      : s),

  setCompanionActive: (id, active) =>
    set((s) => s.character
      ? { character: { ...s.character, companions: (s.character.companions ?? []).map(c =>
          c.id === id ? { ...c, active } : c) } }
      : s),

  renameCompanion: (id, name) =>
    set((s) => s.character
      ? { character: { ...s.character, companions: (s.character.companions ?? []).map(c =>
          c.id === id ? { ...c, name } : c) } }
      : s),

  activateWildShape: (form) =>
    set((s) => s.character ? { character: { ...s.character, activeWildShape: form } } : s),

  deactivateWildShape: () =>
    set((s) => s.character ? { character: { ...s.character, activeWildShape: null } } : s),

  damageWildShape: (amount) =>
    set((s) => {
      if (!s.character?.activeWildShape) return s;
      const ws = s.character.activeWildShape;
      const newHp = Math.max(0, ws.currentHp - amount);
      // PHB p. 67: when beast HP hits 0, druid simply reverts — excess damage
      // does NOT carry over to the druid's own HP pool.
      if (newHp === 0) return { character: { ...s.character, activeWildShape: null } };
      return { character: { ...s.character, activeWildShape: { ...ws, currentHp: newHp } } };
    }),

  healWildShape: (amount) =>
    set((s) => {
      if (!s.character?.activeWildShape) return s;
      const ws = s.character.activeWildShape;
      return { character: { ...s.character, activeWildShape: { ...ws, currentHp: Math.min(ws.currentHp + amount, ws.maxHp) } } };
    }),

  setInnateSpellAbility: (ability) =>
    set((s) => s.character ? { character: { ...s.character, innateSpellAbility: ability } } : s),

  setRacialAbilityChoice: (v) =>
    set((s) => s.character ? { character: { ...s.character, racialAbilityChoice: v } } : s),

  setBackgroundAbilityChoice: (v) =>
    set((s) => s.character ? { character: { ...s.character, backgroundAbilityChoice: v } } : s),

  setSubclassOptions: (v) =>
    set((s) => {
      if (!s.character) return s;
      // Re-sync the spellbook: a `grants: 'cantrip'` group (Acolyte of Nature, Arcane Initiate,
      // Land's Bonus Cantrip) puts the CHOSEN cantrip into always-prepared, so picking one here
      // has to land it in the book now. Without this the pick sat in subclassOptions and the
      // cantrip only appeared after the next load or level-up.
      const character = { ...s.character, subclassOptions: v };
      return {
        character: {
          ...character,
          spellbook: syncAlwaysPrepared(
            character.spellbook ?? [],
            computeAlwaysPreparedIds(character.classes ?? [], character.classOptions, v),
          ),
        },
      };
    }),

  setArmorerMode: (mode) =>
    set((s) => s.character ? { character: { ...s.character, armorerMode: mode } } : s),

  setPathOfBeastForm: (form) =>
    set((s) => s.character ? { character: { ...s.character, pathOfBeastForm: form } } : s),

  setCampaignName: (name) =>
    set((s) => s.character ? { character: { ...s.character, campaignName: name } } : s),

  updateBackgroundCustom: (patch) =>
    set((s) => s.character
      ? { character: { ...s.character, backgroundCustom: { ...s.character.backgroundCustom, ...patch } } }
      : s),

  addJournalEntry: (entry) =>
    set((s) => {
      if (!s.character) return s;
      const newEntry: JournalEntry = {
        ...entry,
        id: crypto.randomUUID(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      return { character: { ...s.character, journal: [newEntry, ...(s.character.journal ?? [])] } };
    }),

  updateJournalEntry: (id, patch) =>
    set((s) => {
      if (!s.character) return s;
      return {
        character: {
          ...s.character,
          journal: (s.character.journal ?? []).map(e =>
            e.id === id ? { ...e, ...patch, updatedAt: Date.now() } : e,
          ),
        },
      };
    }),

  deleteJournalEntry: (id) =>
    set((s) => {
      if (!s.character) return s;
      return { character: { ...s.character, journal: (s.character.journal ?? []).filter(e => e.id !== id) } };
    }),
}));
