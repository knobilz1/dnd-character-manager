import { describe, expect, it } from 'vitest';
import { RACE_OPTION_GROUPS, raceOptionGroups, raceOptionResistances } from './raceOptions';
import { rollRandomCharacter } from '../utils/randomCharacter';
import { racialLanguagePicks } from './languages';
import { getRace, ALL_RACES } from './races';
import { ALL_BACKGROUNDS } from './backgrounds';
import type { BookId } from '../types';

/** Deterministic rand so a failing roll can be re-run identically. */
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

describe('race option data', () => {
  it('every option group belongs to a race that actually exists', () => {
    for (const raceId of Object.keys(RACE_OPTION_GROUPS)) {
      expect(getRace(raceId), `race '${raceId}' in RACE_OPTION_GROUPS`).toBeTruthy();
    }
  });

  it('the standard dragonborn table has all ten dragons with the PHB damage types', () => {
    const groups = raceOptionGroups('dragonborn', 1);
    expect(groups).toHaveLength(1);
    expect(groups[0].options).toHaveLength(10);
    const byValue = Object.fromEntries(groups[0].options.map(o => [o.value, o.resistance]));
    expect(byValue.black).toBe('acid');
    expect(byValue.blue).toBe('lightning');
    expect(byValue.gold).toBe('fire');
    expect(byValue.green).toBe('poison');
    expect(byValue.white).toBe('cold');
  });

  it('a chosen ancestry surfaces as a resistance; no choice means none', () => {
    expect(raceOptionResistances('dragonborn', { 'draconic-ancestry': 'gold' })).toEqual(['fire']);
    expect(raceOptionResistances('dragonborn', {})).toEqual([]);
    expect(raceOptionResistances('tiefling-2024', { 'fiendish-legacy': 'chthonic' })).toEqual(['necrotic']);
  });

  it("Simic's 5th-level enhancement is hidden before level 5", () => {
    expect(raceOptionGroups('simic-hybrid', 1).map(g => g.key)).toEqual(['animal-enhancement-1']);
    expect(raceOptionGroups('simic-hybrid', 5).map(g => g.key))
      .toEqual(['animal-enhancement-1', 'animal-enhancement-5']);
  });

  it('races whose choose-one traits mention an ancestry are all covered', () => {
    // The trap this whole file exists to close: a race whose trait says "choose"
    // an ancestry/lineage/legacy but which no option group models.
    const needing = ALL_RACES.filter(r =>
      r.traits.some(t => /choose (one|a) .*(ancestr|lineage|legacy)/i.test(t.description)));
    for (const r of needing) {
      expect(RACE_OPTION_GROUPS[r.id], `race '${r.id}' has a choose-one ancestry trait but no option group`).toBeTruthy();
    }
  });
});

describe('rollRandomCharacter completes racial choices', () => {
  const books: BookId[] = ['PHB'];

  it('a rolled dragonborn always has an ancestry', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const r = rollRandomCharacter(books, seeded(seed), { raceIds: ['dragonborn'], classId: 'fighter' });
      expect(r).toBeTruthy();
      expect(r!.raceOptions['draconic-ancestry']).toBeTruthy();
    }
  });

  it('rolled language picks exactly cover what the race and background owe', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const r = rollRandomCharacter(books, seeded(seed))!;
      const race = getRace(r.raceId)!;
      const bg = ALL_BACKGROUNDS.find(b => b.id === r.backgroundId)!;
      const owed = racialLanguagePicks(race.languages) + (bg.languages ?? 0);
      expect(r.selectedLanguages).toHaveLength(owed);
      // Never "choose" a language the race already speaks.
      for (const l of r.selectedLanguages) {
        expect(race.languages ?? []).not.toContain(l);
      }
    }
  });

  it("a level-5 Simic never repeats its 1st-level enhancement", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const r = rollRandomCharacter(['PHB', 'GGR'], seeded(seed), {
        raceIds: ['simic-hybrid'], classId: 'fighter', level: 5,
      })!;
      const first = r.raceOptions['animal-enhancement-1'];
      const second = r.raceOptions['animal-enhancement-5'];
      expect(first).toBeTruthy();
      expect(second).toBeTruthy();
      expect(second).not.toBe(first);
    }
  });
});
