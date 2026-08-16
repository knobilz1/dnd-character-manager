import { describe, it, expect } from 'vitest';
import { featGrantedSpells, getEligibleFeats, formatFeatPrerequisite } from './feats';
import { PHB2024_FEATS } from './feats-phb2024';
import type { Character } from '../types';

/**
 * PHB 2024 feat audit, 2026-08-16 — source: phb2024-players-handbook.md Ch.5.
 * Each test pins a defect the audit found, not the implementation that fixed it.
 */

// Loose on purpose: these fixtures name only the fields each assertion depends on, and a full
// ClassLevel/Character literal per test would bury the one value under test.
function char(over: Record<string, unknown> = {}): Character {
  return {
    id: 't', name: 'T', raceId: 'human', backgroundId: 'sage',
    classes: [{ classId: 'wizard', level: 8 }],
    baseAbilityScores: { str: 8, dex: 14, con: 12, int: 18, wis: 10, cha: 8 },
    enabledBooks: ['PHB', 'PHB2024'],
    selectedFeats: [],
    ...over,
  } as unknown as Character;
}

describe('feat-granted spells use the ability the player raised', () => {
  it('Fey-Touched on a wizard casts at Intelligence, not the declared default', () => {
    const c = char({ selectedFeats: ['fey-touched-2024'], featChoices: { 'fey-touched-2024': 'int' } });
    const misty = featGrantedSpells(c).find(s => s.spellId === 'misty-step');
    expect(misty?.ability).toBe('int');
  });

  it('falls back to the declared ability when the player made no choice', () => {
    const c = char({ selectedFeats: ['fey-touched-2024'] });
    expect(featGrantedSpells(c).find(s => s.spellId === 'misty-step')?.ability).toBe('cha');
  });

  it('carries the choice into picked spells too (Ritual Caster)', () => {
    const cleric = char({
      classes: [{ classId: 'cleric', level: 8 }],
      selectedFeats: ['ritual-caster-2024'],
      featChoices: { 'ritual-caster-2024': 'wis' },
      selectedFeatSpells: { 'ritual-caster-2024:rituals': ['detect-magic'] },
    });
    expect(featGrantedSpells(cleric).find(s => s.spellId === 'detect-magic')?.ability).toBe('wis');
  });

  it('Magic Initiate uses the ability the player named on the sheet', () => {
    // The feat grants no score increase, so the choice can't ride on featChoices — the creator
    // would turn that into a real +1. It has its own store.
    const c = char({
      selectedFeats: ['magic-initiate-2024'],
      selectedFeatSpells: { 'magic-initiate-2024:spell': ['bless'] },
      featSpellAbility: { 'magic-initiate-2024': 'int' },
    });
    expect(featGrantedSpells(c).find(s => s.spellId === 'bless')?.ability).toBe('int');
  });

  it('Magic Initiate falls back to its declared ability when nothing was named', () => {
    const c = char({
      selectedFeats: ['magic-initiate-2024'],
      selectedFeatSpells: { 'magic-initiate-2024:spell': ['bless'] },
    });
    expect(featGrantedSpells(c).find(s => s.spellId === 'bless')?.ability).toBe('wis');
  });

  it('ignores a named ability the feat does not offer', () => {
    const c = char({
      selectedFeats: ['magic-initiate-2024'],
      selectedFeatSpells: { 'magic-initiate-2024:spell': ['bless'] },
      featSpellAbility: { 'magic-initiate-2024': 'str' },
    });
    expect(featGrantedSpells(c).find(s => s.spellId === 'bless')?.ability).toBe('wis');
  });

  it('no feat declares both an ability increase and a named spell ability', () => {
    // The two are stored in different places on the character and would fight over one spell's
    // ability if a feat ever carried both. Nothing does today; this is the guard.
    const both = PHB2024_FEATS.filter(f => f.abilityScoreChoice?.length && f.spellAbilityChoice?.length);
    expect(both.map(f => f.id)).toEqual([]);
  });

  it('does not swap an ability the feat never offered', () => {
    // Telekinetic offers Int/Wis/Cha; a Dex pick is not one of them, so Mage Hand keeps its own.
    const c = char({ selectedFeats: ['telekinetic-2024'], featChoices: { 'telekinetic-2024': 'dex' } } as Partial<Character>);
    expect(featGrantedSpells(c).find(s => s.spellId === 'mage-hand')?.ability).toBe('int');
  });
});

