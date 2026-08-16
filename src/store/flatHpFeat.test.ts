import { describe, it, expect } from 'vitest';
import { useCreatorStore } from './useCreatorStore';
import { ALL_FEATS } from '../data/feats';
import { ALL_BACKGROUNDS } from '../data/backgrounds';
import type { Character } from '../types';

/**
 * Boon of Fortitude says "Your Hit Point maximum increases by 40." The feat described it and
 * nothing applied it: `Feat` had `hpBonusPerLevel` and a retroactive per-past-level bonus, but no
 * field for a flat one-time grant, so the forty hit points existed only in the prose.
 */
function build(patch: Partial<Character> = {}): Character {
  useCreatorStore.setState((s) => ({ draft: { ...s.draft,
    name: 'Boon', raceId: 'human', backgroundId: ALL_BACKGROUNDS[0].id,
    classes: [{ classId: 'fighter', level: 19, hitPointsRolled: [] }],
    baseAbilityScores: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 },
    selectedFeats: [],
    ...patch,
  } }));
  const c = useCreatorStore.getState().finalize();
  if (!c) throw new Error('fixture failed');
  return c;
}

describe('flat HP grants from feats', () => {
  it('Boon of Fortitude carries its +40 as data', () => {
    expect(ALL_FEATS.find(f => f.id === 'boon-of-fortitude')?.hpBonus).toBe(40);
  });

  it('and the creator actually adds it to the maximum', () => {
    const without = build().maxHP;
    const with_ = build({ selectedFeats: ['boon-of-fortitude'] }).maxHP;
    expect(with_ - without).toBe(40);
  });

  it('is one-time, not per level — a level 5 character gains the same 40', () => {
    const base = build({ classes: [{ classId: 'fighter', level: 5, hitPointsRolled: [] }] }).maxHP;
    const boosted = build({
      classes: [{ classId: 'fighter', level: 5, hitPointsRolled: [] }],
      selectedFeats: ['boon-of-fortitude'],
    }).maxHP;
    expect(boosted - base).toBe(40);
  });
});
