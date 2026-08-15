import { describe, it, expect } from 'vitest';
import { useCharacterStore } from './useCharacterStore';
import { useCreatorStore } from './useCreatorStore';
import { ALL_BACKGROUNDS } from '../data/backgrounds';
import { ALL_FEATS } from '../data/feats';
import type { Character } from '../types';

/**
 * levelUp rebuilt resources from the class and subclass only, so a resource granted by a
 * RACE or a FEAT was missing until the sheet happened to be reloaded — which then quietly
 * fixed it, hiding the bug. load() had always handled both; this is the copy that hadn't.
 */
function start(patch: Partial<Character>): Character {
  useCreatorStore.setState((s) => ({ draft: { ...s.draft,
    name: 'Level Up', raceId: 'human', backgroundId: ALL_BACKGROUNDS[0].id,
    classes: [{ classId: 'fighter', level: 3, hitPointsRolled: [] }],
    baseAbilityScores: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 },
    ...patch,
  } }));
  const c = useCreatorStore.getState().finalize();
  if (!c) throw new Error('fixture failed');
  return c;
}

const resourceKeys = () => (useCharacterStore.getState().character?.resources ?? []).map((r) => r.key);

describe('levelUp resource rebuild', () => {
  it('creates the resource a feat taken at this level-up grants', () => {
    // The 2014 Lucky feat carries grantedResources; confirm the fixture is real before relying on it.
    const lucky = ALL_FEATS.find((f) => f.id === 'lucky');
    const grantedKey = lucky?.grantedResources?.[0]?.key;
    expect(grantedKey, 'the Lucky feat should grant a tracked resource').toBeTruthy();

    useCharacterStore.getState().load(start({}));
    expect(resourceKeys()).not.toContain(grantedKey);

    // Fighter 3 → 4 is an ASI level, so the dialog offers a feat.
    useCharacterStore.getState().levelUp('fighter', 6, 6, undefined, { type: 'feat', featId: 'lucky' });

    expect(useCharacterStore.getState().character!.selectedFeats).toContain('lucky');
    expect(resourceKeys()).toContain(grantedKey);
  });

  it('keeps a race resource in step with the new total level', () => {
    // Dragonborn Breath Weapon is race-granted and keyed on total character level.
    const c = start({ raceId: 'dragonborn' });
    useCharacterStore.getState().load(c);
    const before = useCharacterStore.getState().character!.resources.find((r) => r.key === 'breath_weapon');
    expect(before, 'fixture race must grant a tracked resource').toBeTruthy();

    useCharacterStore.getState().levelUp('fighter', 6, 6);
    const after = useCharacterStore.getState().character!.resources.find((r) => r.key === 'breath_weapon');
    expect(after).toBeTruthy();
    expect(after!.max).toBeGreaterThanOrEqual(before!.max);
  });
});
