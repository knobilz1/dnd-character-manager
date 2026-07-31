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

## ROOT CAUSE R2 — FULLY CHARACTERISED (Phase D): the creator enforces caps, the SHEET does not
This is the user's named case, now proven exactly. The asymmetry is the whole bug.

**Creator — enforces correctly ✅**
- `StepSkills.tsx:103` — `else if (next.size < maxChoices)` blocks the pick.
- `StepClassOptions.tsx:148` — `current.length < max ? [...current, id] : current` blocks the pick.
  Covers fighting styles, invocations, metamagic, maneuvers, infusions.

**Sheet — enforces nothing ❌**
- `useCharacterStore.ts:449-456` `toggleSpellPrepared` is a bare toggle with **no cap check at all**.
- `useCharacterStore.ts:458-462` `addSpellToBook` only de-duplicates — **no spells-known cap**, so a Bard,
  Sorcerer or Warlock can exceed `SPELLS_KNOWN` without limit.
- `SpellPanel.tsx:176` guards only `alwaysPrepared`, never the limit.
- **No cantrip cap either** — `SpellPanel.tsx:101` displays `{cantripCount}/{cantripsKnown}` and nothing
  stops you exceeding it.

Caps **displayed** in 5 places (`StepClassOptions:62`, `StepSkills:120`, `InventoryPanel:331`,
`SpellPanel:101`, `SpellPanel:108`); caps **enforced** in exactly 1 (`InventoryPanel:334`, and that is the
charge +/- button, not a pick limit).

Fix shape: guard in the **store**, not the panel — `toggleSpellPrepared` and `addSpellToBook` are the two
chokepoints every path funnels through, exactly like `save()` was for the borrowed-character fix.
Both need the derived max, which the store can compute (`maxPreparedSpellsFor`, `spellsKnownFor`,
`cantripsKnownFor` all live in `data/mechanics.ts` and take plain args).

### Original note

`SpellPanel.tsx:106-108` renders `Prepared (n/max)` and turns it **red** when over the limit, but nothing
prevents exceeding it. `maxPreparedSpellsFor` itself is correct and 2024-aware (`PREPARED_SPELLS_2024`
covers bard/cleric/druid/paladin/ranger/wizard-2024). This is the user's named case. Applies to every
prepared caster. Sweep for the same display-without-enforcement shape on spells known, cantrips known,
Expertise picks, invocations, metamagic, maneuvers, infusions.

## ROOT CAUSE R3 — racial NON-SPELL abilities cannot be tracked (CORRECTED, Phase C)
**Correction to the earlier claim.** I first wrote "no racial trait can ever be tracked". That was too
broad. Racial *spells* **are** tracked: `Character.innateSpellUses` (`types/index.ts:527`) is maintained on
load and on rest (`useCharacterStore.ts:290, 701`), and `InnateSpell.recharge` is `'cantrip'|'long'|'short'`.
What has no home is a limited-use racial ability that **isn't a spell**.

Measured:
| Measure | Count |
|---|---|
| Races with ≥1 limited-use trait | 76 |
| …of which have an `innateSpells` path (tracked) | 45 |
| **Races whose limited-use trait has NO tracking path at all** | **31** |
| Total limited-use racial traits | 91 |

