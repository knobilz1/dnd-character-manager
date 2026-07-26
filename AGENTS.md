# Tavern Sheet — working notes for coding agents

Tauri v2 desktop app (Rust backend, React + TypeScript frontend). It began as a
D&D 5e character manager and grew a voice DM console, a battle-map generator that
composes real art from a 183k-tile catalog, 3D character models, TTS voices, and
a multi-engine LLM layer. Windows is the dev box; releases build Windows + macOS.
Published as `knobilz1`.

**This file is auto-loaded by Codex.** Claude Code reads `CLAUDE.md`; `agy`
(Gemini/Antigravity) reads neither — see §6, it's measured, not assumed.

**State:** v0.23.5 (2026-07-25), `main` clean, 470 Rust tests, all feature
branches merged. The updater endpoint serves it across 6 signed platforms.

Contents: §1 rules · §2 release · §3 repo map · §4 campaign data · §5 flows ·
§6 multi-engine · §7 driving the app · §8 horizon · §9 hard lessons

---

## 1. Rules that will burn you

Every one of these has actually gone wrong here.

| Rule | Why |
|---|---|
| **Version lives ONLY in `src-tauri/tauri.conf.json`** | `package.json` says `0.0.0`, `Cargo.toml` says `0.1.0`. Decoys. Releases trigger on pushing a `vX.Y.Z` tag. |
| **`npx tsc --noEmit` checks NOTHING** | Root tsconfig is `files: []` + project references. Use **`npx tsc -b --force`**. |
| **Never pixel-click the app window** | Clicks land wrong and minimise/close it. Drive over CDP (§7). |
| **Separate `CARGO_TARGET_DIR` for `cargo test`** if `tauri dev` is running | They fight over the build lock. |
| **Don't edit `.rs` or `tauri.conf.json` while a long harness runs** | `tauri dev` watches them, restarts the app, CDP dies mid-run. |
| **`Objects:`/`Features:` map layers must NEVER contain NPCs or monsters** | Nabil uses physical miniatures. Naming cells in the text `Deployment:` section is correct; drawing a creature on the map is not. |
| **Render and LOOK at every generated map** | Judging from the tile list has produced confident wrong conclusions repeatedly. |
| **Measure before fixing** | Diff ranking/prompt changes against the real catalog or a real run. Guessing has cost whole sessions. |
| **Never print `.env`** | Real Google OAuth secrets. |
| **Don't push, tag, merge to `main`, or bump the version unless asked.** | |

---

## 2. Release checklist

1. `cargo test --lib` (separate target dir) · `npx tsc -b --force` · `npm run build`.
2. **If `src-tauri/src/dm.rs` changed, run the cfg-inversion check.** It's the
   only file with platform arms and nothing local compiles the macOS side.
   v0.23.2 shipped Windows-only because a `#[cfg(windows)]` got detached from its
   `fn` by an inserted function. On a copy: `#[cfg(not(windows))]`→`#[cfg(all())]`,
   `#[cfg(windows)]`→`#[cfg(any())]`, `#[cfg(target_os = "macos")]`→`#[cfg(all())]`,
   `cargo check --lib`, restore. Repeat with the linux arm on. Code using
   `std::os::unix` can't be checked this way — prefer a plain `Command` so it can.
3. Bump `tauri.conf.json` → commit `chore: vX.Y.Z` → push `main` → push the tag.
4. **Verify the release, don't trust green CI:**
   `curl -sL https://github.com/knobilz1/dnd-character-manager/releases/latest/download/latest.json`
   must be HTTP 200, the new version, all platforms signed. v0.23.2 published
   without `latest.json` and 404'd every user's updater.

---

## 3. Repo map

### Backend — `src-tauri/src/` (~28k lines, 105 Tauri commands)

