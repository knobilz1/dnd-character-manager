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

### R9 — OPEN: the resource pip row is hard-capped at 20, with no numeric readout
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
