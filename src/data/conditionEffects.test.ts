import { describe, it, expect } from 'vitest';
import { CONDITION_EFFECTS, conditionsCausing } from './conditionEffects';
import { rollMode } from '../utils/rollMode';
import type { Condition } from '../types';

const ALL: Condition[] = [
  'Blinded', 'Charmed', 'Deafened', 'Exhaustion', 'Frightened', 'Grappled',
  'Incapacitated', 'Invisible', 'Paralyzed', 'Petrified', 'Poisoned', 'Prone',
  'Restrained', 'Stunned', 'Unconscious',
];

describe('condition effects table', () => {
  /** The bug: `conditions` was read by nothing, so Poisoned's own tooltip promised
   *  disadvantage on attacks and checks while every roll came out straight. */
  it('Poisoned costs attacks and checks', () => {
    expect(conditionsCausing(['Poisoned'], 'disadvAttacks')).toEqual(['Poisoned']);
    expect(conditionsCausing(['Poisoned'], 'disadvChecks')).toEqual(['Poisoned']);
  });

  it.each([
    ['Blinded', 'disadvAttacks'],
    ['Prone', 'disadvAttacks'],
    ['Restrained', 'disadvAttacks'],
    ['Frightened', 'disadvAttacks'],
    ['Restrained', 'disadvDexSaves'],
    ['Invisible', 'advAttacks'],
  ] as const)('%s produces %s', (condition, key) => {
    expect(conditionsCausing([condition], key)).toEqual([condition]);
  });

  it.each(['Paralyzed', 'Petrified', 'Stunned', 'Unconscious'] as const)(
    '%s auto-fails Strength and Dexterity saves', (condition) => {
      expect(conditionsCausing([condition], 'autoFailStrDexSaves')).toEqual([condition]);
    });

  /** These change what you may DO, not how a die lands, so they carry no roll
   *  effect — and must not quietly acquire one. */
  it.each(['Charmed', 'Deafened', 'Incapacitated'] as const)(
    '%s changes no roll', (condition) => {
      expect(CONDITION_EFFECTS[condition]).toBeUndefined();
    });

  it('reports every condition that applies, not just the first', () => {
    expect(conditionsCausing(['Poisoned', 'Prone', 'Deafened'], 'disadvAttacks'))
      .toEqual(['Poisoned', 'Prone']);
  });

  it('handles a character with no conditions', () => {
    expect(conditionsCausing([], 'disadvAttacks')).toEqual([]);
    expect(conditionsCausing(undefined, 'disadvAttacks')).toEqual([]);
  });

  /** Every situational entry must say why, since that text is what tells the
   *  player whether to override it with the roller's manual toggle. */
  it('every situational effect explains itself', () => {
    for (const [name, eff] of Object.entries(CONDITION_EFFECTS)) {
      if (eff?.situational !== undefined) {
        expect(eff.situational.length, name).toBeGreaterThan(0);
      }
    }
  });

  it('only models real conditions', () => {
    expect(Object.keys(CONDITION_EFFECTS).filter(k => !ALL.includes(k as Condition))).toEqual([]);
  });
});

describe('conditions combining at the roll', () => {
  /** PHB p.173: advantage and disadvantage cancel, however many of each. An
   *  invisible poisoned attacker rolls one straight d20. */
  it('Invisible and Poisoned cancel to a straight attack roll', () => {
    const adv = conditionsCausing(['Invisible', 'Poisoned'], 'advAttacks').length > 0;
    const dis = conditionsCausing(['Invisible', 'Poisoned'], 'disadvAttacks').length > 0;
    expect(rollMode(adv, dis)).toBeUndefined();
  });

  it('Invisible alone is advantage; Poisoned alone is disadvantage', () => {
    expect(rollMode(
      conditionsCausing(['Invisible'], 'advAttacks').length > 0,
      conditionsCausing(['Invisible'], 'disadvAttacks').length > 0,
    )).toBe('advantage');
    expect(rollMode(
      conditionsCausing(['Poisoned'], 'advAttacks').length > 0,
      conditionsCausing(['Poisoned'], 'disadvAttacks').length > 0,
    )).toBe('disadvantage');
  });

  /** Two sources of disadvantage are still just disadvantage. */
  it('stacking disadvantage does not double', () => {
    const dis = conditionsCausing(['Poisoned', 'Prone', 'Blinded'], 'disadvAttacks');
    expect(dis).toHaveLength(3);
    expect(rollMode(false, dis.length > 0)).toBe('disadvantage');
  });
});