The 31 are the common, heavily-played ones:
`dragonborn` + all 5 variants (**Breath Weapon**, 1/short rest) · `half-orc` (**Relentless Endurance**,
1/long) · `goliath` (**Stone's Endurance**, 1/short) · `shifter` + all 4 subraces (**Shifting**) ·
`aasimar-2024` (Healing Hands, Celestial Revelation) · `eladrin` (**Fey Step**) · `goblin` · `kobold` ·
`harengon` · `hobgoblin` · `lizardfolk` · `sea-elf` · `shadar-kai` · `duergar` · `deep-gnome` · `leonin` ·
`vedalken` · `autognome` · `astral-elf` · `hadozee` · `erlw-aberrant-dragonmark`.

Fix shape: either add `resources?: ClassResourceDefinition[]` to `Race` (mirrors the subclass field
exactly, and the load/levelUp/rest plumbing already loops class + subclass + feat — adding race is a fourth
loop in the same places), or generalise `innateSpellUses` into a non-spell "trait uses" map. The first is
closer to what already exists. Same build as R5.

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

### ROUND 4 — all 25 class resource definitions swept at once

#### MISSING RESOURCES — confirmed against the book, high value
| Class | Feature | Book says | App |
|---|---|---|---|
| `fighter-2024` | **Indomitable** | 1 use @9, 2 @13, 3 @17 (PHB24 Fighter table) | **absent** |
| `wizard-2024` | **Arcane Recovery** | lv1, once per Long Rest, recover slots ≤ half wizard level on a Short Rest | **absent — wizard-2024 has NO resources at all** |
| `ranger-2024` | **Favored Enemy** (free *Hunter's Mark* casts) | 2 @1, 3 @5, 4 @9, 5 @13, 6 @17; all back on a Long Rest | **absent — ranger-2024 has NO resources at all** |
| `warlock` (2014) | **Mystic Arcanum** | four separate 6th/7th/8th/9th spells, each 1/Long Rest | absent |
| `warlock` (2014) | **Eldritch Master** (lv20) | regain all Pact slots, 1/Long Rest | absent |
| `rogue` (2014 + 2024) | **Stroke of Luck** (lv20) | 1 per Short or Long Rest | absent |
| `artificer` | **Spell-Storing Item** | 2× INT mod casts, refreshed on a Long Rest | absent |

#### C1 — `cleric-2024` Channel Divinity recharges too generously (CONFIRMED)
App has `rechargeOn: 'short'`, which restores **all** uses on a short rest. PHB 2024 (Level 2: Channel
Divinity) says *"2 uses; regain 1 on Short Rest, all on Long Rest."* Another R4 instance, and a real
over-generosity bug, not just a modelling nit.
The **uses table itself is correct** — app `{1:2,2:2,3:2,4:2,5:3,…,17:3,18:4,19:4,20:4}` matches the 2024
Cleric table's Channel Divinity column exactly. ⚠️ One thing to re-check against the **PDF**: the markdown
extract shows `2` uses at level 1 while the feature text says "Level 2: Channel Divinity". App follows the
extract. Possible extract artifact — do not "fix" without the PDF.

#### C2 — `warlock-2024` represents Pact Magic slots TWICE (my round-2 fix made this worse)
`classes/phb2024.ts` declares a `pact_slots` **resource**, but `LevelUpDialog.tsx:405,421-422` already
assumed `warlock-2024` uses the `pactMagic` object + `PACT_MAGIC_TABLE`. Commit `7247716` aligned the
creator and store with LevelUpDialog by granting `pactMagic` to `warlock-2024` — which is consistent with
LevelUpDialog but now means slots exist in **two** places at once.
Pick one representation in the fix pass. The `pactMagic` object is the one the spell UI and level-up
already use, so `pact_slots` is the likely thing to drop. **Flagging honestly: this duplication is partly
mine.** Before `7247716` a 2024 warlock had `pact_slots` only — and no working slots anywhere else.

#### Confirmed correct — do not touch
`barbarian-2024` rage · `bard-2024` inspiration die + CHA-mod override · `druid-2024` Wild Shape uses
(2@2, 3@6, 4@17) · `fighter-2024` Action Surge (1@2, 2@17) and Second Wind (2/3/4 @1/4/10) ·
`monk-2024` Focus = monk level · `paladin-2024` Lay on Hands 5×level and Channel Divinity (2@3, 3@11) ·
`sorcerer-2024` Sorcery Points = level · `warlock-2024` pact slot counts.
`ranger` and `rogue` (2014) correctly have no per-rest resources apart from the Stroke of Luck gap.

#### `druid-2024` — R4 again
Wild Shape uses are right, but 2024 says *"regain one expended use on a Short Rest, all on a Long Rest"*;
`rechargeOn: 'short'` restores all. Same shape as C1.

### ROUND 5 — limited-use feature sweep (classes AND subclasses)

Method: extract every feature whose description contains limited-use language (`once per`,
`times equal to`, `number of times`, `regain … uses`, `per long/short rest`, `expended uses`), then
cross-reference against the resource keys that actually exist. Reproducible awk one-liner, both class
files and both subclass files.

#### ROOT CAUSE R5 — most limited-use SUBCLASS features are untracked
| Measure | Count |
|---|---|
| Subclasses with ≥1 limited-use feature | **90** |
| Subclasses defining any resource | 35 |
| …overlap (have a feature *and* a resource) | 20 |
| **Subclasses with limited-use features and NO resource** | **70** |
| **Individual untracked features (floor)** | **102** |
| 2024 subclasses with limited-use features | 18 — **all untracked** (zero 2024 subclasses define resources) |

102 is a floor, not a total: the 20 subclasses that do define a resource usually define **one**, while
having two to four limited-use features each (e.g. `circle-of-stars` has Cosmic Omen, Star Map and
Starry Form; `chronurgy-magic` has Chronal Shift and Momentary Stasis; `circle-of-wildfire` has Blazing
Revival and Cauterizing Flames).

This is the single largest finding of the audit so far and it is Phase B's headline. It is one build —
the same shape as R3 — not 102 separate fixes.

#### New untracked CLASS features (beyond those already listed)
| Class | Feature | Book |
|---|---|---|
| `paladin` | **Divine Sense** (lv1) | 1 + CHA mod uses per long rest — a **level-1** feature with no counter |
| `paladin` | **Cleansing Touch** (lv14) | CHA mod uses per long rest |
| `wizard` | **Signature Spells** (lv20) | 2 spells, each castable once per short rest without a slot |
| `druid-2024` | **Wild Resurgence** (lv5) | once per long rest |

#### Confirmed fine — not gaps
`druid` Archdruid (unlimited Wild Shape — the `'unlimited'` flag covers it), `barbarian-2024` Persistent
Rage and `bard-2024` Superior Inspiration (both "regain on initiative", not counters), `sorcerer`
Sorcerous Restoration (handled in `shortRest`), `bard` Font of Inspiration, `fighter` Indomitable (2014),
`wizard` Arcane Recovery (2014).

## ROOT CAUSE R6 — magic-item charges mostly untracked (Phase E, added by user)
Item model is `ItemTemplate { name, category, weight?, description?, sourceBook?, maxCharges?, recharge? }`.
`maxCharges` is what turns an item into a usable counter on the sheet (`InventoryPanel.tsx:89-120`,
pips at `:304`), pre-filled when the item is added from template.

| Measure | Count |
|---|---|
| Item templates total | 692 |
| With `maxCharges` (tracked) | 48 |
| **Charge/daily-use language in the text but NO `maxCharges`** | **39** |
| **`maxCharges` set but NO `recharge` — charges never come back** | **2** |

**The 2 broken ones:** `Ring of Three Wishes` (3 charges) and `Scarab of Protection` (12 charges). Both
get a counter that can only ever count down. Ring of Three Wishes is correct per the DMG (it is expended
permanently), so that one is fine — **Scarab of Protection is a real bug**: the DMG says it regains
4d6 expended charges daily at dawn, so it should be `recharge: 'dawn'`.

### R6b — charge COUNTS are clean (47 items), and the "recharge wording" check is a FALSE POSITIVE
- **Charge count vs description: 0 mismatches.** Every item carrying `maxCharges: N` has a description
  opening `"N charges."` and the numbers agree in all 47 cases. Real population, real check, clean result.
- **Recharge wording: not a bug.** A check flagged 38 items as `recharge: 'dawn'` with no "dawn" in the
  text. Item descriptions are **deliberately terse** — e.g.
  `'3 charges. Reaction: succeed on a failed Dex save. Rare. Requires attunement.'` — and only **8 of 47**
  restate recharge timing at all. `recharge` is supplementary structured data, not contradicted by the
  text. **All 38 are fine; recorded so they are not "fixed".**
- ### ❌ RETRACTED — Scarab of Protection is CORRECT as-is
  I logged that it "needs `recharge: 'dawn'`, DMG says 4d6 regained daily at dawn". **That is wrong.**
  Checked against `reference-books/md/dmg-dungeon-masters-guide.md`:
  *"12 charges. Reaction: turn a failed save vs necromancy/undead-effect into a success (1 charge);
  **crumbles at 0 charges**."* It never recharges. The app's own description already says
  "crumbles when the last charge is used".
  Caught at the point of fixing — applying it would have introduced a bug into correct data.
  **Both items with `maxCharges` and no `recharge` are correct**: Ring of Three Wishes (expended
  permanently) and Scarab of Protection (destroyed at 0). **Zero bugs in that category.**

### ⛔ R6 IS BLOCKED ON SOURCE — the DMG markdown extract omits recharge clauses
Attempted to complete R6 and got 2 of 39. The item **counts** are recoverable from the app's own
descriptions (most open `"N charges."`), but the **recharge rule** is not, and guessing it would inject
bugs into working data — exactly the Scarab of Protection mistake, which was a guess that the DMG
contradicted.

Checked 10 items against `reference-books/md/dmg-dungeon-masters-guide.md`; it records a recharge clause
for only **2**:
| Item | DMG says | Applied |
|---|---|---|
| Helm of Teleportation | "3 charges. Regains 1d3/dawn." | `maxCharges: 3, recharge: 'dawn'` ✅ |
| Alchemy Jug | "dawn" | `maxCharges: 1, recharge: 'dawn'` ✅ |
| Gem of Brightness | "50 charges" — **no recharge clause recorded** | not applied |
| Chime of Opening, Hat of Vermin, Staff of Birdcalls, Staff of Flowers, Wand of Pyrotechnics, Wand of Scowls, Wand of Smiles | **nothing recorded** | not applied |

**To finish R6 someone must read the DMG PDF** (`reference-books/D&D 5E - Dungeon Master's Guide.pdf`)
per item, or the markdown extract must be regenerated to include recharge sentences. Note Gem of
Brightness in particular is a trap: it may legitimately have **no** recharge (it becomes a nonmagical
jewel at 0 charges), like Ring of Three Wishes and Scarab of Protection — so a blanket `'dawn'` sweep
across these 39 would be wrong, not merely unverified.

The 39 untracked include: Alchemy Jug, Gem of Brightness, Cape of the Mountebank, Chime of Opening,
Cloak of Invisibility, Cloak of the Bat, Helm of Teleportation, Hat of Vermin, Staff of Birdcalls,
Staff of Flowers, Wand of Pyrotechnics/Scowls/Smiles, Bell Branch, Blood Fury Tattoo, Crook of Rao,
Crystalline Chronicle, Demonomicon of Iggwilv, Lyre of Building, Ring of Obscuring, Rod of Retribution,
Staff of Dunamancy, Amethyst Lodestone, Ruby Weave Gem, Mizzium Mortar, Voyager Staff, all 5 Strixhaven
Primers, Earworm. Full list regenerable with the grep in this commit.

### Phase C data accuracy — CLEAN (112 races)
Anomaly sweep over every 2014 race: **speed** (all 25/30/35/40, zero outliers), **darkvision**
(all absent/60/120, zero outliers), **ASI totals** (distribution 0/1/2/3/4/6).
Both ASI outliers checked individually and both are **correct**: `human` +1 to all six = 6 (PHB standard
human), `dwarf-mountain` +2 STR/+2 CON = 4. The 42 zero-totals are parent races whose subraces carry the
increase, plus the flexible-ASI races.
→ Race **numeric data is clean**. The entire race problem is tracking (R3), not values.
Still owed for Phase C: per-race trait *text* vs source — but note the 2026-06-01/02 audits already covered
race text for MMoM, VGM, GGR, ERLW, EGtW, FToD, SCoC, MToF and PHB (memory `audit_status.md`).

---

## PHASE D — LEVEL-UP AUDIT (user reports "LOTS of bugs" here)

### Verified CORRECT — do not re-flag
- **ASI levels, all 25 classes.** Standard 4/8/12/16/19; Fighter 4/6/8/12/14/16/19; Rogue 4/8/10/12/16/19;
  Artificer 4/8/12/16/19. Every one matches its book.
- **Subclass levels, all 25.** 2014: Cleric 1, Sorcerer 1, Warlock 1, Druid 2, Wizard 2, all others 3.
  2024: all 3 (correctly standardised).

### D1 — HIGH, affects 2014 — subclass prompt uses `===`, so it can be missed permanently
`LevelUpDialog.tsx:293`
```ts
const needsSubclass = newLevel === classDef.subclassLevel && !primary?.subclassId;
```
Strict equality. If a character ever passes their subclass level without one — multiclass entry, a
character created above that level, a cancelled dialog, an import — they are **never prompted again**, at
any level. A subclass-less Barbarian at 7 stays subclass-less forever, silently losing every subclass
feature.
The file itself uses `>=` for every analogous gate (`needsPactBoon` `newLevel >= 3` at :501,
`needsTotemSpirit` `>= 3` at :509, `needsAspectTotem` `>= 6` at :510), so `===` here is inconsistent as
well as wrong. Should be `>=`.

### D2 — MEDIUM, 2024 — Bard and Ranger are treated as KNOWN casters but became PREPARED in 2024
`LevelUpDialog.tsx:455` lists `bard-2024` and `ranger-2024` in `isKnownCaster`, and `:458`'s
`isPreparedCaster` omits them. But PHB 2024 made **both prepared casters**, and `mechanics.ts`
already agrees — `PREPARED_SPELLS_2024` has entries for `bard-2024` and `ranger-2024`.
So the data layer and the level-up dialog contradict each other. Level-up offers a 2024 Bard/Ranger a
known-spells pick when it should be managing a prepared list.

### D3 — MEDIUM, 2024 — Epic Boon is flagged as an ASI
All 12 2024 classes have `{ name: 'Epic Boon', level: 19, isASI: true }`. The name is right, the flag is
not: in PHB 2024 an Epic Boon is a **feat chosen from the Epic Boon category**, not a +2/+1 ability bump.
`LevelUpDialog.tsx:298` keys the ASI UI off `isASI`, so level 19 presents an ability-score picker instead
of an Epic Boon feat list.

### D4 — HIGH, mostly 2014 — subclass build choices are never prompted at level-up
Swept every subclass feature whose text contains choice language (`choose one/two/three/a/an/from`,
`select one/two`, `pick one/two`, `of your choice`):

| Measure | Count |
|---|---|
| Subclass features containing choice language | **103** |
| Subclasses affected | **70** |
| Handled by `LevelUpDialog` | **2** — `totem-warrior` (totemSpirit / aspectTotem / totemicAttunement) and `battle-master` (maneuvers) |

Everything else at class level is handled (`fightingStyles`, `invocations`, `metamagic`, `infusions`,
`optionalFeatures`) — but those are *class* options, not subclass ones.

**⚠️ Caveat, stated honestly: the 103 is an over-count.** The regex cannot distinguish a **build choice**
(persists on the sheet, must be prompted once) from a **use-time choice** (chosen fresh each activation,
correctly needs no prompt). `berserker` Intimidating Presence "choose one creature" and `circle-of-stars`
Starry Form are use-time and are **not** bugs. The list must be triaged by hand before fixing.

**Confirmed build choices that genuinely go unprompted** (spot-checked from the list):
- `arcane-archer` — **Arcane Shot at 3, plus Additional Arcane Shot at 7, 10, 15, 18**: five separate
  choice points, none prompted
- `hunter` — Hunter's Prey (3), Defensive Tactics (7) *(and Multiattack 11 / Superior Hunter's Defense 15)*
- `circle-of-the-land` — **Circle Spells (3)**: the land type drives the whole spell list
- `circle-of-the-land` — Bonus Cantrip (2)
- `champion` — **Additional Fighting Style (10)** — note this is the Champion's, which is why
  `StepClassOptions.tsx:155` giving the *base* Fighter a 2nd style at 10 is suspected wrong (see R1 table)
- `draconic-bloodline` — Dragon Ancestor (1)
- `college-of-lore` — Bonus Proficiencies (3), Additional Magical Secrets (6)
- `knowledge-domain` — Blessings of Knowledge (1) · `nature-domain` — Acolyte of Nature (1)
- `rune-knight` — Rune Carver (3) · `armorer` — Armor Model (3) · `beast-master` — Ranger's Companion (3)
- `bladesinging` — Training in War and Song (2) · `drakewarden` — Draconic Gift (3)
- `horizon-walker` — Planar Warrior (3) · `path-of-wild-magic` — Wild Surge (3)

Consequence: the choice is never recorded on the character, so nothing downstream can act on it — a
Circle of the Land druid has no land type, so their Circle Spells cannot be granted at all.

Regenerate the full list with the awk in commit for D4.

### Still owed in Phase D
Per-subclass level-up options (does each subclass's choice-bearing feature actually prompt at its level),
and racial level-gating (`InnateSpell.minCharLevel` — does a race's level-gated spell appear on level-up).

## PHASE F — SPELLS (536 in the 2014 file) — STRUCTURALLY CLEAN

Five internal-consistency checks across every spell. **All five passed with zero defects.**

| # | Check | Population | Defects |
|---|---|---|---|
| 1 | `concentration: true` flag ⟷ `duration` text containing "Concentration" | 238 flagged | **0** |
| 2 | `'M'` in `components` ⟹ `materialComponent` present | 280 | **0** |
| 3 | `materialComponent` present ⟹ `'M'` in `components` | 280 | **0** |
| 4 | cantrips (level 0) must not have `atHigherLevels` | 49 cantrips, 158 spells with atHL | **0** |
| 5 | `classes` array must not be empty | 536 | **0** |

**Methodology note — this result is verified, not assumed.** The first attempt used a multi-line awk block
parser and returned "no defects" because spell entries are **one per line**; the parser matched nothing.
A silent empty result is indistinguishable from a clean one, so every check was re-run with its population
counted and a positive control: spells with `'M'` **and** `materialComponent` = 280, exactly equal to the
280 with `'M'`, proving the check fires. Apply the same discipline to every future sweep in this file.

Checks 2 and 3 together mean the M/materialComponent relationship is a perfect 1:1 across all 280 — a
strong signal that the May/June 2026 text audits (which fixed several fabricated material components in
TCE, XGtE and FToD) were applied consistently.

**Not yet covered in Phase F:** per-spell numeric/mechanical accuracy vs the books (damage dice, ranges,
durations, save types, atHigherLevels scaling). Note the prior text audits already covered spell
descriptions for PHB (362 spells, 12 bugs), XGtE (95, 3 bugs), TCE, EGtW, FToD and SCoC — see memory
`audit_status.md`. The remaining gap is 2024 spells and cross-book numeric spot-checks.

## PHASE B — SUBCLASS FEATURE LEVELS — CLEAN (959 features checked)
Checked every subclass feature against the legal feature levels for its class
(Barbarian 3/6/10/14 · Bard 3/6/14 · Cleric 1/2/6/8/17 · Druid 2/6/10/14 · Fighter 3/7/10/15/18 ·
Monk 3/6/11/17 · Paladin 3/7/15/18/20 · Ranger 3/7/11/15 · Rogue 3/9/13/17 · Sorcerer 1/6/14/18 ·
Warlock 1/6/10/14 · Wizard 2/6/10/14 · Artificer 3/5/9/15).

**959 examined, 0 skipped. Every apparent anomaly resolved to correct-per-book:**
- `circle-of-the-land` Circle Spells at 3 — **correct**, the Land circle-spells table starts at 3rd.
- `shadow-magic` Eyes of the Dark → Darkness at 3 — **correct**, a sub-part of the level-1 XGtE feature.
- `tob-path-of-the-kraken` In the Dark Below at 15 — **correct per the ToB PDF** (3rd-party, non-standard).
- Paladin oath auras improving at 18 — **correct**, the aura range goes 10→30 ft at 18.
- All `circle-of-stars` features are at 2/2/6/10/14 — **correct** (TCE).

### ⚠️ METHODOLOGY WARNING — three parser bugs produced three false results here
This check reported a wrong answer **three times** before it was right. Recorded because the same traps
will recur in the second pass:
1. **Off-by-one substr offsets** on `classId` → 959 features silently skipped, reported as "0 defects".
2. **`'\''` shell escaping inside a heredoc'd awk file** → the regex looked for three literal quotes and
   matched nothing. Shell quoting rules do not apply once the program is in a file.
3. **Greedy `sub(/.*level: /)`** took the *last* number on a line instead of the first, producing 46
   phantom offenders including "circle-of-stars at level 3" (it is at 2).

**Rule going forward: every sweep needs a positive control** — deliberately narrow the expected set and
confirm the check flags the entries it should. A bare "0 defects" is worthless without it. This is the
second time (see Phase F) a broken parser masqueraded as a clean result.

Also note `sc` (subclass label) can go stale in these awk sweeps while `cid`/`level` stay correct, so
**trust the class and level columns, verify the subclass name** before acting on any row.

---

## PHASE G — CROSS-REFERENCE INTEGRITY — **2 REAL BUGS FOUND**
New angle: do id references actually resolve? A broken id fails **silently** — the spell simply never
appears, with no error anywhere.

546 spell ids defined; 173 referenced by subclasses; 67 by races. Positive control passed (an injected
fake id was correctly reported).

### G1 — Twilight Domain never grants Leomund's Tiny Hut (2014, TCE)
`src/data/subclasses/index.ts:667` — `alwaysPreparedSpells` 5th entry references **`leomunds-tiny-hut`**.
The real id is **`leomund-tiny-hut`** (no `s`). Twilight Domain clerics silently never receive it.

### G2 — 2024 Paladin oath never grants Protection from Evil and Good
`src/data/subclasses/phb2024.ts:289` — references **`protection-from-evil-and-good`**.
The real id is **`protection-from-evil-good`** (no `and`). The oath's level-3 spell list is
protection from evil and good / shield of faith → **Oath of Devotion (2024)**. Silently never granted.

Both are one-character-class typos with zero runtime signal. **Race `innateSpells` references are all
clean** (67/67 resolve).

### ⚠️ False positive recorded — the feat check in this pass is NOT valid
`grantedSpells` extraction returned `cha int long short wis`, which are ability keys and recharge values,
not spell ids — the regex matched every quoted string inside the block, not just spell ids. **No feat
finding should be drawn from it.** Redo with a parser that reads only the array contents.

### G3 — DUPLICATE ID: a 2024 Druid picking Circle of Stars silently receives the **TCE** subclass
- `src/data/subclasses/index.ts:677` — `circle-of-stars`, TCE, `classId: 'druid'`
- `src/data/subclasses/phb2024.ts:172` — `circle-of-stars`, PHB2024, `classId: 'druid-2024'`

Same id in both files. `getSubclass()` (`subclasses/index.ts:1236`) is `.find()` — **first match wins**,
and the TCE entry comes first.

The failure is worse than "unreachable", because the two lookups disagree:
- `getSubclassesForClass('druid-2024')` filters on `classId`, so the **picker correctly offers the 2024
  Circle of Stars**.
- `getSubclass('circle-of-stars')` then returns the **TCE** one.

So a 2024 Druid selects Circle of Stars and is given the 2014 TCE features, at TCE levels, with no error.
Fix: give the 2024 entry a distinct id (`circle-of-stars-2024`), matching how every other 2024 subclass and
class is namespaced.

### G4 — DUPLICATE ID: the 2024 version of Mind Sliver is dead data
- `src/data/spells/index.ts:554` — `mind-sliver`, TCE
- `src/data/spells/phb2024.ts:10` — `mind-sliver`, PHB2024

`getSpell()` (`spells/index.ts:674`) is `.find()`, so the TCE entry always wins and the PHB2024 entry can
never be returned. Its text and mechanics are unreachable.

**Duplicate-id sweep results:** subclasses **1** (`circle-of-stars`), spells **1** (`mind-sliver`),
races **0**, classes **0**. This also explains the subclass count reading 188 rather than 141+48=189.

### Checked and NOT a bug — `parentRaceId`
Four values (`dwarf`, `elf`, `gnome`, `halfling`) have no matching race entry, but `parentRaceId` is used
**only as a grouping key** in `StepRace.tsx:33,90` to cluster subraces under a heading — it is never passed
to `getRace()`. No lookup breaks. Recorded so it is not "fixed" later.

### G5 — CLEAN: spell→class refs and resource-key collisions
- All 16 distinct `spell.classes[]` values resolve to real class ids. **0 broken.**
- **0 resource-key collisions** between the 14 class keys and the 8 subclass keys — no subclass silently
  overwrites a class resource. (Worth knowing: `channel_divinity` is shared by cleric *and* paladin, but
  that is two classes, not a class/subclass clash, and is correct.)
- Positive control passed.

### ❌ G6 — RETRACTED. `SPELLS_KNOWN` **does** carry 2024 keys.
`mechanics.ts:220-221` has `'sorcerer-2024'` and `'warlock-2024'`, with values matching the 2024
"Prepared" column exactly. My original grep used `-A4`, which truncated the block before those two lines,
and I concluded from the truncation that the keys were absent. **A fourth parser/tooling artifact.**
`spellsKnownFor` works correctly for both.

What survived from this area is the **`bard-2024` / `ranger-2024`** half (see D2): those two became
prepared casters and live in `PREPARED_SPELLS_2024`, not `SPELLS_KNOWN`, yet `LevelUpDialog` listed them
as *known* casters — so `spellsKnownFor` returned 0 and neither was ever offered a spell pick on level-up.
Fixed by moving them to `isPreparedCaster`.

Deliberately left alone: `sorcerer-2024` / `warlock-2024` stay classified as known casters. The 2024 book
labels their column "Prepared", but this app models them through `SPELLS_KNOWN` with correct values and
the path is self-consistent; reclassifying them would break something that works for a labelling nicety.

### (original G6 text, superseded)
`LevelUpDialog.tsx:463` computes newly-learned spells as
`spellsKnownFor(classId, newLevel) - spellsKnownFor(classId, currentLevel)` using the **raw** classId.
`SPELLS_KNOWN` (`mechanics.ts:214`) has **no `-2024` keys**, so both terms are 0.
**A 2024 Sorcerer or Warlock is never offered new spells on level-up — the pick simply doesn't appear.**
(Bard-2024 and Ranger-2024 became prepared casters so are unaffected here, but see D2 — the dialog still
misclassifies them as known casters.)
Contrast `cantripsKnownFor` at `:433,436`, which works because `CANTRIPS_KNOWN` **does** carry 2024 keys.
So one table was updated for 2024 and its neighbour was not.

### G7 — `getSpellsByClass` is dead code
`spells/index.ts:678` is defined and **never called anywhere**. Harmless now, but it is the obvious helper
for a future spell-list feature and would silently return `[]` for any 2024 class id, since
`spell.classes[]` tags 2024 ids only on the 11 PHB2024-exclusive spells. Either delete it or make it
route through `baseClassId()`.

### To verify (not yet a finding)
`ranger-2024` is the **only** 2024 caster absent from `spell.classes[]` (bard/cleric/druid/paladin/
sorcerer/warlock/wizard-2024 all appear). Likely benign — those tags come from the 11 PHB2024-exclusive
spells and Ranger simply gets none of them — but confirm against the 2024 Ranger spell list.

### G8 — HIGH (2024): every PHB 2024 class starts with an EMPTY inventory
`startingEquipment.ts` defines entries for exactly 13 classIds — `barbarian bard cleric druid fighter monk
paladin ranger rogue sorcerer warlock wizard artificer`. **No `-2024` ids.**
`getClassStartingEquipment` (`:432`) is `.find(e => e.classId === classId)` on the **raw** id, and
`StepEquipment.tsx:32` passes `primaryClass.classId` straight in. So a 2024 character gets `undefined`
and receives **no starting equipment at all**. Another R1 instance; fix via `baseClassId()`, though the
2024 equipment lists differ from 2014 so the data may need its own entries.

### G9 — starting-equipment names that match no item template lose their description (and 2 lose weight)
`StepEquipment.tsx:48-66` looks each item up in `items.ts` **by name** to inherit `weight` and
`description`. Six names have no exact match:
| startingEquipment name | actual template |
|---|---|
| `Light crossbow` | `Crossbow, light` |
| `Crossbow bolt` | `Crossbow bolts (20)` |
| `Arrow` | `Arrows (20)` |
| `Holy symbol` | `Holy symbol (amulet)` / `(emblem)` / `(reliquary)` |
| `Druidic focus` | `Druidic focus (sprig of mistletoe)` / `(totem)` / `(wooden staff)` / `(yew wand)` |
| `Wooden shield` | *no match at all* |

Most carry an explicit `weight:` inline so encumbrance survives, **but `Arrow` and `Crossbow bolt` carry
neither weight nor a template match**, so 20 arrows and 20 bolts weigh **0**. All six lose their
description on the sheet.
Note `Holy symbol` and `Druidic focus` are deliberately generic (the player picks a variant), so the fix is
probably a generic template entry rather than renaming.

**False positives in this sweep, recorded so they are not chased:** `Artisan\`, `Burglar\`, `Diplomat\`,
`Dungeoneer\`, `Entertainer\`, `Explorer\`, `Priest\`, `Scholar\`, `Thieves\`, `Tinker\` are **sed
truncation at an escaped apostrophe** (`Artisan\'s tools`), not real names. `... (your choice)` entries are
intentional placeholders, not item references.

### G10 — `subclassTips` covers 2014 completely and 2024 not at all
141 tips for 188 subclasses. **All 47 missing are 2024** (the `-2024` set plus `circle-of-the-sea`,
`college-of-dance`, `wild-heart`, `world-tree`, which are 2024 subclasses stored without the suffix).
Given the 2014 priority this is low urgency — 2014 coverage is 141/141 — but it is a complete gap for the
2024 half of the picker.

### G11 — CLEAN: feat-granted spells (earlier false positive now resolved)
`grantedSpells` holds **objects**, not strings:
`grantedSpells: [{ spellId: 'misty-step', recharge: 'short', ability: 'int' }]`.
The earlier "broken refs" of `cha int long short wis` were the `ability` and `recharge` values being
scraped by a regex that grabbed every quoted string in the block. Re-run extracting only `spellId`:
**4 refs, all resolve. 0 broken.** Positive control passed. **The G-pass feat finding is formally
retracted.**

### G12 — SYSTEMIC FRAGILITY: 12 first-wins `.find()` lookups, no uniqueness guard anywhere
Every accessor resolves an id with `.find()`, so a duplicate id silently shadows — exactly how G3 and G4
hide. There is **no uniqueness check anywhere in the codebase or build**.

`backgrounds.ts:815` · `classes/index.ts:626` · `feats.ts:613` · `fightingStyles.ts:26` ·
`infusions.ts:25` · `invocations.ts:66` · `maneuvers.ts:33` · `metamagic.ts:22` · `pactBoons.ts:11` ·
`races/index.ts:2257` · `spells/index.ts:675` · `subclasses/index.ts:1237`

**Duplicate-id sweep across every data file — complete:**
| File group | Duplicates |
|---|---|
| subclasses | **1** (`circle-of-stars` → G3) |
| spells | **1** (`mind-sliver` → G4) |
| classes, races | 0 |
| feats, feats-phb2024, invocations, infusions, metamagic, maneuvers, pactBoons, fightingStyles, backgrounds, backgrounds-ggr, backgrounds-phb2024, optionalClassFeatures | 0 |

So only 2 of the 12 lookups are currently compromised — but nothing **prevents** the next one. Recommend a
cheap unit test asserting id uniqueness per collection; it would have caught G3 and G4 at commit time and
costs one test file. Add it during the fix phase.

### Still to check in Phase G
`subclass.classId` → real class · `race.parentRaceId` → real race · `spell.classes[]` → real class ids ·
`startingEquipment` → real item names · `subclassTips` keys → real subclass ids · duplicate ids within
each data file · resource-key collisions between class and subclass.

---

# FIX PLAN (for the fixing phase)

Ordered by severity × blast radius. Each item names the chokepoint, because per-call-site patching is what
made R1 take two commits instead of one.

### Tier 1 — silently destroys a character sheet
1. **D1 subclass prompt** — `LevelUpDialog.tsx:293`, change `===` to `>=`. One character. Highest
   value-per-byte in the whole audit. Verify: level a subclass-less character past its subclass level.
2. **D4 subclass build choices** — 103 candidates across 70 subclasses, **triage by hand first** to
   separate build choices from use-time choices. Needs a `subclassOptions` store slice mirroring
   `classOptions`, plus prompts in `LevelUpDialog` and the creator. Start with Circle of the Land
   (blocks spell granting entirely), Arcane Archer (5 points), Hunter, Champion.

### Tier 2 — rules are wrong at the table
3. **R2 cap enforcement** — guard in the **store**, not the panels: `useCharacterStore.toggleSpellPrepared`
   (:449) and `addSpellToBook` (:458) are the chokepoints. Covers prepared, spells known, and cantrips.
4. **C1 cleric-2024 Channel Divinity** — restores all on a short rest; should restore one.
   Blocked on R4.
5. **R4 recharge enum widening** — `'short'|'long'|'dawn'` cannot express "one on short, all on long"
   (2024 Wild Shape, 2024 Focus, C1) or multi-day cooldowns (Divine Intervention, 7 days).
   Design once, then C1 and druid-2024 fall out of it.

### Tier 3 — features exist but cannot be tracked
6. **R5 subclass resources** — 102 features / 70 subclasses. `Subclass.resources` **already exists**; only
   8 of 141 use it. Mostly data entry, no new plumbing. 52 of 70 are 2014.
7. **R3 race resources** — 31 races. Add `resources?: ClassResourceDefinition[]` to `Race`, then extend the
   class+subclass+feat loops in `load`/`levelUp`/`shortRest`/`longRest` to a fourth source. 30 of 31 are 2014.
8. **Missing class resources** — fighter-2024 Indomitable, wizard-2024 Arcane Recovery, ranger-2024
   Favored Enemy, warlock Mystic Arcanum + Eldritch Master, rogue Stroke of Luck, artificer
   Spell-Storing Item, paladin Divine Sense + Cleansing Touch, wizard Signature Spells, druid-2024
   Wild Resurgence.
9. **R6 item charges** — 39 items need `maxCharges`/`recharge`; **Scarab of Protection** needs
   `recharge: 'dawn'` (Ring of Three Wishes is correctly permanent).

### Tier 4 — 2024-only
10. **R1 remaining sites** — the 7 in the R1 table. Use `baseClassId()`/`classLevel()`, already added.
11. **D2** bard-2024 / ranger-2024 are prepared casters, not known — `LevelUpDialog.tsx:455,458`.
12. **D3** Epic Boon flagged `isASI: true` on all 12 2024 classes.
13. **A3** ghost `rage_damage` on pre-`74eb1ad` 2024 Barbarians; needs a prune that spares feat-granted
    and disabled-sourcebook resources.

### Tier 5 — cosmetic
14. **A1** level-20 Rage shows `99/99` rather than unlimited.
15. **B1** Berserker Intimidating Presence missing the 24-hour clause.

### Verify-before-merge debt
The AC fix in `74eb1ad` is **typechecked only** — CDP would not attach through `tauri dev` or a second
instance. Confirm a PHB 2024 Barbarian's AC includes CON before merging.

# EDITION PRIORITY — 2014 (user plays it more)
Measured, not assumed. The headline findings are **overwhelmingly 2014**, not 2024:
| Finding | 2014 | 2024 |
|---|---|---|
| R5 untracked subclasses | **52** | 18 |
| R3 untracked races | **30** | 1 |
| R6 untracked items | edition-agnostic (692 templates, mostly 2014-era DMG/XGtE/TCE) | — |
| R2 caps unenforced | both | both |
| R1 class-id blindness | n/a | 2024 only |
Only R1 is 2024-specific. Weight remaining work toward 2014 accordingly, and when a sweep produces a list,
report the 2014 subset first.

2014 untracked subclasses include: alchemist, armorer, artillerist, battle-smith, chronurgy-magic,
circle-of-spores, circle-of-stars, circle-of-wildfire, college-of-creation, college-of-eloquence,
drakewarden, echo-knight, fey-wanderer, graviturgy-magic, horizon-walker, monster-slayer, oath-of-devotion,
oath-of-glory, oath-of-the-ancients, oath-of-the-watchers, order-domain, path-of-the-beast,
path-of-wild-magic, peace-domain, phantom, psi-warrior, rune-knight, school-of-abjuration,
school-of-divination, soulknife, swarmkeeper, the-celestial, the-fiend, + the ToB set.

# SECOND PASS — RESULTS

## Round 1: re-verify the two numbers the fix plan is sized on
Both R5 and R3 were measured **before** the positive-control discipline was adopted, and four parser bugs
had already produced false results elsewhere. Both were therefore re-run with **independently written
parsers** plus positive and negative controls.

| Finding | First pass | Second pass | Verdict |
|---|---|---|---|
| **R5** subclasses with ≥1 limited-use feature | 90 | **90** | ✅ reproduces |
| **R5** limited-use feature lines | 133 | **133** | ✅ reproduces |
| **R3** races untracked (limited-use, no innate-spell path) | 31 | **31** | ✅ reproduces, **set diff empty** |

Controls: R5 broad pattern matched **188** subclasses (equals the known subclass count, so the parser sees
every entry); nonsense pattern matched **0**. R3 nonsense pattern matched **0**.

Minor, non-material difference: the second R3 parser counts 72 races / 85 features where the first counted
76 / 91, because the two attribute traits to nested subraces slightly differently. **The number that
matters — the 31 untracked races — is identical, and `comm -3` between the two sets is empty**, i.e. the
same 31 races exactly.

**Conclusion: Tier 3 of the fix plan is correctly sized.** R5 (102 features / 70 subclasses) and R3
(31 races) are confirmed by two independent implementations.

## Second-pass method note
Re-running a sweep with the *same* script proves nothing — it reproduces its own bugs. Every second-pass
check must be **written fresh** and carry a positive control (a pattern that must match a known
population) and a negative control (a pattern that must match nothing). That is what caught the four
first-pass parser failures, and what validated these two numbers.

## Round 2: R6 and R2

| Finding | First pass | Second pass | Verdict |
|---|---|---|---|
| **R6** items with charge text but no `maxCharges` | 39 | **39** | ✅ reproduces, **set diff empty** |
| **R6** item templates total | 692 | **692** | ✅ |
| **R6** items carrying `maxCharges` | 48 | **47** | ⚠️ **corrected — see below** |
| **R2** no cap guard in the store | asserted | **confirmed** | ✅ |

Controls: R6 nonsense pattern → **0**; match-everything pattern → **645**, exactly `692 − 47`, which both
proves the parser sees every template and independently confirms the corrected 47.

### ✏️ CORRECTION — 47 item templates carry `maxCharges`, not 48
The first pass ran `grep -c 'maxCharges:'` over the **whole file**, which included the type definition at
`items.ts:9` (`maxCharges?: number;`). Counting only item lines gives **47**. Everything derived from it
is unaffected — the 39 gap items and the 2 no-recharge items are unchanged — but the ratio is
**47 tracked of 692**, not 48.

### R2 re-confirmed directly
`useCharacterStore.toggleSpellPrepared` (:449-456) and `addSpellToBook` (:458-462) were re-read in full and
grepped for any `max` / `limit` / `cap` / `>=` / `length` comparison. **There is none in either.** The
sheet genuinely cannot refuse an over-cap pick. This was the user's originally reported bug and it is
verified twice by different means.

## Round 3: D4 triage — **AUTOMATED CLASSIFICATION FAILED. D4 needs hand review.**

Attempted to split the D4 list into *build* choices (persist on the sheet, must be prompted) and
*use-time* choices (re-chosen each activation, correctly need no prompt) using targeting language as the
discriminator. It produced `build=142, usetime=25` — already suspect, since 167 > the 103 of the first
pass (a looser match pattern), and inspection of the "build" bucket shows it is **full of false
positives**:

| Wrongly classed as a build choice | Why it isn't |
|---|---|
| `berserker` Frenzy | "you **can choose** to go into a frenzy" — a per-rage decision |
| `champion` Improved Critical | no choice at all; crits on 19–20 |
| `school-of-evocation` Evocation Savant | no choice; halves gold/time to copy evocation spells |
| `wild-magic` Wild Magic Surge | no choice |
| `thief` Second-Story Work, `arcane-trickster` Mage Hand Legerdemain | no choice |
| `oath-of-the-ancients` Undying Sentinel | no choice |
| `the-fiend` Fiendish Resilience | a real choice, but **re-chosen each rest** — use-time |

**Conclusion: no regex separates these.** The distinction is semantic — does the choice persist? — and the
descriptions do not mark it. Any automated count is noise.

**What D4 actually is, stated honestly:**
- **103** subclass features contain choice language (first-pass figure, reproducible).
- Of those, an **unknown but substantial minority** are true build choices.
- **17 confirmed by hand** so far: `arcane-archer` ×5 (lv3/7/10/15/18) · `hunter` Hunter's Prey (3) +
  Defensive Tactics (7) · `circle-of-the-land` Circle Spells (3) + Bonus Cantrip (2) · `champion`
  Additional Fighting Style (10) · `draconic-bloodline` Dragon Ancestor (1) · `college-of-lore` Bonus
  Proficiencies (3) + Additional Magical Secrets (6) · `knowledge-domain` Blessings of Knowledge (1) ·
  `nature-domain` Acolyte of Nature (1) · `rune-knight` Rune Carver (3) · `armorer` Armor Model (3) ·
  `beast-master` Ranger's Companion (3) · `bladesinging` Training in War and Song (2) · `drakewarden`
  Draconic Gift (3).
- Already handled by the app: `totem-warrior` ×3, `battle-master` maneuvers.

**Fix-phase instruction: do NOT size D4 from a sweep.** Walk the 103 by hand, mark each build/use-time,
and implement only the build ones. Start with the 17 above — `circle-of-the-land` first, since without a
land type its Circle Spells cannot be granted at all.

## Round 4: prerequisite references — CLEAN (new angle)
Same silent-failure class as Phase G, not previously checked.

- **`prerequisiteSpell`** (invocations): 2 refs, both resolve. ✅
- **`prerequisitePact`** (15 uses): values are `blade` / `chain` / `talisman` / `tome`, while pact boon ids
  are `pact-of-the-blade` etc. **This looked like a broken reference and is not.** The comparison sites
  strip the prefix explicitly —
  `i.prerequisitePact === (opts.pactBoon?.replace('pact-of-the-', ''))` at `StepClassOptions.tsx:180` and
  `LevelUpDialog.tsx:604` — and `types/index.ts:290` types the field as the short form
  `'blade' | 'chain' | 'tome' | 'talisman'`, so it is intentional and compiler-enforced.
  **Recorded as correct so it is not "fixed" into breakage.**
- **`prerequisite`** (50 uses): free text (e.g. "Strength 13 or higher"). **Not machine-checkable** — no
  structured form exists, so nothing can validate it. Flagged as an untestable surface rather than a bug;
  a future improvement would be structuring it, but that is a feature, not a fix.

## Still to re-verify in the second pass
R6 (39 items) · R2 cap sites · D4 (103 subclass choices — needs hand triage anyway) · Phase G's G1–G4
(already high-confidence: each was confirmed by direct `grep` of the specific line, not by a sweep).

# SECOND PASS (original plan)
After all phases complete and the batch fix pass lands, **start again from the beginning**. Rationale from
the user: wrong tracking and bad spell/ability data can destroy the project, so one clean sweep is not
enough. Second pass should re-run every reproducible sweep in this file (they are all greps/awk and cheap
to repeat) and diff against these recorded numbers — any drift is a regression.

---

# QUEUE
Phase A: [x] barbarian [x] barbarian-2024 [x] bard [x] bard-2024 [x] cleric [x] druid
[x] cleric-2024 [x] druid-2024 [x] fighter-2024 [x] ranger-2024 [x] wizard-2024 [x] warlock-2024
(resource layer swept for ALL 25; per-class **feature-by-feature** passes still owed for:)
[ ] fighter [ ] monk [ ] monk-2024
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
Entities audited: resource layer swept for all 25 classes; feature-level passes done for 6. Of 336 total: 12.
Caveat: inflated by R1, one systemic cause touching nearly every class. Per-class **data** errors are so far
rare — bard, cleric and druid numbers were all perfect against the book. The real defects are structural:
R1 (2024 blindness), R2 (caps not enforced), R3 (races untrackable), R4 (recharge enum too narrow).

---

## Round 5 findings (batch 9 runtime verification, 2026-07-30)

Found by *looking at the rendered sheet*, not by reading data. Each was invisible to
`tsc -b --force` and to every static sweep run so far.

### R7 — FIXED: override-managed resources loaded at the placeholder value, not full
`load()` inserts a resource with `current = maxPerLevel[level]`, which for any
ability-mod / prof-bonus resource is a placeholder of `1`. The override pass then ran
`current: Math.min(r.current, override)`, so the character opened their sheet with **one
use of a resource that should have been full**. A Wisdom 18 Light Domain cleric showed
1/4 Warding Flares.

Scope: every override-managed key, i.e. everything added in R5 batches 1–9 plus
`divine_sense`, `cleansing_touch`, `psionic_energy`, `star_map`, `cosmic_omen`,
`emboldening_bond`, `restore_balance`, `perfected_armor`, `perfected_bond`,
`writhing_tide`, `swarming_dispersal`, `unleash_incarnation`, `momentary_stasis`,
`deprive_the_unworthy`.

Fixed in `ad41d8c` with a `preexisting` key snapshot taken before the insertion passes:
already-saved keys keep the clamp (a stat drop must lower the max without refilling spent
uses), brand-new keys start full.

### R8 — FIXED: `load()` was not idempotent (input-array aliasing)
`let resources = c.resources ?? []` then `resources.push(...)` **mutates the caller's
character**. The override pass rebuilds entries with `.map()`, so the caller's array kept
the *pre-override* values. A second `load()` — which React StrictMode guarantees in dev,
and any re-navigation causes in prod — saw those as previously-saved and clamped back down.

This is why R7's fix alone still rendered 1/4. Fixed by copying the array.

**Methodology note:** R7 and R8 are the strongest argument yet for runtime verification.
Both are in the single highest-traffic function in the store, both survived every static
sweep, and R8 in particular can only be seen by loading the same character twice.

### R9 — FIXED in `3543da1`, and it was NOT cosmetic (see correction below)
`SheetPage.tsx:2182` and `:2204` both do `Math.min(displayMax === 99 ? 20 : displayMax, 20)`.
There is no number anywhere in the card — the pip count *is* the readout. So a level-20
paladin's Lay on Hands pool (100 hit points, data is correct) renders as **20 pips**, and
the sheet asserts a wrong number with nothing to signal it was truncated. Arcane Ward hits
this too above 20 (wizard 9+ with a positive Int mod).

Clicking still decrements from the true `current`, so the underlying value is fine — it is
purely that what the player reads is wrong.

Not fixed here: it is a display change outside R5's scope. The fix is presumably to switch
to a numeric `current / max` readout above some threshold rather than raising the cap;
100 pips is not a usable control either.

### R10 — OPEN (low, rare): Psi Warrior and Soulknife share one `psionic_energy` pool
Both subclasses define the key `psionic_energy`. TCE gives each its own pool, so a
Fighter (Psi Warrior) / Rogue (Soulknife) multiclass gets one counter where it should have
two. Harmless for single-class characters, which is why it has not surfaced. The
ownership check now allow-lists the one legitimate duplicate (`bladesong`, the same
subclass reprinted in SCAG and TCE) and flags this one.

### Text corrections made in passing
- **the-archfey / Dark Delirium** claimed "The creature can repeat the saving throw at the
  end of each of its turns, ending the effect on a success". PHB p.109 has **no repeat
  save**; the effect ends early only if the creature takes damage. The misty-realm
  description was also missing. Both corrected.
- **school-of-abjuration / Arcane Ward** was missing the damage-absorption rule, the
  "regains 2x spell level when you cast an abjuration spell" rule, and the
  once-per-long-rest creation limit. Corrected.

Both entries had passed earlier text audits, which reinforces B1's note: those passes were
not exhaustive.

### Sweep correction — the R5 ready list was under-counted
The subclass scanner searched descriptions for `can't use it again until`, but descriptions
store escaped apostrophes (`can\'t`), so **every feature using that phrasing was silently
missed**. Unescaping before matching recovered 4 more features (Fey Presence, Misty Escape,
Indestructible Life, scag-swashbuckler Master Duelist). Current ready list: **36 subclasses,
51 features**, of which 6 subclasses / 9 features are done as of `ad41d8c`.

This is parser artifact #6. The positive/negative controls caught two *other* failures in
the same scan (a `\n  {\n` entry pattern that matched nothing, and a regex that failed to
compile) but could not catch this one, because the control subclasses were all found — the
loss was inside the feature-level filter, one level below what the controls checked.
**Controls must be placed at every level a sweep filters, not only at the outermost one.**

---

## SCOPE CORRECTION — R5 was under-counted by roughly half (2026-07-30)

Found while adding ToB: Captain's Call is a textbook R5 resource (uses = 1 + Cha
modifier, long rest, die scaling d6/d8/d10) that **every scan so far had reported as
absent**. Chasing why exposed two more parser artifacts and one blind spot in the method.

### Artifact #7 — features with an apostrophe in the NAME were dropped entirely
The feature regex was `\{ name: '([^']+)', level: ...`. A name stored as `Captain\'s Call`
terminates `[^']+` at the backslash, the following `', level:` doesn't match, and the whole
feature — name, level and description — is silently skipped. Every possessive feature name
in the file was invisible: Captain's Call, Sentinel at Death's Door, Hunter's Sense,
Dark One's Own Luck, Hexblade's Curse, Giant's Might, Drake's Breath, Genie's Vessel.

Note this is the *same class of bug* as artifact #6 (escaped apostrophes in descriptions)
appearing in a different capture group. Fixing one did not fix the other, and the
subclass-level controls passed throughout both.

### Blind spot — the sweep only matched the phrasings I happened to think of
`Uses = 1 + Charisma modifier per long rest` is a perfectly clear limit that matched none
of the nine patterns, because they were all written from the PHB's phrasing
("once per…", "regain all expended uses…", "can't use it again until…"). The data files
paraphrase, and paraphrases vary by whoever entered them. Added `uses =`, `uses equal to`,
`per short/long rest`, and `N/short rest`.

### Artifact #8 — the gap checker read only one of three resource layouts
`resources:` entries appear three ways in this file: name+key on one line single-quoted,
the same double-quoted (`"Dark One's Own Luck"`, quoted that way to dodge escaping), and
name/key on separate lines (battle-master). A single-layout regex reported the-fiend and
hexblade as having *no resources at all*. Now sliced by bracket matching instead.

### Revised numbers

| | before | after |
|---|---|---|
| new subclasses still needing resources | 12 | **17** (23 features) |
| limited-use features inside subclasses already marked done | not checked | **23** |

The second row is the one that matters: the main scan skips any entry that already has a
`resources` block, so a subclass counted as finished could still hide untracked features —
and 23 do. Examples: the-fiend **Hurl Through Hell** (1/long), hexblade **Accursed Spectre**,
rune-knight **Giant's Might** and **Master of Runes**, oath-of-glory **Glorious Defense**,
echo-knight **Shadow Martyr** and **Reclaim Potential**, chronurgy **Chronal Shift** and
**Arcane Abeyance**, graviturgy **Adjust Density** / **Violent Attraction** / **Event Horizon**.

Those 23 need per-feature triage against the book, not bulk addition — an unknown fraction
legitimately draw on a pool that is already tracked (Psi Warrior's Bulwark of Force spends
Psionic Energy Dice; Ascendant Dragon's Breath of the Dragon spends ki) and correctly need
nothing. Triage is R5 work, not a new root cause.

### Method change
The three scanners now live in `tools/audit/` instead of the scratchpad, so the next pass
starts from the fixed versions rather than rewriting them and re-earning the same artifacts.
`r5scan.py` now asserts **feature-level** controls — including one feature with an
apostrophe in its name and one in its description, the two escaping shapes that have each
broken it once. This is the concrete form of the lesson from artifact #6: controls belong at
every level a sweep filters. Subclass-level controls passed during all four artifacts.

Running tally of sweeps that reported a clean or complete result and were wrong: **8**.
Every one of them under-reported. None has ever over-reported. Treat any "nothing found"
from a hand-written sweep over this codebase as unproven until it has a control at the level
that does the filtering.

---

## R5 final phase — triage of the 24 features inside already-done subclasses

Source-checked one at a time. The question for each: does it have its own limit, or does
it spend a pool the sheet already tracks?

### Needs its own resource — CONFIRMED against the book (13)

| Subclass | Feature | Lvl | Limit |
|---|---|---|---|
| the-fiend | Hurl Through Hell | 14 | 1 / long |
| circle-of-dreams | Hidden Paths | 10 | Wis mod (min 1) / long |
| hexblade | Accursed Specter | 6 | 1 / long |
| psi-warrior | Bulwark of Force | 15 | 1 / long |
| oath-of-glory | Glorious Defense | 15 | Cha mod (min 1) / long |
| fey-wanderer | Misty Wanderer | 15 | Wis mod (min 1) / long |
| soulknife | Psychic Veil | 13 | 1 / long |
| soulknife | Rend Mind | 17 | 1 / long |
| alchemist | Restorative Reagents | 9 | Int mod (min 1) / long |
| echo-knight | Shadow Martyr | 10 | 1 / short |
| echo-knight | Reclaim Potential | 15 | Con mod (min 1) / long |
| chronurgy-magic | Chronal Shift | 2 | 2 / long |
| drakewarden | Drake's Breath | 11 | 1 / long |

Note the recurring shape in TCE psionics: Bulwark of Force, Psychic Veil and Rend Mind are
each *once per long rest, **or** spend Psionic Energy dice to use again*. The dice are
already tracked, so only the rest-limited use gets a counter — the die spend is an
alternative cost, the same call made for Warping Implosion and Living Legend.

### Correctly needs nothing (3)
- **graviturgy Adjust Density** and **Event Horizon** — concentration effects with no use
  limit. They matched the sweep on incidental wording.
- **tide-watchers Pull of the Tides** — picks a tidal aspect at the end of each long rest;
  a per-rest choice, not a counter. Already annotated in the entry so a later pass does not
  re-add it.

### Still to verify (7)
- **rune-knight Giant's Might** — extract landed on Runic Juggernaut's text; needs a clean read.
- **rune-knight Master of Runes** — not a counter itself; it upgrades rune invocations from
  once to twice each. The invocations are untracked and belong to **D4** (per-rune, depends
  on which runes were chosen).
- **way-of-the-ascendant-dragon Draconic Disciple** — contains a "once per long rest" reroll
  buried as a sub-bullet (Draconic Presence); confirm before adding.
- **way-of-the-ascendant-dragon Breath of the Dragon** — free uses vs the ki spend need separating.
- **drakewarden Drake Companion** — summon limit vs the spell-slot alternative.
- **the-genie Genie's Vessel** — the wish-like effect recharges after **1d4 long rests**;
  blocked on **R4** like Limited Wish.
- **chronurgy Arcane Abeyance** — recharge clause not yet read in full.

### What this phase already produced
Checking *Violent Attraction's level* against EGtW — a step taken only because it appeared on
this triage list — uncovered that the whole **Graviturgy Magic** subclass sat a tier early
with a fabricated 14th-level feature (`8e6f343`). That bug had nothing to do with resources
and would not have been found by any sweep over the app's own data, which was internally
consistent and typechecked clean. It is the second fabricated feature the audit has found,
after the Drakewarden mislabel. **Both were caught by checking a feature NAME against the
book.** That check deserves to be its own pass over all 141 subclasses, and is not yet done.

---

## Feature-name verification pass — 730 names across all 141 subclasses

Run because the two fabricated features found so far (Graviturgy's "Deprive the
Unworthy", Drakewarden's mislabelled "Reflexive Resistance") were each caught by checking
a NAME against the book, and neither was reachable by any sweep over the app's own data —
which was internally consistent and typechecked clean. Two hits in roughly fifteen
subclasses read closely by hand looked like a rate worth measuring across all of them.

Tool: `tools/audit/namecheck.py`. Normalises apostrophe styles, dashes and whitespace, and
asserts a feature-level control plus a per-entry positive control (the subclass's own name
should appear in its own book).

### Result: no new fabricated features. 57 misses, all explained.

| Cause | Count | Verdict |
|---|---|---|
| App prefixes `Channel Divinity: ` where the book uses a bare name under a heading | ~12 | naming convention |
| App-invented progression labels (`Additional Arcane Shot`, `X Improvement`, `Fighting Spirit Improvement`) for "you learn another at level N" table rows | ~14 | naming convention |
| SCAG entries reprinted in XGtE — the SCAG extract says so explicitly and does not repeat them (Mastermind, Swashbuckler) | 10 | source-extract gap |
| SCAG extract omits Arcana Domain and the Elk/Tiger totem options entirely | 11 | source-extract gap |
| Sub-labels (`Eyes of the Dark: Darkness Spell`, `Expanded Spell List`, totem `— Elk` suffixes) | ~9 | naming convention |
| **cobalt-soul** | 7 | **see below** |

This is a genuine negative result and it bounds the risk: the two known fabrications were
isolated, not the tip of a pattern. Feature names across the codebase are trustworthy.

### It did find two real things

**1. `cobalt-soul` is attributed to the wrong book.** The EGtW extract states plainly:
*"Cobalt Soul Monk subclass is NOT in EGtW. The Cobalt Soul is only a faction/background
flavor. The playable monk subclass is from Tal'Dorei Campaign Setting Reborn."* The app
ships it as `sourceBook: 'EGtW'`. Consequence: a player who owns EGtW and enables it gets a
subclass their book does not contain, and cannot find it when they go looking.

Not fixed — there is no `TDCSR` BookId, so the fix is either a new book entry or a
re-attribution, and that is a product decision rather than a correction. (An earlier session
already recorded Cobalt Soul as "memory-only, EGtW missing"; this pass explains *why*.)

**2. ToB and AcqInc were in the `BookId` union but absent from the `BOOKS` registry**,
making 65 content entries permanently unreachable — 22 ToB subclasses, 22 ToB spells,
8 ToB backgrounds, 7 AcqInc spells, 5 AcqInc backgrounds, 1 AcqInc race. Fixed in
`2dda1a4`. This includes the nine ToB subclasses R5 had just finished giving resources to.

**Why no sweep would have caught #2 either.** Every check the audit runs starts from the
data files and asks whether the data is right. This bug is a broken join *between* two files
that are each internally correct: `BookId` is a valid union, `BOOKS` is a valid array, and
every `sourceBook: 'ToB'` is a valid BookId. Nothing is malformed; the registry is simply
short two rows. It typechecks because `BOOKS` is `Book[]`, not an exhaustive
`Record<BookId, Book>` — a type that would have made this impossible to write.

**Worth considering:** changing `BOOKS` to a `Record<BookId, Book>` (or adding a
`satisfies` exhaustiveness check) would turn this class of bug into a compile error. That is
a code change rather than a data fix, so it is recorded here rather than made.

---

## ✏️ CORRECTION — R9 was misclassified as cosmetic. It was silent data loss.

I logged R9 under "display only — clicking still decrements from the true `current`, so the
underlying value is fine". **That was wrong, and it was wrong because I read only one of the
two branches.** The active branch does derive from `r.current`. The inactive branch — which
is the one ordinary resources like Lay on Hands actually render through — derived the next
stored value from the clamped display number:

```ts
const cappedCurrent = Math.min(r.current, cappedMax);   // 100 -> 20
onClick={() => setResource(r.key, available ? cappedCurrent - 1 : cappedCurrent + 1)}
```

Measured on a level-20 paladin: pool 100/100, one click, stored value **19**.

**Scope was also understated.** I described it as a level-20 problem. Lay on Hands is
5 × paladin level, so the pool passes 20 at **level 5** — every paladin from 5th up was
exposed, and the sheet showed a full-looking row of 20 dots the whole time.

Fixed by replacing both call sites with one `ResourceCounter` component. The invariant it
enforces is the general lesson: **a display may be summarised; a value written back never
may be.** Pips ≤ 20 (unchanged), numeric stepper above, "∞ — no limit" for the sentinel.

### Why the audit's own methods missed it

Every earlier check read the resource *data* and asked whether the numbers matched the book.
Lay on Hands' data was correct at every level — `maxPerLevel` says 100 at 20th, and I had
verified exactly that. The defect was entirely in the render path, and it only becomes
visible if you **click** rather than read.

That is a gap in the verification habit, not a one-off. Every R5 batch this session was
"verified at localhost:5173" by *reading* the rendered counter. Reading proves the max is
right; it cannot prove that using the resource does the right thing. Two of the three
most serious bugs found today — this one and the `load()` idempotence bug (R8) — required
an interaction, not an observation.

**Change to the method going forward: after seeding a sheet, spend one use of at least one
resource and re-read, rather than only reading the initial state.** It costs one extra
click per batch and it is the only thing that would have caught either bug.

---

## Rest-mechanics verification — the first interaction-based pass (2026-07-30)

Direct consequence of the R9 correction. Roughly 80 resources were added this session with
`rechargeOn: 'short' | 'long'`, and **not one had ever been rested**. Every batch was
verified by reading the rendered counter, which proves the max is right and proves nothing
about what resting does. This pass spends uses and then rests.

### Result: the rest system is correct. No defects found.

Test 1 — **mixed short/long on one sheet** (Ancients paladin 20: one short-rest resource
among five long-rest ones, including the 100-point Lay on Hands pool):

| step | Channel Divinity (short) | the five long-rest resources |
|---|---|---|
| initial | 1/1 | full |
| spend one of each | 0/1 | each down exactly 1 (incl. Lay on Hands 99/100) |
| **short rest** | **1/1 refilled** | **all five still spent** ✅ |
| **long rest** | 1/1 | **all five refilled** ✅ |

The middle row is the one that matters — it is the negative control. A short rest that
refilled long-rest resources would be invisible to every static check the audit runs.

Test 2 — **partial regain** (`shortRestRegain`, previously listed under verify-before-merge
debt as typechecked but never run). 2024 Cleric, Channel Divinity 3 uses, rule is "regain
one on a Short Rest, all on a Long Rest": spent all three → **0/3**, short rest → **1/3**.
Exactly one back, not a refill. ✅

An earlier attempt at this test read 2/3 → 3/3 and looked like a pass. It was not a valid
test: from 2/3, "+1" and "refill" are the same number. **A partial-regain test only proves
anything from a state more than one below max.**

Test 3 — **race-granted resources in both directions** (R3's plumbing):
- Dragonborn Breath Weapon (short): spent → 0/1, short rest → 1/1 ✅
- Half-Orc Relentless Endurance (long): spent → 0/1, **short rest → still 0/1**, long rest → 1/1 ✅

### Test-harness lessons worth keeping

1. **Re-query the button on every click.** The resource card is replaced on each re-render,
   so a held reference goes stale and later clicks hit a detached node. A first attempt at
   "spend all three" landed one click and read 2/3 — which would have been reported as the
   feature working.
2. **A test whose pass and fail states produce the same number is not a test.** See the
   2/3 → 3/3 case above.

Both of these produced a *false pass* on the first attempt. Added to the running tally: the
sweep-artifact count stands at 8, all under-reporting; these two are the first false
positives, and both came from the interaction harness rather than a parser.

---

## R3 CLOSED — 27 races, plus a re-sync bug that would have frozen them (2026-07-30)

See `8b02f8d`. Swept all 112 races with `tools/audit/r3scan.py`.

The scanner's important design point: **24 of the 59 flagged traits are innate SPELL
traits** (Drow Magic, the nine Tiefling Legacies, Fairy Magic, Githyanki Psionics…), and
those are already tracked by a separate `innateSpells` system with its own per-spell
counter in SpellPanel. Reporting them as untracked would have manufactured ~24 fake
findings. The scanner splits on whether the race carries `innateSpells` rather than
guessing from the trait text.

### The bug the work exposed
`load()`'s resource re-sync loop iterated only `c.classes`. Race maxes were therefore
never recomputed after character creation — every proficiency-bonus race trait would have
sat at its level-1 value for the entire campaign (Shifter 4→5 keeps 2 uses instead of 3).
The eleven PB race resources added in the same commit would have been **born broken**.

This is the third bug of the session found *while implementing* rather than by any sweep,
after R7/R8 (`load()` idempotence) and R9 (the pip-clamp data loss). All three live in
`load()` or the render path — the two places the audit's data-oriented checks never look.

### Resolved: the Goliath disagreement
Deferred earlier because "sources disagree". They do not — they are **different printings**.
VGM's Goliath has Stone's Endurance once per short or long rest; MMoM's reprint makes it
proficiency-bonus uses per long rest. The app's entry is `sourceBook: 'VGM'`, so the VGM
rule is the correct one for it. Shifting has the identical split (ERLW 1/short vs MMoM
PB/long) and both now render per their own book.

**Generalisable:** when two sources disagree about a rule, check whether the app's entry
names one of them before treating it as ambiguous. It usually does.

### Still open, and NOT R3 (different root cause)
Three races grant spells through trait text but have **no `innateSpells` entry at all**:
`deep-gnome` (Gift of the Svirfneblin), `duergar` (Duergar Magic), `erlw-aberrant-dragonmark`.
The consequence is worse than a missing counter — the spells are not castable from the sheet
at all. This is an **innateSpells coverage gap**, and it deserves its own sweep across all
112 races: which spell-granting traits have no matching `innateSpells` entry.

### Deliberately no counter
- `giff` **Firearms Expert** — recharges "when you reload", which is neither a rest nor a
  daily budget. A counter would be noise.
- `simic-hybrid` **Animal Enhancement** — a build choice (Manta Glide / Nimble Climber / …),
  belongs to D4.

---

## The four deferred decisions — resolved

All four were saved for the user rather than guessed at. Their answers, and what shipped:

### 1. Cobalt Soul's book attribution — hide it
Way of the Cobalt Soul is filed under `EGtW`, but Wildemount's own text names the Tal'Dorei
Campaign Setting as the source; the subclass is not in EGtW at all. Verdict: hide it until
TDCSR is registered as a book.

Implemented as `Subclass.hidden`, checked **inside `bookEnabled`** rather than at the two
subclass pickers. That is the root-cause placement: all 24 callers of `bookEnabled` are
availability filters and none of them render an already-chosen entry, so one guard hides the
entry from every picker in the app and cannot make a feature vanish from a character who
already took it. Verified both halves — an existing Cobalt Soul monk still renders its
subclass name and features, and the level-up subclass list shows ten monk subclasses across
PHB/XGtE/TCE/FToD with Cobalt Soul absent.

The creator's `StepSubclass` filter is the same single `bookEnabled` call and has no second
path, but it was **not** driven directly: the creator starts at level 1, where the subclass
step is inert, so reaching it needs a level-3 start. Verified by shared predicate, not by
observation.

### 2. Shared `psionic_energy` key — split
Psi Warrior and Soulknife each grant their own pool, so a Fighter/Rogue holding both drew
them from one counter. Split into `psionic_energy_psi_warrior` / `psionic_energy_soulknife`,
with the subclass named in the display label so the two rows are distinguishable.

**The split needed a migration, and the reason is a render-path detail:** the resource panel
falls back to `resourceDef?.name ?? r.key`, so a saved key no definition claims any more
renders as its raw string. Renaming the key without migrating would have put a literal
`psionic_energy` row on every existing Psi Warrior's sheet. `load()` renames the saved entry
before `preexisting` is computed, so spent uses survive the migration.

Verified on a seeded pre-split save (Fighter 3 Psi Warrior / Rogue 3 Soulknife carrying the
old `psionic_energy` at 2/4): the migrated pool came back **2/6** — max corrected, spent uses
kept, not refilled — and the newly inserted Soulknife pool **6/6**. Then spending one
Soulknife die moved that pool to 5/6 and left Psi Warrior at 2/6. Independence proven by
interaction, not by reading two counters.

### 3. Typing `BOOKS` — keyed registry
`BOOKS` is now `Object.values` of a `{ [K in BookId]: Book & { id: K } }` literal. A book id
in the union with no registry entry is a compile error, and the mapped type pins each entry's
`id` to its own key so a typo fails too. **Control run:** adding `'TDCSR'` to `BookId` with no
registry entry produced `TS2741: Property 'TDCSR' is missing` at `books.ts:8`, then reverted.

This closes the gap class that produced B1 — AcqInc and ToB content shipped citing books the
registry had never heard of, which meant no badge, no book-picker entry, and no way to enable
the content at all. That was a broken join between two files each internally consistent, which
is precisely what no single-file sweep can see.

### 4. Deep Gnome / Duergar spell ability — add a choice
MMoM lets the player pick Int, Wis or Cha; the data held one value (Int). Added
`Race.innateSpellAbilityChoice` + `Character.innateSpellAbility`, with each `InnateSpell`'s own
`ability` as the fallback for characters saved before the choice existed.

The picker sits in the sheet's Racial Innate Spells header, **not** in the creator. Race cannot
change after creation, so one control on the sheet reaches new and existing characters alike —
whereas a creator-only picker would have reproduced D4's exact failure (a choice that exists at
creation and is unreachable afterwards). Verified: Deep Gnome shows an INT/WIS/CHA select,
switching it to CHA changes both spell rows to CHA, the value persists to localStorage and
survives a reload through `load()`. Negative control: Tiefling, which has innate spells but no
choice, renders the panel with its fixed CHA and **no** select.

---

## Pre-release smoke test (2026-07-30)

### The intended test could not be run: there are no real characters on this machine
The plan was to load the user's own saved characters — the one population synthetic seeds
cannot imitate. The installed app's WebView2 localStorage
(`%LOCALAPPDATA%\com.nabil.dndsheet\EBWebView\Default\Local Storage\leveldb`) holds exactly
**one** character, `own-test-1` "Thorin Oakshield" (playerName "Ana"), a fixture from the
proxy/roll-call work. No other Tavern Sheet WebView2 profile exists on the box.

Ruled out rather than assumed: `dnd_cm_library_v1` appears in **none** of the `.ldb` files,
and those files are 90–100% printable bytes, so no compacted older/larger library is hiding
behind snappy compression. The single value in `000010.log` is the current one.

That real save was loaded through the modified `load()` anyway: renders clean, no console
errors, Arcane Recovery intact, no raw-key rows.

### Substitute A — override keys, checked exhaustively (`tools/audit/keycheck.py`)
An override naming a key no definition declares is a **silent no-op**: `load()` applies
overrides by mapping over resources already present, so a typo'd or renamed key leaves the
feature on its placeholder max with nothing on screen to show for it. That is the R7 shape,
and the `psionic_energy` split had just created two new override keys.

- 157 declared resource keys, 52 override keys in each implementation.
- `computeResourceMaxOverrides` (store) and `resourceMaxOverrides` (derived) are **identical
  sets** — no drift between the two mirrored implementations.
- **Zero dangling override keys.**

### Substitute B — `maxPerLevel` coverage (`tools/audit/maxtables.py`)
`load()` reads `rd.maxPerLevel[level] ?? 0`, so a missing level silently becomes max 0, which
on the sheet is indistinguishable from a fully expended feature. Swept all 157 keys: 132
literal tables, 24 helper-built (`profBonusByLevel` / `fromLevel` / `atEveryLevel`), 1 flat
feat `max`. The sweep asserts the three buckets account for every declared key rather than
silently skipping what it cannot parse — the first draft *did* silently skip 22 blocks and
would have reported clean over 86% of the corpus.

**One finding: `fighting_spirit` (Samurai) had no entries for levels 1–2.** Harmless today
(the subclass cannot be held below fighter 3) but it was the only table in 157 with a gap,
and the gap is the exact shape that reads as 0/0. Filled in.

### Substitute C — 14 realistic builds rendered end-to-end
Level-20 representatives of every resource shape, checked against the books:

| Build | Rendered | Verdict |
|---|---|---|
| Fighter 20 Battle Master | Action Surge 2, Second Wind 1, Indomitable 3, Superiority d12 ×6 | ✅ |
| Cleric 20 Life | Channel Divinity 3, Divine Intervention 1 + its `special` note | ✅ |
| Bard 20 Lore (half-elf) | Bardic Inspiration d12 ×4 — Cha 16+2 racial = 18, mod +4 | ✅ |
| Monk 20 | Ki 20/20 (exactly at PIP_LIMIT, still pips) | ✅ |
| Paladin 20 Devotion | Lay on Hands as the numeric stepper 100/100 | ✅ |
| Sorcerer 20 Draconic (dragonborn) | Sorcery Points 20, Breath Weapon 1 | ✅ |
| Artificer 20 Armorer | Infused Items 6, Flash of Genius 3 (Int), Perfected Armor 6 (PB) | ✅ |
| Barbarian 20 Totem / Druid 20 Land | Rages and Wild Shape both "∞ — no limit" | ✅ |
| Rogue 20 Soulknife | Psionic Energy **d12**, Psychic Veil, Rend Mind | ✅ |
| **Fighter 10 Psi Warrior / Rogue 10 Soulknife** | **two** Psionic pools, 12/12 each, both d8, plus Fey Step 6 | ✅ |
| Barbarian 1 (goliath) | Rages, Stone's Endurance | ✅ |
| Ranger 20 Gloom Stalker | no panel — Ranger is `resources: []` and the subclass has no block | ✅ correct |

**Zero raw snake_case rows across all 14.** The multiclass row is the one that matters most:
it is the build the `psionic_energy` split exists for, and it now shows two independent pools
at the right size and the right die.

### What this does and does not establish
It establishes that the resource layer is correct across every shape the app can produce. It
does **not** establish anything about the user's real characters, because there are none here
to test. If characters exist on another machine or in Drive sync, that check is still owed.

---

# PHASE B / PHASE C — sweeps run 2026-07-30 (log-only)

## B2 — subclass spell grants are missing on at least 11 subclasses that grant spells in RAW
`tools/audit/spellgrants.py`. Parsed all **189** subclasses (141 + 48) and split them by class into
"has a spell-grant field" (`alwaysPreparedSpells` / `landSpells` / `expandedSpells`) vs not.

Controls: `circle-of-the-land` must have a grant (it does), `champion` must not (it doesn't).

| class | with | without | verdict |
|---|---|---|---|
| cleric | 17 | 2 | **both gaps** — `tob-island-domain`, `tob-sea-domain` |
| paladin | 12 | 2 | **both gaps** — `tob-oath-of-greed`, `tob-oath-of-the-deep` |
| **artificer** | **0** | **4** | **all four are gaps** |
| warlock | 10 | 4 | 2 confirmed gaps (`the-genie`, `scag-the-undying`) |
| druid | 3 | 10 | 2 confirmed gaps (`circle-of-spores`, `circle-of-wildfire`) |
| ranger | 2 | 11 | 2 confirmed gaps (`fey-wanderer`, `swarmkeeper`) |
| sorcerer | 0 | 14 | 1+ confirmed gap (`aberrant-mind`) |
| bard/barbarian/fighter/monk/rogue/wizard | — | all | expected; these grant no list in RAW |

**Confirmed against the books this turn (11):**
- `alchemist` / `armorer` / `artillerist` / `battle-smith` — TCE "Alchemist Spells" (p.123 of the
  extract), "Armorer Spells" (162), "Artillerist Spells" (205), "Battle Smith Spells" (235). Every
  Artificer specialist has a Specialist Spells table and **none of the four is implemented**, so an
  Armorer never receives *magic missile*/*thunderwave* at all.
- `circle-of-spores` — TCE 657: "Circle Spells (2nd) … Always prepared (don't count against limit)".
- `circle-of-wildfire` — TCE 725: same shape.
- `fey-wanderer` — TCE 1071: "Fey Wanderer Magic (3rd): Additional spells … don't count against
  spells known".
- `swarmkeeper` — TCE 1107: "Swarmkeeper Magic (3rd)".
- `aberrant-mind` — TCE 1250: "Psionic Spells (1st): Additional spells (always known)".
- `the-genie` — TCE 1405: "Genie Expanded Spells".
- `scag-the-undying` — SCAG 202: "Expanded Spells".

**Correctly absent, checked so the list is not assumed uniform:** `drakewarden` (FToD grants a drake
companion, no spell table) — proof that the "without" column is a triage list, not a defect list.

**Still to triage against the books:** `clockwork-soul` (TCE names it differently from the pattern
searched), the remaining XGtE druid/ranger circles and archetypes, the ToB entries, and all 48 of the
2024 set. Severity: **high** — an unimplemented always-prepared list is a feature the player paid a
subclass for and never receives, and nothing on the sheet indicates its absence.

## B3 — every spell id referenced anywhere resolves (clean, and worth recording)
`tools/audit/spellrefs.py`. A dangling id is *silent*: `getSpell()` returns undefined and the render
path skips the row, so a granted spell simply never appears — invisible to a text-accuracy audit,
which reads descriptions rather than ids.

Swept `alwaysPreparedSpells`, `landSpells`, `expandedSpells`, `innateSpells`, `grantedSpells` and
`spellList` across subclasses (both editions), races (both), feats (both) and classes (both):
**615 raw references, 223 distinct ids, 0 dangling**, against a corpus of 547 spells.

Note the asymmetry with B2 — every reference that *exists* is valid; the defect is the references
that were never written. A referential-integrity check cannot see a missing feature, which is why
B2 needed a per-class roster instead.

## C1 — racial fly / climb / swim speeds are declared, unset, and unread
Three separate layers each fail, which is why neither a data sweep nor a code sweep alone would find it:

1. **Type**: `Race` declares `swim?`, `fly?`, `climb?` (`src/types/index.ts`).
2. **Data**: across all 112 races, `fly` is set **0 times** and `climb` **0 times**; `swim` is set 3
   times (`lizardfolk` :477, `triton` :520, `sea-elf` :1032).
3. **Code**: nothing reads them. `useCharacterDerived.ts:243` computes
   `(race?.speed ?? 30) + featSpeedBonus + monkSpeedBonus + barbFastMovement` and the sheet renders a
   single `{speed} ft` (`SheetPage.tsx:530`). The only `.fly`/`.climb`/`.swim` readers in the repo
   belong to the **Wild Shape beast-form** system (`beastForms.ts`, `WildShapeModal.tsx`,
   `AlternateFormPanel.tsx`), which uses its own `speed` object and is unrelated.

So even the three races that *do* set `swim: 30` have it silently discarded, and races whose defining
trait is flight carry it only as prose:

| race | trait text present | speed data |
|---|---|---|
| `aarakocra` | "Flight — flying speed equal to your walking speed" | `speed: 30`, no `fly` |
| `fairy` | "Flight — flying speed equal to your walking speed" | `speed: 30`, no `fly` |
| `owlin` | "Flight — thanks to your wings…" | `speed: 30`, no `fly` |
| `hadozee` | "Climb Speed — climbing speed equal to your walking speed" | no `climb` |
| `tabaxi` | "Cat's Claws — climbing speed of 20 feet" | no `climb` |
| `lizardfolk` / `triton` / `sea-elf` | swim in text | `swim: 30` set, **never read** |

Severity: **high** for the flying races — flight is the single mechanical reason to pick Aarakocra,
Fairy or Owlin, and the sheet shows a plain 30 ft walk. Note this is the same shape as B1 and the
AcqInc/ToB registry gap: **two files that are each internally consistent, joined by nothing.**

## C2 — R3 and the innate-spell coverage sweep re-run clean (regression check)
Both existing sweeps reproduce their recorded numbers exactly:
- `r3scan.py`: 40 races flagged, 41 traits, **5 genuinely untracked** — of which 3 (`giff`, `kobold`,
  `shadar-kai`) already carry a resource and are flagged for an unrelated reason, leaving
  `erlw-aberrant-dragonmark` and `simic-hybrid` (a build choice → D4).
- `innatescan.py`: entry control ok at 112 races; exactly **1** race grants a spell in trait text with
  no `innateSpells` entry — `erlw-aberrant-dragonmark`, unchanged.

The racial *resource* layer closed by R3 is therefore still closed. Phase C's remaining exposure is
ASIs, speeds (C1), darkvision, resistances, proficiencies and languages — not limited-use tracking.

---

# ROOT CAUSE R11 — every build-option list is book-filtered against books its own class never enables

Found by the Phase D workflow (two agents, independently, on different caps), then generalised and
confirmed at runtime with matched controls.

## The mechanism
Three facts that are individually reasonable and jointly fatal:

1. **The edition toggle is exclusive.** `StepBooks.tsx:17-27` — `selectPhbEdition('2024')` does
   `next.delete('PHB'); next.add('PHB2024')`. A 2024 character's `enabledBooks` therefore contains
   `PHB2024` and **not** `PHB`.
2. **Every option list is filtered by `bookEnabled`.** `StepClassOptions.tsx:165,183,187,197,208,219,224`
   and `LevelUpDialog.tsx:610,642,648,652,656,662` — thirteen sites, all the same predicate.
3. **No option entry declares `PHB2024`, and none has an `alsoIn`.** Across all seven option files —
   146 entries — the count of `PHB2024` is **0** and the count of `alsoIn` is **0**:

| file | entries | sourceBooks present | `PHB2024` | `alsoIn` |
|---|---|---|---|---|
| `invocations.ts` | 54 | PHB 32, XGtE 14, TCE 8 | 0 | 0 |
| `metamagic.ts` | 10 | PHB 8, TCE 1, XGtE 1 | 0 | 0 |
| `maneuvers.ts` | 23 | PHB 16, TCE 7 | 0 | 0 |
| `infusions.ts` | 17 | TCE 17 | 0 | 0 |
| `pactBoons.ts` | 4 | PHB 3, TCE 1 | 0 | 0 |
| `fightingStyles.ts` | 15 | PHB 6, TCE 6, XGtE 3 | 0 | 0 |
| `optionalClassFeatures.ts` | 23 | TCE 24 | 0 | 0 |

So the filter is arithmetically guaranteed to return an empty list for any 2024 class. The same
mechanism fires on a second, unrelated book pair: **Artificer** is `sourceBook: 'TCE', alsoIn: ['ERLW']`
(`classes/index.ts:598-601`), so a player who enables ERLW to get the Artificer — exactly what `alsoIn`
is for — passes the class filter and then hits an infusion list that is 100% TCE.

## Runtime confirmation — four builds, each against a matched control
Seeded one level *below* a grant level so the picker must render, then read the dialog. The control is
the identical class and level transition with only `enabledBooks` changed. (First attempt used level
10→11, which grants no metamagic; the control read empty too and caught the bad harness — the picker
was never rendered. Levels corrected before the run below.)

| build | picker | filtered result | matched control | control result |
|---|---|---|---|---|
| `sorcerer-2024` 9→10, books `[PHB2024]` | METAMAGIC 0/1 | **"No results."** | `sorcerer` 9→10, `[PHB]` | Careful Spell … ✅ |
| `fighter-2024` + `battle-master-2024` 6→7, `[PHB2024]` | MANEUVERS 0/2 | **"No results."** | `fighter` + `battle-master` 6→7, `[PHB]` | Commander's Strike … ✅ |
| `warlock-2024` + `fiend-patron-2024` 4→5, `[PHB2024]` | INVOCATIONS 0/2 | **"No results."** | `warlock` + `the-fiend` 4→5, `[PHB]` | Agonizing Blast … ✅ |
| `artificer` 9→10, books `[PHB, ERLW]` | INFUSIONS 0/2 | **"No results."** | `artificer` 9→10, `[PHB, TCE]` | Armor of Magical Strength … ✅ |

## The part that makes it silent instead of merely broken
**Confirm is enabled exactly when the picker is empty.** Measured on all four: `Confirm Level N` is
`disabled === false` while the counter reads `0/2 chosen`. The 2014 warlock control has
`disabled === true` — because it has real unmade choices — which proves the gate itself works. The gate
compares chosen-count against required-count, and an empty candidate list means the requirement can
never be satisfied, so the dialog lets the level through. The player advances and the feature is gone
with no error, no warning, and no way to recover it later.

*(An earlier reading of the 2024 warlock as hard-blocked was a seeding error on my part — that build
had no patron, so the subclass gate was firing. With a patron assigned it behaves like the other three.)*

## Blast radius
**123 of 146 option entries are unreachable** for the affected builds:

| build | loses | count |
|---|---|---|
| `sorcerer-2024` | all metamagic | 10 |
| `fighter-2024` / `paladin-2024` / `ranger-2024` | all fighting styles | 15 |
| `battle-master-2024` | all maneuvers | 23 |
| `warlock-2024` | all invocations + all pact boons | 58 |
| `artificer` with ERLW but not TCE | all infusions | 17 |

`optionalClassFeatures.ts` (23, all TCE) is **excluded from the count deliberately** — TCE optional
class features apply to the 2014 classes, so a 2024 character correctly receives none. Counting it
would have inflated the finding.

Severity: **high**. This is R1's family (2024 ids invisible to logic) but one layer down — R1 was code
comparing `classId` to 2014 names; R11 is *data* carrying a book id that the class's own edition never
enables. Fixing R1's call sites could not have fixed this.

## Why no earlier sweep saw it
The text-accuracy audit read descriptions, and every description is correct. The R5 limited-use sweep
read resource definitions, and every definition is correct. Each file is internally consistent; the
defect is in the **join** between `enabledBooks` and `sourceBook` — the third instance of that shape in
this audit, after the AcqInc/ToB registry gap (B1) and racial speeds (C1).

---

# PHASE D COMPLETE — cap enforcement sweep (multi-agent, 2026-07-30)

Run as a 57-agent workflow: 8 sweepers (one per cap) piped into per-finding adversarial verifiers
prompted to **refute**, then a synthesis pass grouping survivors by root cause. 41 findings confirmed,
**3 refuted and dropped**. Full agent transcripts: `.claude/.../workflows/wf_da788e90-527/`.

## Reconciliation with the R11 entry committed earlier this session (`d244607`)
Two sweepers hit the book-filter defect independently, from different caps (metamagic, infusions). I
generalised it and confirmed it at runtime *before* the workflow finished, and logged it above as R11.
**They are the same root cause** — the section below is the fuller treatment and supersedes the numbering,
not the evidence. The two are complementary:
- my entry has the **runtime proof**: four builds vs four matched controls, plus the measurement that
  `Confirm` is `disabled === false` while the counter reads `0/2 chosen`;
- the section below has the **static anatomy**: the exact consumer sites, and the crucial detail I
  missed — the fix already exists, once, at `StepSpells.tsx:199-206`.

## Independently spot-checked before recording (I did not take agent output on trust)
| claim | verdict |
|---|---|
| R19 — Artificer prepared cap uses `Math.ceil` | **confirmed**: `mechanics.ts:285` `Math.ceil(level/2)`; TCE line 53 says "Int modifier + half artificer level (**rounded down**)". `paladin` on line 282 correctly uses `Math.floor`. Over-prepares by 1 at every odd level. |
| R15 — `addSpellToBook` has no cap | **confirmed**: `useCharacterStore.ts:622-626` guards only against duplicates. |
| R11 — the one correct impl is in `StepSpells` | **confirmed**: `StepSpells.tsx:202-206`, one-directional `if (set.has('PHB2024')) set.add('PHB')`, with a comment explaining exactly why. |

## Phase D — cap enforcement sweep

Read-only mechanical audit of the eight player-choice caps (spells known, cantrips known, prepared spells, expertise, invocations, metamagic, maneuvers, infusions) across `audit/class-mechanics`. Every finding below survived an adversarial refutation pass. Grouped by **root cause**, not by cap — the same structural defect surfaces in up to six caps at once, and fixing it once closes all of them.

### Defect rate

| Metric | Count |
|---|---|
| Caps swept | 8 |
| Caps with ≥1 confirmed defect | 8 |
| **Defect rate** | **100%** |
| Confirmed findings | 41 |
| Distinct root causes | 10 (R11–R20) |
| Findings refuted on review | 3 |

Every cap's **numbers** are largely correct; every cap's **enforcement** has at least one hole. The table lookups were audited and are clean (see Verified Correct). The failures are in the plumbing between the table and the mutation.

---

### R11 — PHB2024 characters have `PHB` deleted from `enabledBooks`, and no non-spell option list was ever re-tagged

**What it is.** `StepBooks.tsx:19-25` `selectPhbEdition('2024')` does `next.delete('PHB'); next.add('PHB2024')` — the two ids are mutually exclusive, and `toggle()` at `:31` early-returns for both so PHB cannot be re-enabled. `bookEnabled.ts:16-18` passes only on `sourceBook` or an `alsoIn` hit. Every option data file predates 2024 and carries bare `sourceBook: 'PHB'` with zero `alsoIn: ['PHB2024']` tags. Result: a 2024 character's option pickers render **empty grids under live "Choose N" headers**.

**Why the structure produces it.** The fix was applied once, locally, at exactly one call site — `StepSpells.tsx:202-206` `const set = new Set(draft.enabledBooks); if (set.has('PHB2024')) set.add('PHB')` — inside a `useMemo` consumed only by that step's spell filter. It was never lifted into `bookEnabled()` or into the stored `enabledBooks`, so every other picker in the app still passes the raw set.

**Sites.**
- Data with 0 PHB2024 tags: `src/data/invocations.ts:5-36` (32 entries), `src/data/metamagic.ts:3-19` (10), `src/data/maneuvers.ts:5-20` (16 PHB + 7 TCE), `src/data/fightingStyles.ts`, `src/data/pactBoons.ts`, `src/data/optionalClassFeatures.ts`
- Raw-set consumers, creator: `StepClassOptions.tsx:131` → `:165` (styles), `:183` (invocations), `:197` (metamagic), `:208` (maneuvers), `:218` (infusions)
- Raw-set consumers, level-up: `LevelUpDialog.tsx:458` → `:610`, `:642`, `:652`, `:656`, `:662`
- The one correct implementation: `StepSpells.tsx:199-206`
- No normalization at the boundary: `useCreatorStore.ts:246` copies `draft.enabledBooks` verbatim; `useCharacterStore.ts:459` is `c.enabledBooks ?? ['PHB']`, a missing-field default only

**Failure scenario.** Books step → 2024 Edition (default set becomes exactly `['PHB2024']`) → Warlock 5 → Class Options. The "Eldritch Invocations — Choose 3" card renders over an empty grid. `OptionSection` (`StepClassOptions.tsx:68-112`) has no empty state, so it is a blank rectangle. Same character at every level-up: `CompactOptionPicker` prints `"No results."` (`LevelUpDialog.tsx:148`) and `canConfirm` (`:598-607`) never references invocations, so the level completes silently. Character reaches 20 with zero invocations. Identical for 2024 Sorcerer metamagic, 2024 Battle Master maneuvers, 2024 Fighter fighting styles.

**Severity: high.** Class-defining features are unreachable on a shipping edition, with no recovery path — no sheet UI writes `classOptions`.

**Adjacent instance, same shape:** `alsoIn: ['ERLW']` appears exactly once in `src/data/` (`classes/index.ts:601`, Artificer). All 17 infusions (`infusions.ts:5-21`) and all 4 Artificer subclasses (`subclasses/index.ts:1233/1251/1264/1276`) are TCE-only, so an ERLW-only Artificer — the natural Eberron loadout — gets zero infusions and zero subclasses. The subclass path at least has a real empty state (`StepSubclass.tsx:53-65`); the infusion path is silent.

---

### R12 — Two independent implementations of every option count; only `LevelUpDialog` was taught 2024

**What it is.** The creator and the level-up dialog each carry their own hardcoded progression ladder. `StepClassOptions.tsx:137` collapses the class id via `baseClassId()` (`classes/index.ts:669-671`, returns `spellListClassId`) so `sorcerer-2024` → `sorcerer`, then applies the **2014** ladder. `LevelUpDialog.tsx:264` keeps the raw `classId` and has 2024-aware variants. The two disagree, and the level-up delta formula swallows the gap.

**Why the structure produces it.** `baseClassId()` is correct and necessary for filtering option *data* (which is tagged with 2014 ids — see the comment at `StepClassOptions.tsx:134-136`). The bug is reusing the same collapsed id for the *count*. No count table lives in `mechanics.ts` alongside `SPELLS_KNOWN`; each is inlined at its use site.

**Sites.**

| Cap | Creator (2014 ladder, wrong for 2024) | Level-up | RAW 2024 |
|---|---|---|---|
| Invocations | `StepClassOptions.tsx:171-178` (0 at L1, 2 at L2, 3 at L5) | `LevelUpDialog.tsx:70-80` ✓ correct | 1 at L1, 3 at L2, 5 at L5 |
| Metamagic | `StepClassOptions.tsx:191-196` (2@L3, 3@L10, 4@L17) | `LevelUpDialog.tsx:62-67` (2@L2, 3@L10, 4@L17) — only the L2 threshold was fixed | 2@L2, 4@L10, 6@L17 (`phb2024-players-handbook.md:1293`) |
| Expertise (bard) | `StepSkills.tsx:9-20` (2@L3, 4@L10) | `LevelUpDialog.tsx:586` (2 at L2 or L9) ✓ correct | 2@L2, 4@L9 (`phb2024-players-handbook.md:354,361,378`) |

**Failure scenario.** Create a 2024 Sorcerer at level 1. Creator's metamagic ladder starts at L3 → no picker. Level 1→2: `metaCountFn(2) - metaCountFn(1)` = 2 − 2 = **0** → no picker. The level-2 grant falls into the gap between the two functions and is unrecoverable (`updateClassOptions`, `useCharacterStore.ts:921-926`, has exactly one caller and no top-up). At L10 and L17 both implementations under-grant, so a level-20 2024 Sorcerer ends with **4 metamagic options against RAW 6**. A 2024 Warlock created at L1 ends level 20 with 9 of 10 invocations; created at L5, 8 of 10. A 2024 Bard created at level 9 gets 2 expertise instead of 4, permanently.

**Severity: high.** Wrong numbers on a shipping build, silently under-granted, with no display anywhere that shows the cap.

---

### R13 — `canConfirm` omits all six pending option arrays; grants are computed as a level delta, never as owed-vs-owned

**What it is.** `LevelUpDialog.tsx:598-607` gates Confirm on HP method, subclass, pact boon, three totem picks, land type, ASI validity and expertise. `pendingSpells`, `pendingCantrips`, `pendingInvocations`, `pendingMetamagic`, `pendingManeuvers` and `pendingInfusions` appear nowhere in it. The button at `:1684` is `disabled={!canConfirm}`. Separately, every `totalNew*` is `Math.max(0, countFn(newLevel) - countFn(currentLevel))` — a **table delta**, explicitly documented as such at `:613-616` ("NOT the difference against what's stored"). So a skipped pick is never re-offered: every subsequent level with a flat table yields 0.

**Why the structure produces it.** The delta design is deliberate and correct for its stated purpose (not double-offering creator-time picks). It is also exactly what makes a skipped grant permanent. The author already fixed this failure mode once for subclasses — see the `>=` rationale comment at `:297-301` — and never generalized it.

**Sites.** `LevelUpDialog.tsx:598-607` (the gate), `:389-420` (`confirm()`, whose only early return is the subclass), `:400-403` (the merge fires only when some pending array is non-empty), `:411-413` (Set unions), plus each delta: `:487` spells, `:455` cantrips, `:618` invocations, `:624` metamagic, `:632` maneuvers, `:637` infusions. Store side: `useCharacterStore.ts:921-926` is a blind `{...existing, ...partial}` spread with no clamp and no backfill.

**Failure scenario.** Battle Master 6 → 7. Section shows "0/2 chosen" in amber; Confirm is green. Player confirms. Levels 7→8→9 all yield delta 0, so the section does not render. Level 10 offers exactly 2. The character is permanently 2 maneuvers short. Same for a Warlock at 4→5 (7 of 8 at level 20), a Sorcerer at 2→3 (2 of 4 at level 20), an Artificer at 5→6 (6 of 8 known infusions at level 10).

**Severity: medium.** Silently lost grants, never over-cap. Recovery exists only as a whole-character rollback: `SheetPage.tsx:769` calls `saveSnapshot(character!, 'Before Level Up')` and `SnapshotPanel.tsx:42-47` can restore it — 30 snapshots retained (`useSnapshotStore.ts:23`), so a shortfall noticed at level 20 is gone.

**Aggravating instance (high):** `battleMasterManeuverCount` (`LevelUpDialog.tsx:82-87`) has **no `level < 3` guard** — it returns 3 for levels 0, 1 and 2. A Fighter taking Battle Master at 2→3 gets a delta of 3 − 3 = 0 and is never prompted for the *initial three* maneuvers at all. The two sibling functions in the same file do guard (`warlockInvocationCount2024:70-80` falls through to 0; `artificerInfusionCount:89-90` opens with `if (level < 2) return 0`). One-line fix, one call site.

---

### R14 — The creator never re-validates the draft when class or level changes

**What it is.** `StepClass.tsx:31-43` `setLevel` rewrites only `classes`. `useCreatorStore.ts:100-101` `updateDraft` is a shallow merge, so `spellbook`, `classOptions` and `expertiseSkills` survive untouched. Every picker enforces its cap **at click time only** — no picker has a reconciliation effect keyed on the new cap. `CreatorPage.tsx:46,49,51` return unconditional `true` for `class-options`, `skills` and `spells`, and Finish is gated solely on `draft.name` (`:134`). `useCreatorStore.ts:255,265-268,291` copy the draft verbatim into the saved character.

**Why the structure produces it.** `selectClass` (`StepClass.tsx:20-29`) *does* reset `selectedFeats` and `classOptions` — so the omission in `setLevel` is asymmetric, not a merge artifact. The reset instinct exists; it was applied to one of the two mutations.

**Sites.** `StepClass.tsx:31-43` (setLevel), `StepClassOptions.tsx:149-155` (`toggleList` is add-side only), `StepSkills.tsx:73-91` (effect has `expertiseSlots` in its deps but the only expertise branch is the `=== 0` clear at `:82-84`), `StepSpells.tsx:250-268` (no trim; the sole `useEffect` at `:276-280` resets the level filter), `CreatorPage.tsx:46,49,51`, `useCreatorStore.ts:255,265-268,291`, `useLibraryStore.ts:27-28` (bare array push), `useCharacterStore.ts:409-416,470` (load backfills missing keys, never clamps).

**Failure scenario.** Bard 20 → pick 22 spells → Back → level 1 → Finish. Saved as a Bard 1 with 22 known spells. Worse, the excess is **unremovable in the creator**: `StepSpells.tsx:212` filters the grid on `s.level <= maxSpellLevel`, so at Bard 1 the 2nd–9th-level picks are not rendered at all and have no Remove button — the banner reads "22 / 4 (full)" with no way to act. Same shape everywhere: Artificer 18 → 12 infusions → level 2 keeps all 12 including a 14th-level-prereq infusion (and `StepClassOptions.tsx:218-220` filters `items` by `minLevel <= level`, so those eight are invisible and un-deselectable); Rogue 6 → 4 expertise → level 3 keeps 4, and `useCharacterDerived.ts:217` doubles PB on all four; Warlock 18 → 8 invocations → level 2 keeps 8; Fighter 10 → 2 fighting styles → level 1 keeps 2.

**Severity: medium-to-high.** Reachable in two Back clicks by an ordinary "actually let's start lower" edit, persists into the saved character, and is unrecoverable from inside the wizard.

**Secondary instance:** the same effect's proficiency strip (`StepSkills.tsx:74-76`) strands expertise on a **background** change. Acolyte→Criminal drops Religion proficiency; the expertise pick on Religion survives, and the tile is inert (`:187` `onClick={() => { if (proficient) toggleExpertise(skill); }}`, dimmed at `:193`), so the slot is occupied and cannot be freed. Consequence is cosmetic — `useCharacterDerived.ts:217` requires proficiency for the doubled bonus, so only the double-dot marker at `SheetPage.tsx:598` is wrong.

---

### R15 — `addSpellToBook` is a chokepoint with no cap, and `spellsKnown` is never derived

**What it is.** `useCharacterStore.ts:622-626` `addSpellToBook` takes only a `spellId` and its sole guard is a duplicate check. Its sibling four lines above, `toggleSpellPrepared` (`:592-601`), carries an explicit comment calling itself "the single chokepoint every preparation path funnels through" and accepts a `maxPrepared` argument from the caller. The pattern was not applied to `addSpellToBook`. Compounding it: `useCharacterDerived.ts` returns `maxPreparedSpells`, `cantripsKnown`, `maxSpellLevel` and `slotTotals` (`:495-526`) but has **no `spellsKnown`** and does not import `spellsKnownFor` — so no consumer has a number to compare against.

**Sites.** `useCharacterStore.ts:622-626` (mutation), `SpellPanel.tsx:526` `onClick={() => { addSpellToBook(spell.id); }}` on a bare div — no disabled state, no confirm, and the handler never closes the dialog so the whole list can be click-through'd. `SpellPanel.tsx:69-75` `availableToAdd` filters on book, class, dedupe, level filter and search only. `SheetPage.tsx:723` passes the raw store action through. `SpellPanel.tsx:45` destructures only `{ maxPreparedSpells, slotTotals, cantripsKnown, maxSpellLevel }`. `LevelUpDialog.tsx:395` is the only *capped* caller (`:1222`, `pendingSpells.length < spellsKnownGained`).

**Failure scenario.** Bard 3 (Spells Known = 6). Spells tab → Add Spell → click every row. All ~110 PHB bard spells land in the spellbook, every one castable (`SpellPanel.tsx:87` `if (!isPreparedCaster) return true;`). No counter turns red because there is no spells-known counter. Persists through `save()` and Drive sync. Same for a Wizard 5 clicking the "C" filter and adding six extra cantrips → `10/4` in red, all castable, nothing ever trims it (`load()` at `:427` and `levelUp` at `:857-860` only run `syncAlwaysPrepared`).

**Severity: medium.** The over-cap state persists and nothing trims it, but reaching it requires deliberately clicking extra rows in the add browser.

**Important: a naïve clamp in `addSpellToBook` would be wrong.** Several features legitimately push the spellbook past the table — College of Lore Additional Magical Secrets (`phb-players-handbook.md:380`, "don't count against spells known"), Pact of the Chain's find familiar (`:1105`), feat-granted spells. And `cantripsKnown` is computed from the **primary class only** (`useCharacterDerived.ts:283-296`, no multiclass summation) while `SpellPanel.tsx:68-71` deliberately widens the add list to every class the character has — so there is currently no correct number to clamp against. The fix is two changes: derive `spellsKnown` and make `cantripsKnown` multiclass-aware, *then* gate.

---

### R16 — Spell-list resolution is implemented three times, and only the creator's copy is correct

**What it is.** Resolving "which spells may this character pick" requires two normalizations: fall back to `classDef.spellListClassId` (so `sorcerer-2024` → `sorcerer` and `eldritch-knight` → `wizard`), and treat `PHB2024` as also unlocking `PHB`. Three implementations exist; each does a different subset.

| Site | subclass `spellListClassId` | class `spellListClassId` | PHB2024→PHB | uses `bookEnabled` |
|---|---|---|---|---|
| `StepSpells.tsx:134-136`, `:199-206` | ✓ | ✓ | ✓ | ✓ |
| `LevelUpDialog.tsx:282`, `:503-513` | ✓ | ✗ | ✗ | ✓ |
| `SpellPanel.tsx:68-75` | ✗ | ✗ | ✗ | ✗ (bare `enabledBooks.includes(s.sourceBook)`, so `alsoIn` is ignored too) |

**Failure scenario A (2024, high).** PHB-2024 Sorcerer 1→2. `spellsKnownGained` = 4 − 2 = 2 and the dialog renders "You learn 2 new spells." The list beneath is **empty**: core spells carry `classes: ['sorcerer']` not `'sorcerer-2024'`, and `bookEnabled` rejects `sourceBook: 'PHB'` for a set of `['PHB2024']` (`grep -c "alsoIn.*PHB2024" src/data/spells/index.ts` = 0). Confirm is enabled (R13), the 2 spells are lost, and `SpellPanel`'s Add Spell is broken the same way so there is no recovery. Applies to every 2024 caster; `wizard-2024` is worst — 2 free spellbook picks per level that can never be spent. Above level 1 the list is not literally empty but shows 1–2 of ~150 (`arcane-vigor`, `jallarzi-storm-of-radiance`, `tashas-bubbling-cauldron` carry the `-2024` tags).

**Failure scenario B (EK/AT, medium).** A single-classed Eldritch Knight or Arcane Trickster's Add Spell dialog is **always empty** — no spell in the dataset lists `'fighter'` or `'rogue'` (every class id appearing in any spell's `classes` array: artificer, bard, cleric, druid, paladin, ranger, sorcerer, warlock, wizard). `LevelUpDialog` is their only route to learn spells, and per R13 it does not require the picks — so skipping the level-3 prompt costs 3 spells with no UI anywhere that can record them. A Fighter(EK)/Wizard multiclass is fine, which is why `SpellPanel.tsx:65-67`'s multiclass comment exists.

**Severity: high** (2024 instance), **medium** (EK/AT instance).

**Note the interaction.** R15 and R16 point in opposite directions and cancel out misleadingly: a 2014 Bard can add unlimited spells; an EK or a 2024 Sorcerer can add none. Fixing only the uncapped path leaves EK/AT and 2024 casters unable to reach their legal count at all. **Fix these together.** The lazy fix is one exported helper — `spellListIdsFor(character)` + `spellBooksFor(character)` — that all three sites call.

---

### R17 — The prepared-caster identity is a hardcoded string array duplicated in four places; three are stale

**What it is.** Whether a class is a prepared caster is expressed as a literal id list, copied four times. `LevelUpDialog.tsx:482` carries the correct list including all six `-2024` ids (with a comment about a previously-fixed instance of this same stale-id bug). The three sheet-side copies do not.

**Sites.** `SpellPanel.tsx:33` `const PREPARED_CASTER_CLASSES = ['cleric', 'druid', 'paladin', 'wizard', 'artificer'];`, consumed at `:77`. Duplicated at `SheetPage.tsx:996` (used `:1058`, `:1066`, `:1081`) and `SidebarPanel.tsx:536-537`. The correct normalizer `baseClassId()` exists at `classes/index.ts:669` — its own doc comment describes this exact bug class — and is used in 9 places, none of them these three.

**Failure scenario.** PHB-2024 Cleric 5, WIS 16. `derived.maxPreparedSpells` = 9, computed correctly (`useCharacterDerived.ts:287` → `PREPARED_SPELLS_2024['cleric-2024']`). On the sheet: `isPreparedCaster` is false, so the "Prepared (n/max)" header (`SpellPanel.tsx:107`) never renders, the prepare checkbox (`:175`) never renders — meaning `toggleSpellPrepared`, the one correctly-enforcing chokepoint in the codebase, is **unreachable** — and `:87` `if (!isPreparedCaster) return true;` makes every spell in the book castable. Worst case `wizard-2024`: a creator-capped level-20 spellbook of 44 spells (`StepSpells.tsx:174`, `6 + 2*(charLevel-1)`) against a prepared cap of 25, all 44 castable with no counter shown.

**Severity: high.** A correctly-computed cap that reaches nothing.

**One fix closes it:** `mechanics.ts` already knows the answer — a class is a prepared caster iff `maxPreparedSpellsFor` returns non-null. Export that predicate and point the four call sites at it. `StepSpells.tsx:169` already derives it that fifth way (`preparedLimit !== null`), which is why the creator recognizes 2024 prepared casters and the sheet does not.

---

### R18 — Prepared-only casters have no pick guard at creation, and the creator writes `isPrepared: true` on every selection

**What it is.** `StepSpells.tsx:250-268`: the `level > 0` branch is `if (isSpellbookCaster) {…} else if (isKnownCaster && selectedNonCantrips >= effectiveSpellLimit) return;`. For a prepared-only caster **both flags are false** — `isSpellbookCaster` is wizard/`wizard-2024` only (`:173`), and `isKnownCaster` requires `spellsKnownFor() > 0` (`:175`), which returns 0 for cleric/druid/paladin/artificer and for `bard-2024`/`cleric-2024`/`druid-2024`/`paladin-2024`/`ranger-2024` (no `SPELLS_KNOWN` entry, `mechanics.ts:214-222`). Control falls through to `:267` `updateDraft({ spellbook: [...current, { spellId, isPrepared: true, isAlwaysPrepared: false }] })`. `preparedLimit` is computed at `:168` but drives only the informational banner at `:328-336`.

**Why nothing downstream repairs it.** `useCreatorStore.ts:265-268` passes the spellbook through `syncAlwaysPrepared`, which (`alwaysPrepared.ts:43`) is `isPrepared: alwaysPreparedIds.includes(s.spellId) ? true : s.isPrepared` — it can only *set* prepared, never clear. `toggleSpellPrepared` (`useCharacterStore.ts:604`) is `if (!entry.isPrepared && …)`, so it refuses new preparations but cannot repair an inherited over-cap state.

**Failure scenario.** Level-1 Cleric, WIS 16, cap = 1 + 3 = 4. Tick all 15 PHB 1st-level cleric spells — none refused. Finish. Sheet header reads "Prepared (15/4)" in red, all 15 castable, and the only way out is unticking 11 one at a time. For a *2024* cleric it is worse: per R17 there is no red counter and no checkboxes at all.

**Severity: high.** Every prepared caster is routinely born over cap, and nothing at any later point reconciles.

**Adjacent, same file, medium:** `StepSpells.tsx:155` maps the 2014 `paladin` to `'wis'` while `:160` correctly maps `'paladin-2024': 'cha'`. The class definition (`classes/index.ts:335`) and the sheet both use `'cha'`. A level-6 CHA-15 paladin sees "prepare 2" in the creator and 5 on the sheet. The `?? 'wis'` fallback at `:165` silently mis-abilities any future class id absent from the map. (Note the whole line is unreliable regardless: `draft.baseAbilityScores` is the *pre-racial* score, so the creator understates the limit for cleric, druid and wizard too — the paladin mapping is its sharpest instance, not its only one.)

---

### R19 — `Math.ceil` where the book says rounded down (Artificer prepared cap)

**What it is.** `mechanics.ts:283-285` `case 'artificer': return Math.max(1, Math.ceil(level / 2) + spellMod);`. The comment at `:284` ("Artificer gets spells at level 1 (unlike Paladin/Ranger who start at 2)") is a conflation — the level-1 case is already handled by the `Math.max(1, …)` floor, which is exactly RAW's "minimum of one spell." The Paladin case one line above correctly uses `Math.floor`.

**Correct per book.** `tce-tashas-cauldron.md:53` (verified in both the reference-books copy and the Drive copy): "Prepare Int modifier + half artificer level (rounded down) spells." Line 51 of the same file — "Spell slots for multiclassing: Add half artificer levels (rounded up)" — is a *different quantity*; rounding up is correct there and wrong here.

**Failure scenario.** Artificer 5, INT 18. RAW: floor(5/2) + 4 = 6. App: ceil(5/2) + 4 = **7**. `SpellPanel.tsx:109` shows "Prepared (6/7)" and `toggleSpellPrepared` — the one enforcing chokepoint — faithfully accepts a 7th spell, because it enforces the value it is handed (`useCharacterStore.ts:604-612`) and by design does not recompute. Wrong at every odd level 1–19 for any artificer with a positive INT modifier.

**Severity: high.** Wrong number on a real build, enforced.

---

### R20 — Features that grant proficiency, expertise, resources or spells exist as description strings with no data hook

**What it is.** `ClassFeature` (`types/index.ts:113-123`) carries only `name`/`level`/`description`/`isASI`/`featOnly`. Subclasses have no skill-granting field (`skillProficiencies` exists only on the background type, `types/index.ts:245`). `computeAlwaysPreparedIds` (`alwaysPrepared.ts:12-33`) reads only subclass `alwaysPreparedSpells` and `landSpells`, never class features. `classOptions.optionalFeatures` is written (`useCharacterStore.ts:921-926`) but never read by `useCharacterDerived` (`grep optionalFeatures src/hooks/` → nothing). So any feature whose mechanics don't fit an existing field is prose only.

**Sites — expertise / proficiency:**
- `useCharacterDerived.ts:192-210` is the *complete* set of subclass expertise handling: two hardcoded `if (cl.subclassId === …)` lines plus the Knowledge Domain block. `expertiseSlotsForClass` (`StepSkills.tsx:9-20`) handles only rogue and bard; `LevelUpDialog.tsx:584-587` the same four ids.
- Unhandled entirely: Scout Survivalist (`subclasses/index.ts:669`), Cobalt Soul Mystical Erudition (`:1350`), TCE Deft Explorer/Canny (`optionalClassFeatures.ts:138-145`), PHB2024 Ranger Deft Explorer L2 + Expertise L9 (`classes/phb2024.ts:396,404`), PHB2024 Wizard Scholar L2 (`:592`).
- Half-implemented: Corsair (`:196`) and Purple Dragon Knight (`:198`) add to `effectiveExpertiseSet` but never to `skillProfs`, while `:217` requires `effectiveExpertiseSet.has(skill) && skillProfs.has(skill)`. The Knowledge Domain block immediately below (`:200-210`) does **both** adds — the correct pattern is in the same function.

**Sites — resources / spells:**
- `feats.ts:154-159` Metamagic Adept and `fightingStyles.ts:17` Superior Technique: no `grantedResources`, no maneuver contribution. Both cap sites (`StepClassOptions.tsx:201-206`, `LevelUpDialog.tsx:82-87`) key solely off `isBattleMaster` and level; `selectedFeats` and `classOptions.fightingStyles` are never consulted.
- `feats.ts:518-524` Metamagic Adept likewise. **Half of this is a one-line data omission:** `Feat.grantedResources` exists at `types/index.ts:316` and is wired end to end (consumed at `useCharacterStore.ts:331-338`, rest at `:976-981`, sheet at `SheetPage.tsx:64`, already used by Lucky at `feats.ts:140`). Adding `grantedResources: [{ key: 'sorcery_points', … }]` would light up the metamagic UI, since `SheetPage.tsx:2361` keys off `r.key === 'sorcery_points'`.
- `subclasses/phb2024.ts` defines **zero** resources (`grep -c "resources:"` → 0, against 72 in `subclasses/index.ts`). `battle-master-2024` (`:188-199`) therefore has no Superiority Dice at all — no count, no die size, nothing to spend — while `LevelUpDialog.tsx:629-630` still prompts it for maneuvers.
- Armorer Armor Modifications (`tce-tashas-cauldron.md:193`, "+2 Infused Items") has no resource entry and no `computeResourceMaxOverrides` branch (`useCharacterStore.ts:16-130` has an armorer branch at `:69-70` for `perfected_armor` only). `grep "infused_items" src/` → 2 hits, both the definition. Gap is a constant −2 from level 9: L9 shows 3 vs RAW 5, L10-13 4 vs 6, L14-17 5 vs 7, L18-20 6 vs 8. `setResource` (`:637-644`) hard-clamps to `r.max`, so the player cannot work around it.
- Wizard 20 Signature Spells (`classes/index.ts:594`, `classes/phb2024.ts:604`) and Wizard 18 Spell Mastery (`:593`/`:602`): description only. The **only** code that writes `isAlwaysPrepared: true` is `syncAlwaysPrepared`, fed by the subclass-only computer, so the player cannot even hand-mark two spells — `SpellPanel.tsx:177-178` disables the toggle for always-prepared spells.
- PHB2024 Divine Order (Thaumaturge) / Primal Order (Magician), `classes/phb2024.ts:139,185`: a mandatory L1 either/or, one branch of which is +1 cantrip. No `ClassOptionsState` field, no `StepClassOptions` entry (`grep divineOrder|primalOrder|Thaumaturge|Magician src/` → the two description strings only), and the creator **hard-blocks the legal pick** (`StepSpells.tsx:257` mutation guard, `:402-408` disabled button).

**Failure scenarios.** Fighter 7 Purple Dragon Knight with a background lacking Persuasion (Persuasion is not on the Fighter skill list, `classes/index.ts:220`, so this is the *default* case): RAW gives proficiency + doubling = +6 at level 7; the app gives +0, while `SheetPage.tsx:598-618` still draws the emerald double-dot expertise marker beside the bare ability modifier. — 2024 Ranger 9: RAW 3 expertise skills, app 0, no section rendered at creation or level-up, permanently −4 on three skills. — 2024 Fighter 3 Battle Master: prompted to choose maneuvers, no dice to spend them with. — Armorer 12: Infused Items reads 4/4, RAW 6.

**Severity: high** for the expertise and Battle-Master-dice instances (wrong numbers on shipping builds); **medium** for Signature Spells / Spell Mastery / Divine Order / Metamagic Adept (features that silently do nothing).

**Also in this class, low:** `infusions.ts:7` `bag-of-holding-infusion` is tagged `sourceBook: 'TCE'`, but TCE lists 16 infusions and Bag of Holding is a 2nd-level *Replicable Item* under Replicate Magic Item (`tce-tashas-cauldron.md:319`), not an infusion. It was a standalone infusion in ERLW. Retagging it `'ERLW'` alone would be half a fix — Armblade, ERLW's other standalone-turned-replicable, is absent, and no infusion carries `alsoIn: ['ERLW']` (see R11).

---

### Missing-mechanic findings (no shared root cause)

These are genuine RAW features with no implementation anywhere. Each is independent.

| # | Feature | Sites | Severity |
|---|---|---|---|
| M1 | **Spell swap on level-up** — Bard/Sorcerer/Warlock/Ranger/EK/AT may each replace one known spell per level (`phb-players-handbook.md:337,657,872,967,1007,1098`). `confirm()` only calls `addSpellToBook`; `removeSpellFromBook` isn't imported (`LevelUpDialog.tsx:157`). At flat table levels the whole section is hidden (`:1135`), so the swap is silently skipped at Sorcerer 11→12, Bard 11→12, Warlock 9→10, EK/AT at fighter/rogue 5/6/9/12/17/18. | `LevelUpDialog.tsx:157,394-396,484-489,1135` | medium |
| M2 | **Invocation swap on level-up** — both editions allow it (`phb-players-handbook.md:1103`, `phb2024-players-handbook.md:1404`). `:410` is a Set union; `:645` filters known invocations out of the picker so a replacement target can't even be displayed. Note `updateClassOptions` (`useCharacterStore.ts:925`) is an object spread — a shorter array *would* shrink it, so this is a single-file fix. | `LevelUpDialog.tsx:410,645,1426` | medium |
| M3 | **Maneuver swap** — PHB core (at 7/10/15, `phb-players-handbook.md:629`) and TCE Martial Versatility at ASI levels (`tce-tashas-cauldron.md:766`). Union-only merge at `:412`; `:651-653` excludes known maneuvers. The app's own data at `optionalClassFeatures.ts:83` tells the player the rule exists. | `LevelUpDialog.tsx:412,651-653,1515-1527` | medium |
| M4 | **Magical Secrets (any-class picks)** — Bard 10/14/18 and College of Lore 6 choose from *any* class list. All three pickers filter on `s.classes.includes(spellListClassId)`; `expandedSpells` (`StepSpells.tsx:187-195`) is the warlock-patron mechanism and no bard subclass populates it. `counterspell` (`spells/index.ts:59`, `classes: ['sorcerer','warlock','wizard']`) is unreachable for a bard at any level. | `StepSpells.tsx:209-216`, `LevelUpDialog.tsx:507`, `SpellPanel.tsx:71`, `subclasses/index.ts:29` | medium |
| M5 | **`prerequisiteSpell` never enforced** — 7 invocations declare it (`invocations.ts:5,16,28,45,47,48,49`); both filters check `minLevel` and `prerequisitePact` only. The field builds a caption (`StepClassOptions.tsx:333`, `LevelUpDialog.tsx:1453`) and nothing else, while the help text at `StepClassOptions.tsx:327` claims spell prereqs *are* filtered. Caution: the two hex invocations read "hex spell **or a warlock feature that curses**", so a naive `spellbook.includes('hex')` check would wrongly block a Hexblade. | `StepClassOptions.tsx:182-185`, `LevelUpDialog.tsx:641-645` | medium |
| M6 | **Replicate Magic Item can only be learned once** — RAW says multiple times, each naming a different item (`tce-tashas-cauldron.md:317`). `Infusion` (`types/index.ts:360-367`) has no multi-pick flag and `classOptions.infusions` is `string[]` with no per-instance item field. `LevelUpDialog.tsx:655-658` filters it out after the first pick; `:413` dedupes via `new Set`; `StepClassOptions.tsx:149-155` treats the second click as *removal* (and `:92-95` does not disable an already-selected card, so the deselect is reachable). | `infusions.ts:17`, `types/index.ts:360-367,384`, `LevelUpDialog.tsx:413,655-658`, `StepClassOptions.tsx:92-95,149-155` | medium |
| M7 | **Always-prepared subclass cantrips counted against the cantrip cap** — `SpellPanel.tsx:97-104` counts every level-0 spellbook entry, with no `isAlwaysPrepared` filter, while the sibling prepared count at `:51-55` *does* exclude them. `syncAlwaysPrepared` injects them at build and on **every load**, so deleting one is undone next load. A 2024 Celestial Warlock 3 shows `Cantrips: 4/2` in red on a build the app itself produced (Light + Sacred Flame are cleric-list, never offered in the creator); Circle of the Sea shows 3/2 (Ray of Frost is sorcerer/wizard-list). Display-only — `cantripsKnown` gates no mutation. | `SpellPanel.tsx:97-104`, `alwaysPrepared.ts:45-49`, `subclasses/phb2024.ts:158,169,498` | low |
| M8 | **Arcane Trickster's sheet cantrip cap is 1 low** — `useCharacterDerived.ts:292-296` hardcodes the *Eldritch Knight* progression (2@3, 3@10) for any `spellcastingType === 'third'` subclass, ignoring the correct per-subclass tables that every other consumer reads (`subclasses/index.ts:195`, `phb2024.ts:217,383`). A creator-made Rogue 3 AT — legal, built by the app — displays `Cantrips: 3/2` in red. 2024 EK at Fighter 14 shows 4/3. Display-only, but alarming and self-contradictory. Related: the hook reads `classes[0]` only, so a Wizard 1 / AT 3 omits the AT cantrips from the cap entirely. | `useCharacterDerived.ts:292-296` | medium |

---

### Verified correct

Recorded so the second pass can diff against it. Every number below was checked against the book text, level by level, not from memory.

| Cap | What was verified | Evidence |
|---|---|---|
| spells-known | All 6 `SPELLS_KNOWN` tables exact at levels 1-20: bard, sorcerer, warlock, ranger, sorcerer-2024, warlock-2024 — including the flat pairs and plateaus | `mechanics.ts:215-221` vs `phb-players-handbook.md:341-361,876-896,1010-1030,1075-1095`; `phb2024-players-handbook.md:1262-1283,1379-1400` |
| spells-known | All 4 EK/AT `spellsKnownByClassLevel` tables exact, incl. the 16/17/18 plateau at 11 | `subclasses/index.ts:114,196`; `phb2024.ts:218,384` |
| spells-known | EK/AT `restrictedSchools` + `freePickLevels [8,14,20]` correct and correctly dropped at those levels | `subclasses/index.ts:115-116,197-198`; `LevelUpDialog.tsx:286-290` |
| spells-known | Multiclass keyed off per-class level, never character level (correct per PHB p.163) | `LevelUpDialog.tsx:162-165,487` |
| spells-known | Creator DOES enforce the cap in the mutation and the UI | `StepSpells.tsx:263-265,403-408` |
| spells-known | Level-up DOES cap picks at the table delta | `LevelUpDialog.tsx:1222,1236` |
| cantrips-known | All 7 PHB2014 + all 6 PHB2024 `CANTRIPS_KNOWN` tables exact at 1-20, incl. the Artificer's non-standard 2/3@10/4@14 | `mechanics.ts:242-255` vs the 13 class tables in both books; artificer vs `tce-tashas-cauldron.md:57-79` |
| cantrips-known | Upper clamp safe: `table[max(0, min(level,20) - 1)]` | `mechanics.ts:261` |
| cantrips-known | EK/AT school restriction correctly **not** applied to cantrips (RAW: spells only) | `LevelUpDialog.tsx:460-466` vs `:503-513`; `StepSpells.tsx:213` |
| cantrips-known | Racial cantrips deliberately kept out of the spellbook, so they don't inflate the count | `useCharacterStore.ts:870,1043,1111`; `useCreatorStore.ts:273` |
| prepared-spells | All 6 `PREPARED_SPELLS_2024` tables exact at 1-20, incl. flat spots and the wizard's divergent 16-20 tail | `mechanics.ts:225-232` vs `phb2024-players-handbook.md:351-372,453-474,564-585,927-948,1036-1057,1540-1561` |
| prepared-spells | 2014 cleric/druid/wizard `max(1, level + mod)` and paladin `max(1, floor(level/2) + mod)` (≥L2) correct, min-1 handled | `mechanics.ts:275-282` |
| prepared-spells | Always-prepared correctly excluded at **both** counting sites; flag re-derived live on load/level-up/creation, so it can only lower the count | `useCharacterStore.ts:607-611`, `SpellPanel.tsx:51-55`, `alwaysPrepared.ts:40-50` |
| prepared-spells | `LevelUpDialog` cannot create an over-cap prepared state — everything it commits writes `isPrepared: false` | `LevelUpDialog.tsx:394-395`; `useCharacterStore.ts:625` |
| expertise | 2014 Bard (2@3, 4@10), 2014 Rogue and 2024 Rogue (2@1, 4@6) correct at all levels | `StepSkills.tsx:11-18`; `LevelUpDialog.tsx:585,587` |
| expertise | Level-up hard-caps picks, blocks Confirm until the quota is met, and has a correct degenerate-case fallback so it can't soft-lock | `LevelUpDialog.tsx:607,1659,1663-1664` |
| expertise | Cannot grant expertise in a non-proficient skill, cannot double-grant; merge-not-overwrite on level-up | `LevelUpDialog.tsx:588-596`; `useCharacterStore.ts:888-891` |
| expertise | Knowledge Domain fully correct: grants proficiency **and** expertise, capped at 2, list restricted at both picker and consumer, cleared on subclass change | `useCharacterDerived.ts:200-210`; `StepSkills.tsx:28,60,86-88` |
| expertise | Keyed off class level, not character level; correctly does not stack with Jack of All Trades / Remarkable Athlete (`Math.max`, gated on `!skillProfs.has`) | `LevelUpDialog.tsx:162-165`; `useCharacterDerived.ts:219-223` |
| invocations | 2014 count table exact at 1-20 in **both** implementations; 2024 function exact (just never reached from the creator) | `LevelUpDialog.tsx:43-52,70-80`; `StepClassOptions.tsx:169-179` |
| invocations | All 54 invocation `minLevel`/`prerequisitePact` values verified against PHB/XGtE/TCE — zero discrepancies | `invocations.ts` vs `phb-players-handbook.md:1133-1165`, `xge:1163-1189`, `tce:1336-1348` |
| invocations | Pact-boon prereq IS enforced at both gates; the `replace('pact-of-the-','')` mapping matches the type union exactly | `StepClassOptions.tsx:183`; `LevelUpDialog.tsx:642` |
| invocations | Pending picks don't leak across classes in a multiclass level-up | `LevelUpDialog.tsx:211-233` |
| metamagic | 2014 count table exact at 1-20 in both implementations | `LevelUpDialog.tsx:54-59`; `StepClassOptions.tsx:191-196` |
| metamagic | Sorcery-point costs correct (1/1/1/1/1/2/3 + Transmuted 1); points are actually deducted with an affordability guard and cannot go negative; Twinned's variable cost degrades safely to a manual-deduct tooltip | `metamagic.ts:5-18`; `SheetPage.tsx:987-990,2361-2397` |
| metamagic | Sorcery-point max table correct both editions (0 at L1, = sorcerer level thereafter) | `classes/index.ts:498`; `classes/phb2024.ts:488` |
| maneuvers | 2014 maneuvers-known (3/5/7/9 at 3/7/10/15) and 2014 superiority dice count (4/5/6 at 3/7/15) exact at all 20 levels | `StepClassOptions.tsx:202-206`; `subclasses/index.ts:99` |
| maneuvers | 2014 die size exact (d8@3, d10@10, d12@18) and `getResourceDie` picks against the **owning class's** level; short-rest recharge correct | `subclasses/index.ts:97,100`; `SheetPage.tsx:76-93`; `useCharacterStore.ts:1000-1010` |
| maneuvers | The 16 PHB + 7 TCE maneuver list is complete and correctly attributed; XGtE adds none (verified — its only "maneuver" hits are Warding Maneuver and Elegant Maneuver) | `maneuvers.ts:5-29` |
| maneuvers | Both gates double-guard against exceeding the delta; duplicates impossible | `LevelUpDialog.tsx:1531,1535,653,412`; `StepClassOptions.tsx:149-155` |
| infusions | Infusions Known (4/6/8/10/12 at 2/6/10/14/18) exact at **both** sites; Infused Items table exact at all 20 levels | `LevelUpDialog.tsx:89-96`; `StepClassOptions.tsx:212-217`; `classes/index.ts:612-617` vs `tce:59-77` |
| infusions | The two Artificer numbers are **not** conflated — separate structures, independent computation, distinct player-facing wording | `classes/index.ts:633`; `StepClassOptions.tsx:372` |
| infusions | All 17 `minLevel` prerequisites match TCE p.20-24; multiclass keys off artificer class level in all five writers; long rest and level-up carry the tracker correctly | `infusions.ts:5-21`; `useCharacterStore.ts:754-767,369-378,1089-1094`; `useCreatorStore.ts:225-226` |
| all | **No level-down path exists anywhere.** The only mutation of `character.classes` is `levelUp` (`useCharacterStore.ts:716-734`), which increments. No `setClassLevel`, no `removeClass`, no level editor. | grep across `src/store`, `src/pages/sheet` |
| all | **No post-creation subclass change** (`useCharacterStore.ts:728` uses `?? subclassPick`, filling an empty slot only), **no post-creation ability-score editor** (only ASI/feat increases, which raise), **no post-creation book toggle** (`enabledBooks` written only by `StepBooks.tsx:26,35`). Every Q4 "legal when made, now illegal" drop path is unreachable on the sheet — the over-cap states that exist all originate in the creator (R14). | — |

---

### Cheapest-first fix order

1. **R19** — `ceil` → `floor`, one character. Wrong number on every odd-level artificer.
2. **R13 aggravating instance** — `if (level < 3) return 0;` at `LevelUpDialog.tsx:82`. One line, one call site; restores the Battle Master's initial 3 maneuvers.
3. **R17** — export the prepared-caster predicate from `mechanics.ts` (it already knows: `maxPreparedSpellsFor() !== null`), point 4 call sites at it. Unblocks the entire 2024 prepared-caster sheet.
4. **R11** — widen `PHB2024` → `PHB` once, inside `bookEnabled()`. Six option lists across four caps light up in one edit; beats adding `alsoIn` to ~70 data entries.
5. **R13** — add the six pending arrays to `canConfirm` (`:598-607`). One expression; closes silent loss for spells, cantrips, invocations, metamagic, maneuvers and infusions simultaneously.
6. **R16 + R15 together** — one `spellListIdsFor(character)` helper for the three divergent sites, plus derive `spellsKnown` in `useCharacterDerived`. Must land together (see the interaction note in R16).
7. **R14** — one clamp pass over the draft in `useCreatorStore.finalize()`, or reset `classOptions` in `setLevel`. Closes over-cap persistence for five caps at once.
8. **R12** — move the count ladders into `mechanics.ts` keyed by raw class id, delete both inline copies.
9. **R20** — data-layer work, largest diff, lowest leverage per line. Start with `grantedResources` on Metamagic Adept (one line, field already wired) and the Knowledge-Domain pattern for Corsair/PDK (three lines).
---

# BATCH FIX PASS — round 1 (2026-07-30)

Cheapest-first, per the order recorded at the end of the Phase D section. Six fixes, each verified at
runtime against a matched control rather than by reading the diff.

| # | Root cause | Change | Runtime proof |
|---|---|---|---|
| 1 | **R19** | `mechanics.ts` Artificer prepared cap `Math.ceil` → `Math.floor` | Artificer 9 (Int 17) sheet reads **`Prepared (0/7)`**; `ceil` gave 8 |
| 2 | **R13** (Battle Master instance) | `battleMasterManeuverCount` gains `if (level < 3) return 0` | Fighter 2→3 now offers **`MANEUVERS 0/3`**; previously the delta was `3−3=0` and the initial three were never offered |
| 3 | **R17** | new `isPreparedCaster()` in `mechanics.ts`, derived from `maxPreparedSpellsFor(...) !== null`; 3 stale hardcoded arrays repointed (`SheetPage`, `SidebarPanel`, `SpellPanel`) | 2024 cleric 5 sheet reads **`Prepared (0/9)`**, matching `PREPARED_SPELLS_2024['cleric-2024'][4]`; previously no prepared UI at all |
| 4 | **R11** | one-directional `PHB2024 → PHB` widening inside `bookEnabled()` | 2024 sorcerer 9→10 METAMAGIC and 2024 warlock 4→5 INVOCATIONS both populate; 2014 twins unchanged |
| 5 | **R11** (ERLW half) | `alsoIn: ['ERLW']` on all 17 infusions and the 4 Artificer specialists; `alsoIn?` added to the `Infusion` type | ERLW-only Artificer 9→10 INFUSIONS populates |
| 6 | **R13** | `canConfirm` moved below the option computations and given the six missing clauses | See the gate table below |

## The gate, both directions
A gate that only ever blocks is a soft-lock, so it was tested in both directions on a Battle Master 2→3:

| state | Confirm |
|---|---|
| `MANEUVERS 0/3` | disabled |
| `1/3` | disabled |
| `2/3` | disabled |
| **`3/3`** | **enabled** |

Each clause uses the expertise pattern — `picked >= min(granted, picked + available)` — so it is
satisfied by picking everything granted **or** everything that exists. That second half matters: a
naive `remaining === 0` gate would have converted R11's silent loss into an unlevelable character.
Prepared casters are exempt from the spell clause, matching the picker's own `canAdd` rule.

## Two bugs introduced and caught during the fix, worth recording
1. **`bookEnabled` aliasing.** The first version of the widening did `set.add('PHB')` on a `set` that
   was the *caller's* Set whenever a Set was passed (several callers pass a memoised one). Fixed by
   copying unconditionally. Identical shape to the `load()` aliasing bug from earlier in this audit —
   the second time this exact mistake has appeared.
2. **Gating on a search-filtered list.** `availableSpells` is filtered by the dialog's search box and
   level dropdown, so using it in `canConfirm` would have let *typing a search term* unlock Confirm.
   Split into `availableSpellsUnfiltered` (the real availability) and `availableSpells` (presentation).

## Regression checks after the fixes
- `npx tsc -b --force` clean; `npm run build` clean.
- `keycheck.py`: 52 override keys, store and derived still identical sets, **0 dangling**.
- `spellrefs.py`: **223 / 223** references resolve, unchanged.
- 2014 control builds (sorcerer 9→10, Battle Master, TCE artificer) behave exactly as before.

## Still open from the fix order
Items 6–9: **R16 + R15** (spell-list resolution implemented three times; `spellsKnown` never derived —
must land together), **R14** (creator never re-validates the draft on class/level change), **R12** (two
divergent count ladders; the 2024 numbers are still wrong — a level-20 2024 sorcerer gets 4 metamagic
against RAW 6), **R20** (features that grant proficiency/expertise/resources as description strings only).

Note R12 is *not* fixed by round 1: R11 made the 2024 lists visible, but the **counts** those lists are
measured against are still the 2014 ladder in the creator.

---

# PHASE B / C sweeps — round 2 (2026-07-30, log-only)

Two new reproducible sweeps: `tools/audit/racefields.py` and `tools/audit/subclasslevels.py`. Both
carry positive and negative controls and both assert they accounted for every entity rather than
silently skipping what they could not parse (the `subclasslevels` assert that *every* subclass yielded
at least one parsed feature is the one that would have caught a silent-blindness bug).

## C3 — the proficiency layer is data-complete and computationally inert
The same three-layer shape as C1, and the widest instance found so far.

**Layer 1 — nothing calculates from it.** Outside the data files, weapon and armor proficiencies are
read in exactly three places, none of which is a calculation:
- `StepClass.tsx:81` — a creator *display* line
- `fillCharacterPDF.ts:247-249` and `printSheet.ts:1317-1319` — the two *export* paths

`Race.proficiencies` is read by the two export paths **only**. `useCharacterDerived` never mentions
weapon, armor or tool proficiency at all — only skills and saves.

**Layer 2 — the attack roll assumes universal proficiency.** `SheetPage.tsx:1458`:
```
const toHit = abilityMod + profBonus;
```
Unconditional. Every character is proficient with every weapon they equip, and `toggleInventoryEquipped`
has no gate either. A wizard with a greataxe gets the full proficiency bonus to hit. This is *why* the
missing data in layer 3 has gone unnoticed: the data would not have changed any number if it were there.

**Layer 3 — four races state a fixed proficiency in prose and carry no `proficiencies` array:**

| race | book | prose |
|---|---|---|
| `dwarf-hill` | PHB | "proficiency with the battleaxe, handaxe, light hammer, and warhammer" |
| `dwarf-mountain` | PHB | same |
| `gnome-rock` | PHB | "proficiency with artisan's tools (tinker's tools)" |
| `giff` | SJA | "proficiency with firearms" |

Four more are **player choices**, so an array cannot express them and they belong to D4, not here:
`changeling`, `erlw-changeling` (two skills of your choice), `tortle`, `erlw-mark-of-making` (one of
several). Separated deliberately — merging them would have turned an 8-item defect list into a
4-item one plus 4 false positives.

Note the ordering consequence: filling in layer 3 alone changes nothing on the sheet, because layers
1 and 2 discard it. Severity: **medium-high**, and it is a *fix-ordering* finding as much as a defect
one — the data work is worthless before the attack roll learns to ask.

## C4 — `autognome` states poison resistance in prose, `resistances: []`
Its Mechanical Nature trait text contains "resistance to poison damage"; the field is empty. **SJA is
not among the 14 reference books**, so this could not be checked against source — but the two
representations inside the app disagree, which is a defect whichever side is right. Flagged for the
fix pass to resolve against the book when available. Sole resistance disagreement in 122 races.

## C5 — darkvision is CLEAN across all 122 races (baseline)
Checked three ways: prose mentions darkvision but field unset (**0**), prose distance disagrees with
the field (**0**), field set with no prose (**0**). The distance check parses "dim light within N feet"
out of the trait text and compares it to the number — so this is not merely a presence check. Recorded
as a regression baseline for the second pass.

## B4 — subclass feature levels are structurally CLEAN (baseline)
**955 features across all 189 subclasses.** Zero features below their class's `subclassLevel` (which
would be unreachable — the level-up dialog grants from the level table, so the feature could never
fire), and zero levels outside 1-20. Cross-referenced against the real `subclassLevel` of all 25
classes, with `fighter=3`/`cleric=1` as the control.

22 subclasses grant 3+ features at one level; inspection shows these are legitimate (XGtE and TCE
entry levels genuinely stack three features), so it is reported as an observation, not a defect list.

This bounds the remaining Phase B work: the *impossible* levels are all absent, so what is left is
purely "is level N the level the book says", which needs per-subclass book reading and cannot be swept.

## Running defect rate
| Sweep | Entities | Defects |
|---|---|---|
| racefields — darkvision | 122 races × 3 checks | **0** |
| racefields — resistances | 122 races | **1** (autognome) |
| racefields — proficiencies | 122 races | **4** fixed + 4 deferred to D4 |
| subclasslevels — reachability | 955 features / 189 subclasses | **0** |
| proficiency consumers (code) | whole `src/` | **1 systemic** (C3) |

Sweeps to date: **7 layers swept, 4 found defects (57%).** The three clean layers — spell-reference
integrity, darkvision, and subclass feature reachability — are the regression baseline; recording a
clean sweep is what makes the second pass able to detect drift.

---

# PHASE A — all 494 class features vs implementation (2026-07-30, log-only)

`tools/audit/classfeatures.py`. R20 established this shape at subclass level by naming instances;
this sweeps **every** class feature in both editions, so the result is a coverage number rather than
a list of the ones somebody happened to look at.

Parser note worth keeping: the first version demanded `name`/`level`/`description` in a fixed order
and silently captured only **363 of 494** — `isASI`/`featOnly` sit between those fields in places.
The `>= 470` assert caught it. Replaced with a brace-matching object reader that pulls each field
independently. This is the fourth parser artifact in this audit and the fourth caught by an assert
rather than by inspection.

## Coverage
**494 features across all 25 classes** (2014: 234, 2024: 260). Implementation evidence:

| evidence | count |
|---|---|
| none | 222 (45%) |
| ASI / feat slot (handled generically) | 131 |
| hardcoded code reference | 111 |
| resource key | 30 |

The 45% with no evidence is **not** a defect count — most are narrative or DM-facing text that needs
no mechanic. Flagging them all is the mistake the first D4 sweep made. Instead the sweep only reports
features that make a **mechanical claim of a kind the app already has a field for**, which narrows
494 to **13**.

## A1 — `monk-2024` Disciplined Survivor (lv14): proficiency in all saving throws, unimplemented
Its 2014 twin **is** implemented — `useCharacterDerived.ts:156`, "Monk Diamond Soul (lv.14):
proficiency in all saving throws". The 2024 version has no equivalent branch. Textbook R1 family: the
logic exists, keyed to the 2014 id only. A 2024 monk 14 is short a proficiency bonus on four saves.
Severity: **high** (wrong number on a shipping build). Sole proficiency-claim gap in 494 features.

## A2 — expertise gaps: exactly the two R20 already named, and nothing else
`ranger-2024` Deft Explorer (lv2) and `wizard-2024` Scholar (lv2). This is a **corroboration**, not a
new finding — an independent sweep over all 494 features found no expertise gap R20 had missed, which
raises confidence in R20's own list.

## A3 — five features claim advantage; the mechanism exists but nothing feeds it
`barbarian` Danger Sense (2) and Feral Instinct (7), `fighter-2024` Studied Attacks (13), `ranger`
Land's Stride (8), `sorcerer-2024` Innate Sorcery (1).

This is **not** "the app has no advantage system". It does: `useDiceStore.ts:9,26` carry
`mode?: 'normal' | 'advantage' | 'disadvantage'` end to end, and `DiceRoller.tsx` renders the
side-by-side layout. What is missing is the wiring — the **only** things that auto-select a mode are
exhaustion (`SheetPage.tsx:571,603` pass `'disadvantage'`) and the manual button at
`DiceRoller.tsx:582`. No feature ever passes `'advantage'`.

That makes this cheaper to fix than it looks and worth separating from R20: the mechanism is built and
proven, and each feature needs one argument at an existing call site. Severity: **medium** — the
player can select advantage by hand, so nothing is unreachable, but the sheet never volunteers it.

## A4 — Extra Attack (5 classes) has no representation at all
`barbarian`/`fighter`/`monk`/`paladin`/`ranger` level 5. `grep` for `Extra Attack`, `extraAttack`,
`attacksPerAction`, `numAttacks` across `src/hooks` and `src/pages/sheet` returns **nothing**, and
`WeaponAttacksPanel` (`SheetPage.tsx:1435-1470`) lists one row per equipped weapon with no attack
count. Fighter's later 11th/20th upgrades are equally absent.

Severity: **low** — no number is wrong, the sheet simply never states how many attacks the action
buys. Recorded because a player reading only the sheet has no way to know, and because it is the kind
of gap that looks like an oversight rather than a decision.

## Clean in this sweep (baselines)
- **speed claims: 0 unimplemented.** `useCharacterDerived.ts:243` already sums
  `featSpeedBonus + monkSpeedBonus + barbFastMovement`.
- **resistance claims: 0 unimplemented** at class level (C4's autognome is a *race*).
- **spell-grant claims: 0 unimplemented** at class level.

## ✏️ Correction to R20 — one of its notes is now stale
R20 closes with "no infusion carries `alsoIn: ['ERLW']` (see R11)". Fix round 1 (`7586566`) added
`alsoIn: ['ERLW']` to **all 17** infusions and the 4 Artificer specialists. The rest of that paragraph
still stands: `bag-of-holding-infusion` is tagged TCE but is a Replicable Item there rather than an
infusion, and ERLW's Armblade is still absent.

## Running defect rate
| Sweep | Entities | Defects |
|---|---|---|
| classfeatures — proficiency | 494 features | **1** (A1) |
| classfeatures — expertise | 494 features | 2, both already known (A2) |
| classfeatures — advantage wiring | 494 features | **5** (A3, one root cause) |
| classfeatures — extra attack | 494 features | **5** (A4, one root cause) |
| classfeatures — speed / resistance / spell-grant | 494 features | **0** |

Sweeps to date: **8 layers swept, 5 found defects (63%).** Phase A's per-class feature pass is now
covered by a single reproducible sweep rather than 16 hand passes; what remains for Phase A is
per-class *level table* verification against the books, which cannot be swept.

---

# D4 — build-choice triage, COMPLETE (2026-07-30, log-only)

`tools/audit/d4list.py`. The earlier automated attempt was abandoned as unclassifiable
("build=142, usetime=25 from a 103-item list"). It is now clear **why**, and the problem is smaller
than it looked.

## Why the automated attempt failed: one phrase
Nearly every 2014 subclass feature opens with PHB boilerplate — "Beginning when you choose this
archetype at 3rd level, ...". That "choose" is the **subclass** pick, not a choice the feature grants.
`champion` Improved Critical, the canonical false positive in the old table, contains no choice at all:

> "Beginning when you **choose this archetype** at 3rd level, your weapon attacks score a critical hit
> on a roll of 19 or 20."

Stripping that boilerplate — and its select / pick / adopt / join variants, which cost another
6 candidates — takes 173 to **150**. The negative control (Improved Critical must NOT appear) fired on
the first run and is what exposed this; without it the sweep would have shipped the same noise as
before. The discriminator was never targeting language; it was boilerplate contamination.

## The actual question
Not "is this a choice" but **does the choice persist?** A build choice must be stored or the feature
cannot work; a use-time choice is re-made every activation and storing it would be wrong.

`ClassOptionsState` (`types/index.ts:384-402`) can store: fightingStyles, invocations, pactBoon,
metamagic, maneuvers, infusions, optionalFeatures, totemSpirit, aspectTotem, totemicAttunement,
landType. Plus armorerMode, pathOfBeastForm, expertiseSkills, knowledgeDomainSkills, featChoices on
`Character`.

## Result of the hand pass over all 150

**Already stored correctly (7):** totem-warrior x3, battle-master maneuvers, champion +
champion-2024 + college-of-swords fighting styles, armorer Armor Model, circle-of-the-land land type,
knowledge-domain (partial — skills stored, languages not).

**USE-TIME, correctly needing no storage (majority, ~95).** Two kinds: creature targeting ("choose a
creature within 30 feet" — the bulk), and genuinely re-chosen options. The latter are worth naming
because they *look* like build choices: hunter-2024 Hunter's Prey and Defensive Tactics ("change on
Short/Long Rest"), the-fiend / fiend-patron-2024 Fiendish Resilience (each rest), wild-heart Rage of
the Wilds and Power of the Wilds (each rage), path-of-the-beast Form of the Beast (each rage),
circle-of-stars Starry Form (each activation), artillerist Eldritch Cannon (each summon), drakewarden
Drake Companion damage type (when summoned), swarmkeeper Gathered Swarm (each hit),
warrior-of-elements-2024 Elemental Epitome (each turn), tob-school-of-the-tide-watcher Pull of the
Tides (each long rest), diviner-2024 The Third Eye (per rest).

Note path-of-the-beast is *over*-modelled: `pathOfBeastForm` persists a choice RAW re-makes each
rage. Harmless, but it is the mirror of the defect class below.

**BUILD CHOICE WITH NO STORAGE — the defect list (23 features, 17 subclasses):**

| group | subclass / feature | needs |
|---|---|---|
| **named-option lists** | arcane-archer Arcane Shot (lv3 x2, +1 at 7/10/15/18 = 6 picks) | new array |
| | way-of-the-four-elements Disciple of the Elements (3) + Additional (6/11/17) | new array |
| | rune-knight Rune Carver (lv3 x2, more later) | new array |
| | hunter Hunter's Prey (3), Defensive Tactics (7) | new array |
| | way-of-the-kensei Path of the Kensei (lv3, two weapons) | new array |
| | beast-master Ranger's Companion (lv3) / beast-master-2024 Primal Companion (lv3) | new field |
| **single fixed pick** | draconic-bloodline Dragon Ancestor (lv1) — **determines a damage resistance** | one field |
| | draconic-bloodline-2024 Draconic Ancestor (3) + Elemental Affinity (6) | one field |
| | divine-soul Divine Magic (lv1) — affinity grants a free spell | one field |
| | way-of-the-ascendant-dragon Breath of the Dragon (lv3), "your chosen element" | one field |
| | tob-sea-domain One with the Sea (lv17) | one field |
| **proficiency / language** | battle-master Student of War; bladesinging + scag-bladesinging Training in War and Song; cavalier Bonus Proficiency; college-of-lore + college-of-lore-2024 Bonus Proficiencies; fey-wanderer-2024 Otherworldly Glamour; nature-domain Acolyte of Nature; scag-arcana-domain Arcane Initiate; scag-mastermind Master of Intrigue; scag-purple-dragon-knight Royal Envoy; drakewarden Draconic Gift; cobalt-soul Mystical Erudition | **blocked on C3** |

**The proficiency group is blocked, not merely unimplemented.** Twelve of the 23 grant a weapon, tool,
language or skill proficiency — and C3 established that racial/class proficiency data feeds no
calculation at all (`toHit = abilityMod + profBonus`, unconditional). Storing these choices changes
nothing until C3's attack-roll gate exists. That reorders the fix work: **C3 before this group**, or
the effort is wasted.

**Spell-pick group (storage exists, restriction unenforced):** college-of-lore Additional Magical
Secrets (any class), scag-arcana-domain Arcane Mastery (one each of 6th-9th), circle-of-the-land Bonus
Cantrip, school-of-illusion Improved Minor Illusion. The spellbook stores the result, so nothing is
lost — but no code enforces the restriction, so the player can pick anything.

**Residual false positives left to the hand pass (~10):** "if you so choose", and "a direction of your
choice" where the *opponent* chooses (circle-of-the-land Nature's Sanctuary, scag-the-undying Among the
Dead, tob-island-domain High Tide), plus oath-of-the-ancients Undying Sentinel ("you can choose to drop
to 1 hit point" — a yes/no, not a stored option). Deliberately **not** pattern-matched away: a pattern
broad enough to catch these was judged more likely to eat real candidates than to help.

## D4 status: CLOSED as a question, OPEN as work
The classification the earlier round called impossible is done: **23 build choices need storage, ~95
are correctly use-time, 7 already work, ~10 were regex noise.** 12 of the 23 are blocked behind C3.

## Running defect rate
| Sweep | Entities | Defects |
|---|---|---|
| d4list — build choices with no storage | 150 candidates / 189 subclasses | **23** |

Sweeps to date: **9 layers swept, 6 found defects (67%).**

---

# C6 — 52 of 122 races (43%) grant NO ability score increase at all

`tools/audit/raceasi.py`. The largest single mechanical defect found in this audit.

## What it is
2014 races carry a fixed ASI (+2 Str, +1 Con). MMoM and PHB 2024 replaced that with a **flexible**
one — "increase one score by 2 and a different one by 1, or three different scores by 1" — chosen by
the player. The app models a flexible race as `abilityScoreIncreases: {}` and then never asks.

Three facts, each independently checkable:

1. **52 of 122 races have an empty `abilityScoreIncreases`.**
2. **No storage exists for a chosen racial ASI.** `types/index.ts` contains no `racialAsi`,
   `raceAsi`, `racialChoice`, `racialAbilityChoice` or `asiChoices`. The `abilityScoreChoice`
   machinery in `StepFeats.tsx:155-166` belongs to **feats** and is keyed by feat id.
3. **Every consumer reads the static object.** 19 read sites of `abilityScoreIncreases`
   (`useCharacterDerived.ts:47`, `useCharacterStore.ts:22,807`, `useCreatorStore.ts:169,175,204-205`,
   …) and exactly one assignment, in the data itself. `StepRace.tsx:182` renders the literal string
   **"Flexible (see traits)"** — a label, not a picker.

So a flexible race contributes +0 to every ability, permanently, with no way for the player to
correct it.

## Runtime proof, against a matched control
Four characters, identical base scores 15/14/13/12/10/8, same class and level; only the race differs.

| race | rendered scores | verdict |
|---|---|---|
| `dwarf-hill` (fixed ASI) | STR15 DEX14 **CON15** INT12 **WIS11** CHA8 | correct: +2 CON, +1 WIS. **The mechanism works.** |
| `shifter` (MMoM) | STR15 DEX14 CON13 INT12 WIS10 CHA8 | **+0** — identical to base |
| `elf-2024` (PHB 2024) | STR15 DEX14 CON13 INT12 WIS10 CHA8 | **+0** |
| `human-variant` (PHB) | STR15 DEX14 CON13 INT12 WIS10 CHA8 | **+0** — RAW gives +1 to two of your choice |

The dwarf control is what makes this conclusive: the racial-ASI path is not broken in general, it
simply has no input for the flexible case.

## Blast radius by book
| book | count | notes |
|---|---|---|
| MMoM | 31 | the entire reprinted-races line |
| PHB2024 | 10 | **all ten species** |
| SJA | 6 | astral-elf, autognome, giff, hadozee, plasmoid, thri-kreen |
| FToD | 3 | chromatic / metallic / gem dragonborn |
| SCoC | 1 | owlin |
| **PHB** | **1** | **`human-variant`** — Variant Human, one of the most-played races in 2014 |

`human-variant` deserves separate note: it is not a flexible-ASI reprint, it is a **core PHB** option
whose +1/+1 has simply never been implemented. It is the one instance of this defect that a
2014-only, PHB-only player will hit.

## A second-order finding: 32 of the 52 do not even say so in prose
Only **20** of the empty-ASI races carry trait text describing the flexible increase (owlin does;
deep-gnome does not). For the other 32 the ability increase is absent from the data *and* absent from
the description, so the sheet gives the player no indication anything is missing. Those are strictly
worse than the 20 — a player reading the trait list has no reason to suspect a gap.

## Severity
**Highest of the audit.** Every other finding costs a feature, a counter or a choice; this one is a
flat −2/−1 (or −1/−1/−1) on 43% of races, which moves AC, attack, damage, saves, skills, spell save
DC and HP simultaneously. It is also the cheapest kind of thing to miss in a text-accuracy audit,
because the descriptions of the 20 are *correct* — they say exactly what the player should get.

## Fix shape (for round 2, not done here)
Needs a `Character` field for the chosen increases, a picker in `StepRace` (where the "Flexible"
label already sits), and a level-up-independent path since race never changes. The 19 read sites all
funnel through `race.abilityScoreIncreases`, so the merge point is one helper — the same shape as
C3's, and worth doing in the same pass.

## Languages — checked, no mechanical exposure
`Race.languages` is a `string[]` rendered in `StepRace` and the export paths. Nothing computes from
it; there is no language proficiency system to be wrong about. Recorded as **not a defect surface**
rather than swept, so a later pass does not spend effort on it.

## Running defect rate
| Sweep | Entities | Defects |
|---|---|---|
| raceasi — flexible ASI reachability | 122 races | **52** (one root cause) |
| raceasi — languages | 122 races | not a mechanical surface |

Sweeps to date: **10 layers swept, 7 found defects (70%).** Phase C is now COMPLETE: speeds (C1),
resistances (C4), darkvision (C5, clean), proficiencies (C3), ASIs (C6), languages (n/a).

---

## ✏️ CORRECTION to C6 — it is TWO root causes, and the count of 52 was wrong

Found while designing the fix, before writing any code. C6 claimed "52 of 122 races grant no ability
score increase". The consequence is real and the runtime proof stands, but the diagnosis conflated
two different defects, and one third of the count belongs to neither.

### The 10 PHB 2024 species are NOT a race-side defect
In the 2024 rules the **background** grants the ability score increase, not the species
(`phb2024-players-handbook.md`: *"Each background grants: ability score increases (+2/+1 to two, or
+1/+1/+1 to all three listed)"*). So `abilityScoreIncreases: {}` on `elf-2024` and its nine siblings
is **correct data**. My runtime check saw `elf-2024` at +0 and I attributed it to the race; the
character was in fact missing a *background* bonus.

### C6a — race-side flexible ASI, unreachable (42 races, confirmed)
| book | count | rule, per the race's own trait text |
|---|---|---|
| MMoM | 31 | "Increase one score by 2 and a different score by 1, OR three different scores by 1" |
| SJA | 6 | same Tasha-style wording (SJA book unavailable; the app's own trait text is unambiguous) |
| FToD | 3 | chromatic/metallic/gem dragonborn, same wording — verified in the data |
| SCoC | 1 | owlin — `scoc` extract states "Flexible ASI" explicitly |
| PHB | 1 | `human-variant` — a **different** rule: "+1 to two different ability scores of your choice" |

42, not 52. `human-variant` needs its own distribution shape, so a single hardcoded "+2/+1 or
+1/+1/+1" would have silently mis-modelled it.

### C7 (new) — 2024 backgrounds carry the ASI in prose only
`Background` (`types/index.ts:241-254`) has **no ability-score field at all**. The 2024 increase
exists only inside `feature.description`, e.g. acolyte-2024: *"Ability Scores: +2/+1 to Intelligence,
Wisdom, Charisma (or +1 each)"*. Nothing parses it. So **every** 2024 character is missing the entire
+2/+1, regardless of species — 16 backgrounds affected.

This is the same shape as C1/C3/C6a once more: a mechanic that exists as prose beside a type with
nowhere to put it.

### Why this correction matters beyond the count
Fixing C6 as originally written would have added a racial picker to the ten 2024 species — giving
them an increase the 2024 rules do not grant, on top of the background one they are still missing.
The audit's own methodology note applies: *check which source the app's entry names before assuming
the defect is where the symptom appeared.*

## FIX — C6a implemented and verified (racial flexible ASI now reachable)

Fixed in the same pass that produced the correction above, so the ten PHB 2024 species were
deliberately **not** touched.

**Shape.** `Race.flexibleAsi?: number[][]` — each entry one legal distribution of increments.
41 races carry `[[2,1],[1,1,1]]`; `human-variant` carries `[[1,1]]`, because its rule genuinely
differs and a single hardcoded shape would have mis-modelled it. `Character.racialAbilityChoice`
stores the assignment.

**Merge point.** New `src/utils/racialAsi.ts` exports `racialAsi(race, chosen)` — returns the chosen
map for a flexible race, the fixed table otherwise, so it is safe to call unconditionally. All 19
read sites across 9 files now go through it: `useCharacterDerived`, `useCharacterStore` ×2,
`useCreatorStore` ×4, `LevelUpDialog`, `feats.ts`, `StepAbilityScores` ×5, `StepFeats`, `StepReview`,
`StepRace` ×2. A companion `needsRacialAsi()` reports an outstanding choice by comparing the multiset
of picked increments against each legal distribution — so a lone +2 does not satisfy "+2/+1", and
stray zeros never count.

**Reachability.** `FlexibleAsiPicker` is rendered in **both** the creator's race step (replacing the
dead "Flexible (see traits)" label) and the sheet's Character tab. Both, because race cannot change
after creation — a creator-only picker would leave every existing character permanently unable to
supply the value, which is precisely how the Circle of the Land land type and the Deep Gnome spell
ability were each unreachable. Changing race in the creator clears any choice made for the previous
one, since the shapes differ per race.

**Runtime verification** — five builds, identical base scores 15/14/13/12/10/8, only race and choice differing:

| build | rendered | verdict |
|---|---|---|
| `dwarf-hill` (fixed ASI) | CON15 WIS11 | unchanged — no regression on the 70 fixed races |
| `shifter`, no choice yet | base | correctly +0 until chosen |
| `shifter`, +2 STR / +1 CON | **STR17 CON14** | applied |
| `human-variant`, +1 DEX / +1 WIS | **DEX15 WIS11** | applied — the `[[1,1]]` shape works |
| `elf-2024` | base | correctly still +0; its increase is background-side |

**Picker verified interactively**, both directions:

| step | status | scores |
|---|---|---|
| start | choice required | STR15 CON13 |
| assign +2 → STR | choice required *(partial)* | STR17 CON13 |
| assign +1 → CON | **set** | STR17 **CON14** |

A partial assignment applies what is chosen but keeps reporting the choice as outstanding; the flag
flips only on a complete legal distribution.

`npx tsc -b --force` clean, `npm run build` clean.

**Not fixed here: C7** (2024 backgrounds carry the ASI in prose only). It is a different type, a
different picker and a different rule — folding it into this commit would have hidden it.

---

## FIX — C3 implemented and verified (the attack roll now asks about proficiency)

**The blocker was a missing field, not a missing check.** `WeaponData` had no simple/martial
category, and nearly every class states its proficiency as *"Simple weapons"* / *"Martial weapons"*
rather than by name — so there was no way to resolve a grant against a weapon even if the attack roll
had wanted to. That is why `toHit = abilityMod + profBonus` was unconditional.

**What changed.**
1. `WeaponData.category: 'simple' | 'martial' | 'unarmed'` on all 38 weapons — 14 simple, 23 martial,
   1 unarmed, matching PHB p.149. The script asserted both directions (no weapon left unclassified,
   no classification naming a weapon that does not exist) rather than guessing.
2. New `src/utils/weaponProficiency.ts` → `isProficientWithWeapon(character, weaponName)`. Handles
   both grant shapes: category grants, and named grants which the books pluralise inconsistently
   ("Longswords" vs "Rapier"), so it tries the literal and a singularised form. Named grants resolve
   through `lookupWeapon`, so race proficiency arrays that mix in skills — `['Perception']`,
   `['Stealth']` — simply never match a weapon.
3. `SheetPage.tsx` weapon panel: `toHit = abilityMod + (proficient ? profBonus : 0)`, plus a
   **"not proficient"** badge. Deliberately visible: a smaller attack number with no explanation
   reads as a bug.
4. C3 layer 3, partially: `dwarf-hill` and `dwarf-mountain` now carry
   `proficiencies: ['Battleaxe', 'Handaxe', 'Light hammer', 'Warhammer']`, which their own trait text
   already granted.

**Two deliberate non-changes.**
- An **unknown weapon is treated as proficient**. The inventory accepts free text, and silently
  docking the bonus on a homebrew or renamed item ("Longsword +1" resolves, "Bob's Cleaver" does not)
  would be worse than granting it. Non-proficiency should be a statement, not a parse failure.
- `gnome-rock` (artisan's tools) and `giff` (firearms) were **not** given `proficiencies` entries.
  Neither is a weapon the attack roll can resolve, and adding data no code reads is how C3 came
  about in the first place.

**Runtime verification** — five builds, STR 16 (+3), level 5 (prof +3), so proficient = +6 and
non-proficient = +3:

| build | to-hit | badge | mechanism under test |
|---|---|---|---|
| Wizard + Greataxe | **+3** | shown | martial weapon, wizard has none — negative control |
| Wizard + Quarterstaff | **+6** | — | named plural grant `'Quarterstaffs'` → singularisation works |
| Fighter + Greataxe | **+6** | — | `'Martial weapons'` category grant |
| **Hill Dwarf wizard + Battleaxe** | **+6** | — | **the new racial grant** — a wizard proficient by race |
| **Hill Dwarf wizard + Greatsword** | **+3** | shown | the racial grant correctly does *not* over-apply |

The dwarf pair is the load-bearing evidence: one character, two weapons, differing only in whether
the racial grant covers them.

**Still open in this area.**
- **Armor proficiency is not enforced.** RAW: wearing armor you lack proficiency with gives
  disadvantage on any ability check, save or attack using Str or Dex, and prevents spellcasting.
  None of that exists. Left out deliberately — it needs the advantage/disadvantage wiring from A3,
  and folding it in would have made this change hard to verify.
- **The 12 proficiency-granting build choices from D4 are now unblocked** — the attack roll finally
  reads the data, so storing those choices will do something. That was the whole reason C3 was
  sequenced ahead of them.

`npx tsc -b --force` clean, `npm run build` clean. `keycheck.py`, `spellrefs.py` and `maxtables.py`
all re-run unchanged (0 dangling override keys, 223/223 spell refs, 0 table gaps).
