/**
 * Companion scaling self-check.
 *
 * The repo has no JS test runner and this is not the place to introduce one, so this follows the
 * same shape as spellrefs.js: paste into the dev-server page console (or drive it over CDP) with
 * the app running on :5173. It returns { pass, failures }.
 *
 * Covers the arithmetic that is easy to get subtly wrong and invisible when it is:
 *   - Beast Master grafts the RANGER's proficiency bonus onto AC, to-hit and damage
 *   - HP floors at 4 x ranger level, not the beast's own maximum
 *   - Bestial Fury (11th) turns one attack into two
 *   - flat damage (Poisonous Snake's bite is literally "1") still takes the bonus
 *   - a negative die modifier can cancel to nothing: 1d4-2 with +2 is 1d4, not "1d4+0"
 */
(async () => {
  const t = Date.now();
  const C = await import('/src/utils/companion.ts?t=' + t);

  const ranger = (level) => ({
    classes: [{ classId: 'ranger', subclassId: 'beast-master', level }],
    baseAbilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    selectedFeats: [], selectedSkillProficiencies: [], inventory: [],
  });
  const beast = (beastId) => ({
    id: 'c1', kind: 'beast-master', classId: 'ranger', beastId, name: 'Fang',
    currentHP: 1, active: true,
  });

  const failures = [];
  const eq = (label, got, want) => {
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      failures.push(`${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
    }
  };

  // Wolf: AC 13, HP 11, Bite +4 2d4+2. Ranger 5 -> proficiency +3.
  const w5 = C.computeCompanionDerived(ranger(5), beast('wolf'));
  eq('wolf@5 ac', w5.ac, 16);                    // 13 + 3
  eq('wolf@5 maxHP', w5.maxHP, 20);              // max(11, 4 x 5)
  eq('wolf@5 toHit', w5.attacks[0].toHit, 7);    // 4 + 3
  eq('wolf@5 damage', w5.attacks[0].damage, '2d4+5');
  eq('wolf@5 attacksPerAction', w5.attacksPerAction, 1);

  // Ranger 11 -> proficiency +4, and Bestial Fury.
  const w11 = C.computeCompanionDerived(ranger(11), beast('wolf'));
  eq('wolf@11 maxHP', w11.maxHP, 44);            // max(11, 4 x 11)
  eq('wolf@11 attacksPerAction', w11.attacksPerAction, 2);

  // Flat damage still takes the bonus.
  const snake = C.computeCompanionDerived(ranger(5), beast('poisonous-snake'));
  eq('snake@5 flat damage', snake.attacks[0].damage, '4');   // 1 + 3

  // Damage-expression arithmetic, including the cancel-to-zero case.
  eq('addDamageBonus 2d4+2 +3', C.addDamageBonus('2d4+2', 3), '2d4+5');
  eq('addDamageBonus 1d6 +2', C.addDamageBonus('1d6', 2), '1d6+2');
  eq('addDamageBonus 1d4-1 +2', C.addDamageBonus('1d4-1', 2), '1d4+1');
  eq('addDamageBonus 1d4-2 +2', C.addDamageBonus('1d4-2', 2), '1d4');
  eq('addDamageBonus flat 1 +3', C.addDamageBonus('1', 3), '4');

  return { pass: failures.length === 0, checks: 13, failures };
})();
