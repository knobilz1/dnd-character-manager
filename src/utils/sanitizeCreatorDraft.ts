import type { Character } from '../types';
import { getClass } from '../data/classes';
import { getSubclass } from '../data/subclasses';
import { getSpell } from '../data/spells';
import {
  ASI_LEVELS,
  warlockInvocationsKnown,
  sorcererMetamagicKnown,
  battleMasterManeuversKnown,
  artificerInfusionsKnown,
  computeMaxSpellLevel,
  cantripsKnownFor,
  spellsKnownFor,
} from '../data/mechanics';
import { baseClassId } from '../data/classes';

/**
 * Trims a creator draft down to what its class and level actually allow.
 *
 * The wizard steps enforce budgets at PICK time — StepSpells won't offer a
 * 3rd-level spell to a level-1 wizard — but nothing ever re-checked after the
 * fact, and the class/level controls sit on the FIRST step. So build a level-5
 * Battle Master, pick maneuvers, spells and a feat, then drop the level slider
 * to 1: the subclass survives below its own unlock level, the maneuvers and the
 * feat come along, and a switch from wizard to fighter kept the whole spellbook.
 * Every later step then renders choices its own rules would refuse to offer.
 *
 * Runs inside updateDraft — the one place every edit already flows — so it
 * cannot be forgotten by a new step, and RandomCharacterButton and the dev
 * escape hatch get it for free. It TRIMS to legality rather than resetting:
 * a wizard switching to sorcerer keeps the spells both lists share and loses
 * only the rest, which is what "retraining" should feel like. Idempotent, and
 * a legal draft passes through structurally unchanged.
 *
 * Deliberately out of scope (each noted where it bites): the wizard's
 * cumulative per-spell-level book caps (the flat book size and max castable
 * level are enforced; the "how many 3rd-or-higher" refinement lives only in
 * StepSpells), fighting-style unlock levels (reset on class switch; a
 * paladin dropped from 2 to 1 keeps the style until the step is revisited),
 * and multiclass entries beyond classes[0] (the creator UI is single-class;
 * LevelUpDialog owns multiclass hygiene).
 */

type Draft = Partial<Character> & { equipmentChoices?: Record<number, number> };

