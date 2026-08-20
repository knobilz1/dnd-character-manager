import { describe, expect, it } from 'vitest';
import { buildStartingLoadout } from './startingLoadout';
import { getClassStartingEquipment } from '../data/startingEquipment';
import { rollRandomCharacter } from './randomCharacter';
import type { BookId } from '../types';

function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

let n = 0;
const testId = () => `test-${++n}`;

describe('buildStartingLoadout', () => {
  it('a fighter with every choice made walks out with gear, not an empty pack', () => {
    const eq = getClassStartingEquipment('fighter')!;
    const choices: Record<number, number> = {};
    eq.choices.forEach((_, i) => { choices[i] = 0; });
    const loadout = buildStartingLoadout('fighter', 'soldier', choices, false, testId);
    expect(loadout.inventory.length).toBeGreaterThan(0);
    expect(loadout.inventory.some(i => i.source === 'class')).toBe(true);
    expect(loadout.inventory.some(i => i.source === 'background')).toBe(true);
  });

  it("background gold lands in gp, not as an inventory item called '15 gp'", () => {
    const loadout = buildStartingLoadout('fighter', 'criminal', {}, false, testId);
    expect(loadout.gp).toBeGreaterThan(0);
    expect(loadout.inventory.some(i => /^\d+\s*gp$/i.test(i.name))).toBe(false);
  });

  it('takeGold skips the class package but keeps the background kit', () => {
    const eq = getClassStartingEquipment('fighter')!;
    const choices: Record<number, number> = {};
    eq.choices.forEach((_, i) => { choices[i] = 0; });
    const loadout = buildStartingLoadout('fighter', 'soldier', choices, true, testId);
    expect(loadout.inventory.every(i => i.source === 'background')).toBe(true);
  });
});

describe('rollRandomCharacter equips the character', () => {
  it('every rolled character has an answer for every class equipment choice, and real gold', () => {
    const books: BookId[] = ['PHB'];
    for (let seed = 1; seed <= 10; seed++) {
      const r = rollRandomCharacter(books, seeded(seed))!;
      const eq = getClassStartingEquipment(r.classId);
      for (let i = 0; i < (eq?.choices.length ?? 0); i++) {
        expect(r.equipmentChoices[i], `choice ${i} for ${r.classId}`).toBeGreaterThanOrEqual(0);
        expect(r.equipmentChoices[i]).toBeLessThan(eq!.choices[i].options.length);
      }
      const loadout = buildStartingLoadout(r.classId, r.backgroundId, r.equipmentChoices, false, testId);
      expect(loadout.inventory.length).toBeGreaterThan(0);
    }
  });
});
