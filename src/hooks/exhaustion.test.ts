import { describe, it, expect } from 'vitest';
import { computeCharacterDerived } from './useCharacterDerived';
import { useCreatorStore } from '../store/useCreatorStore';
import { ALL_BACKGROUNDS } from '../data/backgrounds';
import type { Character, ExhaustionLevel } from '../types';

/**
 * Exhaustion level 3 imposes disadvantage on attack rolls AND saving throws
 * (PHB p.291). Only the saves half was derived, so an exhausted character rolled
 * attacks straight — the half that comes up every single turn.
 *
 * Built through the creator's own finalize() rather than a hand-written literal:
 * computeCharacterDerived assumes a COMPLETE character, and a partial fixture
 * throws somewhere unrelated to what is being tested.
 */
function character(exhaustionLevel: ExhaustionLevel): Character {
  const store = useCreatorStore.getState();
  useCreatorStore.setState(s => ({ draft: { ...s.draft,
    name: 'Exhausted', raceId: 'human',
    classes: [{ classId: 'fighter', level: 5, hitPointsRolled: [] }],
    backgroundId: ALL_BACKGROUNDS[0].id,
    baseAbilityScores: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 },
  }}));
  const c = useCreatorStore.getState().finalize();
  if (!c) throw new Error('fixture character failed to build');
  useCreatorStore.setState({ draft: store.draft });
  return { ...c, exhaustionLevel };
}

describe('exhaustion thresholds', () => {
  it('is clean at level 0', () => {
    const d = computeCharacterDerived(character(0));
    expect(d.exhaustionDisadvChecks).toBe(false);
    expect(d.exhaustionDisadvAttacks).toBe(false);
    expect(d.exhaustionDisadvSaves).toBe(false);
  });

  it('hits ability checks first, at level 1', () => {
    const d = computeCharacterDerived(character(1));
    expect(d.exhaustionDisadvChecks).toBe(true);
    expect(d.exhaustionDisadvAttacks).toBe(false);
    expect(d.exhaustionDisadvSaves).toBe(false);
  });

  it('leaves attacks and saves alone at level 2', () => {
    const d = computeCharacterDerived(character(2));
    expect(d.exhaustionDisadvAttacks).toBe(false);
    expect(d.exhaustionDisadvSaves).toBe(false);
  });

  /** The gap this test exists for: attacks must turn on with saves, not after. */
  it('hits attacks and saves together at level 3', () => {
    const d = computeCharacterDerived(character(3));
    expect(d.exhaustionDisadvAttacks).toBe(true);
    expect(d.exhaustionDisadvSaves).toBe(true);
  });

  it('stays on above level 3', () => {
    for (const lv of [4, 5] as ExhaustionLevel[]) {
      const d = computeCharacterDerived(character(lv));
      expect(d.exhaustionDisadvAttacks, `level ${lv}`).toBe(true);
      expect(d.exhaustionDisadvSaves, `level ${lv}`).toBe(true);
    }
  });

  it('halves the hit point maximum from level 4', () => {
    expect(computeCharacterDerived(character(3)).exhaustionHpMaxHalved).toBe(false);
    expect(computeCharacterDerived(character(4)).exhaustionHpMaxHalved).toBe(true);
  });
});