describe('"X or Y 13+" prerequisites accept either ability', () => {
  const dexRogue = char({
    classes: [{ classId: 'rogue', level: 8 }],
    baseAbilityScores: { str: 8, dex: 18, con: 14, int: 10, wis: 12, cha: 10 },
  } as Partial<Character>);

  it.each(['athlete-2024', 'sentinel-2024', 'grappler-2024', 'charger-2024', 'dual-wielder-2024', 'polearm-master-2024'])(
    'a Dex build qualifies for %s despite Strength 8',
    (id) => {
      expect(getEligibleFeats(dexRogue, ['PHB2024']).some(f => f.id === id)).toBe(true);
    },
  );

  it('still refuses when neither alternative is met', () => {
    const weak = char({ baseAbilityScores: { str: 8, dex: 8, con: 12, int: 18, wis: 10, cha: 8 } } as Partial<Character>);
    expect(getEligibleFeats(weak, ['PHB2024']).some(f => f.id === 'athlete-2024')).toBe(false);
  });

  it('Observant takes Wisdom as well as Intelligence', () => {
    const cleric = char({
      classes: [{ classId: 'cleric', level: 8 }],
      baseAbilityScores: { str: 10, dex: 10, con: 12, int: 8, wis: 18, cha: 12 },
    });
    expect(getEligibleFeats(cleric, ['PHB2024']).some(f => f.id === 'observant-2024')).toBe(true);
  });
});

describe('level prerequisites are judged at the level being gained', () => {
  const lvl3Fighter = char({
    classes: [{ classId: 'fighter-2024', level: 3 }],
    baseAbilityScores: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 10 },
  });

  it('a level-3 character levelling to 4 is offered the 2024 General feats', () => {
    // The ASI that grants the feat IS level 4; the character object still reads 3 while the dialog
    // is open. Judged at 3, all 43 General feats disappeared from the first ASI in the game.
    const atFour = getEligibleFeats(lvl3Fighter, ['PHB2024'], 4).map(f => f.id);
    expect(atFour).toContain('great-weapon-master-2024');
    expect(atFour).toContain('athlete-2024');
    expect(getEligibleFeats(lvl3Fighter, ['PHB2024']).map(f => f.id)).not.toContain('great-weapon-master-2024');
  });

  it('Epic Boons become available at the level-19 ASI', () => {
    const lvl18 = char({ classes: [{ classId: 'fighter-2024', level: 18 }] });
    expect(getEligibleFeats(lvl18, ['PHB2024'], 19).map(f => f.id)).toContain('boon-of-truesight');
  });

  it('still gates a feat the character has not reached', () => {
    expect(getEligibleFeats(lvl3Fighter, ['PHB2024'], 4).map(f => f.id)).not.toContain('boon-of-truesight');
  });
});

describe('prerequisite text', () => {
  it('prints alternatives with "or" and keeps the level requirement', () => {
    const athlete = PHB2024_FEATS.find(f => f.id === 'athlete-2024')!;
    expect(formatFeatPrerequisite(athlete.prerequisite)).toBe('STR 13+ or DEX 13+, level 4');
  });
});

describe('2014 feats whose prerequisites were missing or unenforceable', () => {
  it('Athlete (2014) requires Str or Dex 13 — it had no prerequisite at all', () => {
    const weak = char({
      classes: [{ classId: 'fighter', level: 8 }],
      baseAbilityScores: { str: 10, dex: 10, con: 14, int: 12, wis: 12, cha: 10 },
    });
    expect(getEligibleFeats(weak, ['PHB']).map(f => f.id)).not.toContain('athlete');
    const strong = char({
      classes: [{ classId: 'fighter', level: 8 }],
      baseAbilityScores: { str: 10, dex: 14, con: 14, int: 12, wis: 12, cha: 10 },
    });
    expect(getEligibleFeats(strong, ['PHB']).map(f => f.id)).toContain('athlete');
  });

  it('Ritual Caster (2014) gates on Int or Wis 13, not free text', () => {
    const dull = char({
      classes: [{ classId: 'fighter', level: 8 }],
      baseAbilityScores: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 },
    });
    expect(getEligibleFeats(dull, ['PHB']).map(f => f.id)).not.toContain('ritual-caster');
  });
});

describe('Boon of Fortitude', () => {
  it('carries its flat +40 HP as data, not just prose', () => {
    expect(PHB2024_FEATS.find(f => f.id === 'boon-of-fortitude')?.hpBonus).toBe(40);
  });
});
