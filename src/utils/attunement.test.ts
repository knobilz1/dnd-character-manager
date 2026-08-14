import { describe, it, expect, beforeEach } from 'vitest';
import { requiresAttunement, attunementSlots, attunedItems, canAttune, BASE_ATTUNEMENT_SLOTS } from './attunement';
import { useCharacterStore } from '../store/useCharacterStore';
import { ALL_ITEMS } from '../data/items';
import type { Character, InventoryItem } from '../types';

/**
 * The three-item cap is a rule the table has always enforced from memory: the
 * sheet let you carry a Belt of Giant Strength, a Cloak of Displacement, a Ring of
 * Protection and a Staff of Power and never said a word.
 */

let seq = 0;
function item(patch: Partial<InventoryItem> = {}): InventoryItem {
  return { id: `i${seq++}`, name: 'Thing', quantity: 1, category: 'magic', ...patch };
}

function character(patch: Partial<Character> = {}): Character {
  return {
    id: 't', createdAt: 0, updatedAt: 0, name: 'T', playerName: '', alignment: '',
    enabledBooks: ['PHB'], raceId: 'human', backgroundId: 'sage',
    classes: [{ classId: 'fighter', level: 5, hitPointsRolled: [] }],
    abilityScoreMethod: 'pointbuy',
    baseAbilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    selectedSkillProficiencies: [], selectedFeats: [],
    classOptions: { fightingStyles: [], invocations: [], metamagic: [], maneuvers: [], infusions: [], optionalFeatures: [] },
    inventory: [], hitDiceUsed: {}, spellbook: [],
    maxHP: 30, currentHP: 30, tempHP: 0,
    deathSaves: { successes: 0, failures: 0 },
    conditions: [], exhaustionLevel: 0,
    spellSlotsUsed: {} as Character['spellSlotsUsed'],
    resources: [], inspiration: false, experiencePoints: 0, notes: '',
    currencies: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
    ...patch,
  } as Character;
}

const ATTUNED = () => item({ description: 'Requires attunement.', attuned: true });

describe('reading attunement out of the item text', () => {
  it.each([
    ['Requires attunement.', true],
    ['+2 AC while wearing no armor and no shield. Rare. Requires attunement.', true],
    ['(requires attunement)', true],
    ['Requires attunement (wizard)', true],
    ['Requires attunement by a creature with the Mark of Warding)', true],
    ['requires attunement by a spellcaster)', true],
    ['A sturdy rope, 50 feet long.', false],
    ['', false],
  ])('%s → %s', (description, expected) => {
    expect(requiresAttunement(item({ description }))).toBe(expected);
  });

  it('an item with no description at all needs no attunement', () => {
    expect(requiresAttunement(item({ description: undefined }))).toBe(false);
  });

  /** Pins the coverage this shipped with — measured at 360 of 521 magic items.
   *  A data edit that silently stops matching should fail here. */
  it('matches a large share of the magic items in the book data', () => {
    const magic = ALL_ITEMS.filter(i => i.category === 'magic');
    const needing = magic.filter(i => ATTUNEMENT_TEXT.test(i.description ?? ''));
    expect(magic.length).toBeGreaterThan(400);
    expect(needing.length).toBeGreaterThan(300);
  });
});
const ATTUNEMENT_TEXT = /requires?\s+attunement/i;

