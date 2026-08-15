import { describe, it, expect } from 'vitest';
import { effectiveFeatIds } from './effectiveFeats';
import { computeCharacterDerived } from '../hooks/useCharacterDerived';
import { ALL_BACKGROUNDS, getBackground } from '../data/backgrounds';
import { ALL_FEATS } from '../data/feats';
import { useCreatorStore } from '../store/useCreatorStore';
import type { Character } from '../types';

/**
 * PHB 2024 gives every character a free Origin feat from their background. The data
 * recorded it only inside the feature's prose, so it granted nothing — no Tough hit
 * points, no Alert initiative, no Magic Initiate spells.
 */
function build(patch: Partial<Character>): Character {
  useCreatorStore.setState((s) => ({ draft: { ...s.draft,
    name: 'Origin', raceId: 'human',
    classes: [{ classId: 'fighter-2024', level: 5, hitPointsRolled: [] }],
    backgroundId: 'acolyte',
    baseAbilityScores: { str: 14, dex: 12, con: 14, int: 10, wis: 10, cha: 10 },
    ...patch,
  } }));
  const c = useCreatorStore.getState().finalize();
  if (!c) throw new Error('fixture failed');
  return c;
}

describe('the data links each 2024 background to a real feat', () => {
  it('every PHB 2024 background carries an originFeatId that resolves', () => {
    const bg2024 = ALL_BACKGROUNDS.filter((b) => b.sourceBook === 'PHB2024');
    expect(bg2024.length).toBeGreaterThan(0);
    for (const b of bg2024) {
      expect(b.originFeatId, `${b.id} must name its Origin feat`).toBeTruthy();
      expect(ALL_FEATS.find((f) => f.id === b.originFeatId), `${b.id} → ${b.originFeatId}`).toBeTruthy();
    }
  });

  it('leaves 2014 backgrounds alone — they grant no feat in those rules', () => {
    const legacy = ALL_BACKGROUNDS.filter((b) => b.sourceBook !== 'PHB2024');
    expect(legacy.every((b) => b.originFeatId === undefined)).toBe(true);
  });
});

describe('effectiveFeatIds', () => {
  it('adds the background Origin feat to the ASI picks', () => {
    const c = build({ backgroundId: 'soldier-2024', selectedFeats: ['alert-2024'] });
    const ids = effectiveFeatIds(c);
    expect(ids).toContain('alert-2024');                       // the ASI pick
    expect(ids).toContain(getBackground('soldier-2024')!.originFeatId!); // the free one
  });

  it('never lists the same feat twice when both routes grant it', () => {
    const origin = getBackground('soldier-2024')!.originFeatId!;
    const c = build({ backgroundId: 'soldier-2024', selectedFeats: [origin] });
    expect(effectiveFeatIds(c).filter((id) => id === origin)).toHaveLength(1);
  });

  it('changes nothing for a 2014 character', () => {
    const c = build({ backgroundId: 'acolyte', selectedFeats: ['alert'] });
    expect(effectiveFeatIds(c)).toEqual(['alert']);
  });
});

describe('the Origin feat actually applies', () => {
  /** Farmer grants Tough: +2 max HP per level. A level-5 character gets +10. */
  it('Tough from the Farmer background raises the hit point maximum', () => {
    const withTough = build({ backgroundId: 'farmer-2024' });
    const without = build({ backgroundId: 'acolyte' });
    expect(getBackground('farmer-2024')?.originFeatId).toBe('tough-2024');
    expect(withTough.maxHP - without.maxHP).toBe(10);
  });

  /** Soldier grants Savage Attacker; Guard grants Alert. Neither changes a score, so
   *  assert through the feat list the derive actually consults. */
  it('the derive sees the Origin feat', () => {
    const guard = build({ backgroundId: 'guard-2024' });
    const derived = computeCharacterDerived(guard);
    expect(derived).toBeTruthy();
    expect(effectiveFeatIds(guard)).toContain('alert-2024');
  });
});
