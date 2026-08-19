import { describe, expect, it } from 'vitest';
import { parseCharacterWish } from './parseCharacterWish';
import type { BookId } from '../types';

const PHB: BookId[] = ['PHB'];

describe('parseCharacterWish', () => {
  it('matches hyphenated race names typed with a space — the half orc that came out dragonborn', () => {
    const wish = parseCharacterWish('half orc fighter', PHB);
    expect(wish.classId).toBe('fighter');
    expect(wish.raceIds).toEqual(['half-orc']);
    expect(wish.raceLabel).toBe('Half-Orc');
  });

  it('still matches the hyphenated spelling', () => {
    expect(parseCharacterWish('a half-orc brute', PHB).raceIds).toEqual(['half-orc']);
    expect(parseCharacterWish('half-elf bard', PHB).raceIds).toEqual(['half-elf']);
  });

  it('matches "half elf" without letting bare "elf" swallow it', () => {
    const wish = parseCharacterWish('a charming half elf bard', PHB);
    expect(wish.raceIds).toEqual(['half-elf']);
  });

  it('a bare parent race still yields all of its subraces', () => {
    const wish = parseCharacterWish('a dwarf warrior', PHB);
    expect(wish.classId).toBe('fighter');
    expect(wish.raceIds).toBeDefined();
    expect(wish.raceIds!.length).toBeGreaterThan(1);
    expect(wish.raceIds!.every(id => id.includes('dwarf'))).toBe(true);
  });

  it('leaves the race unset when nothing matches, so the roll stays random', () => {
    expect(parseCharacterWish('someone mysterious and cool', PHB).raceIds).toBeUndefined();
  });
});
