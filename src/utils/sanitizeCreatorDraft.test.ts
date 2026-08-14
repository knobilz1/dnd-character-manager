import { describe, it, expect } from 'vitest';
import { sanitizeCreatorDraft } from './sanitizeCreatorDraft';
import { useCreatorStore } from '../store/useCreatorStore';
import { getSpell } from '../data/spells';
import { getSubclass } from '../data/subclasses';
import type { Character, PreparedSpell } from '../types';

/**
 * The two review findings: the creator never revalidated on a level drop, and a
 * class switch kept the old spellbook. The steps enforce budgets at pick time
 * only, and the class/level controls live on the FIRST step — so every later
 * step could be left holding choices its own rules would refuse to offer.
 */

type Draft = Partial<Character> & { equipmentChoices?: Record<number, number> };

function draft(patch: Draft): Draft {
  return {
    classOptions: { fightingStyles: [], invocations: [], metamagic: [], maneuvers: [], infusions: [], optionalFeatures: [] },
    spellbook: [], selectedFeats: [], selectedSkillProficiencies: [],
    ...patch,
  };
}

const pick = (spellId: string): PreparedSpell => ({ spellId, isPrepared: true, isAlwaysPrepared: false });
const ids = (d: Draft) => (d.spellbook ?? []).map((e) => e.spellId);

/** The fixtures name real content — guard against the ids drifting out from
 *  under the tests, which would quietly turn every case into a no-op. */
it('the fixtures still exist in the data', () => {
  for (const id of ['fireball', 'melfs-acid-arrow', 'fire-bolt', 'cure-wounds']) {
    expect(getSpell(id), id).toBeTruthy();
  }
  expect(getSubclass('battle-master')?.classId).toBe('fighter');
  expect(getSubclass('eldritch-knight')?.spellListClassId).toBe('wizard');
});

describe('level drops', () => {
  it('a level-5 wizard dropped to 1 loses the spells a level-1 wizard cannot have', () => {
    const d = draft({
      classes: [{ classId: 'wizard', level: 5, hitPointsRolled: [] }],
      // Fireball is 3rd level — castable at wizard 5, impossible at wizard 1.
      spellbook: [pick('fireball'), pick('magic-missile'), pick('shield')],
    });
    expect(ids(sanitizeCreatorDraft(d))).toEqual(['fireball', 'magic-missile', 'shield']);

    const dropped = sanitizeCreatorDraft({ ...d, classes: [{ classId: 'wizard', level: 1, hitPointsRolled: [] }] });
    expect(ids(dropped)).toEqual(['magic-missile', 'shield']);
  });

  it('trims cantrips to the lower count, keeping the earliest picks', () => {
    // PHB wizard: 3 cantrips at level 1, 4 at level 5.
    const d = draft({
      classes: [{ classId: 'wizard', level: 1, hitPointsRolled: [] }],
      spellbook: [pick('fire-bolt'), pick('mage-hand'), pick('light'), pick('ray-of-frost')],
    });
    expect(ids(sanitizeCreatorDraft(d))).toEqual(['fire-bolt', 'mage-hand', 'light']);
  });

  it('drops a subclass below its own unlock level, and its maneuvers with it', () => {
    const d = draft({
      classes: [{ classId: 'fighter', level: 5, subclassId: 'battle-master', hitPointsRolled: [] }],
      classOptions: { fightingStyles: ['defense'], invocations: [], metamagic: [], maneuvers: ['riposte', 'trip-attack', 'precision-attack'], infusions: [], optionalFeatures: [] },
      selectedFeats: ['sentinel'], // fighter's first ASI is level 4
      featChoices: {},
    });

    // Level 3: Battle Master unlocks at 3, knows 3 maneuvers — subclass and
    // maneuvers survive; the level-4 feat slot is gone.
    const at3 = sanitizeCreatorDraft({ ...d, classes: [{ ...d.classes![0], level: 3 }] });
    expect(at3.classes![0].subclassId).toBe('battle-master');
    expect(at3.classOptions!.maneuvers).toHaveLength(3);
    expect(at3.selectedFeats).toEqual([]);

    // Level 1: below the unlock — subclass gone, and the maneuvers can't
    // outlive the feature that granted them.
    const at1 = sanitizeCreatorDraft({ ...d, classes: [{ ...d.classes![0], level: 1 }] });
    expect(at1.classes![0].subclassId).toBeUndefined();
    expect(at1.classOptions!.maneuvers).toEqual([]);
  });

  it('trims warlock invocations to the ladder', () => {
    const d = draft({
      classes: [{ classId: 'warlock', level: 5, hitPointsRolled: [] }],
      classOptions: { fightingStyles: [], invocations: ['agonizing-blast', 'devils-sight', 'eldritch-sight'], metamagic: [], maneuvers: [], infusions: [], optionalFeatures: [] },
    });
    // 2014 warlock: 3 invocations at 5, none at all at level 1.
    expect(sanitizeCreatorDraft(d).classOptions!.invocations).toHaveLength(3);
    const at1 = sanitizeCreatorDraft({ ...d, classes: [{ classId: 'warlock', level: 1, hitPointsRolled: [] }] });
    expect(at1.classOptions!.invocations).toEqual([]);
  });

  it('an Eldritch Knight dropped below 3 loses the subclass AND the wizard-list spells it carried', () => {
    const d = draft({
      classes: [{ classId: 'fighter', level: 3, subclassId: 'eldritch-knight', hitPointsRolled: [] }],
      spellbook: [pick('fire-bolt'), pick('shield')],
    });
    // At 3 the subclass provides the casting, so the spells stand.
    expect(ids(sanitizeCreatorDraft(d))).toEqual(['fire-bolt', 'shield']);
    // At 1 the subclass is gone and a plain fighter casts nothing.
    const at1 = sanitizeCreatorDraft({ ...d, classes: [{ ...d.classes![0], level: 1 }] });
    expect(at1.classes![0].subclassId).toBeUndefined();
    expect(ids(at1)).toEqual([]);
  });
});

