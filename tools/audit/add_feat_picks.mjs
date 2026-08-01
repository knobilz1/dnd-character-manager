/**
 * Wire the skill / expertise picks. Same guarded insert as the other two scripts.
 *
 * Pools are written as EXPRESSIONS over the real catalogs (SKILL_NAMES, ARTISAN_TOOLS…) rather
 * than as hand-typed lists, so a skill or tool added later is offered automatically and cannot
 * drift out of sync — the failure mode that made `placeholderPicks` necessary for languages.
 */
import fs from 'node:fs';

const SKILLS = 'SKILL_NAMES';
const TOOLS = '...ARTISAN_TOOLS, ...MUSICAL_INSTRUMENTS, ...GAMING_SETS';

const PLAN = {
  'src/data/feats.ts': {
    'skilled': {
      grantsPicks: `{ count: 3, label: 'Three skills or tools of your choice', options: [...${SKILLS}, ${TOOLS}] }`,
    },
    'skill-expert': {
      grantsPicks: `{ count: 1, label: 'One skill of your choice', options: [...${SKILLS}] }`,
      grantsExpertise: '1',
    },
    'prodigy': {
      grantsPicks: `{ count: 1, label: 'One skill of your choice', options: [...${SKILLS}] }`,
      grantsExpertise: '1',
      grantsTools: `["One type of artisan's tools of your choice"]`,
      grantsLanguages: '1',
    },
    'squat-nimbleness': {
      grantsPicks: `{ count: 1, label: 'Acrobatics or Athletics', options: ['Acrobatics', 'Athletics'] }`,
    },
    'weapon-master': {
      grantsPicks: `{ count: 4, label: 'Four weapons of your choice', options: [...WEAPON_NAMES] }`,
    },
  },
  'src/data/feats-phb2024.ts': {
    'skilled-2024': {
      grantsPicks: `{ count: 3, label: 'Any combination of 3 skills or tools', options: [...${SKILLS}, ${TOOLS}] }`,
    },
    'skill-expert-2024': {
      grantsPicks: `{ count: 1, label: 'One skill of your choice', options: [...${SKILLS}] }`,
      grantsExpertise: '1',
    },
    'keen-mind-2024': {
      grantsPicks: `{ count: 1, label: 'Lore Knowledge — one skill', options: ['Arcana', 'History', 'Investigation', 'Nature', 'Religion'] }`,
    },
    'observant-2024': {
      grantsPicks: `{ count: 1, label: 'Keen Observer — one skill', options: ['Insight', 'Investigation', 'Perception'] }`,
    },
    // count === options.length, so the derive grants all eighteen outright rather than making
    // the player click every skill in a picker that has no alternative.
    'boon-of-skill': {
      grantsPicks: `{ count: ${SKILLS}.length, label: 'Proficiency in all skills', options: [...${SKILLS}] }`,
      grantsExpertise: '1',
    },
  },
};

const render = (fields) => Object.entries(fields).map(([k, v]) => `    ${k}: ${v},`).join('\n');

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