export function sanitizeCreatorDraft<T extends Draft>(draft: T): T {
  const cl = draft.classes?.[0];
  const cls = cl ? getClass(cl.classId) : undefined;
  if (!cl || !cls) return draft;
  const level = cl.level;
  const out: T = { ...draft };

  // ── Subclass first: it decides spell lists and budgets for everything below.
  let sub = cl.subclassId ? getSubclass(cl.subclassId) : undefined;
  const subclassInvalid =
    !!cl.subclassId &&
    (!sub || sub.classId !== cl.classId || level < (cls.subclassLevel ?? 1));
  if (subclassInvalid) {
    sub = undefined;
    out.classes = [{ ...cl, subclassId: undefined }, ...(draft.classes!.slice(1))];
  }

  // ── Class options: each list trimmed to its ladder at this level. The ladders
  // are the same ones the step and the LevelUpDialog read (mechanics.ts), so the
  // three can't disagree. Trimming keeps the FIRST picks — the later ones are
  // the ones the lower level hadn't earned yet.
  const baseId = baseClassId(cl.classId);
  const isBattleMaster = baseId === 'fighter' && (cl.subclassId === 'battle-master' || cl.subclassId === 'battle-master-2024') && !subclassInvalid;
  const co = draft.classOptions;
  if (co) {
    const caps = {
      invocations: baseId === 'warlock' ? warlockInvocationsKnown(cl.classId, level) : 0,
      metamagic: baseId === 'sorcerer' ? sorcererMetamagicKnown(cl.classId, level) : 0,
      maneuvers: isBattleMaster ? battleMasterManeuversKnown(level) : 0,
      infusions: baseId === 'artificer' ? artificerInfusionsKnown(level) : 0,
    };
    const trimmed = {
      ...co,
      invocations: co.invocations.slice(0, caps.invocations),
      metamagic: co.metamagic.slice(0, caps.metamagic),
      maneuvers: co.maneuvers.slice(0, caps.maneuvers),
      infusions: co.infusions.slice(0, caps.infusions),
    };
    if (
      trimmed.invocations.length !== co.invocations.length ||
      trimmed.metamagic.length !== co.metamagic.length ||
      trimmed.maneuvers.length !== co.maneuvers.length ||
      trimmed.infusions.length !== co.infusions.length
    ) {
      out.classOptions = trimmed;
    }
  }

  // ── Spellbook. Mirrors StepSpells' own resolution line for line: the subclass
  // overrides list/type/budgets for EK and Arcane Trickster, 2024 classes reach
  // their list through spellListClassId, and the wizard's book is 6 + 2/level.
  if (draft.spellbook?.length) {
    const isSubCaster = !!sub?.spellcastingType && sub.spellcastingType !== 'none';
    const isCaster = (cls.spellcastingType && cls.spellcastingType !== 'none') || isSubCaster;
    if (!isCaster) {
      // Even a non-caster keeps its GRANTS — always-prepared entries are synced
      // by load(), not picked here, and deleting them would fight that system.
      const kept = draft.spellbook.filter((e) => e.isAlwaysPrepared);
      if (kept.length !== draft.spellbook.length) out.spellbook = kept;
    } else {
      const effectiveType = isSubCaster ? (sub!.spellcastingType ?? 'none') : (cls.spellcastingType ?? 'none');
      const listId = isSubCaster
        ? (sub!.spellListClassId ?? cl.classId)
        : (cls.spellListClassId ?? cl.classId);
      const maxSpellLevel = computeMaxSpellLevel(effectiveType, cl.classId, level);
      const cantripCap = isSubCaster
        ? (sub!.cantripsKnownByClassLevel?.[Math.min(level, 20) - 1] ?? 0)
        : cantripsKnownFor(cl.classId, level);
      const knownCap = isSubCaster
        ? (sub!.spellsKnownByClassLevel?.[Math.min(level, 20) - 1] ?? 0)
        : spellsKnownFor(cl.classId, level);
      const isSpellbookCaster = ['wizard', 'wizard-2024'].includes(cl.classId);
      // 0 means "no pick cap here" — prepared casters (cleric, druid…) choose on
      // the sheet, so only list membership and castable level bind them.
      const leveledCap = isSpellbookCaster ? 6 + 2 * Math.max(0, level - 1) : knownCap;

      let cantrips = 0;
      let leveled = 0;
      const kept = draft.spellbook.filter((entry) => {
        // Grants (Light Domain's Light, patron spells) are synced by load(), not
        // picked here — they pass through untouched and count against nothing.
        if (entry.isAlwaysPrepared) return true;
        const spell = getSpell(entry.spellId);
        if (!spell) return false;
        if (!spell.classes.includes(listId)) return false;
        if (spell.level > maxSpellLevel) return false;
        if (spell.level === 0) return ++cantrips <= cantripCap;
        return leveledCap === 0 || ++leveled <= leveledCap;
      });
      if (kept.length !== draft.spellbook.length) out.spellbook = kept;
    }
  }

  // ── Feats: one pick per ASI level reached, plus every record hanging off a
  // feat that no longer fits — an orphaned Resilient choice or Magic Initiate
  // spell list would resurface the moment the feat was re-taken.
  if (draft.selectedFeats?.length) {
    const slots = (ASI_LEVELS[cl.classId] ?? []).filter((l) => l <= level).length;
    if (draft.selectedFeats.length > slots) {
      const keptFeats = draft.selectedFeats.slice(0, slots);
      out.selectedFeats = keptFeats;
      const keep = new Set(keptFeats);
      if (draft.featChoices) {
        out.featChoices = Object.fromEntries(Object.entries(draft.featChoices).filter(([id]) => keep.has(id)));
      }
      if (draft.selectedFeatPicks) {
        out.selectedFeatPicks = Object.fromEntries(Object.entries(draft.selectedFeatPicks).filter(([id]) => keep.has(id)));
      }
      if (draft.selectedFeatSpells) {
        // Keys are `${featId}:${grantKey}`.
        out.selectedFeatSpells = Object.fromEntries(
          Object.entries(draft.selectedFeatSpells).filter(([key]) => keep.has(key.split(':')[0])),
        );
      }
    }
  }

  // ── Class skill picks: keep what the new class also offers, drop the rest,
  // and never more than its count. Racial/background skills live elsewhere
  // (see the Character doc comment on selectedSkillProficiencies).
  if (draft.selectedSkillProficiencies?.length && cls.skillChoices) {
    const offered = new Set(cls.skillChoices.from);
    const kept = draft.selectedSkillProficiencies
      .filter((s) => offered.has(s))
      .slice(0, cls.skillChoices.count);
    if (kept.length !== draft.selectedSkillProficiencies.length) {
      out.selectedSkillProficiencies = kept;
    }
  }

  return out;
}