| File | Lines | What |
|---|---|---|
| `campaign.rs` | 13k | Campaigns, memory files, module import/chapters, session plans, **battle-map generation + tile resolution**. 52 commands. The big one. |
| `tile_library.rs` | 4.9k | The 183k-tile catalog: indexing, shortlisting, keyword/biome ranking, `SYNONYMS` |
| `dm.rs` | 3.0k | Live DM turns, CLI spawning, sign-in, vision. **Only file with platform arms.** |
| `tts.rs` | 2.2k | Kokoro (default) + F5 (opt-in HD) voices, voice catalog |
| `local_llm.rs` | 1.8k | Ingestion routing, cross-model critique, local-LLM path |
| `pack_profile.rs` | 973 | Per-biome tile-pack profile: which queries a biome rolls for floor/liquid |
| `cli_provider.rs` | 806 | **PURE** per-engine argv building, well tested — start here for the engine layer |
| `party_listener.rs` | 801 | LAN `:7777` channel: players push turns/photos, pull narration |
| `oauth.rs` | 326 | Google Drive PKCE loopback |

### Frontend — `src/`

- `pages/sheet/` — the character sheet: `SheetPage`, `CharacterViewport` (3D),
  `DiceRoller`, `InventoryPanel`, `SpellPanel`, `TraitsPanel`, `LevelUpDialog`,
  `SidebarPanel` (9 pinnable modules), `SnapshotPanel`
- `pages/creator/` — step-based character creator
- `pages/dm/DMConsolePage.tsx` — the DM console (~5k lines; most DM work lands here)
- `pages/table/TableView.tsx` — chrome-less second-monitor/TV map view
- `pages/HomePage.tsx`, `GraveyardPage.tsx`
- `store/` — Zustand, persisted to localStorage: `useSettingsStore`
  (`tavern-sheet-settings`), `useCharacterStore`, `useCampaignStore`,
  `usePartyStore`, `useDiceStore`, `useDriveStore`, `useLibraryStore`,
  `useThemeStore`, `useSidebarStore`, `useSnapshotStore`, `useCreatorStore`
- `data/` — 27 files of 5e rules content (classes, races, feats, spells, items,
  backgrounds, invocations, infusions, subclass tips…), incl. PHB 2014 **and**
  2024 editions gated by `BookId`
