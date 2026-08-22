import { describe, it, expect } from 'vitest';
import { buildSheetDigest } from './sheetDigest';
import { useCreatorStore } from '../store/useCreatorStore';
import type { Character } from '../types';

/**
 * The DM resolves a character's abilities from this digest. A dragonborn's
 * Draconic Ancestry decides their breath weapon's damage type, its shape AND
 * which saving throw it calls for — but nothing used to carry that pick to
 * the DM (memory/party.md has only the bare race, and this digest had no race
 * line at all). Reported live: a bronze dragonborn's breath weapon was
 * narrated as a weapon swing and resolved as an attack roll.
 */
function build(patch: Partial<Character>): Character {
  useCreatorStore.setState((s) => ({ draft: { ...s.draft,
    name: 'Vora', raceId: 'dragonborn',
    classes: [{ classId: 'fighter', level: 5, hitPointsRolled: [] }],
    backgroundId: 'acolyte',
    baseAbilityScores: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 },
    ...patch,
  } }));
  const c = useCreatorStore.getState().finalize();
  if (!c) throw new Error('fixture failed');
  return c;
}

describe('the sheet digest carries race and the racial choices that decide mechanics', () => {
  it('names the chosen draconic ancestry, not just "Dragonborn"', () => {
    const digest = buildSheetDigest(build({ raceOptions: { 'draconic-ancestry': 'bronze' } }));
    expect(digest).toContain('Race: Dragonborn (Draconic Ancestry: Bronze)');
  });

  it('still names the race when the ancestry was never picked', () => {
    const digest = buildSheetDigest(build({ raceOptions: {} }));
    // No parenthetical rather than an empty "()" — an unpicked choice is
    // absent, not blank.
    expect(digest).toContain('Race: Dragonborn');
    expect(digest).not.toContain('()');
  });
});
