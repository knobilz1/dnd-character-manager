import { describe, it, expect } from 'vitest';
import { computeCharacterDerived } from './useCharacterDerived';
import { weaponAttackLine } from '../utils/weaponAttack';
import { useCreatorStore } from '../store/useCreatorStore';
import { ALL_BACKGROUNDS } from '../data/backgrounds';
import type { BookId, Character, ExhaustionLevel, InventoryItem } from '../types';

/**
 * PHB 2024 replaced the exhaustion staircase with one rule: −2 to every D20 Test per level
 * and −5 ft of Speed per level, dead at 6. The app ran one ladder for both editions, so a
 * 2024 character took disadvantage on every check from level 1 (which their rules don't
 * impose) and no attack penalty at all until level 3 (which their rules do).
 *
 * The penalty is folded into the derived numbers, so the sheet shows what you actually roll.
 */
function build(books: BookId[], exhaustionLevel: ExhaustionLevel, classId = 'fighter'): Character {
  useCreatorStore.setState((s) => ({ draft: { ...s.draft,
    name: 'Weary', raceId: 'human', backgroundId: ALL_BACKGROUNDS[0].id,
    classes: [{ classId, level: 5, hitPointsRolled: [] }],
    baseAbilityScores: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 10 },
    enabledBooks: books,
  } }));
  const c = useCreatorStore.getState().finalize();
  if (!c) throw new Error('fixture failed');
  return { ...c, exhaustionLevel };
}

const d2024 = (lv: ExhaustionLevel, classId?: string) => computeCharacterDerived(build(['PHB2024'], lv, classId));
const d2014 = (lv: ExhaustionLevel, classId?: string) => computeCharacterDerived(build(['PHB'], lv, classId));

describe('PHB 2024 exhaustion', () => {
  it('takes −2 per level off every D20 Test', () => {
    const rested = d2024(0);
    for (const level of [1, 2, 3] as ExhaustionLevel[]) {
      const worn = d2024(level);
      expect(worn.skills['Athletics'], `skills at ${level}`).toBe(rested.skills['Athletics'] - 2 * level);
      expect(worn.savingThrows.str, `saves at ${level}`).toBe(rested.savingThrows.str - 2 * level);
      expect(worn.initiative, `initiative at ${level}`).toBe(rested.initiative - 2 * level);
    }
  });

  it('reaches weapon attacks, which are D20 Tests too', () => {
    const worn = d2024(2);
    const sword = { id: 's', name: 'Longsword', quantity: 1, category: 'weapon', equipped: true } as InventoryItem;
    const c = build(['PHB2024'], 2);
    const withPenalty = weaponAttackLine(c, sword, { mods: worn.mods, profBonus: worn.profBonus, martialArtsDie: 0, d20Penalty: worn.exhaustionD20Penalty });
    const without = weaponAttackLine(c, sword, { mods: worn.mods, profBonus: worn.profBonus, martialArtsDie: 0 });
    expect(withPenalty.toHit).toBe(without.toHit - 4);
  });

  it('takes 5 ft of speed per level, and can reach 0', () => {
    expect(d2024(0).speed).toBe(30);
    expect(d2024(1).speed).toBe(25);
    expect(d2024(3).speed).toBe(15);
    expect(d2024(6).speed).toBe(0);
  });

  it('imposes no disadvantage at all — that is the 2014 mechanic', () => {
    for (const level of [1, 3, 5] as ExhaustionLevel[]) {
      const d = d2024(level);
      expect(d.exhaustionDisadvChecks, `checks at ${level}`).toBe(false);
      expect(d.exhaustionDisadvAttacks, `attacks at ${level}`).toBe(false);
      expect(d.exhaustionDisadvSaves, `saves at ${level}`).toBe(false);
    }
  });

  it('does not halve the hit point maximum', () => {
    expect(d2024(4).exhaustionHpMaxHalved).toBe(false);
    expect(d2024(5).exhaustionHpMaxHalved).toBe(false);
  });
});

describe('PHB 2014 exhaustion is untouched', () => {
  it('still uses disadvantage, not a numeric penalty', () => {
    const rested = d2014(0);
    const worn = d2014(3);
    expect(worn.skills['Athletics']).toBe(rested.skills['Athletics']); // no number changes
    expect(worn.exhaustionDisadvChecks).toBe(true);
    expect(worn.exhaustionDisadvAttacks).toBe(true);
    expect(worn.exhaustionDisadvSaves).toBe(true);
  });

  it('still halves speed at 2 and zeroes it at 5', () => {
    expect(d2014(1).speed).toBe(30);
    expect(d2014(2).speed).toBe(15);
    expect(d2014(5).speed).toBe(0);
  });

  it('still halves the hit point maximum from 4', () => {
    expect(d2014(3).exhaustionHpMaxHalved).toBe(false);
    expect(d2014(4).exhaustionHpMaxHalved).toBe(true);
  });
});
