/**
 * Feat proficiency picks: does a pick land in the RIGHT pool, and only there?
 *
 * The design claim is that one picker serves skills, tools and weapons because each pick is
 * resolved by the catalog it belongs to. That claim is only worth anything if a skill pick can't
 * leak into the tool list and a weapon pick can't become a skill, so most of these checks are
 * cross-pool negatives.
 */
const { computeCharacterDerived } = await import(process.argv[2]);
const { isProficientWithWeapon } = await import(process.argv[3]);

const CHAR = (feats, picks = {}, expertise = []) => ({
  id: 'p', name: 'P', raceId: 'human', backgroundId: 'soldier',
  classes: [{ classId: 'wizard', level: 8 }],
  baseAbilityScores: { str: 12, dex: 14, con: 14, int: 16, wis: 12, cha: 8 },
  selectedFeats: feats, featChoices: {}, selectedSkillProficiencies: ['Arcana', 'History'],
  selectedLanguages: [], selectedToolProficiencies: {},
  selectedFeatPicks: picks, selectedFeatExpertise: expertise, expertiseSkills: [],
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
const d = (...a) => computeCharacterDerived(CHAR(...a));
const baseSkills = new Set(d([]).allSkillProficiencies);
const baseTools = new Set(d([]).toolProficiencies);
const newSkills = (...a) => [...d(...a).allSkillProficiencies].filter(s => !baseSkills.has(s)).sort();
const newTools = (...a) => d(...a).toolProficiencies.filter(t => !baseTools.has(t)).sort();

// ── A skill pick becomes a skill and NOTHING else.
check('Skilled: a skill pick becomes a skill proficiency',
  newSkills(['skilled'], { skilled: ['Stealth'] }), ['Stealth']);
check('NEGATIVE: that same pick does not appear as a tool',
  newTools(['skilled'], { skilled: ['Stealth'] }), []);

// ── A tool pick from the SAME grant becomes a tool and nothing else. This is the whole point of
//    resolving by catalog rather than by which picker the choice came from.
check("Skilled: a tool pick from the same grant becomes a tool",
  newTools(['skilled'], { skilled: ["Smith's tools"] }), ["Smith's tools"]);
check('NEGATIVE: that tool pick does not appear as a skill',
  newSkills(['skilled'], { skilled: ["Smith's tools"] }), []);
check('Skilled: a mixed pick splits across both pools',
  [newSkills(['skilled'], { skilled: ['Stealth', "Smith's tools", 'Lute'] }),
   newTools(['skilled'], { skilled: ['Stealth', "Smith's tools", 'Lute'] })],
  [['Stealth'], ['Lute', "Smith's tools"]]);

// ── Unpicked grants grant nothing, and picks are scoped per feat.
check('NEGATIVE: taking the feat without picking grants nothing',
  [newSkills(['skilled']), newTools(['skilled'])], [[], []]);
check("NEGATIVE: another feat's key does not spend this feat's picks",
  newSkills(['skilled'], { 'skill-expert': ['Stealth'] }), []);
// Acrobatics, not Athletics: the soldier background already grants Athletics, so picking it
// diffs to nothing and the check would fail against working code.
check('Squat Nimbleness pick lands', newSkills(['squat-nimbleness'], { 'squat-nimbleness': ['Acrobatics'] }), ['Acrobatics']);
check('NEGATIVE: a pick outside the grant\'s options is still stored but adds nothing new',
  newSkills(['squat-nimbleness'], { 'squat-nimbleness': ['Athletics'] }), []);

// ── Owed counts.
const owed = (...a) => d(...a).featPicksOwed;
check('Skilled owes 3, then 1 after two picks',
  [owed(['skilled']), owed(['skilled'], { skilled: ['Stealth', 'Nature'] })], [3, 1]);
check('NEGATIVE: no feats owes 0', owed([]), 0);

// ── The auto rule: Boon of Skill covers every option, so it grants outright with no picker.
const boon = d(['boon-of-skill']);
check('Boon of Skill grants all 18 skills with no picks owed',
  [newSkills(['boon-of-skill']).length, boon.featPicksOwed], [18 - baseSkills.size, 0]);
check('Boon of Skill is marked auto, Skilled is not',
  [d(['boon-of-skill']).featPicks[0].auto, d(['skilled']).featPicks[0].auto], [true, false]);

// ── Weapons. Weapon Master's picks are named weapons; a wizard has simple weapons only.
const prof = (feats, picks, w) => isProficientWithWeapon(CHAR(feats, picks), w);
check('NEGATIVE: wizard is not proficient with a greataxe', prof([], {}, 'Greataxe'), false);
check('Weapon Master pick grants that weapon',
  prof(['weapon-master'], { 'weapon-master': ['Greataxe'] }, 'Greataxe'), true);
check('NEGATIVE: an unpicked weapon stays unproficient',
  prof(['weapon-master'], { 'weapon-master': ['Greataxe'] }, 'Glaive'), false);
check('NEGATIVE: a weapon pick does not become a skill',
  newSkills(['weapon-master'], { 'weapon-master': ['Greataxe'] }), []);
check('NEGATIVE: a skill pick does not become weapon proficiency',
  prof(['skilled'], { skilled: ['Stealth'] }, 'Greataxe'), false);

// ── Expertise. Doubles proficiency, so it must apply only to a skill already held.
const exp = (...a) => [...d(...a).expertiseSkills].sort();
check('Skill Expert expertise applies', exp(['skill-expert'], {}, ['Arcana']), ['Arcana']);
check('Skill Expert owes 1 expertise slot', d(['skill-expert']).featExpertiseOwed, 1);
check('NEGATIVE: expertise beyond the slots is dropped',
  exp(['skill-expert'], {}, ['Arcana', 'History']), ['Arcana']);
check('NEGATIVE: a feat with no expertise grants no slots', d(['skilled']).featExpertiseOwed, 0);
check('Arcana expertise doubles the bonus (+3 prof -> +6)',
  d(['skill-expert'], {}, ['Arcana']).skills['Arcana'] - d([]).skills['Arcana'], 3);

console.log(failures ? `\n${failures} FAILURES` : '\nall checks passed');
process.exit(failures ? 1 : 0);
