import { describe, it, expect } from 'vitest';
import { weaponAttackLine, magicBonusFromName, isMonkWeapon } from './weaponAttack';
import { lookupWeapon } from '../data/weapons';
import type { Character, InventoryItem } from '../types';

/**
 * The attack panel's numbers, which players read every single turn. Four rules were
 * missing entirely (Archery, Dueling, monk weapons, magic +N) because the arithmetic
 * lived twice — once per panel — and neither copy had them.
 */
const MODS = { str: 3, dex: 4, con: 2, int: 0, wis: 1, cha: 0 };

function weapon(name: string, equipped = true): InventoryItem {
  return { id: name, name, quantity: 1, category: 'weapon', equipped } as InventoryItem;
}

function character(patch: Partial<Character> & { inventory?: InventoryItem[] }): Character {
  return {
    classes: [], inventory: [], selectedFeats: [], selectedFeatPicks: {},
    classOptions: { fightingStyles: [], invocations: [], metamagic: [], maneuvers: [], infusions: [], optionalFeatures: [] },
    ...patch,
  } as unknown as Character;
}

const line = (c: Character, item: InventoryItem, martialArtsDie = 0) =>
  weaponAttackLine(c, item, { mods: MODS, profBonus: 3, martialArtsDie });

/** Guard: these fixtures name real weapons, and the flags the rules key on must exist. */
it('the weapon fixtures are real and carry the properties the rules read', () => {
  expect(lookupWeapon('longbow')?.ranged).toBe(true);
  expect(lookupWeapon('greatsword')?.twoHanded).toBe(true);
  expect(lookupWeapon('longsword')?.twoHanded).toBeUndefined();
  expect(lookupWeapon('quarterstaff')?.ability).toBe('str');
});

/** A Greatclub used to resolve to a `club` — "greatclub" contains "club" and club is
 *  listed first, so the wielder was shown 1d4 one-handed instead of 1d8 two-handed. */
it('resolves the most specific weapon name, not the first one in the table', () => {
  expect(lookupWeapon('Greatclub')?.name).toBe('greatclub');
  expect(lookupWeapon('Greatclub')?.damageDice).toBe('1d8');
  expect(lookupWeapon('Club')?.name).toBe('club');
  expect(lookupWeapon('+1 Greatsword')?.name).toBe('greatsword');
  expect(lookupWeapon('Crossbow, Heavy')?.name).toBe('heavy crossbow');
});

describe('fighting styles', () => {
  const fighter = (styles: string[], inv: InventoryItem[]) => character({
    classes: [{ classId: 'fighter', level: 5, hitPointsRolled: [] }],
    classOptions: { fightingStyles: styles, invocations: [], metamagic: [], maneuvers: [], infusions: [], optionalFeatures: [] },
    inventory: inv,
  });

  it('Archery adds +2 to hit with a ranged weapon, and nothing to damage', () => {
    const bow = weapon('Longbow');
    const without = line(fighter([], [bow]), bow);
    const withStyle = line(fighter(['archery'], [bow]), bow);
    expect(withStyle.toHit).toBe(without.toHit + 2);
    expect(withStyle.damageBonus).toBe(without.damageBonus);
    expect(withStyle.notes).toContain('Archery +2 to hit');
  });

  it('Archery does not touch a melee weapon', () => {
    const sword = weapon('Longsword');
    expect(line(fighter(['archery'], [sword]), sword).toHit).toBe(line(fighter([], [sword]), sword).toHit);
  });

  it('Dueling adds +2 damage to a one-handed melee weapon', () => {
    const sword = weapon('Longsword');
    const withStyle = line(fighter(['dueling'], [sword]), sword);
    expect(withStyle.damageBonus).toBe(line(fighter([], [sword]), sword).damageBonus + 2);
    expect(withStyle.toHit).toBe(line(fighter([], [sword]), sword).toHit);
  });

  it('Dueling does not apply to a two-handed weapon, a ranged one, or a second weapon in hand', () => {
    const greatsword = weapon('Greatsword');
    expect(line(fighter(['dueling'], [greatsword]), greatsword).damageBonus).toBe(MODS.str);

    const bow = weapon('Longbow');
    expect(line(fighter(['dueling'], [bow]), bow).damageBonus).toBe(MODS.dex);

    // Two weapons equipped — "and no other weapons" fails.
    const sword = weapon('Longsword');
    const dagger = weapon('Dagger');
    expect(line(fighter(['dueling'], [sword, dagger]), sword).damageBonus).toBe(MODS.str);
  });

  it('a 2024 fighting-style FEAT counts, not just the class option', () => {
    const bow = weapon('Longbow');
    const viaFeat = character({
      classes: [{ classId: 'fighter-2024', level: 5, hitPointsRolled: [] }],
      selectedFeats: ['fighting-style-archery-2024'],
      inventory: [bow],
    });
    expect(line(viaFeat, bow).toHit).toBe(line(fighter([], [bow]), bow).toHit + 2);
  });
});

