/**
 * Tool, language and weapon grants that feats hand out — asserted through the SAME pipelines the
 * class and background grants use, because that reuse is the whole claim being made.
 *
 * Every check has a mirror: the feat held vs not held, or a categorised grant vs a grant of a
 * different category. "Crafter owes 3 picks" would pass even if the picker offered lutes.
 */
const { computeCharacterDerived } = await import(process.argv[2]);
const { isProficientWithWeapon } = await import(process.argv[3]);

const CHAR = (feats) => ({
  id: 'p', name: 'P', raceId: 'human', backgroundId: 'soldier',
  classes: [{ classId: 'wizard', level: 8 }],
  baseAbilityScores: { str: 12, dex: 14, con: 14, int: 16, wis: 12, cha: 8 },
  selectedFeats: feats, featChoices: {}, selectedSkillProficiencies: [],
  selectedLanguages: [], selectedToolProficiencies: {},
  classOptions: { fightingStyles: [], invocations: [], metamagic: [], maneuvers: [], infusions: [], optionalFeatures: [] },
  inventory: [], currencies: {}, hitDiceUsed: {}, resources: [],
  enabledBooks: ['PHB', 'XGtE', 'TCE', 'PHB2024', 'FToD'],
  currentHP: 1, maxHP: 1, tempHP: 0, level: 8,
});

let failures = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}: ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`);
};
const d = (feats) => computeCharacterDerived(CHAR(feats));
/** Tools resolved outright, minus whatever the wizard/soldier baseline already had. */
const baselineTools = new Set(d([]).toolProficiencies);
const newTools = (feats) => d(feats).toolProficiencies.filter(t => !baselineTools.has(t));
const owed = (feats) => d(feats).toolsOwed - d([]).toolsOwed;
const langOwed = (feats) => d(feats).languagesOwed - d([]).languagesOwed;

// ── Fixed tool grants resolve to a real proficiency, not a picker.
check('Chef grants cook\'s utensils outright', newTools(['chef']), ["Cook's utensils"]);
check('Chef adds no picks owed', owed(['chef']), 0);
check('Poisoner grants the poisoner\'s kit outright', newTools(['poisoner']), ["Poisoner's kit"]);

// ── Choice grants become picks, in the right category.
check('Crafter 2024 owes 3 picks', owed(['crafter-2024']), 3);
check('Musician 2024 owes 3 picks', owed(['musician-2024']), 3);
check('Artificer Initiate owes 1 pick', owed(['artificer-initiate']), 1);
// Diff against the baseline's GRANT TEXTS — the soldier background already carries a gaming-set
// choice, and filtering grant texts against resolved tool NAMES matched it every time.
const baselineGrants = new Set(d([]).toolChoices.map(x => x.text));
const optionsFor = (featId) => {
  const c = d([featId]).toolChoices.find(x => !baselineGrants.has(x.text));
  return c ? c.grant.categories : null;
};
check('Crafter picks are artisan tools', optionsFor('crafter-2024'), ['artisan']);
check('Musician picks are instruments — NOT artisan tools', optionsFor('musician-2024'), ['instrument']);

// ── Languages.
check('Linguist owes 3 languages', langOwed(['linguist']), 3);
check('NEGATIVE: Chef owes no languages', langOwed(['chef']), 0);

// ── Weapon proficiency. A wizard has simple weapons only.
const prof = (feats, w) => isProficientWithWeapon(CHAR(feats), w);
check('NEGATIVE: wizard is not proficient with a greataxe', prof([], 'Greataxe'), false);
check('Martial Weapon Training 2024 grants the greataxe', prof(['martial-weapon-training-2024'], 'Greataxe'), true);
check('NEGATIVE: a different feat does not', prof(['chef'], 'Greataxe'), false);
check('NEGATIVE: wizard keeps simple weapons regardless', [prof([], 'Dagger'), prof(['chef'], 'Dagger')], [true, true]);
check('NEGATIVE: armour grants do not become weapon proficiency',
  prof(['heavily-armored'], 'Greataxe'), false);

console.log(failures ? `\n${failures} FAILURES` : '\nall checks passed');
process.exit(failures ? 1 : 0);
