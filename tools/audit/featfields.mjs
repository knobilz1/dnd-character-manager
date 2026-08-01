/**
 * R6 question, asked of every feat: does anything READ it?
 *
 * Two halves, and the second is the one that matters:
 *  1. Field census — which structured fields exist on the real data, on how many feats.
 *  2. The bare set — feats carrying NO mechanical field at all. Those are either genuinely
 *     narrative (Actor's disguise advantage; there is nothing to track) or a mechanic living
 *     only in `description` prose, which is exactly the shape `recharge` and `grantsProficiency`
 *     had. This list is the audit population.
 */
const FEATS = (await import(process.argv[2])).ALL_FEATS;

/** Fields that make a feat mechanically live. `description`/`id`/`name`/`sourceBook` don't count,
 *  and neither does `prerequisite` — it gates taking the feat, it isn't an effect. */
const EFFECT_FIELDS = [
  'abilityScoreIncrease', 'abilityScoreChoice', 'grantsSpell', 'grantsProficiency',
  'hpBonusPerLevel', 'hpRetroactiveBonusPerPastLevel', 'initiativeBonus', 'speedBonus',
  'passivePerceptionBonus', 'passiveInvestigationBonus', 'grantsSaveForChosenAbility',
  'grantedSpells', 'grantedResources',
];

const census = new Map(EFFECT_FIELDS.map(f => [f, []]));
const bare = [];
for (const f of FEATS) {
  let any = false;
  for (const k of EFFECT_FIELDS) {
    if (f[k] === undefined) continue;
    census.get(k).push(f.id);
    any = true;
  }
  if (!any) bare.push(f);
}

console.log(`# ${FEATS.length} feats\n`);
console.log('## Field census');
for (const [k, ids] of census) console.log(`${String(ids.length).padStart(3)}  ${k}`);

// Accounting assert: every feat is either bare or counted at least once.
const counted = new Set([...census.values()].flat());
console.log(`\ncounted ${counted.size} + bare ${bare.length} = ${counted.size + bare.length} (of ${FEATS.length})`);
if (counted.size + bare.length !== FEATS.length) throw new Error('census does not close');

console.log(`\n## Bare feats — no mechanical field at all (${bare.length})`);
for (const f of bare) {
  const desc = f.description.replace(/\s+/g, ' ').trim();
  console.log(`\n- **${f.name}** (${f.id}, ${f.sourceBook})\n  ${desc}`);
}
