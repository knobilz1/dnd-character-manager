/**
 * Mirror-image probe for the 2024 feat fixes.
 *
 * Every bug fixed here was "the 2014 feat works, its 2024 twin does nothing". So each case runs
 * the SAME character twice — once holding the 2014 feat, once the 2024 one — and the proof is
 * that the two now agree. A probe that only ran the 2024 side could not tell a fix from a
 * coincidence, and one that only asserted a number would pass if BOTH editions were broken.
 *
 * Run: node tools/audit/featmirror.mjs <derived.mjs url>
 */
const { computeCharacterDerived } = await import(process.argv[2]);

const BASE = {
  id: 'probe', name: 'Probe', raceId: 'human', backgroundId: 'soldier',
  classes: [{ classId: 'fighter', level: 8, subclassId: 'champion' }],
  baseAbilityScores: { str: 16, dex: 16, con: 14, int: 10, wis: 12, cha: 8 },
  selectedFeats: [], featChoices: {}, selectedSkillProficiencies: [],
  classOptions: { fightingStyles: [], invocations: [], metamagic: [], maneuvers: [], infusions: [], optionalFeatures: [] },
  inventory: [], currencies: {}, hitDiceUsed: {}, resources: [],
  enabledBooks: ['PHB', 'XGtE', 'TCE', 'PHB2024', 'FToD'],
  currentHP: 1, maxHP: 1, tempHP: 0, level: 8,
};

const withFeats = (feats, extra = {}) => ({ ...BASE, ...extra, selectedFeats: feats });
const CHAIN = { name: 'Chain mail', category: 'armor', equipped: true, quantity: 1 };
const HALFPLATE = { name: 'Half plate armor', category: 'armor', equipped: true, quantity: 1 };

let failures = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

// ── Tough: HP per level. The derive exposes it via the feat fields, so compare the raw data.
const featsMod = await import(process.argv[3]);
const feat = (id) => featsMod.ALL_FEATS.find(f => f.id === id);
check('Tough hpBonusPerLevel 2014 vs 2024',
  [feat('tough').hpBonusPerLevel, feat('tough-2024').hpBonusPerLevel], [2, 2]);
check('Tough retroactive 2014 vs 2024',
  [feat('tough').hpRetroactiveBonusPerPastLevel, feat('tough-2024').hpRetroactiveBonusPerPastLevel], [2, 2]);

// ── Spell grants. Negative control: a feat with no spell must stay empty.
const spellIds = (id) => (feat(id).grantedSpells ?? []).map(g => g.spellId);
check('fey-touched 2014 vs 2024 grant misty step',
  [spellIds('fey-touched'), spellIds('fey-touched-2024')], [['misty-step'], ['misty-step']]);
check('shadow-touched 2014 vs 2024 grant invisibility',
  [spellIds('shadow-touched'), spellIds('shadow-touched-2024')], [['invisibility'], ['invisibility']]);
check('telekinetic 2014 vs 2024 grant mage hand',
  [spellIds('telekinetic'), spellIds('telekinetic-2024')], [['mage-hand'], ['mage-hand']]);
check('telepathic 2014 vs 2024 grant detect thoughts',
  [spellIds('telepathic'), spellIds('telepathic-2024')], [['detect-thoughts'], ['detect-thoughts']]);
check('NEGATIVE: grappler grants no spell', spellIds('grappler'), []);

// ── Alert: initiative. Fighter 8 => prof +3, dex 16 => +3.
const initOf = (feats) => computeCharacterDerived(withFeats(feats)).initiative;
check('Alert 2014 = dex+5', initOf(['alert']), 3 + 5);
check('Alert 2024 = dex+prof', initOf(['alert-2024']), 3 + 3);
check('NEGATIVE: no alert = dex only', initOf([]), 3);

// ── Lucky: pool size = prof bonus in 2024, flat 3 in 2014.
const luck = (feats, key) => computeCharacterDerived(withFeats(feats)).resourceMaxOverrides[key];
check('Lucky 2024 pool = prof bonus (3 at level 8)', luck(['lucky-2024'], 'luck_points'), 3);
check('NEGATIVE: 2014 Lucky has no override', luck(['lucky'], 'lucky_points'), undefined);

// ── Medium Armor Master: half plate is dexCap 2, so AC 15+2=17 without, 15+3=18 with.
const acOf = (feats, armor) => computeCharacterDerived(withFeats(feats, { inventory: [armor] })).ac;
check('Half plate, no feat', acOf([], HALFPLATE), 17);
check('Half plate + MAM 2014', acOf(['medium-armor-master'], HALFPLATE), 18);
check('Half plate + MAM 2024', acOf(['medium-armor-master-2024'], HALFPLATE), 18);
check('NEGATIVE: chain mail (heavy) ignores MAM', acOf(['medium-armor-master-2024'], CHAIN), 16);

// ── Defense fighting style: +1 AC in armour, from either the class option or the 2024 feat.
const acStyle = (opts, feats) => computeCharacterDerived({
  ...withFeats(feats, { inventory: [CHAIN] }),
  classOptions: { ...BASE.classOptions, fightingStyles: opts },
}).ac;
check('Chain mail, no style', acStyle([], []), 16);
check('Chain mail + Defense as class option', acStyle(['defense'], []), 17);
check('Chain mail + Defense as 2024 feat', acStyle([], ['fighting-style-defense-2024']), 17);
check('NEGATIVE: a different style feat gives no AC', acStyle([], ['fighting-style-archery-2024']), 16);
check('NEGATIVE: not double-counted when held both ways',
  acStyle(['defense'], ['fighting-style-defense-2024']), 17);

console.log(failures ? `\n${failures} FAILURES` : '\nall checks passed');
process.exit(failures ? 1 : 0);
