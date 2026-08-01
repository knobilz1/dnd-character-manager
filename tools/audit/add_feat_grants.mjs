/**
 * Wire the tool / language / weapon grants that feats describe in prose.
 *
 * Same insert mechanic as add_feat_resources.mjs: flat literals, `^  \},$` ends an entry, and the
 * script refuses to write at all if any id is missing, duplicated, or already carries the field.
 *
 * Deliberately NOT wired: Gunner ("firearms") and Tavern Brawler ("improvised weapons"). The
 * weapon catalog contains neither, and `isProficientWithWeapon` returns true for weapons it does
 * not know — so those grants would change nothing in either direction. Recorded here rather than
 * silently omitted.
 */
import fs from 'node:fs';

const PLAN = {
  'src/data/feats.ts': {
    'chef':                { grantsTools: ["Cook's utensils"] },
    'poisoner':            { grantsTools: ["Poisoner's kit"] },
    'artificer-initiate':  { grantsTools: ["One type of artisan's tools of your choice"] },
    'linguist':            { grantsLanguages: 3 },
  },
  'src/data/feats-phb2024.ts': {
    'chef-2024':                   { grantsTools: ["Cook's utensils"] },
    'poisoner-2024':               { grantsTools: ["Poisoner's kit"] },
    'crafter-2024':                { grantsTools: ["Three artisan's tools of your choice"] },
    'musician-2024':               { grantsTools: ['Three musical instruments of your choice'] },
    'martial-weapon-training-2024':{ grantsProficiency: ['Martial weapons'] },
  },
};

const render = (fields) => Object.entries(fields)
  .map(([k, v]) => `    ${k}: ${typeof v === 'number' ? v : JSON.stringify(v).replace(/","/g, '", "')},`)
  .join('\n');

const problems = [];
const staged = [];
for (const [file, feats] of Object.entries(PLAN)) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const inserts = [];
  for (const [id, fields] of Object.entries(feats)) {
    const hits = lines.map((l, i) => (l.trim() === `id: '${id}',` ? i : -1)).filter(i => i >= 0);
    if (hits.length !== 1) { problems.push(`${id}: found ${hits.length} definitions, expected 1`); continue; }
    let end = hits[0];
    while (end < lines.length && lines[end] !== '  },') end++;
    if (end >= lines.length) { problems.push(`${id}: no closing brace`); continue; }
    const body = lines.slice(hits[0], end).join('\n');
    const clash = Object.keys(fields).find(k => body.includes(`${k}:`));
    if (clash) { problems.push(`${id}: already has ${clash}`); continue; }
    inserts.push({ at: end, block: render(fields) });
  }
  inserts.sort((a, b) => b.at - a.at);
  for (const { at, block } of inserts) lines.splice(at, 0, block);
  staged.push([file, lines.join('\n'), inserts.length]);
}

if (problems.length) {
  console.error('REFUSING TO WRITE:\n  ' + problems.join('\n  '));
  process.exit(1);
}
for (const [file, text, n] of staged) {
  fs.writeFileSync(file, text);
  console.log(`${file}: wired ${n} feats`);
}