describe('class switches', () => {
  it('wizard to fighter empties the spellbook — the reported bug', () => {
    const d = draft({
      classes: [{ classId: 'fighter', level: 5, hitPointsRolled: [] }],
      spellbook: [pick('fireball'), pick('magic-missile')],
    });
    expect(ids(sanitizeCreatorDraft(d))).toEqual([]);
  });

  it('wizard to sorcerer keeps the spells both lists share and drops the rest', () => {
    const d = draft({
      classes: [{ classId: 'sorcerer', level: 5, hitPointsRolled: [] }],
      // Fireball is on both lists; Melf's Acid Arrow is wizard-only.
      spellbook: [pick('fireball'), pick('melfs-acid-arrow')],
    });
    expect(ids(sanitizeCreatorDraft(d))).toEqual(['fireball']);
  });

  it('a cleric spell survives a switch between prepared casters that share it', () => {
    const d = draft({
      classes: [{ classId: 'druid', level: 3, hitPointsRolled: [] }],
      spellbook: [pick('cure-wounds')],
    });
    expect(ids(sanitizeCreatorDraft(d))).toEqual(['cure-wounds']);
  });

  it('skill picks keep what the new class also offers, capped at its count', () => {
    // Wizard picks that survive into rogue: Arcana is not on the barbarian list.
    const d = draft({
      classes: [{ classId: 'barbarian', level: 1, hitPointsRolled: [] }],
      selectedSkillProficiencies: ['Arcana', 'Athletics', 'Perception'],
    });
    expect(sanitizeCreatorDraft(d).selectedSkillProficiencies).toEqual(['Athletics', 'Perception']);
  });

  it('a subclass belonging to a different class is dropped', () => {
    const d = draft({
      classes: [{ classId: 'wizard', level: 5, subclassId: 'battle-master', hitPointsRolled: [] }],
    });
    expect(sanitizeCreatorDraft(d).classes![0].subclassId).toBeUndefined();
  });
});

describe('feat hygiene', () => {
  it('drops the records hanging off a trimmed feat', () => {
    const d = draft({
      classes: [{ classId: 'fighter', level: 1, hitPointsRolled: [] }],
      selectedFeats: ['resilient'],
      featChoices: { resilient: 'con' },
      selectedFeatPicks: { resilient: ['whatever'] },
      selectedFeatSpells: { 'resilient:grant': ['x'], },
    });
    const s = sanitizeCreatorDraft(d);
    expect(s.selectedFeats).toEqual([]);
    expect(s.featChoices).toEqual({});
    expect(s.selectedFeatPicks).toEqual({});
    expect(s.selectedFeatSpells).toEqual({});
  });
});

describe('what must NOT be touched', () => {
  it('granted always-prepared spells pass through and count against nothing', () => {
    const granted: PreparedSpell = { spellId: 'fireball', isPrepared: true, isAlwaysPrepared: true };
    const d = draft({
      classes: [{ classId: 'fighter', level: 1, hitPointsRolled: [] }],
      spellbook: [granted],
    });
    expect(sanitizeCreatorDraft(d).spellbook).toEqual([granted]);
  });

  it('a legal draft passes through with identical content, and the pass is idempotent', () => {
    const d = draft({
      classes: [{ classId: 'wizard', level: 5, hitPointsRolled: [] }],
      spellbook: [pick('fireball'), pick('fire-bolt')],
      selectedSkillProficiencies: ['Arcana', 'History'],
      selectedFeats: ['sentinel'], // wizard ASI at 4 — one slot at level 5
    });
    const once = sanitizeCreatorDraft(d);
    expect(once.spellbook).toEqual(d.spellbook);
    expect(once.selectedFeats).toEqual(d.selectedFeats);
    expect(once.selectedSkillProficiencies).toEqual(d.selectedSkillProficiencies);
    expect(sanitizeCreatorDraft(once)).toEqual(once);
  });

  it('a draft with no class yet is untouched', () => {
    const d = draft({ classes: [], spellbook: [pick('fireball')] });
    expect(sanitizeCreatorDraft(d)).toEqual(d);
  });
});

describe('through the real store', () => {
  it('dropping the level via updateDraft trims the book — the chokepoint works', () => {
    const store = useCreatorStore.getState();
    store.reset();
    store.updateDraft({
      classes: [{ classId: 'wizard', level: 5, hitPointsRolled: [] }],
      spellbook: [pick('fireball'), pick('shield')],
    });
    expect(ids(useCreatorStore.getState().draft as Draft)).toEqual(['fireball', 'shield']);
    useCreatorStore.getState().updateDraft({ classes: [{ classId: 'wizard', level: 1, hitPointsRolled: [] }] });
    expect(ids(useCreatorStore.getState().draft as Draft)).toEqual(['shield']);
    useCreatorStore.getState().reset();
  });
});
