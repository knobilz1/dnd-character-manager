/**
 * Give the eleven feats that describe a counter an actual counter.
 *
 * Inserts a `grantedResources` line before the closing `  },` of each named feat. Every feat
 * object in these two files is a FLAT literal — the only nested values (`prerequisite`,
 * `grantedSpells`) are written on one line — so `^  \},$` reliably ends an entry. The script
 * asserts it found each id exactly once and that no id already has the field, then refuses to
 * write anything if any check fails: a partial rewrite of a data file is worse than no rewrite.
 */
import fs from 'node:fs';

const R = (key, name, max, rechargeOn) =>
  `    grantedResources: [{ key: '${key}', name: '${name}', max: ${max}, rechargeOn: '${rechargeOn}' }],`;
const R2 = (a, b) => `    grantedResources: [\n${a.replace('    grantedResources: [', '      ').replace(/\],$/, ',')}\n${b.replace('    grantedResources: [', '      ').replace(/\],$/, ',')}\n    ],`;

/** `max` here is the level-1 seed for prof-bonus counters; resourceMaxOverrides carries the truth. */
const PLAN = {
  'src/data/feats.ts': {
    'chef':                          R('chef_treats', 'Chef Treats', 2, 'long'),
    'poisoner':                      R('poisoner_doses', 'Poison Doses', 2, 'long'),
    'gift-of-the-chromatic-dragon':  R2(R('chromatic_infusion', 'Chromatic Infusion', 1, 'long'),
                                        R('reactive_resistance', 'Reactive Resistance', 2, 'long')),
    'gift-of-the-gem-dragon':        R('telekinetic_reprisal', 'Telekinetic Reprisal', 2, 'long'),
    'gift-of-the-metallic-dragon':   R('protective_wings', 'Protective Wings', 2, 'long'),
    // ponytail: own keys rather than adding to the sorcerer / battle master pools. RAW they
    // pool together, but the load-time insert skips a key that already exists, so a sorcerer
    // taking Metamagic Adept would silently get nothing. Two counters that obviously add up
    // beats one counter that's wrong for exactly the characters most likely to take the feat.
    'metamagic-adept':               R('metamagic_adept_points', 'Sorcery Points (Metamagic Adept)', 2, 'long'),
    'martial-adept':                 R('martial_adept_dice', 'Superiority Die (Martial Adept)', 1, 'short'),
    'scoc-strixhaven-mascot':        R('mascot_teleport', 'Mascot Teleport', 1, 'long'),
  },
  'src/data/feats-phb2024.ts': {
    'mage-slayer-2024':              R('guarded_mind', 'Guarded Mind', 1, 'short'),
    'boon-of-fate':                  R('improve_fate', 'Improve Fate', 1, 'short'),
    'boon-of-recovery':              R2(R('last_stand', 'Last Stand', 1, 'long'),
                                        R('recover_vitality', 'Recover Vitality (d10s)', 10, 'long')),
  },
};

const problems = [];
const staged = [];
for (const [file, feats] of Object.entries(PLAN)) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const inserts = [];
  for (const [id, block] of Object.entries(feats)) {
    const hits = lines.map((l, i) => (l.trim() === `id: '${id}',` ? i : -1)).filter(i => i >= 0);
    if (hits.length !== 1) { problems.push(`${id}: found ${hits.length} definitions, expected 1`); continue; }
    let end = hits[0];
    while (end < lines.length && lines[end] !== '  },') end++;
    if (end >= lines.length) { problems.push(`${id}: no closing brace found`); continue; }
    const body = lines.slice(hits[0], end).join('\n');
    if (body.includes('grantedResources')) { problems.push(`${id}: already has grantedResources`); continue; }
    inserts.push({ at: end, block });
  }
  // Insert from the bottom up so earlier indices stay valid.
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
  console.log(`${file}: added ${n} feat resource blocks`);
}
