/**
 * Every feat counter, end to end: does it exist, does it scale, and does the right rest refill it?
 *
 * The bug this guards against is the one `recharge` had for months — a field populated, displayed,
 * and never acted on. So the checks are on BEHAVIOUR: the pool a level-13 character would see, and
 * which rest key it lands under. A probe that only asserted "the feat has a grantedResources
 * field" would have passed on the day Lucky 2024 handed out a flat 4 instead of a prof bonus.
 */
const { computeCharacterDerived } = await import(process.argv[2]);
const FEATS = (await import(process.argv[3])).ALL_FEATS;

const CHAR = (feats, level) => ({
  id: 'p', name: 'P', raceId: 'human', backgroundId: 'soldier',
  classes: [{ classId: 'fighter', level, subclassId: 'champion' }],
  baseAbilityScores: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8 },
  selectedFeats: feats, featChoices: {}, selectedSkillProficiencies: [],
  classOptions: { fightingStyles: [], invocations: [], metamagic: [], maneuvers: [], infusions: [], optionalFeatures: [] },
  inventory: [], currencies: {}, hitDiceUsed: {}, resources: [],
  enabledBooks: ['PHB', 'XGtE', 'TCE', 'PHB2024', 'FToD', 'SCoC', 'ERLW'],
  currentHP: 1, maxHP: 1, tempHP: 0, level,
});

let failures = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}: ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`);
};

// ── Every counter is reachable, and no two feats collide on a key.
const owners = new Map();
for (const f of FEATS) for (const r of f.grantedResources ?? []) {
  if (owners.has(r.key)) failures++, console.log(`FAIL  key "${r.key}" claimed by both ${owners.get(r.key)} and ${f.id}`);
  owners.set(r.key, f.id);
}
console.log(`ok    ${owners.size} feat counters across ${new Set([...owners.values()]).size} feats, no key collisions`);

// The class pools these must NOT stomp. Metamagic Adept and Martial Adept deliberately use their
// own keys; if either ever adopts the class key, a sorcerer/battle master silently loses the feat.
check('metamagic-adept avoids the sorcerer pool', owners.get('sorcery_points'), undefined);
check('martial-adept avoids the battle master pool', owners.get('superiority_dice'), undefined);

// ── Prof-bonus counters scale. Fighter 5 => +3, fighter 13 => +5.
const pool = (featId, key, level) => computeCharacterDerived(CHAR([featId], level)).resourceMaxOverrides[key];
for (const [featId, key] of [
  ['lucky-2024', 'luck_points'], ['chef', 'chef_treats'], ['poisoner', 'poisoner_doses'],
  ['gift-of-the-chromatic-dragon', 'reactive_resistance'],
  ['gift-of-the-gem-dragon', 'telekinetic_reprisal'],
  ['gift-of-the-metallic-dragon', 'protective_wings'],
]) {
  check(`${featId} → ${key} scales 3@lv5 → 5@lv13`, [pool(featId, key, 5), pool(featId, key, 13)], [3, 5]);
}

// ── Negative controls: the flat counters must NOT be scaled, and a feat you don't hold gives none.
check('NEGATIVE: 2014 Lucky stays flat (no override)', pool('lucky', 'lucky_points', 13), undefined);
check('NEGATIVE: Chromatic Infusion is 1/rest, not prof', pool('gift-of-the-chromatic-dragon', 'chromatic_infusion', 13), undefined);
check('NEGATIVE: not holding Chef grants no pool', pool('lucky', 'chef_treats', 13), undefined);

// ── Rest routing: a 'short' counter must be short, a 'long' one must not be.
const rest = (key) => FEATS.flatMap(f => f.grantedResources ?? []).find(r => r.key === key)?.rechargeOn;
check('Guarded Mind recharges on a short rest', rest('guarded_mind'), 'short');
check('Improve Fate recharges on a short rest', rest('improve_fate'), 'short');
check('Martial Adept die recharges on a short rest', rest('martial_adept_dice'), 'short');
check('NEGATIVE: Luck Points do NOT recharge on a short rest', rest('luck_points'), 'long');
check('NEGATIVE: Chef treats do NOT recharge on a short rest', rest('chef_treats'), 'long');

console.log(failures ? `\n${failures} FAILURES` : '\nall checks passed');
process.exit(failures ? 1 : 0);