describe('how many slots a character has', () => {
  it('is three for an ordinary character', () => {
    expect(attunementSlots(character())).toBe(BASE_ATTUNEMENT_SLOTS);
    expect(BASE_ATTUNEMENT_SLOTS).toBe(3);
  });

  // TCE p.107/111/113 — Magic Item Adept, Savant, Master.
  it.each([[9, 3], [10, 4], [13, 4], [14, 5], [17, 5], [18, 6], [20, 6]])(
    'an artificer %i has %i slots', (level, slots) => {
      expect(attunementSlots(character({ classes: [{ classId: 'artificer', level, hitPointsRolled: [] }] }))).toBe(slots);
    });

  /** Class level, not character level: the ladder belongs to the artificer levels. */
  it('a fighter 15 / artificer 2 still has three', () => {
    expect(attunementSlots(character({ classes: [
      { classId: 'fighter', level: 15, hitPointsRolled: [] },
      { classId: 'artificer', level: 2, hitPointsRolled: [] },
    ] }))).toBe(3);
  });

  it('an artificer 10 / fighter 5 has four', () => {
    expect(attunementSlots(character({ classes: [
      { classId: 'artificer', level: 10, hitPointsRolled: [] },
      { classId: 'fighter', level: 5, hitPointsRolled: [] },
    ] }))).toBe(4);
  });

  it('Gold Bloodline Treasure Hunter raises it to five at 14', () => {
    const at = (level: number) => attunementSlots(character({ classes: [{ classId: 'sorcerer', subclassId: 'tob-gold-bloodline', level, hitPointsRolled: [] }] }));
    expect(at(13)).toBe(3);
    expect(at(14)).toBe(5);
  });

  it('a character with no classes still has the base three', () => {
    expect(attunementSlots(character({ classes: [] }))).toBe(3);
  });
});

describe('the cap', () => {
  it('allows a fourth item only once a slot frees up', () => {
    const fourth = item({ description: 'Requires attunement.' });
    const full = character({ inventory: [ATTUNED(), ATTUNED(), ATTUNED(), fourth] });
    expect(attunedItems(full)).toHaveLength(3);
    expect(canAttune(full, fourth)).toBe(false);

    const freed = character({ inventory: [ATTUNED(), ATTUNED(), fourth] });
    expect(canAttune(freed, fourth)).toBe(true);
  });

  it('never blocks un-attuning, even at the cap', () => {
    const third = ATTUNED();
    const full = character({ inventory: [ATTUNED(), ATTUNED(), third] });
    expect(canAttune(full, third)).toBe(true);
  });

  it('refuses items that do not ask for attunement', () => {
    expect(canAttune(character(), item({ description: 'A sturdy rope.' }))).toBe(false);
  });

  it('an artificer 14 can hold five', () => {
    const fifth = item({ description: 'Requires attunement.' });
    const c = character({
      classes: [{ classId: 'artificer', level: 14, hitPointsRolled: [] }],
      inventory: [ATTUNED(), ATTUNED(), ATTUNED(), ATTUNED(), fifth],
    });
    expect(canAttune(c, fifth)).toBe(true);
  });
});

describe('toggleAttunement in the store', () => {
  beforeEach(() => useCharacterStore.setState({ character: null, concentrationCheck: null }));
  const store = () => useCharacterStore.getState();

  it('attunes and un-attunes', () => {
    const ring = item({ name: 'Ring of Protection', description: 'Requires attunement.' });
    useCharacterStore.setState({ character: character({ inventory: [ring] }) });
    store().toggleAttunement(ring.id);
    expect(store().character!.inventory[0].attuned).toBe(true);
    store().toggleAttunement(ring.id);
    expect(store().character!.inventory[0].attuned).toBe(false);
  });

  /** The cap lives in the store, not the panel, so nothing can route around it. */
  it('refuses a fourth', () => {
    const fourth = item({ description: 'Requires attunement.' });
    useCharacterStore.setState({ character: character({ inventory: [ATTUNED(), ATTUNED(), ATTUNED(), fourth] }) });
    store().toggleAttunement(fourth.id);
    expect(store().character!.inventory.find(i => i.id === fourth.id)!.attuned).toBeFalsy();
    expect(attunedItems(store().character!)).toHaveLength(3);
  });

  it('refuses an item that never required attunement', () => {
    const rope = item({ description: 'A sturdy rope.' });
    useCharacterStore.setState({ character: character({ inventory: [rope] }) });
    store().toggleAttunement(rope.id);
    expect(store().character!.inventory[0].attuned).toBeFalsy();
  });

  it('does nothing for an id that is not in the bag', () => {
    useCharacterStore.setState({ character: character({ inventory: [ATTUNED()] }) });
    expect(() => store().toggleAttunement('nope')).not.toThrow();
    expect(attunedItems(store().character!)).toHaveLength(1);
  });
});
