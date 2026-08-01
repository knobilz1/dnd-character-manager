/**
 * Wire the feats that grant a CHOSEN spell. Same guarded insert as the other add_* scripts.
 *
 * The pools are the union of the lists a feat names, not a list the player selects first. Magic
 * Initiate and Strixhaven Initiate both say the picks must come from ONE list; enforcing that
 * needs a list-selector per feat, and the alternative on offer today is no spells at all. Recorded
 * in the type doc rather than left as a silent liberty.
 *
 * Not wired: `spell-sniper-2024` — the 2024 rewrite dropped the cantrip entirely, so it correctly
 * grants no spell. Checked against PHB 2024 p.198–211 rather than assumed from the 2014 twin.
 */
import fs from 'node:fs';

const SIX = "['bard', 'cleric', 'druid', 'sorcerer', 'warlock', 'wizard']";
const G = (o) => `{ ${Object.entries(o).map(([k, v]) => `${k}: ${v}`).join(', ')} }`;

const PLAN = {
  'src/data/feats.ts': {
    'magic-initiate': [
      G({ key: "'cantrips'", label: "'Two cantrips from one class list'", count: 2, level: 0, classIds: SIX, recharge: "'cantrip'", ability: "'cha'" }),
      G({ key: "'spell'", label: "'One 1st-level spell from that same list'", count: 1, level: 1, classIds: SIX, recharge: "'long'", ability: "'cha'" }),
    ],
    'ritual-caster': [
      G({ key: "'rituals'", label: "'Two 1st-level ritual spells from one class list'", count: 2, level: 1, classIds: SIX, ritualOnly: true, recharge: "'cantrip'", ability: "'int'" }),
    ],
    'spell-sniper': [
      G({ key: "'cantrip'", label: "'One cantrip that requires an attack roll'", count: 1, level: 0, classIds: SIX, requiresAttackRoll: true, recharge: "'cantrip'", ability: "'cha'" }),
    ],
    'artificer-initiate': [
      G({ key: "'cantrip'", label: "'One artificer cantrip'", count: 1, level: 0, classIds: "['artificer']", recharge: "'cantrip'", ability: "'int'" }),
      G({ key: "'spell'", label: "'One 1st-level artificer spell'", count: 1, level: 1, classIds: "['artificer']", recharge: "'long'", ability: "'int'" }),
    ],
    'aberrant-dragonmark': [
      G({ key: "'cantrip'", label: "'One sorcerer cantrip'", count: 1, level: 0, classIds: "['sorcerer']", recharge: "'cantrip'", ability: "'con'" }),
      // Short OR long rest, per the feat text; 'short' is the one the rest handlers act on and a
      // long rest restores everything anyway, so the shorter recharge is the correct entry.
      G({ key: "'spell'", label: "'One 1st-level sorcerer spell'", count: 1, level: 1, classIds: "['sorcerer']", recharge: "'short'", ability: "'con'" }),
    ],
    'scoc-strixhaven-initiate': [
      // The five colleges' cantrip lists, unioned. Picking a college first would be a sixth
      // selector for one feat; the table is in the description for the player to follow.
      G({ key: "'cantrips'", label: "'Two cantrips from your Strixhaven college'", count: 2, level: 0,
          spellIds: "['light', 'sacred-flame', 'thaumaturgy', 'fire-bolt', 'prestidigitation', 'ray-of-frost', 'druidcraft', 'guidance', 'mage-hand', 'vicious-mockery', 'chill-touch', 'spare-the-dying']",
          recharge: "'cantrip'", ability: "'int'" }),
      G({ key: "'spell'", label: "'One 1st-level spell from your college\\\\'s lists'", count: 1, level: 1,
          classIds: "['bard', 'cleric', 'druid', 'sorcerer', 'wizard']", recharge: "'long'", ability: "'int'" }),
    ],
  },
  'src/data/feats-phb2024.ts': {
    'magic-initiate-2024': [
      G({ key: "'cantrips'", label: "'Two cantrips from one list'", count: 2, level: 0, classIds: "['cleric', 'druid', 'wizard']", recharge: "'cantrip'", ability: "'wis'" }),
      G({ key: "'spell'", label: "'One level 1 spell from that list'", count: 1, level: 1, classIds: "['cleric', 'druid', 'wizard']", recharge: "'long'", ability: "'wis'" }),
    ],
    'ritual-caster-2024': [
      G({ key: "'rituals'", label: "'Level 1 Ritual spells (proficiency bonus)'", count: 2, countFromProfBonus: true, level: 1, classIds: SIX, ritualOnly: true, recharge: "'cantrip'", ability: "'int'" }),
    ],
  },
};

const problems = [];
const staged = [];
for (const [file, feats] of Object.entries(PLAN)) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const inserts = [];
  for (const [id, grants] of Object.entries(feats)) {
    const hits = lines.map((l, i) => (l.trim() === `id: '${id}',` ? i : -1)).filter(i => i >= 0);
    if (hits.length !== 1) { problems.push(`${id}: found ${hits.length} definitions, expected 1`); continue; }
    let end = hits[0];
    while (end < lines.length && lines[end] !== '  },') end++;
    if (end >= lines.length) { problems.push(`${id}: no closing brace`); continue; }
    if (lines.slice(hits[0], end).join('\n').includes('grantsSpellPicks')) { problems.push(`${id}: already wired`); continue; }
    inserts.push({ at: end, block: `    grantsSpellPicks: [\n${grants.map(g => `      ${g},`).join('\n')}\n    ],` });
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