describe('monk weapons', () => {
  const monk = (level: number, inv: InventoryItem[]) => character({
    classes: [{ classId: 'monk', level, hitPointsRolled: [] }],
    inventory: inv,
  });

  it('lets a monk use DEX with a quarterstaff — the reported bug', () => {
    const staff = weapon('Quarterstaff');
    const m = monk(5, [staff]);
    const l = line(m, staff, 6);
    // DEX 4 + prof 3 = +7 to hit, 1d6+4 damage — not STR 3 with no proficiency-free die.
    expect(l.toHit).toBe(MODS.dex + 3);
    expect(l.damageBonus).toBe(MODS.dex);
    expect(l.notes).toContain('Martial Arts (DEX)');
  });

  it('upgrades the damage die once Martial Arts passes the weapon die', () => {
    const staff = weapon('Quarterstaff');
    expect(line(monk(5, [staff]), staff, 6).damageDice).toBe('1d6');   // d6 vs d6 — no change
    expect(line(monk(11, [staff]), staff, 8).damageDice).toBe('1d8');  // d8 beats d6
  });

  it('leaves non-monk weapons alone', () => {
    const greatsword = weapon('Greatsword');
    const l = line(monk(11, [greatsword]), greatsword, 8);
    expect(l.damageDice).toBe('2d6');
    expect(l.damageBonus).toBe(MODS.str);
  });

  it('classifies monk weapons by the two-handed flag, not by name', () => {
    expect(isMonkWeapon(lookupWeapon('quarterstaff'))).toBe(true);
    expect(isMonkWeapon(lookupWeapon('shortsword'))).toBe(true);
    expect(isMonkWeapon(lookupWeapon('dagger'))).toBe(true);
    expect(isMonkWeapon(lookupWeapon('unarmed'))).toBe(true);
    expect(isMonkWeapon(lookupWeapon('greatclub'))).toBe(false); // simple but two-handed
    expect(isMonkWeapon(lookupWeapon('longsword'))).toBe(false); // martial
    expect(isMonkWeapon(lookupWeapon('shortbow'))).toBe(false);  // ranged
  });

  it('gives a non-monk nothing, however good their DEX', () => {
    const staff = weapon('Quarterstaff');
    const wizard = character({ classes: [{ classId: 'wizard', level: 11, hitPointsRolled: [] }], inventory: [staff] });
    expect(line(wizard, staff, 0).damageBonus).toBe(MODS.str);
  });
});

describe('magic weapons', () => {
  it('reads the bonus out of the item name, both spellings', () => {
    expect(magicBonusFromName('+1 Longsword')).toBe(1);
    expect(magicBonusFromName('Longsword +2')).toBe(2);
    expect(magicBonusFromName('Longsword')).toBe(0);
    expect(magicBonusFromName('Sword of Wounding')).toBe(0);
  });

  it('adds it to BOTH the attack and the damage', () => {
    const plain = weapon('Longsword');
    const magic = weapon('+1 Longsword');
    const c = character({ classes: [{ classId: 'fighter', level: 5, hitPointsRolled: [] }], inventory: [magic] });
    const base = line(character({ classes: [{ classId: 'fighter', level: 5, hitPointsRolled: [] }], inventory: [plain] }), plain);
    const enchanted = line(c, magic);
    expect(enchanted.toHit).toBe(base.toHit + 1);
    expect(enchanted.damageBonus).toBe(base.damageBonus + 1);
    expect(enchanted.notes).toContain('Magic weapon +1');
  });
});

describe('what must not change', () => {
  it('still gates the proficiency bonus on actual proficiency', () => {
    const sword = weapon('Longsword');
    const wizard = character({ classes: [{ classId: 'wizard', level: 5, hitPointsRolled: [] }], inventory: [sword] });
    const l = line(wizard, sword);
    expect(l.proficient).toBe(false);
    expect(l.toHit).toBe(MODS.str); // no proficiency bonus
  });

  it('keeps finesse picking the better ability', () => {
    const rapier = weapon('Rapier');
    const rogue = character({ classes: [{ classId: 'rogue', level: 5, hitPointsRolled: [] }], inventory: [rapier] });
    expect(line(rogue, rapier).damageBonus).toBe(MODS.dex); // dex 4 > str 3
  });

  it('a plain fighter with a plain sword gets exactly ability + proficiency', () => {
    const sword = weapon('Longsword');
    const f = character({ classes: [{ classId: 'fighter', level: 5, hitPointsRolled: [] }], inventory: [sword] });
    const l = line(f, sword);
    expect(l.toHit).toBe(MODS.str + 3);
    expect(l.damageBonus).toBe(MODS.str);
    expect(l.damageDice).toBe('1d8');
    expect(l.versatileDice).toBe('1d10');
    expect(l.notes).toEqual([]);
  });
});
