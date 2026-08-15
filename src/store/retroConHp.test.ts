import { describe, it, expect } from 'vitest';
import { useCharacterStore } from './useCharacterStore';
import { useCreatorStore } from './useCreatorStore';
import { ALL_FEATS } from '../data/feats';
import { ALL_BACKGROUNDS } from '../data/backgrounds';
import type { Character } from '../types';

/**
 * PHB: "Whenever your Constitution modifier increases by 1, your hit point maximum
 * increases by 1 for each level you have attained." levelUp detected that increase from
 * base + racial CON only, while the sheet's real CON also counts the background (2024 puts
 * the ability increase there) and any feat with a fixed increase — so taking Durable, which
 * is +1 CON flat, granted no retroactive hit points at all.
 */
function start(patch: Partial<Character> = {}): Character {
  useCreatorStore.setState((s) => ({ draft: { ...s.draft,
    name: 'Retro', raceId: 'human', backgroundId: ALL_BACKGROUNDS[0].id,
    classes: [{ classId: 'fighter', level: 3, hitPointsRolled: [] }],
    // Human grants +1 to every ability, so a BASE 12 is an effective CON of 13 (+1) and
    // one more point makes it 14 (+2) — the parity step these tests turn on. (Base 13
    // would already be an effective 14, and nothing would move.)
    baseAbilityScores: { str: 16, dex: 12, con: 12, int: 10, wis: 10, cha: 10 },
    ...patch,
  } }));
  const c = useCreatorStore.getState().finalize();
  if (!c) throw new Error('fixture failed');
  return c;
}

const maxHP = () => useCharacterStore.getState().character!.maxHP;

describe('retroactive hit points when CON improves', () => {
  it('a fixed +1 CON from a feat pays out over every level — the reported bug', () => {
    const durable = ALL_FEATS.find((f) => f.id === 'durable');
    expect(durable?.abilityScoreIncrease?.con, 'Durable should carry a fixed +1 CON').toBe(1);

    useCharacterStore.getState().load(start());
    const before = maxHP();
    // Fighter 3 → 4, spending the ASI on Durable. New total level is 4, CON mod 1 → 2,
    // so 4 retroactive hit points on top of the level's own gain.
    useCharacterStore.getState().levelUp('fighter', 6, 6, undefined, { type: 'feat', featId: 'durable' });
    expect(maxHP() - before).toBe(6 + 4);
  });

  it('still pays out for a plain +2 CON ability increase', () => {
    useCharacterStore.getState().load(start());
    const before = maxHP();
    useCharacterStore.getState().levelUp('fighter', 6, 6, undefined, { type: 'asi', increases: { con: 2 } });
    // Effective CON 13 → 15: modifier +1 → +2, one step, four levels.
    expect(maxHP() - before).toBe(6 + 4);
  });

  it('pays nothing when the modifier does not actually move', () => {
    useCharacterStore.getState().load(start());
    const before = maxHP();
    useCharacterStore.getState().levelUp('fighter', 6, 6, undefined, { type: 'asi', increases: { str: 2 } });
    expect(maxHP() - before).toBe(6);
  });
});
