import { describe, it, expect } from 'vitest';
import { computeCharacterDerived } from './useCharacterDerived';
import { useCreatorStore } from '../store/useCreatorStore';
import { getSubclass } from '../data/subclasses';
import { ALL_BACKGROUNDS } from '../data/backgrounds';
import type { Character } from '../types';

/**
 * The sheet's caps for the two third-caster subclasses read the wrong tables: the cantrip
 * count was a hardcoded copy of the Eldritch Knight's ladder (so an Arcane Trickster saw
 * "3/2" in red and couldn't swap a cantrip), and the spells-known cap asked
 * SPELLS_KNOWN['wizard'] — which doesn't exist, because wizards use a spellbook — so it
 * came back null, meaning "no limit". Each subclass carries its own ladder; read that.
 */
function build(classId: string, subclassId: string, level: number): Character {
  useCreatorStore.setState((s) => ({ draft: { ...s.draft,
    name: 'Third', raceId: 'human', backgroundId: ALL_BACKGROUNDS[0].id,
    classes: [{ classId, level, subclassId, hitPointsRolled: [] }],
    baseAbilityScores: { str: 12, dex: 14, con: 14, int: 16, wis: 10, cha: 10 },
  } }));
  const c = useCreatorStore.getState().finalize();
  if (!c) throw new Error('fixture failed');
  return c;
}

describe('Arcane Trickster', () => {
  it('knows 3 cantrips at level 3, not the Eldritch Knight’s 2', () => {
    expect(getSubclass('arcane-trickster')?.cantripsKnownByClassLevel?.[2]).toBe(3);
    expect(computeCharacterDerived(build('rogue', 'arcane-trickster', 3)).cantripsKnown).toBe(3);
  });

  it('matches its own ladder at 10 as well', () => {
    const expected = getSubclass('arcane-trickster')!.cantripsKnownByClassLevel![9];
    expect(computeCharacterDerived(build('rogue', 'arcane-trickster', 10)).cantripsKnown).toBe(expected);
  });
});

describe('Eldritch Knight', () => {
  it('still gets its own 2-at-3rd cantrip ladder', () => {
    expect(computeCharacterDerived(build('fighter', 'eldritch-knight', 3)).cantripsKnown).toBe(2);
  });

  it('has a spells-known CEILING rather than none at all', () => {
    const d = computeCharacterDerived(build('fighter', 'eldritch-knight', 3));
    expect(d.spellsKnown).not.toBeNull();
    expect(d.spellsKnown).toBe(getSubclass('eldritch-knight')!.spellsKnownByClassLevel![2]);
  });

  it('the ceiling grows with level', () => {
    const at3 = computeCharacterDerived(build('fighter', 'eldritch-knight', 3)).spellsKnown!;
    const at20 = computeCharacterDerived(build('fighter', 'eldritch-knight', 20)).spellsKnown!;
    expect(at20).toBeGreaterThan(at3);
  });
});
