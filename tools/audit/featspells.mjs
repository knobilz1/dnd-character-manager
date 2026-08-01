/**
 * Feat-granted spell PICKS: is the pool right, and does a pick behave like a fixed grant?
 *
 * The design claim is that a picked spell is indistinguishable from a `grantedSpells` entry once
 * chosen — same tracking key, same rest handling — so the sharpest check is the mirror: Fey
 * Touched's fixed Misty Step and a Magic Initiate pick must come back from the same resolver in
 * the same shape.
 *
 * Run: node tools/audit/featspells.mjs <bundled-module-dir-url>
 */
const S = process.argv[2].replace(/\/?$/, '/');
const { featGrantedSpells, featSpellChoices, spellPickOptions, ALL_FEATS } = await import(S + 'feats.mjs');

const BOOKS = ['PHB', 'XGtE', 'TCE', 'PHB2024', 'FToD', 'SCoC', 'ERLW'];
const CHAR = (feats, spells = {}) => ({
  id: 'p', name: 'P', raceId: 'human', backgroundId: 'soldier',
  classes: [{ classId: 'fighter', level: 8 }],
  baseAbilityScores: { str: 14, dex: 14, con: 14, int: 12, wis: 12, cha: 12 },
  selectedFeats: feats, selectedFeatSpells: spells, featChoices: {},
  selectedSkillProficiencies: [], classOptions: {}, inventory: [], resources: [],
  enabledBooks: BOOKS, currentHP: 1, maxHP: 1, tempHP: 0, level: 8,
});

let failures = 0;
const check = (l, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${l}: ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`);
};
const grantOf = (featId, key) =>
  ALL_FEATS.find(f => f.id === featId).grantsSpellPicks.find(g => g.key === key);
const opts = (featId, key) => spellPickOptions(grantOf(featId, key), BOOKS);

// ── Pools are the right LEVEL and the right list.
check('Magic Initiate cantrip pool is all cantrips',
  opts('magic-initiate', 'cantrips').every(s => s.level === 0), true);
check('Magic Initiate spell pool is all 1st level',
  opts('magic-initiate', 'spell').every(s => s.level === 1), true);
check('Artificer Initiate pool is artificer-only',
  opts('artificer-initiate', 'cantrip').every(s => s.classes.includes('artificer')), true);
check('NEGATIVE: the artificer pool is smaller than the six-list pool',
  opts('artificer-initiate', 'cantrip').length < opts('magic-initiate', 'cantrips').length, true);
check('Aberrant Dragonmark pool is sorcerer-only',
  opts('aberrant-dragonmark', 'cantrip').every(s => s.classes.includes('sorcerer')), true);

// ── Filters. The attack-cantrip count is pinned: it comes from a description regex, not a tag,
//    so a reworded spell would otherwise shrink the pool silently.
const sniper = opts('spell-sniper', 'cantrip');
// 11 without Tides of Blood, 13 with it. Asserting BOTH pins the description regex (no 'attack'
// tag exists in the spell data) and proves the book filter is doing something — a bare count
// would pass whether or not enabledBooks was ever consulted.
check('Spell Sniper offers 11 attack cantrips, 13 once ToB is enabled',
  [sniper.length, spellPickOptions(grantOf('spell-sniper', 'cantrip'), [...BOOKS, 'ToB']).length], [11, 13]);
check('Spell Sniper includes Fire Bolt and Eldritch Blast',
  ['fire-bolt', 'eldritch-blast'].every(id => sniper.some(s => s.id === id)), true);
check('NEGATIVE: Spell Sniper excludes non-attack cantrips (Light, Guidance)',
  ['light', 'guidance'].some(id => sniper.some(s => s.id === id)), false);
const rituals = opts('ritual-caster', 'rituals');
check('Ritual Caster offers only ritual-tagged 1st-level spells',
  rituals.length > 0 && rituals.every(s => s.ritual && s.level === 1), true);
check('NEGATIVE: Ritual Caster excludes Magic Missile (1st level, not a ritual)',
  rituals.some(s => s.id === 'magic-missile'), false);
check('Strixhaven cantrips come from the named twelve, not a whole list',
  opts('scoc-strixhaven-initiate', 'cantrips').length, 12);

// ── Counts, including the one that scales.
const counts = (feats, prof) => featSpellChoices(CHAR(feats), prof).map(c => [c.key.split(':')[1], c.count]);
check('Magic Initiate owes 2 cantrips + 1 spell', counts(['magic-initiate'], 3), [['cantrips', 2], ['spell', 1]]);
check('Ritual Caster 2024 count follows the proficiency bonus',
  [counts(['ritual-caster-2024'], 2)[0][1], counts(['ritual-caster-2024'], 5)[0][1]], [2, 5]);
check('NEGATIVE: a fixed-count grant ignores the proficiency bonus',
  [counts(['magic-initiate'], 2)[0][1], counts(['magic-initiate'], 6)[0][1]], [2, 2]);

// ── The mirror: a picked spell resolves exactly like a fixed one.
const fixed = featGrantedSpells(CHAR(['fey-touched']));
const picked = featGrantedSpells(CHAR(['magic-initiate'], { 'magic-initiate:spell': ['bless'] }));
check('a fixed grant resolves', fixed.map(g => [g.featId, g.spellId, g.recharge]), [['fey-touched', 'misty-step', 'long']]);
check('a picked grant resolves in the same shape',
  picked.map(g => [g.featId, g.spellId, g.recharge]), [['magic-initiate', 'bless', 'long']]);
check('both carry featName, which the sheet prints',
  [!!fixed[0].featName, !!picked[0].featName], [true, true]);
check('NEGATIVE: an unpicked grant resolves to nothing', featGrantedSpells(CHAR(['magic-initiate'])), []);
check('NEGATIVE: picks for a feat not taken are ignored',
  featGrantedSpells(CHAR(['tough'], { 'magic-initiate:spell': ['bless'] })), []);
check('cantrip picks carry the cantrip recharge, so no rest tracks them',
  featGrantedSpells(CHAR(['magic-initiate'], { 'magic-initiate:cantrips': ['fire-bolt'] }))[0].recharge, 'cantrip');

// ── Every grant's pool must be non-empty, or the picker renders an empty box.
for (const f of ALL_FEATS) {
  for (const g of f.grantsSpellPicks ?? []) {
    const n = spellPickOptions(g, BOOKS).length;
    if (n < g.count) { failures++; console.log(`FAIL  ${f.id}:${g.key} offers ${n} spells for ${g.count} picks`); }
  }
}
console.log(`ok    every grant's pool covers its pick count`);

console.log(failures ? `\n${failures} FAILURES` : '\nall checks passed');
process.exit(failures ? 1 : 0);
