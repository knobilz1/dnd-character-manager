/**
 * Phase G8 — every spell REFERENCE resolves to a real spell.
 *
 * G5 checked the forward direction (spell.classes[] naming real classes). This is the reverse:
 * anything that points AT a spell by id — racial innate spells, subclass domain/patron/land
 * lists, feat-granted spells. A dangling id here silently drops the spell from a sheet with no
 * error anywhere.
 *
 * Runs against the REAL loaded modules, not a TS parse. Paste into the dev-server page console
 * (or drive it over CDP) with the app running on :5173.
 *
 * WATCH THE POPULATION COUNT, NOT JUST THE RESULT. The first version of this checked only
 * `alwaysPrepared`/`innateSpells` and reported "129 refs, clean" — but the real key is
 * `alwaysPreparedSpells`, and it holds a LEVEL-KEYED OBJECT rather than an array, so the largest
 * population (362 subclass spell references) was invisible while the check looked green.
 * Correct total is 615.
 */
(async () => {
  const t = Date.now();
  const [S, R, C, SC, F, IV, IN, B] = await Promise.all([
    import('/src/data/spells/index.ts?t=' + t),
    import('/src/data/races/index.ts?t=' + t),
    import('/src/data/classes/index.ts?t=' + t),
    import('/src/data/subclasses/index.ts?t=' + t),
    import('/src/data/feats.ts?t=' + t),
    import('/src/data/invocations.ts?t=' + t),
    import('/src/data/infusions.ts?t=' + t),
    import('/src/data/backgrounds.ts?t=' + t),
  ]);
  const ids = new Set(S.ALL_SPELLS.map((s) => s.id));

  // Keys whose leaf STRINGS are spell ids. Deliberately excludes spellListClassId (a class id),
  // spellcastingType / spellcastingAbility, and spellsKnownByClassLevel (numbers).
  const SPELL_KEYS = new Set([
    'alwaysPreparedSpells', 'expandedSpells', 'landSpells', 'spellIds', 'spells',
  ]);

  const bad = [];
  const counts = {};

  function leaves(v, where) {
    if (v == null) return;
    if (typeof v === 'string') {
      counts[where] = (counts[where] || 0) + 1;
      if (!ids.has(v)) bad.push(`${where}: '${v}'`);
      return;
    }
    // arrays AND level-keyed objects both bottom out here
    if (typeof v === 'object') return Object.values(v).forEach((x) => leaves(x, where));
  }

  function walk(v, where) {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) return v.forEach((x) => walk(x, where));
    for (const [k, val] of Object.entries(v)) {
      if (SPELL_KEYS.has(k)) leaves(val, `${where}.${k}`);
      else if (k === 'spellId' && typeof val === 'string') {
        counts[where] = (counts[where] || 0) + 1;
        if (!ids.has(val)) bad.push(`${where}.spellId: '${val}'`);
      } else walk(val, where);
    }
  }

  walk(R.ALL_RACES, 'races');
  walk(C.ALL_CLASSES, 'classes');
  walk(SC.ALL_SUBCLASSES, 'subclasses');
  walk(F.ALL_FEATS, 'feats');
  walk(IV.ALL_INVOCATIONS, 'invocations');
  walk(IN.ALL_INFUSIONS, 'infusions');
  walk(B.ALL_BACKGROUNDS, 'backgrounds');

  // Control: the checker must fire on each shape it claims to cover.
  const ctlBad = [];
  const ctlIds = ids;
  (function control() {
    const fake = [
      { id: 'x', alwaysPreparedSpells: { 1: ['bless', 'NOT-A-SPELL'] } },
      { id: 'y', expandedSpells: ['NOPE'] },
      { id: 'z', innateSpells: [{ spellId: 'ALSO-NOPE' }] },
    ];
    const seen = [];
    (function w(v) {
      if (!v || typeof v !== 'object') return;
      if (Array.isArray(v)) return v.forEach(w);
      for (const [k, val] of Object.entries(v)) {
        if (SPELL_KEYS.has(k)) {
          (function l(x) {
            if (typeof x === 'string') { if (!ctlIds.has(x)) seen.push(x); return; }
            if (x && typeof x === 'object') Object.values(x).forEach(l);
          })(val);
        } else if (k === 'spellId' && typeof val === 'string') {
          if (!ctlIds.has(val)) seen.push(val);
        } else w(val);
      }
    })(fake);
    ctlBad.push(...seen);
  })();

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return {
    spellRefsChecked: total,
    byArea: counts,
    dangling: bad,
    controlsFired: ctlBad.length === 3 ? 'PASS (3/3)' : `FAIL (${ctlBad.length}/3)`,
  };
})();
