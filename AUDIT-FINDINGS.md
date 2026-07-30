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

# SECOND PASS (user-requested)
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
