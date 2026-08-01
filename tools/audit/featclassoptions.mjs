/**
 * Class-option feats: does the pick reach the system that ACTS on it?
 *
 * Fighting Initiate, Eldritch Adept, Metamagic Adept and Martial Adept each grant one option from
 * a catalog the app already has — and each landed nowhere, because the pick had no storage and
 * the display lists only ever read `classOptions`.
 *
 * Half of these checks guard a collision rather than a feature: `lookupWeapon` matches by
 * SUBSTRING, so 'eldritch-spear' contains "spear" and 'unarmed-fighting' contains "unarmed". Note
 * the weapon checks use a WIZARD — a fighter has both simple and martial weapons, so a negative
 * control run against one reads "proficient" no matter what the code does.
 */
const S = process.argv[2].replace(/\/?$/, '/');  // dir of bundled modules
const { computeCharacterDerived } = await import(S + 'derived.mjs');
const { isProficientWithWeapon } = await import(S + 'wprof.mjs');
const { activeFightingStyles } = await import(S + 'fightingStyles.mjs');
const F = (await import(S + 'feats.mjs')).ALL_FEATS;

const CHAR = (feats, picks = {}) => ({
  id: 'p', name: 'P', raceId: 'human', backgroundId: 'soldier',
  classes: [{ classId: 'fighter', level: 8, subclassId: 'champion' }],
  baseAbilityScores: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8 },
  selectedFeats: feats, featChoices: {}, selectedSkillProficiencies: [],
  selectedFeatPicks: picks, selectedFeatExpertise: [], expertiseSkills: [],
  classOptions: { fightingStyles: [], invocations: [], metamagic: [], maneuvers: [], infusions: [], optionalFeatures: [] },
  inventory: [{ name: 'Chain mail', category: 'armor', equipped: true, quantity: 1 }],
  currencies: {}, hitDiceUsed: {}, resources: [],
  enabledBooks: ['PHB', 'XGtE', 'TCE', 'PHB2024', 'FToD'],
  currentHP: 1, maxHP: 1, tempHP: 0, level: 8,
});
let failures = 0;
const check = (l, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${l}: ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`);
};
const opts = (id) => F.find(f => f.id === id).grantsPicks.options;

// Each of the four offers a real, non-empty pool.
for (const [id, n] of [['fighting-initiate', 1], ['eldritch-adept', 1], ['metamagic-adept', 2], ['martial-adept', 2]]) {
  const g = F.find(f => f.id === id).grantsPicks;
  check(`${id}: ${n} pick(s), non-empty pool`, [g.count, g.options.length > 0], [n, true]);
}
// Eldritch Adept must not offer invocations with a prerequisite (TCE p.79).
check('Eldritch Adept excludes pact-locked invocations',
  opts('eldritch-adept').includes('thirsting-blade'), false);

// Fighting Initiate's pick reaches the AC computation — the same route the class option takes.
const ac = (feats, picks) => computeCharacterDerived(CHAR(feats, picks)).ac;
check('NEGATIVE: chain mail, no style', ac([], {}), 16);
check('Fighting Initiate → Defense gives +1 AC',
  ac(['fighting-initiate'], { 'fighting-initiate': ['defense'] }), 17);
check('NEGATIVE: Fighting Initiate → Archery gives no AC',
  ac(['fighting-initiate'], { 'fighting-initiate': ['archery'] }), 16);
check('activeFightingStyles reports the pick',
  activeFightingStyles(CHAR(['fighting-initiate'], { 'fighting-initiate': ['dueling'] })), ['dueling']);

// The collision this guards: option ids are matched by SUBSTRING in the weapon lookup.
// A WIZARD, not the fighter above: a fighter has simple AND martial weapons, so every negative
// control here would read "proficient" no matter what the code did.
const WIZ = (feats, picks) => ({ ...CHAR(feats, picks), classes: [{ classId: 'wizard', level: 8 }] });
check('NEGATIVE: Eldritch Spear does not grant spear proficiency',
  isProficientWithWeapon(WIZ(['eldritch-adept'], { 'eldritch-adept': ['eldritch-spear'] }), 'Spear'), false);
check('NEGATIVE: Unarmed Fighting style does not grant weapon proficiency',
  isProficientWithWeapon(WIZ(['fighting-initiate'], { 'fighting-initiate': ['unarmed-fighting'] }), 'Greataxe'), false);
check('NEGATIVE: a wizard has no greataxe to begin with', isProficientWithWeapon(WIZ([], {}), 'Greataxe'), false);
check('a real Weapon Master pick still works',
  isProficientWithWeapon(WIZ(['weapon-master'], { 'weapon-master': ['Greataxe'] }), 'Greataxe'), true);

// And option ids must not leak into skills or tools either.
const dd = computeCharacterDerived(CHAR(['metamagic-adept'], { 'metamagic-adept': ['quickened-spell', 'twinned-spell'] }));
const base = computeCharacterDerived(CHAR([], {}));
check('NEGATIVE: metamagic ids do not become skills or tools',
  [[...dd.allSkillProficiencies].length - [...base.allSkillProficiencies].length,
   dd.toolProficiencies.length - base.toolProficiencies.length], [0, 0]);

console.log(failures ? `\n${failures} FAILURES` : '\nall checks passed');
process.exit(failures ? 1 : 0);
