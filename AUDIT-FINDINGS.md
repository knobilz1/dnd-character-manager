# Mechanical audit — classes, subclasses, races

Running log. **Log-only mode**: findings are recorded here, not fixed, except (a) anything actively
destructive and (b) the three commits already on this branch. A batch fix pass happens at the end,
grouped by root cause.

Branch `audit/class-mechanics`, off `main` @ `7f2a4f0`.

## What this audit is
The 2026-05/06 audits checked **text accuracy** (does the description match the book) — see memory
`audit_status.md`. This one checks **mechanical implementation**:
1. Does every limited-use feature have a tracked resource?
2. Are max / recharge / scaling die correct vs the class table?
3. Does the feature actually *do* anything (derived stats, enforcement)?
4. Does level-up grant the right things at the right levels?
5. Are caps enforced (prepared spells etc.)?

## Sources
- `G:\My Drive\DND Source Books\*.md` — 10 curated mechanics extracts with real class tables.
- `C:\Users\nabil\Desktop\Code\reference-books\md\` — fuller set of 14, **including
  `phb2024-players-handbook.md`**. PHB 2024, DMG, MMoM, MToF are NOT on G:.
- `C:\Users\nabil\Desktop\Code\reference-books\*.pdf` — the original PDFs.

## Scope — 336 entities
| Group | Count |
|---|---|
| Classes 2014 | 13 |
| Classes 2024 | 12 |
| Subclasses 2014 | 141 |
| Subclasses 2024 | 48 |
| Races 2014 | 112 |
| Races 2024 | 10 |

## Structural facts
- `ClassFeature` = `{name, level, description, isASI?}` — **no link to a resource**. Features are pure text.
- Resources come from exactly 3 places: class defs, subclass defs, feat defs.
- **`Race` has NO `resources` field** — only `traits` + `innateSpells`. No racial trait can ever be tracked.
- Only 8 of 141 subclasses (2014) define resources; 0 of 48 (2024).
- `spellListClassId` maps `barbarian-2024`→`barbarian` but was read only by `StepSpells.tsx`.

---

# FINDINGS

## ROOT CAUSE R1 — PHB 2024 class ids are invisible to most logic
Code compares `classId` to 2014 names with exact equality. `spellListClassId` already carries the mapping
but almost nothing used it. Affects nearly every 2024 class. **Partially fixed** (commits `74eb1ad`,
`7247716`); remaining sites below, each to be handled in its class's round.

### Fixed already
| Site | Was broken for 2024 |
|---|---|
| `useCharacterDerived.ts:110` | Barbarian Unarmored Defense → **wrong AC** |
| `useCharacterDerived.ts:114` | Monk Unarmored Defense → **wrong AC** |
| `:36-40` class levels | Rage damage, Martial Arts die, **Ki/Focus save DC = 0**, Sneak Attack dice, Paladin aura |
| `:310` bard | `bardic_inspiration` max override missing |
| `useCharacterStore.ts:26-39` | same overrides on load/rest, persisted |
| `useCharacterStore.ts:809` | **Font of Inspiration** — 2024 Bard never regained inspiration on a short rest |
| `useCharacterStore.ts:629` | Pact Magic not refreshed on level-up for `warlock-2024` |
| `useCreatorStore.ts:221` | Pact Magic **never granted at all** to a creator-built `warlock-2024` |
| `StepSkills.tsx:10,14` | Expertise slots = 0 for `rogue-2024` and `bard-2024` |

⚠️ The AC fix is **typechecked but not yet observed running**. Verify before merge.

### Still open — fix in each class's own round
| Site | Class | Effect on the 2024 version |
|---|---|---|
| `StepClassOptions.tsx:153-157` | fighter/paladin/ranger | no Fighting Style picker (all 3 have it in 2024) |
| `StepClassOptions.tsx:164` | warlock | check if it also gates invocations — 2024 warlock HAS invocations |
| `StepClassOptions.tsx:185` | sorcerer | no Metamagic picker (2024 sorcerer gets it at lv2) |
| `SheetPage.tsx:227` | druid | Wild Shape / alternate-form UI absent |
| `SheetPage.tsx:2261` | monk | monk panel absent |
| `useCharacterStore.ts:842` | sorcerer | also **wrong level**: 2024 Sorcerous Restoration is lv5, code says `>= 20` |
| `mechanics.ts:214 SPELLS_KNOWN` | sorcerer, warlock | no `-2024` keys → `spellsKnownFor` returns **0** |

### Verified NOT bugs — do not re-flag
- `LevelUpDialog.tsx:501` excluding `warlock-2024` from Pact Boon is **correct** — 2024 has no Pact Boon
  feature; Pact of the Blade etc. became Eldritch Invocations.
- `LevelUpDialog.tsx:546-548` already branches Bard Expertise 2014 (3/10) vs 2024 (2/9), which genuinely
  differ. Normalising would break it.
- Artificer sites — there is no `artificer-2024`.
- Subclass-gated sites (`path-of-the-beast`, `armorer`, `berserker`, `totem-warrior`) — 2014-only subclasses.

## ROOT CAUSE R2 — caps are displayed but never enforced
`SpellPanel.tsx:106-108` renders `Prepared (n/max)` and turns it **red** when over the limit, but nothing
prevents exceeding it. `maxPreparedSpellsFor` itself is correct and 2024-aware (`PREPARED_SPELLS_2024`
covers bard/cleric/druid/paladin/ranger/wizard-2024). This is the user's named case. Applies to every
prepared caster. Sweep for the same display-without-enforcement shape on spells known, cantrips known,
Expertise picks, invocations, metamagic, maneuvers, infusions.

## ROOT CAUSE R3 — racial traits cannot be tracked at all
No `resources` on `Race`, no racial-resource plumbing anywhere. Every limited-use racial trait is
text-only: Breath Weapon (1/short), Relentless Endurance (1/long), Stone's Endurance, Fey Step,
Hidden Step, Lucky, Healing Hands, aasimar transformations, Rabbit Hop, Goring Rush, and so on.
This is a build, not a bug fix. Scope it when Phase C completes and the full list of affected traits exists.

---

# PER-ENTITY LOG

## Phase A — classes

### barbarian (2014) — 2 findings
- **A1 (low).** Level-20 Rage shows `99/99` instead of unlimited. Both spellings (`20:99` here,
  `20:'unlimited'` at `classes/index.ts:175`) normalise to literal 99 in the store; the type supports
  `'unlimited'` but no display path renders it.
- Rage counts match the PHB table (p.47) exactly. Rage damage +2/+3/+4 at 1/9/16 correct.
- **Not tracked (by design?):** Relentless Rage's escalating DC (10, +5 per use, resets on a rest) is
  stateful across rests but has no counter.

### barbarian-2024 — 1 finding (fixed)
- **A2 (medium, FIXED `74eb1ad`).** Rage Damage was modelled as a spendable resource with +/- buttons and
  "recharges on a long rest". It is a static scaling bonus. Values were right; the modelling was not.
- **A3 (low, deferred).** `useCharacterStore.load()` never prunes resource keys whose def has gone away, so
  a 2024 Barbarian saved before `74eb1ad` keeps a ghost `rage_damage` counter. A prune pass must also spare
  feat-granted and disabled-sourcebook resources — its own change.

### bard (2014) — clean
Bardic Inspiration die d6/d8/d10/d12 at 1/5/10/15 ✅. Uses = CHA mod ✅ (via override; the `maxPerLevel`
ramp is a never-used fallback). `SPELLS_KNOWN.bard` matches the Spells Known column exactly ✅.
Font of Inspiration handled ✅. Superior Inspiration (20th) is text-only — cannot be automated, acceptable.

### bard-2024 — see R1 (Font of Inspiration, Expertise), both fixed

### cleric (2014) — clean on data, 1 gap
Verified vs PHB p.57: Channel Divinity 1/2/3 uses at levels 2/6/18 ✅, `rechargeOn: 'short'` ✅
(source: "regained on a short or long rest"). Destroy Undead CR ½/1/2/3/4 at 5/8/11/14/17 ✅.
`CANTRIPS_KNOWN.cleric` = 3,3,3,4…5 ✅. Prepared = WIS mod + level ✅.
Domain spells correctly **excluded** from the prepared count (`SpellPanel.tsx:50-54` skips
`isAlwaysPrepared` and cantrips) — matches PHB p.56 "don't count against the number you can prepare" ✅.
- **A4 (low, structural).** Divine Intervention's **7-day cooldown** is untracked. There is no model for a
  multi-day cooldown — `rechargeOn` is only `'short' | 'long' | 'dawn'`. Same shape will recur; note it as a
  type-level gap rather than a per-class bug.

### druid (2014) — clean on data
Wild Shape 2 uses, `rechargeOn: 'short'` ✅, `20:'unlimited'` ✅. `CANTRIPS_KNOWN.druid` = 2,2,2,3…4 ✅.
- Wild Shape UI is 2024-blind — already captured under R1 (`SheetPage.tsx:227`).
- **Check in the druid-2024 round:** 2024 Wild Shape differs (uses rise at 6 and 17, and it regains *one*
  use on a short rest, all on a long rest). The single `rechargeOn` enum can't express "one on short, all on
  long" — likely a second instance of the A4-shaped gap.

---

# QUEUE
Phase A: [x] barbarian [x] barbarian-2024 [x] bard [x] bard-2024 [x] cleric [x] druid
[ ] cleric-2024 [ ] druid-2024 [ ] fighter [ ] fighter-2024 [ ] monk [ ] monk-2024
[ ] paladin [ ] paladin-2024 [ ] ranger [ ] ranger-2024 [ ] rogue [ ] rogue-2024 [ ] sorcerer
[ ] sorcerer-2024 [ ] warlock [ ] warlock-2024 [ ] wizard [ ] wizard-2024 [ ] artificer

Phase B: 189 subclasses — not started (berserker already has a finding, see B1 below).
Phase C: 122 races — not started, blocked conceptually on R3.
Phase D: level-up progression for every class + subclass; cap enforcement (R2).

## Phase B early findings
- **B1 (low).** Berserker *Intimidating Presence* (lv10) omits "If the creature succeeds on its saving
  throw, you can't use this feature on that creature again for 24 hours" (PHB p.49). Notable because this
  subclass passed the 2026-05-31 PHB text audit — that pass was not exhaustive.

## ROOT CAUSE R4 — `rechargeOn` can't express real recharge rules
The enum is `'short' | 'long' | 'dawn'`. It cannot express:
- a multi-day cooldown (Cleric Divine Intervention, 7 days)
- "regain one on a short rest, all on a long rest" (2024 Druid Wild Shape, 2024 Monk Focus, and others)
Expect more instances. Collect them all before designing the widening.

## Defect rate
Entities audited 6 / 336. With ≥1 finding: 4 (bard, cleric, druid clean on data). Running 67%.
Caveat: inflated by R1, one systemic cause touching nearly every class. Per-class **data** errors are so far
rare — bard, cleric and druid numbers were all perfect against the book. The real defects are structural:
R1 (2024 blindness), R2 (caps not enforced), R3 (races untrackable), R4 (recharge enum too narrow).
