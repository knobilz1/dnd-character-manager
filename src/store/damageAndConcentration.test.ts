import { describe, it, expect, beforeEach } from 'vitest';
import { useCharacterStore } from './useCharacterStore';
import type { Character } from '../types';

/**
 * The damage path used to do exactly one thing: subtract hit points. Three rules
 * that hang off it were left to the player to remember, and two of them lose
 * state silently when forgotten.
 */

function fixture(patch: Partial<Character> = {}): Character {
  return {
    id: 'test', createdAt: 0, updatedAt: 0,
    name: 'Test', playerName: '', alignment: '',
    enabledBooks: ['PHB'],
    raceId: 'human',
    classes: [{ classId: 'wizard', level: 5 }],
    backgroundId: 'sage',
    baseAbilityScores: { str: 10, dex: 10, con: 14, int: 16, wis: 10, cha: 10 },
    maxHP: 30, currentHP: 30, tempHP: 0,
    deathSaves: { successes: 0, failures: 0 },
    conditions: [], exhaustionLevel: 0,
    spellSlotsUsed: {} as Character['spellSlotsUsed'],
    resources: [], inspiration: false, experiencePoints: 0, notes: '',
    currencies: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
    inventory: [], spellbook: [], preparedSpells: [],
    ...patch,
  } as Character;
}

const store = () => useCharacterStore.getState();

beforeEach(() => {
  useCharacterStore.setState({ character: null, concentrationCheck: null });
});

describe('taking damage while concentrating', () => {
  it('raises a save at DC 10 for small hits', () => {
    useCharacterStore.setState({ character: fixture({ concentrationSpellId: 'fly' }) });
    store().damageHP(9);
    // Half of 9 is 4, so the floor of 10 applies.
    expect(store().concentrationCheck).toEqual({ dc: 10, damage: 9 });
  });

  it('raises a save at half the damage once that exceeds 10', () => {
    useCharacterStore.setState({ character: fixture({ concentrationSpellId: 'fly' }) });
    store().damageHP(25);
    expect(store().concentrationCheck).toEqual({ dc: 12, damage: 25 });
  });

  it('raises nothing when not concentrating', () => {
    useCharacterStore.setState({ character: fixture() });
    store().damageHP(25);
    expect(store().concentrationCheck).toBeNull();
  });

  it('raises nothing for a zero-damage hit', () => {
    useCharacterStore.setState({ character: fixture({ concentrationSpellId: 'fly' }) });
    store().damageHP(0);
    expect(store().concentrationCheck).toBeNull();
  });

  /** The save belongs to the spell that was interrupted; it must not outlive it. */
  it('is cleared by ending or restarting concentration', () => {
    useCharacterStore.setState({ character: fixture({ concentrationSpellId: 'fly' }) });
    store().damageHP(20);
    expect(store().concentrationCheck).not.toBeNull();
    store().endConcentration();
    expect(store().concentrationCheck).toBeNull();

    store().startConcentration('haste');
    store().damageHP(20);
    expect(store().concentrationCheck).not.toBeNull();
    store().startConcentration('fly');
    expect(store().concentrationCheck).toBeNull();
  });
});

describe('damage at 0 hit points', () => {
  it('costs a death saving throw failure', () => {
    useCharacterStore.setState({ character: fixture({ currentHP: 0 }) });
    store().damageHP(3);
    expect(store().character!.deathSaves.failures).toBe(1);
  });

  /** Being dropped TO 0 is not the same as being hit while already down. */
  it('does not fire when the hit is what drops you', () => {
    useCharacterStore.setState({ character: fixture({ currentHP: 5 }) });
    store().damageHP(9);
    expect(store().character!.currentHP).toBe(0);
    expect(store().character!.deathSaves.failures).toBe(0);
  });

  it('never exceeds three failures', () => {
    useCharacterStore.setState({ character: fixture({ currentHP: 0 }) });
    for (let i = 0; i < 6; i++) store().damageHP(1);
    expect(store().character!.deathSaves.failures).toBe(3);
  });

  /**
   * Corner case, decided deliberately: temporary hit points are a buffer against
   * damage, not a way of not taking it, so a hit soaked entirely by temp HP while
   * at 0 still costs a failure. Reaching this state at all is unusual — temp HP
   * would normally have absorbed the hit that dropped you — so it is documented
   * here rather than left to whichever behaviour fell out of the implementation.
   */
  it('still fires when temp HP absorbs the whole hit', () => {
    useCharacterStore.setState({ character: fixture({ currentHP: 0, tempHP: 10 }) });
    store().damageHP(4);
    expect(store().character!.tempHP).toBe(6);
    expect(store().character!.deathSaves.failures).toBe(1);
  });
});

describe('healing from 0 hit points', () => {
  it('clears marked death saves', () => {
    useCharacterStore.setState({ character: fixture({
      currentHP: 0, deathSaves: { successes: 1, failures: 2 },
    }) });
    store().healHP(5);
    expect(store().character!.currentHP).toBe(5);
    expect(store().character!.deathSaves).toEqual({ successes: 0, failures: 0 });
  });

  /** Otherwise the next knockdown starts partway to dead, carrying failures from
   *  a fight the character already survived. */
  it('leaves them alone when healing above 0', () => {
    useCharacterStore.setState({ character: fixture({
      currentHP: 10, deathSaves: { successes: 1, failures: 2 },
    }) });
    store().healHP(5);
    expect(store().character!.deathSaves).toEqual({ successes: 1, failures: 2 });
  });

  it('leaves them alone when the heal is zero', () => {
    useCharacterStore.setState({ character: fixture({
      currentHP: 0, deathSaves: { successes: 0, failures: 2 },
    }) });
    store().healHP(0);
    expect(store().character!.deathSaves.failures).toBe(2);
  });
});
