/**
 * Does the creator carry every choice a player made into the finished character?
 *
 * `finalize()` builds its result as an explicit object literal — a WHITELIST. Any field the draft
 * carries but that block doesn't name is dropped silently, with no type error, because the draft
 * is a `Partial<Character>` and every dropped field is optional. `selectedLanguages` and
 * `selectedToolProficiencies` were already missing before this probe existed.
 *
 * So the check is deliberately structural rather than per-field: put a marker value in every
 * player-choice field, finalize, and assert nothing vanished. A new choice field that nobody
 * remembers to add to finalize() shows up here rather than as a bug report about lost picks.
 */
const { useCreatorStore } = await import(process.argv[2]);

/** Every field the player can set that is a CHOICE rather than a derived value. */
const CHOICE_FIELDS = {
  selectedSkillProficiencies: ['Arcana'],
  selectedFeats: ['magic-initiate'],
  featChoices: {},
  expertiseSkills: ['Arcana'],
  selectedLanguages: ['Draconic'],
  selectedToolProficiencies: { "Three artisan's tools of your choice": ["Smith's tools"] },
  selectedFeatPicks: { skilled: ['Stealth'] },
  selectedFeatExpertise: ['Arcana'],
  selectedFeatSpells: { 'magic-initiate:spell': ['bless'] },
  knowledgeDomainSkills: ['Nature'],
};

const store = useCreatorStore.getState();
store.updateDraft({
  name: 'Probe', playerName: 'audit', alignment: 'True Neutral',
  enabledBooks: ['PHB', 'XGtE', 'TCE'],
  raceId: 'human', backgroundId: 'soldier',
  classes: [{ classId: 'wizard', level: 4 }],
  baseAbilityScores: { str: 10, dex: 12, con: 14, int: 16, wis: 10, cha: 10 },
  ...CHOICE_FIELDS,
});
const c = useCreatorStore.getState().finalize();

let failures = 0;
const check = (l, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${l}: ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`);
};

if (!c) { console.log('FAIL  finalize() returned null'); process.exit(1); }
for (const [field, value] of Object.entries(CHOICE_FIELDS)) {
  check(`finalize keeps ${field}`, c[field], value);
}

// Feat spell uses must be seeded, or the sheet shows the spell as available while no rest
// handler has a key to restore — the shape that let item `recharge` sit inert for months.
check('finalize seeds the feat spell use counter',
  c.innateSpellUses?.['feat:magic-initiate:bless'], 1);
check('NEGATIVE: no counter for a cantrip pick (nothing tracks those)',
  Object.keys(c.innateSpellUses ?? {}).some(k => k.includes('cantrip')), false);

console.log(failures ? `\n${failures} FAILURES` : '\nall checks passed');
process.exit(failures ? 1 : 0);
