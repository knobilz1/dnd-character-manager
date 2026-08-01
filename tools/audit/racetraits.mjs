/**
 * Race traits vs the source books: does the app name traits the book doesn't, miss traits it does,
 * and do the NUMBERS agree?
 *
 * Deliberately not a prose diff. The reference extracts are summaries, not verbatim text, so a
 * word-level comparison would be noise from end to end. What survives that is exactly the part
 * that matters: the set of trait names, and the numbers inside them (60 ft, DC 8 + …, once per
 * long rest, level gates).
 *
 * PAIRING IS GATED. The sweep refuses to report a comparison until it has matched a source
 * section to a race, and prints matched/total per book, because "0 mismatches" over 3% pairing is
 * the failure mode this audit has hit before — a clean result is worthless if the two sides never
 * met.
 *
 * Run: node tools/audit/racetraits.mjs <races.mjs url> [bookId]
 */
import fs from 'node:fs';
import path from 'node:path';

const MD = 'C:/Users/nabil/Desktop/Code/reference-books/md';
const BOOK_FILE = {
  PHB: 'phb-players-handbook.md',
  PHB2024: 'phb2024-players-handbook.md',
  MMoM: 'mmom-monsters-of-the-multiverse.md',
  VGM: 'vgm-volos-guide-to-monsters.md',
  ERLW: 'erlw-eberron-rising-last-war.md',
  SCAG: 'scag-sword-coast-adventurers-guide.md',
  EGtW: 'egtw-explorers-guide-wildemount.md',
  FToD: 'ftod-fizbans-treasury-of-dragons.md',
  GGR: 'ggr-guildmasters-guide-ravnica.md',
  SCoC: 'scoc-strixhaven-curriculum-of-chaos.md',
  MToF: 'mtof-mordenkainens-tome-of-foes.md',
  // No reference markdown exists for these; their races cannot be compared at all.
  SJA: null,
  AcqInc: null,
};

/** U+2019 vs ' made "Thieves' Cant" look missing in an earlier sweep. Normalise both sides. */
const norm = (s) => s
  .replace(/[\u2018\u2019\u02BC]/g, "'")
  .replace(/[\u201C\u201D]/g, '"')
  .replace(/[\u2013\u2014]/g, '-')
  .replace(/\s+/g, ' ')
  .trim();

/** Every heading in a book, with the slice of text it owns (bounded by the next same-or-higher
 *  heading — a race nested at #### under another race's ### must not swallow its siblings). */
