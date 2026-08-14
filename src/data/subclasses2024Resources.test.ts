import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ALL_SUBCLASSES } from './subclasses';

/**
 * The PHB 2024 subclasses declared no resources at all until 2026-08-13, so their
 * limited-use features were untracked — most visibly the Battle Master, which the
 * level-up dialog offered maneuvers with no Superiority Dice to spend.
 *
 * The failure mode these tests exist to catch is the SECOND one: a resource that
 * is declared but inert. Pools sized by an ability modifier carry a placeholder
 * `maxPerLevel` of 1 (the convention the 2014 entries already use) and get their
 * real size from `resourceMaxOverrides`. Miss the override and the pool silently
 * sits at one use forever — and load() then clamps `current` to it, which is
 * exactly how creator-built characters ended up looking part-spent.
 */

const subclasses2024 = ALL_SUBCLASSES.filter(s => s.sourceBook === 'PHB2024');
const derivedSource = readFileSync('src/hooks/useCharacterDerived.ts', 'utf8');

/** Every key whose real maximum comes from an override, not from its own table. */
const OVERRIDE_BACKED = [
  // Wisdom modifier
  'warding_flare', 'corona_of_light', 'war_priest', 'moonlight_step',
  'star_map_2024', 'cosmic_omen_2024', 'flurry_of_healing_and_harm',
  'wholeness_of_body', 'misty_wanderer', 'dreadful_strike',
  // Charisma modifier
  'glorious_defense', 'restore_balance_2024', 'steps_of_the_fey', 'dark_ones_own_luck_2024',
  // 2 x proficiency bonus
  'psionic_energy_psi_warrior', 'psionic_energy_soulknife',
  // 2 x wizard level + Int
  'arcane_ward',
];

describe('PHB 2024 subclass resources', () => {
  it('the edition actually declares resources now', () => {
    const withResources = subclasses2024.filter(s => (s.resources ?? []).length > 0);
    expect(withResources.length).toBeGreaterThanOrEqual(31);
  });

  it('battle-master-2024 has Superiority Dice, since level-up grants it maneuvers', () => {
    const bm = subclasses2024.find(s => s.id === 'battle-master-2024');
    const dice = (bm?.resources ?? []).find(r => r.key === 'superiority_dice');
    expect(dice).toBeDefined();
    // 2024 PHB: 4 dice at 3, 5 at 7, 6 at 15; d8 -> d10 at 10 -> d12 at 18.
    expect(dice!.maxPerLevel[3]).toBe(4);
    expect(dice!.maxPerLevel[7]).toBe(5);
    expect(dice!.maxPerLevel[15]).toBe(6);
    expect(dice!.resourceDie).toEqual({ 3: 8, 10: 10, 18: 12 });
    expect(dice!.rechargeOn).toBe('short');
  });

  /** The load-bearing one: a placeholder table with no override is a dead pool. */
  it.each(OVERRIDE_BACKED)('%s is backed by a resourceMaxOverrides branch', (key) => {
    expect(derivedSource).toContain(`'${key}'`);
  });

  it('every override-backed key is actually declared by some subclass', () => {
    const declared = new Set(
      ALL_SUBCLASSES.flatMap(s => (s.resources ?? []).map(r => r.key)),
    );
    expect(OVERRIDE_BACKED.filter(k => !declared.has(k))).toEqual([]);
  });

  it('no subclass declares the same resource key twice', () => {
    const offenders = subclasses2024
      .map(s => {
        const keys = (s.resources ?? []).map(r => r.key);
        return { id: s.id, dupes: keys.filter((k, i) => keys.indexOf(k) !== i) };
      })
      .filter(x => x.dupes.length > 0);
    expect(offenders).toEqual([]);
  });

  it('every declared resource has a name, a key and a 20-level table', () => {
    const bad: string[] = [];
    for (const s of subclasses2024) {
      for (const r of s.resources ?? []) {
        if (!r.name?.trim() || !r.key?.trim()) bad.push(`${s.id}: nameless/keyless`);
        for (let lv = 1; lv <= 20; lv++) {
          if (r.maxPerLevel[lv] === undefined) bad.push(`${s.id}/${r.key}: no entry at level ${lv}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  /** Pools that scale on their own table must not be flat, or they'd be silently
   *  stuck at their level-3 size the way the placeholder pools would. */
  it.each([
    ['psi-warrior-2024', 'psionic_energy_psi_warrior', 4, 12],
    ['soulknife-2024', 'psionic_energy_soulknife', 4, 12],
    ['zealot-2024', 'warrior_of_the_gods', 4, 7],
    ['diviner-2024', 'portent', 2, 3],
    ['celestial-patron-2024', 'healing_light', 4, 21],
  ])('%s / %s grows from %i to %i', (id, key, atGain, atTwenty) => {
    const r = subclasses2024.find(s => s.id === id)?.resources?.find(x => x.key === key);
    expect(r, `${id} is missing ${key}`).toBeDefined();
    expect(r!.maxPerLevel[20]).toBe(atTwenty);
    const firstNonZero = Object.entries(r!.maxPerLevel)
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .find(([, v]) => v !== 0)?.[1];
    expect(firstNonZero).toBe(atGain);
  });
});
