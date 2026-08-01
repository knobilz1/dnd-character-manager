/**
 * Coverage: which feats hand out something the app has a SYSTEM for, and carry no field for it?
 *
 * Matching is on the DESCRIPTION and deliberately generous — a false positive costs one line of
 * reading, a false negative hides a bug. Every hit is triaged by hand; the value is the LIST, not
 * the count, because the population nobody has checked is where the bugs are.
 */
const FEATS = (await import(process.argv[2])).ALL_FEATS;

/** system → [regex over the description, fields that would carry it] */
const SYSTEMS = [
  ['skill',          /proficiency in .{0,40}\bskills?\b|\bskills? (of your choice|proficienc)/i, ['grantsPicks']],
  ['expertise',      /\bexpertise\b/i,                                            ['grantsExpertise']],
  ['language',       /\blanguages? (of your choice|you know)|learn .{0,12}languages/i, ['grantsLanguages']],
  ['tool',           /artisan'?s? tools|\btools?\b|musical instrument|gaming set|utensils|\bkit\b/i, ['grantsTools', 'grantsPicks']],
  ['armour',         /\b(light|medium|heavy) armor (training|proficiency)|proficiency with .{0,12}armor/i, ['grantsProficiency']],
  ['weapon prof',    /proficiency with .{0,30}weapon|weapons of your choice|all Martial weapons/i, ['grantsProficiency', 'grantsPicks']],
  ['fighting style', /fighting style option/i,                                    ['grantsPicks']],
  ['invocation',     /eldritch invocation/i,                                      ['grantsPicks']],
  ['metamagic',      /metamagic option/i,                                         ['grantsPicks']],
  ['maneuver',       /\bmaneuvers? of your choice\b/i,                            ['grantsPicks']],
  ['spell',          /you learn .{0,30}\bspell|learn the .{0,30}\bspell|\bcantrips?\b|always (have .{0,20})?prepared/i, ['grantedSpells', 'grantsSpellPicks']],
  // A spell that recharges on a rest is tracked BY that spell's entry, not by a separate counter —
  // so grantedSpells/grantsSpellPicks satisfy the resource claim too. Without this the probe
  // reported Fey Touched as an untracked resource while its Misty Step was tracked correctly.
  ['resource',       /\bonce\b.{0,60}\b(long|short) rest|\buses? equal to\b|number of .{0,30}equal to your proficiency/i, ['grantedResources', 'grantedSpells', 'grantsSpellPicks']],
];

let gaps = 0, covered = 0;
const byId = new Map();
for (const f of FEATS) {
  for (const [system, re, fields] of SYSTEMS) {
    if (!re.test(f.description)) continue;
    if (fields.some(k => f[k] !== undefined)) { covered++; continue; }
    gaps++;
    if (!byId.has(f.id)) byId.set(f.id, []);
    byId.get(f.id).push(system);
  }
}

console.log(`${FEATS.length} feats | ${covered} system claims covered | ${gaps} still uncovered\n`);
for (const [id, systems] of byId) {
  const f = FEATS.find(x => x.id === id);
  console.log(`${id.padEnd(34)} [${f.sourceBook.padEnd(8)}] ${systems.join(', ')}`);
}
