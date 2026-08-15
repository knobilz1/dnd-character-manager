import { describe, it, expect } from 'vitest';
import { computeCharacterDerived } from './useCharacterDerived';
import { useCreatorStore } from '../store/useCreatorStore';
import { ALL_BACKGROUNDS } from '../data/backgrounds';
import type { Character } from '../types';

/**
 * Two audit leftovers, fixed together because both were "the data knows, the
 * sheet never said": racial fly/swim/climb speeds (an Aarakocra sheet showed
 * "30 ft" and nothing else) and Extra Attack (a level-5 fighter looked like
 * one swing per action).
 *
 * Fixtures go through the creator's finalize(), same as exhaustion.test.ts —
 * computeCharacterDerived assumes a COMPLETE character.
 */
function build(patch: Partial<Character>): Character {
  const store = useCreatorStore.getState();
  useCreatorStore.setState(s => ({ draft: { ...s.draft,
    name: 'Fixture', raceId: 'human',
    classes: [{ classId: 'fighter', level: 5, hitPointsRolled: [] }],
    backgroundId: ALL_BACKGROUNDS[0].id,
    baseAbilityScores: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 },
    ...patch,
  }}));
  const c = useCreatorStore.getState().finalize();
  if (!c) throw new Error('fixture character failed to build');
  useCreatorStore.setState({ draft: store.draft });
  return c;
}

const halfPlate = { id: 'hp1', name: 'Half plate armor', quantity: 1, category: 'armor' as const, equipped: true };

describe('attacksPerAction', () => {
  it('a wizard swings once', () => {
    expect(computeCharacterDerived(build({ classes: [{ classId: 'wizard', level: 5, hitPointsRolled: [] }] })).attacksPerAction).toBe(1);
  });

  it('follows the 2014 fighter ladder: 2 at 5, 3 at 11, 4 at 20', () => {
    for (const [level, want] of [[4, 1], [5, 2], [11, 3], [20, 4]] as const) {
      const d = computeCharacterDerived(build({ classes: [{ classId: 'fighter', level, hitPointsRolled: [] }] }));
      expect(d.attacksPerAction, `fighter ${level}`).toBe(want);
    }
  });

  it('reads the 2024 fighter names ("Two/Three Extra Attacks")', () => {
    for (const [level, want] of [[5, 2], [11, 3], [20, 4]] as const) {
      const d = computeCharacterDerived(build({ classes: [{ classId: 'fighter-2024', level, hitPointsRolled: [] }] }));
      expect(d.attacksPerAction, `fighter-2024 ${level}`).toBe(want);
    }
  });

  it('a subclass grant counts: Bladesinging wizard gets it at 6, not 5', () => {
    const at = (level: number) => computeCharacterDerived(build({
      classes: [{ classId: 'wizard', level, subclassId: 'bladesinging', hitPointsRolled: [] }],
    })).attacksPerAction;
    expect(at(5)).toBe(1);
    expect(at(6)).toBe(2);
  });

  it('Thirsting Blade gives the blade warlock a second attack', () => {
    const warlock = build({ classes: [{ classId: 'warlock', level: 5, hitPointsRolled: [] }] });
    expect(computeCharacterDerived(warlock).attacksPerAction).toBe(1);
    const withBlade: Character = { ...warlock, classOptions: {
      fightingStyles: [], invocations: ['thirsting-blade'], metamagic: [], maneuvers: [], infusions: [], optionalFeatures: [],
    } };
    expect(computeCharacterDerived(withBlade).attacksPerAction).toBe(2);
  });
});

describe('racial fly/swim/climb speeds', () => {
  it('a human has none', () => {
    const d = computeCharacterDerived(build({}));
    expect(d.flySpeed).toBe(0);
    expect(d.swimSpeed).toBe(0);
    expect(d.climbSpeed).toBe(0);
  });

  it('a Fairy flies at walking speed', () => {
    expect(computeCharacterDerived(build({ raceId: 'fairy' })).flySpeed).toBe(30);
  });

  it("'walk' tracks walk bonuses: a monk Aarakocra flies at monk speed", () => {
    const d = computeCharacterDerived(build({
      raceId: 'aarakocra',
      classes: [{ classId: 'monk', level: 6, hitPointsRolled: [] }], // Unarmored Movement +15
    }));
    expect(d.speed).toBe(45);
    expect(d.flySpeed).toBe(45);
  });

  it('medium armor grounds the walk-equal fliers but not the Winged Tiefling', () => {
    const grounded = build({ raceId: 'fairy' });
    grounded.inventory = [...(grounded.inventory ?? []), halfPlate];
    expect(computeCharacterDerived(grounded).flySpeed).toBe(0);

    const tiefling = build({ raceId: 'scag-tiefling-winged' });
    tiefling.inventory = [...(tiefling.inventory ?? []), halfPlate];
    expect(computeCharacterDerived(tiefling).flySpeed).toBe(30);
  });

  it('exhaustion halves and then zeroes fly speed like any other speed', () => {
    const fairy = build({ raceId: 'fairy' });
    expect(computeCharacterDerived({ ...fairy, exhaustionLevel: 2 }).flySpeed).toBe(15);
    expect(computeCharacterDerived({ ...fairy, exhaustionLevel: 5 }).flySpeed).toBe(0);
  });

  it('Triton swims 30, Tabaxi climbs 20', () => {
    expect(computeCharacterDerived(build({ raceId: 'triton' })).swimSpeed).toBe(30);
    expect(computeCharacterDerived(build({ raceId: 'tabaxi' })).climbSpeed).toBe(20);
  });
});