function sections(text) {
  const lines = text.split(/\r?\n/);
  const heads = [];
  lines.forEach((l, i) => {
    const m = /^(#{2,5})\s+(.*)$/.exec(l);
    if (m) heads.push({ depth: m[1].length, title: norm(m[2]), line: i });
  });
  return heads.map((h, i) => {
    let end = lines.length;
    for (let j = i + 1; j < heads.length; j++) {
      if (heads[j].depth <= h.depth) { end = heads[j].line; break; }
    }
    return { ...h, body: lines.slice(h.line + 1, end).join('\n') };
  });
}

/** "### Aasimar (p. 186)" → "aasimar"; "### Duergar (Dwarf Subrace) - p. 105" → "duergar". */
const headKey = (title) => norm(title)
  .replace(/\(.*?\)/g, ' ')
  .replace(/[-–—]?\s*pp?\.\s*[\d–-]+/gi, ' ')
  .replace(/\bsubrace\b|\bvariants?\b|\bspecies\b/gi, ' ')
  .replace(/[^a-z0-9 ]/gi, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

/** Trait entries in a section body: "**Darkvision.** 60 ft." and "- **Heavenly Wings.** …". */
function sourceTraits(body) {
  const out = new Map();
  for (const m of body.matchAll(/^\s*[-*]?\s*\*\*(.+?)\.?\*\*\s*(.*)$/gm)) {
    const name = norm(m[1]).replace(/\s*\(.*?\)\s*$/, '').replace(/[.:]$/, '');
    if (!name || name.length > 60) continue;
    out.set(name.toLowerCase(), norm(m[2]));
  }
  return out;
}

/** Numbers that carry meaning, normalised. Ignores page refs and bare list markers. */
const numbers = (s) => [...norm(s).matchAll(/\b(\d+)\s*(ft|feet|d\d+|hp|hit points|minutes?|hours?|days?)?\b/gi)]
  .map(m => (m[2] ? `${m[1]}${m[2].toLowerCase().replace('feet', 'ft').replace('hit points', 'hp')}` : m[1]));

// ── load the app's races at runtime ──────────────────────────────────────────
const ALL = (await import(process.argv[2])).ALL_RACES;
const only = process.argv[3];
const flat = [];
const walk = (r) => { flat.push(r); (r.subraces ?? []).forEach(walk); };
ALL.forEach(walk);

const bookCache = new Map();
const sectionsFor = (book) => {
  if (bookCache.has(book)) return bookCache.get(book);
  const file = BOOK_FILE[book];
  const v = file && fs.existsSync(path.join(MD, file)) ? sections(fs.readFileSync(path.join(MD, file), 'utf8')) : null;
  bookCache.set(book, v);
  return v;
};

/** A race matches a heading when the heading key contains the race's distinctive words. */
function findSection(race, secs) {
  const key = headKey(race.name);
  const words = key.split(' ').filter(w => w.length > 2);
  let best = null;
  for (const s of secs) {
    const sk = headKey(s.title);
    if (!sk) continue;
    if (sk === key) return s;
    const hit = words.filter(w => sk.includes(w)).length;
    if (hit === words.length && words.length > 0) { if (!best || s.body.length > best.body.length) best = s; }
  }
  return best;
}

const stats = {};
const findings = [];
let paired = 0, unpaired = 0, noBook = 0;

const byId = new Map(flat.map(r => [r.id, r]));

for (const race of flat) {
  if (only && race.sourceBook !== only) continue;
  const st = stats[race.sourceBook] ??= { paired: 0, total: 0, noBook: 0 };
  st.total++;
  const secs = sectionsFor(race.sourceBook);
  if (!secs) { st.noBook++; noBook++; continue; }
  // A SUBRACE carries its parent's traits as well as its own, and the book prints those once
  // under the parent. Searching only the subrace's section reported every High Elf inheriting
  // Darkvision and Keen Senses as "not in source" — 117 findings, none of them real. The parent
  // section is also the fallback when a subrace has no heading of its own, which is how the books
  // print Lightfoot and Stout.
  const parent = race.parentRaceId ? byId.get(race.parentRaceId) : null;
  const own = findSection(race, secs);
  const parentSec = parent ? findSection(parent, secs) : null;
  const sec = own ?? parentSec;
  if (!sec) { unpaired++; findings.push({ kind: 'UNPAIRED', race: race.name, book: race.sourceBook }); continue; }
  paired++; st.paired++;

  const body = [own?.body, parentSec?.body].filter(Boolean).join('\n');
  const src = sourceTraits(body);
  const srcAll = norm(body).toLowerCase();
  for (const t of race.traits ?? []) {
    const name = norm(t.name).replace(/\s*\(.*?\)\s*$/, '').toLowerCase();
    const entry = src.get(name);
    if (entry === undefined) {
      // The name may still appear in prose rather than as a bolded entry.
      if (!srcAll.includes(name)) {
        findings.push({ kind: 'TRAIT NOT IN SOURCE', race: race.name, book: race.sourceBook, trait: t.name });
      }
      continue;
    }
    const appN = numbers(t.description), srcN = numbers(entry);
    const missing = srcN.filter(n => !appN.includes(n));
    const extra = appN.filter(n => !srcN.includes(n));
    // Only flag when the SOURCE states a number the app doesn't. Extra numbers in the app are
    // expected: the extracts are summaries, so the app's fuller text legitimately says more.
    if (missing.length) {
      findings.push({ kind: 'NUMBER MISSING', race: race.name, book: race.sourceBook, trait: t.name,
                      missing, extra, src: entry.slice(0, 120), app: norm(t.description).slice(0, 120) });
    }
  }
}

console.log(`# ${paired + unpaired + noBook} races considered\n`);
console.log('| book | paired | total | no reference |');
console.log('|---|---|---|---|');
for (const [b, s] of Object.entries(stats).sort()) {
  const thin = s.noBook === 0 && s.paired / s.total < 0.8 ? '  ⚠ THIN' : '';
  console.log(`| ${b} | ${s.paired} | ${s.total} | ${s.noBook} |${thin}`);
}
console.log(`\npaired ${paired} + unpaired ${unpaired} + no-reference ${noBook} = ${paired + unpaired + noBook}`);
if (paired + unpaired + noBook !== flat.filter(r => !only || r.sourceBook === only).length) {
  throw new Error('accounting does not close');
}
if (paired === 0) { console.log('\nNOTHING PAIRED — findings below would be meaningless.'); process.exit(1); }

const byKind = {};
for (const f of findings) (byKind[f.kind] ??= []).push(f);
for (const [kind, list] of Object.entries(byKind)) {
  console.log(`\n## ${kind} (${list.length})`);
  for (const f of list) {
    console.log(`- **${f.race}** [${f.book}]${f.trait ? ` — ${f.trait}` : ''}`);
    if (f.missing) {
      console.log(`    source has ${JSON.stringify(f.missing)}, app does not`);
      console.log(`    src: ${f.src}`);
      console.log(`    app: ${f.app}`);
    }
  }
}
console.log(`\n${findings.length} findings over ${paired} paired races`);
