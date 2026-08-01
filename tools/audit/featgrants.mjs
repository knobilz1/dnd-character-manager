/**
 * Which feats hand out something the app already has a SYSTEM for, and carry no field for it?
 *
 * The app now tracks skills, expertise, languages, tools, armour/weapon proficiency, fighting
 * styles, invocations, metamagic, maneuvers, spells and resources. A feat whose text grants one of
 * those but whose data carries no corresponding field is prose the sheet cannot act on — the same
 * shape as "one extra language of your choice" printing on a character sheet.
 *
 * Matching is on the DESCRIPTION, deliberately generous, because a false positive costs one line
 * of reading and a false negative hides a bug. Every hit is triaged by hand.
 */
const FEATS = (await import(process.argv[2])).ALL_FEATS;

/** system → [regex over the description, field(s) that would carry it] */
const SYSTEMS = [
  ['skill',          /proficiency in .{0,40}\bskills?\b|\bskills? (of your choice|proficienc)/i, ['grantsProficiency']],
  ['expertise',      /\bexpertise\b/i,                                            ['grantsProficiency']],
  ['language',       /\blanguages?\b/i,                                           ['grantsProficiency']],
  ['tool',           /artisan'?s? tools|\btools?\b|musical instrument|gaming set/i, ['grantsProficiency']],
  ['armour',         /\b(light|medium|heavy) armor\b/i,                           ['grantsProficiency']],
  ['weapon prof',    /proficiency with .{0,30}weapon/i,                           ['grantsProficiency']],
  ['fighting style', /fighting style/i,                                           []],
  ['invocation',     /eldritch invocation/i,                                      []],
  ['metamagic',      /metamagic|sorcery point/i,                                  ['grantedResources']],
  ['maneuver',       /\bmaneuver\b|superiority di/i,                              ['grantedResources']],
  ['spell',          /you learn .{0,30}\bspell|learn the .{0,30}\bspell|\bcantrips?\b|always (have .{0,20})?prepared/i, ['grantedSpells']],
  ['resource',       /\bonce\b.{0,60}\b(long|short) rest|\buses? equal to\b|number of .{0,30}equal to your proficiency/i, ['grantedResources']],
];

let gaps = 0, covered = 0;
const rows = [];
for (const f of FEATS) {
  for (const [system, re, fields] of SYSTEMS) {
    if (!re.test(f.description)) continue;
    const has = fields.filter(k => f[k] !== undefined);
    // A placeholder string in grantsProficiency is not coverage: "3 skills or tools of your
    // choice" is prose in a field, and reads as a literal proficiency name to every consumer.
    const placeholder = (f.grantsProficiency ?? []).some(g => /choice|choose|^\d|\bone\b|\btwo\b|\bthree\b|\bfour\b/i.test(g));
    const ok = has.length > 0 && !(fields.includes('grantsProficiency') && placeholder);
    if (ok) { covered++; continue; }
    gaps++;
    rows.push({ id: f.id, book: f.sourceBook, system, note: placeholder ? 'PLACEHOLDER STRING' : 'no field' });
  }
}

console.log(`${FEATS.length} feats | ${covered} system claims covered | ${gaps} gaps\n`);
const byId = new Map();
for (const r of rows) {
  if (!byId.has(r.id)) byId.set(r.id, []);
  byId.get(r.id).push(`${r.system}${r.note === 'PLACEHOLDER STRING' ? ' (PLACEHOLDER)' : ''}`);
}
for (const [id, systems] of byId) {
  const f = FEATS.find(x => x.id === id);
  console.log(`${id.padEnd(34)} [${f.sourceBook.padEnd(8)}] ${systems.join(', ')}`);
}