- `utils/` — `battleMapRender.ts` (deterministic spec→PNG/PDF), `dmActions.ts`
  (parses the ```dm-actions block), `dmPrompt.ts` (builds each turn's prompt),
  `boardCrossCheck.ts`, `tableCamera.ts`

### Where to go for a given task

| Task | Start at |
|---|---|
| DM says/does the wrong thing | `campaign.rs` `BASE_CLAUDE_MD` / `DM_RULES` (§4), then `dmPrompt.ts` |
| A dm-action isn't applied | `src/utils/dmActions.ts` (parse) → `DMConsolePage.runTurn` (apply) |
| Map looks wrong | Render it (§7), then `campaign.rs` tile resolution / `tile_library.rs` ranking |
| Wrong tile chosen for a word | `SYNONYMS` in `tile_library.rs` — most such bugs are "the map used a word the pack has never heard of" |
| Character rules/data wrong | `src/data/` |
| Engine/CLI behaviour | `cli_provider.rs` (pure args) then `dm.rs` (spawning) |
| Voices | `tts.rs` |

---

## 4. Campaign data and memory — where the DM's brain lives

**Not in the repo.** Each campaign is a folder at
`%APPDATA%\com.nabil.dndsheet\campaigns\<campaign-id>\`, and the DM CLI is run
**with that folder as its working directory**. That is the entire mechanism by
which the DM knows anything.

```
<campaign-id>/
  CLAUDE.md              persona + world + the dm-actions contract. @imports below.
  name.txt               display name
  battle_mode.txt        grid | theater | hex  — gates a LOT of behaviour
  modules_index.md       one line per imported module
  modules_manifest.json
  modules/active_id.txt
  active_module/
    index.md             the module's chapter list
    current.md           the CURRENT chapter's full text (trimmed as the party progresses)
    plan.md              the module's arc plan (written at import, critiqued)
    session_plan.md      cached "Plan Next Session" output
  memory/
    MEMORY.md            the campaign's running memory index
    session_index.md     one line per past session
    full_history.md      verbatim transcripts
    entities.md          NPCs the DM chose to remember
    locations.md
    party.md             the player characters
    flagged_facts.md     open threads / unresolved promises
    dm_rules.md          REGENERATED EVERY LOAD — see below
    battle_maps/index.md one line per prepared map
    battle_maps/<slug>.md         the map spec (ASCII grid + Features + Tactics + Deployment)
    battle_maps/<slug>.tiles.json resolved art sidecar
```

`CLAUDE.md` pulls the rest in with `@relative/path` import lines — Claude Code
resolves those automatically. Currently:

```
@memory/MEMORY.md          @memory/session_index.md   @memory/flagged_facts.md
@memory/entities.md        @memory/locations.md       @memory/party.md
@memory/battle_maps/index.md                          @memory/dm_rules.md
@modules_index.md          @active_module/index.md    @active_module/current.md
```

### The trap that matters most here

**`BASE_CLAUDE_MD` (in `campaign.rs`) is written ONCE when a campaign is created
and NEVER rewritten.** Anything you document there reaches new campaigns and *no
existing one*.

**`DM_RULES` → `memory/dm_rules.md` is regenerated on every campaign load**, and
it is mode-specific (grid / theater / hex), which grid-gates content for free.

So: **anything an existing campaign must learn goes in `DM_RULES`.** The `makeMap`
action was nearly shipped into the dead file. There are also `sync_*_at` upgrade
functions (`sync_dm_rules_at`, `sync_session_index_at`,
`sync_battle_maps_index_at`) that retrofit an *import line* into an old
`CLAUDE.md` without rewriting its body — that's the pattern if you genuinely need
a new file imported.

### Non-Claude engines don't get any of this for free

Only `CLAUDE.md` is written, and only Claude reads it (§6). For Codex/Gemini,
`local_llm::cli_project_context` resolves `CLAUDE.md` + its `@imports` and
prepends the result to the prompt — once per thread, and again whenever the
content hash changes (so a chapter advance still reaches the DM next turn, which
is the property Claude gets free by re-reading the file).

---

## 5. How the main flows work

**A live DM turn.** Mic → Whisper (off-thread) → `dmPrompt.ts` builds the turn
(party status + battle log + what was said; persona/lore come from the campaign
folder, not this prompt) → `dm.rs` spawns the engine CLI in the campaign dir →
reply = narration + optional trailing ` ```dm-actions ` JSON block →
`dmActions.ts` parses and strips it (it must never be spoken) →
`DMConsolePage.runTurn` applies the actions → TTS speaks the narration. Claude
streams (partial text starts speaking early); other engines return whole, and the
UI says so.

**Actions** include `damage`, `battleLog`, `removeCombatant`, `endBattle`,
`rememberEntity`, `rememberLocation`, `advanceToChapter`, `recallSession`,
`recallMap` (pull an existing map's spec into the next turn), `makeMap` (build a
new one — see §8).

**Battle map generation.** ~542s per map: **spec ~467s (87%)** — the model writes
an ASCII grid + Features + Tactics + Deployment, best of several parallel
candidates — then **tile resolution ~73s**: classify the biome (voted, §8), roll
the pack profile for floor/liquid queries, shortlist candidates from the catalog,
and vision-pick per slot. Maps for one plan generate **concurrently**, so five
take about as long as one.

**Module import.** PDF → text extraction (80K chunks) → chapterize (heading
skeleton → chapters) → per-chapter naming → arc plan → cross-model critique →
written to `active_module/`.

**LAN play.** `party_listener.rs` serves `:7777`; players' own app instances push
spoken turns and table photos and pull narration. One camera holder at a time.

---

## 6. The multi-engine layer

Every engine is the vendor's own CLI as a subprocess, so Nabil pays a flat
subscription and never a per-token API key.

| Engine | CLI | Lockdown | Prompt delivery |
|---|---|---|---|
| Claude | `claude` | `--tools ""` | stdin |
| Codex | `codex` | `--sandbox read-only --ignore-user-config` | stdin |
| Gemini | `agy` | `--mode plan --sandbox` | **argv only** |

A flag being *accepted* is not a flag being *obeyed* — only a real write attempt
plus an md5 comparison proves a sandbox. Gemini's sandbox **redirects** writes to
a scratch dir and reports success, so it never errors.

### Which CLI reads what (measured 2026-07-25)

A scratch dir with `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, each holding a
different pass-phrase, asked each CLI for "the pass-phrase":

| CLI | reads |
|---|---|
| `claude` | CLAUDE.md |
| `codex` | **AGENTS.md only** |
| `agy --print` | **none of the three** |

### agy's constraints (all measured)

- The prompt **must** be `--print`'s value. `--print` with no value prints help;
  `--print --` swallows the `--`; stdin is never read (`--prompt` is an alias).
- So it inherits Windows' **32,767-char command-line cap**. A 40,015-char prompt
  doesn't error — it **fails to spawn** ("Argument list too long"). The campaign
  brief is ~39K, hence line-aligned chunking in `run_engine_turn`.
- Ingestion's biggest prompts are 60–80K (`MAX_CHAPTER_CHARS`,
  `EXTRACTION_CHUNK_MAX_CHARS`), so module import on Gemini is impossible; it's
  refused up front with `PROMPT_TOO_LONG_MARKER` and fails over to a
  stdin-capable engine.
- agy's read tools are **auto-denied headless**, and it returns
  `"status":"SUCCESS"` with an empty response — a denied tool looks like a win.
- `agy models` prints the **catalogue, not entitlements** (it lists everything
  while signed out). Only a real call proves access.

### Model choice

Gemini is probed per workload — turns take `gemini-3.1-pro-low`, ingestion takes
`-pro-high`. Claude and Codex are deliberately **not** auto-selected: their tiers
are pinned on measurements that auto-overriding would silently invalidate
(`BOARD_READ_MODEL` is opus because sonnet scored 3/6 against opus's 6/6).

---

## 7. Driving and verifying the app

It's a native window; browser-preview tooling can't host it. Start with the
debugger open:

```bash
WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 npm run tauri dev
```

Then talk to it on `127.0.0.1:9222`. Node 26 has a built-in `WebSocket`. Call
backend commands from the page with
`window.__TAURI_INTERNALS__.invoke('cmd', { args })`.

Harnesses live in `scripts/` — see `scripts/README-harnesses.md`. Start with
`render-map.mjs` (render a map and actually look at it), `engine-turn.mjs` (two
live DM turns with memory + action-block checks), `setmode.mjs`.

Map debug log: `%TEMP%\tavern_map_debug.log`, truncated at the start of each
generation run.

---

## 8. Where things stand, and what's next

### Shipped in v0.23.5 (this week's work)

- Cross-model critique now also runs on **Plan Next Session** (it already ran on
  campaign lore, lore updates, and a module's plan at import). Measured: two
  reviewers, two rounds, 10/10 edits applied — and round 2 repaired a
  contradiction round 1's own patch introduced, which is why there are two.
- **`[combat]` means "a fight CAN happen"**, including optional and
  failure-state ones. Maps are generated for `[combat]` encounters and no others.
- **Three maps per plan** (`MAX_PLAN_MAPS`), in plan order, everything dropped
  named in `skipped_maps` and shown in the UI.
- **Biome classification hardened** — see §9, the worst silent defect found.

### Open, highest value first

1. **`makeMap` doesn't trigger.** Fully wired (parses, strips, rejects malformed
   input, grid-gated in code, never blocks the turn) but across four live Codex
   turns the DM never asked — including a party explicitly declaring an attack on
   an unmapped place. **`ask_dm_engine` rejects Claude**, so the engine most
   sessions use was never tested. Try a real Claude session first. If it stays
   silent, the fix is probably surfacing the action in the always-loaded action
   list — which needs an upgrade path for existing campaigns (§4), not a one-liner.
2. **Curse of Strahd import.** Never run. Extraction is the cost (~10× the
   Gloamwood module); the critique pipeline is validated and roughly constant.
3. **Map quality defects**, all seen in real output: `o` pillars render as ~10px
   rings despite being toppling set pieces; a war camp came out ~85% empty; a
   stalag pool renders near-black; cavern ground picks `Webbed_A_01`; hide tents
   render as brick. Several share a root cause — **coverage outranks biome
   affinity**, so a generic adjective imports off-biome art. The same shape is
   sometimes *correct* (a bone pile), so no rule over (coverage, affinity) alone
   separates them. Needs an idea, not a tweak.
4. **The liquid-contrast rule fights the fiction.** It rejects water too close to
   the floor colour for legibility, which guarantees a marsh map can't have the
   "black water" its own spec describes. Both goals are legitimate.
5. **`reresolve_map_tiles` has no UI.** Re-runs only tile resolution (~72s vs a
   ~542s full regenerate) — very useful for iterating on tile art.
6. **Never verified:** `getUserMedia` actually returning a frame (no camera on
   this box, so `captureTableFrame` has never run for real); the
   `TILE PICK AGREED` log arm.
7. **Housekeeping:** 81 campaigns exist, mostly `x1-*`/`w1-*`/`zz-*` scratch.
   `zz-gloam` is the useful one (Gloamwood Whispers imported, grid mode, 4 maps).
   The maplog interleaves on concurrent writes (cosmetic).

### Longer horizon (discussed, not started)

Android port · party-wide initiative tracking · per-NPC custom voice cloning
("whisper" feature on top of the shipped F5-TTS engine) · extending the
cross-check to the vision board read · a UI for re-resolving tile art.

### Numbers worth not re-deriving

| Thing | Number |
|---|---|
| Battle map | ~542s = spec ~467s (87%) + tiles ~73s |
| Plan Next Session (plan text only) | ~245–290s |
| DM turn, Codex | 6.0s / 2.2s |
| DM turn, Gemini | 26.2s `pro-low`, **141.9s `pro-high`**, 14.0s agy default |
| Board read, angled 8-token photo | claude 4/8 exact, codex 2/8 — **and they make the same error on 2**, so agreement isn't evidence of correctness |
| Board read latency | claude ~95s, codex ~12s |

---

## 9. Hard lessons

Written down because each one cost real time, and most look like nothing.

- **A test that shares the code's assumption proves nothing.** Tests here once
  passed against a deliberately broken source because they asserted against the
  same constant they were testing. Sabotage-check anything load-bearing.
- **Log both outcomes.** Silence that could mean "agreed", "returned nothing", or
  "never ran" has hidden two separate defects. The critique cross-check looked
  healthy for days while every leg returned empty.
- **The cheapest call can be the most destructive.** `classify_biome` was one
  low-effort sonnet call deciding the floor, liquid *and* vegetation for a whole
  map. Same spec, six runs: `swamp`×4, `forest`, **`horror`** — and `horror`
  swapped the ground for flesh, the water for blood and the trees for tentacles.
  Undetectable downstream, because within the horror pack that art is correct.
  Now voted, on opus at medium effort. Spend redundancy where blast radius is
  large, not where cost is high.
- **Compiling isn't building.** `cargo` here only ever compiles the Windows arm.
- **`--help` is not the flag list.** `--output-format` was real and undocumented;
  a flag can also be accepted and silently ignored.
- **Verify the instruction arrived before concluding the model ignored it.** A
  `makeMap` test "failed" three times before checking whether the rule was in the
  campaign's regenerated `dm_rules.md`. It wasn't.
- **Don't instruct the model into the shape you're testing for.** A prompt ending
  "narrate in three sentences" measures your instruction, not the rules.
- **Don't build test scenarios on invented content.** The DM is told to reject
  player overreach and it does — you'll measure that rule instead of your feature.
- **Waiting for the page to answer ≠ waiting for the rebuild to land.** If the old
  app never went down, a CDP poll passes instantly and you test stale code.
- **Never build JS with bash heredocs** (`\n`, `\d`, backticks, `${}` all mangle),
  and remember **the page has no `process`** — referencing it throws silently, so
  a script that prints success unconditionally will lie to you.
- **`get_map_tiles` has no `.terrain` key** — assemble terrain from the top-level
  `floor`/`liquid`/`natural_walls`. Reading `.terrain` silently renders built-in
  sprites, which looks exactly like a texture bug.
- **Dev and prod are separate localStorage origins.** "No characters yet" in dev
  is not data loss.

## House style

Comments explain **why**, especially when code encodes a measurement or a past
bug; match the density already in the file. Prefer the smallest change that fixes
the root cause — and fix it where all callers route through, not in the one path
a report happened to name.
