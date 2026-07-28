# Tavern Sheet — working notes for coding agents

Tauri v2 desktop app (Rust backend, React + TypeScript frontend). It began as a
D&D 5e character manager and grew a voice DM console, a battle-map generator that
composes real art from a 183k-tile catalog, 3D character models, TTS voices, and
a multi-engine LLM layer. Windows is the dev box; releases build Windows + macOS.
Published as `knobilz1`.

**This file is auto-loaded by Codex.** Claude Code reads `CLAUDE.md`; `agy`
(Gemini/Antigravity) reads neither — see §7, it's measured, not assumed.

**State:** v0.23.9 (2026-07-28), `main` clean, 482 Rust tests (+23 `#[ignore]`d
real-data harnesses), all feature branches merged. The updater endpoint serves
6 signed platforms.

Contents: §1 rules · §2 setup/build/test · §3 GitHub Actions · §4 repo map ·
§5 campaign data · §6 flows · §7 multi-engine · §8 driving the app ·
§9 feature map (shipped + planned) · §10 hard lessons

### Start here

**This file is a map, not a substitute for the source.** It tells you where to
look and what will bite; it cannot stand in for 28k lines of Rust. Before
changing anything:

1. Read §1 (rules) and the relevant task row in §4.
2. **Read the `//!` module doc comment at the top of the file you're touching.**
   They are long, current, and explain *why* — `campaign.rs` has 56 lines of it,
   `cli_provider.rs` 44. Then read the `///` on the specific function. Many of
   them record a measurement or a bug that is the whole reason the code is shaped
   that way, and several name the exact function to revisit if you extend it.
3. If it's DM behaviour, read the campaign's own `CLAUDE.md` and
   `memory/dm_rules.md` on disk (§5) — the DM's instructions live there, not in
   this repo, and `dm_rules.md` is regenerated so the on-disk copy is the truth.
4. If it's map or tile behaviour, generate one and **look at it** (§8). The tile
   list will not show you brick ground in a marsh.

A concrete first pass for `campaign.rs`, which is the file most work lands in:
its module doc, then `BASE_CLAUDE_MD` and `DM_RULES` (the DM's actual
instructions), then whichever of the three areas you need — campaign/memory
files, module import + chapters, or battle-map generation + tile resolution.

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

## 2. Setup, building, testing

### Prerequisites

Node 24+ (CI pins 24; Node 26 locally for the harnesses' built-in `WebSocket`),
a stable Rust toolchain, and WebView2 (present on current Windows). Then
`npm install`.

Runtime things that live **outside the repo** and that a fresh clone won't have:

| Needs | Where | Without it |
|---|---|---|
| `.env` with `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | repo root, gitignored | Drive sync can't authorise. **Never print these.** |
| Campaign folders | `%APPDATA%\com.nabil.dndsheet\campaigns\` | The DM has nothing to run |
| Tile library (`manifest.json` ~86 MB, `pack_profile.json`, `pack_profile_overrides.json`) | `%APPDATA%\com.nabil.dndsheet\tile_library\` — importable in-app now (`import_tile_library`), no longer a manual copy | Maps render as built-in sprites, no catalog art |
| Vendor CLIs installed **and signed in** | `claude`, `codex`, `agy` | DM turns and ingestion fail |
| Release signing key | GitHub secret, see §3 | CI fails fast on purpose |

### Commands

```bash
npm run tauri dev            # desktop app (add the CDP env var — see §8)
npm run dev                  # frontend only in a browser; no Tauri IPC, most DM features dead
npx tsc -b --force           # the ONLY typecheck that works here
npm run build                # production frontend build
cd src-tauri && cargo test --lib          # 482 tests
```

### Reading the code

**The `//!` module doc comments are the real documentation** — 56 lines at the
top of `campaign.rs`, 44 in `cli_provider.rs`, 30 in `dm.rs`, 28 in
`local_llm.rs`, 21 in `tile_library.rs`. They explain *why*, and they are kept
current. Read the module doc before the code, and read the `///` on any function
you're about to change — a lot of them record a measurement or a past bug, and
several say explicitly "if X is ever added, this is the function to revisit".

Tests are inline `#[cfg(test)] mod tests` at the bottom of each file (265 in
`campaign.rs` alone).

**`#[ignore]`d tests are real-data harnesses, not dead tests.** They hit the live
catalog, real campaigns, or live models, and are driven by env vars. Run with
`cargo test --lib <name> -- --ignored --nocapture`. The useful ones:

| Harness | Env vars | Use |
|---|---|---|
| `classify_biome_over_the_real_map_corpus` | `MAP_FILTER`, `MAP_CORPUS` | Which biome real map specs classify as |
| `vocabulary_misses_over_the_real_map_corpus` | `MAP_CORPUS` | Words the maps use that the catalog has never heard of — the single cheapest source of tile bugs |
| `rank_snapshot_over_the_real_catalog` | `TILE_CORPUS`, `TILE_SNAPSHOT`, `TILE_SCENES`, `TILE_CATEGORY`, `TILE_DEPTH` | Before/after ranking diffs. **Sweep any ranking change through this before believing it.** |
| `deployment_standability_over_the_real_maps` | `MAP_CORPUS` | Are deployment cells actually stand-on-able |
| `chapterize_a_real_module`, `measure_candidate_heading_lines` | `HEADING_SCAN_PDF` | Module import against a real PDF |
| `local_ingestion_end_to_end` | `LOCAL_INGEST_URL`, `LOCAL_INGEST_MODEL` | The local-LLM path |
| `*_end_to_end` (chapterize, lore, digest, plan) | — | Live model calls; slow and costly |

---

## 3. GitHub Actions — the whole release flow

One workflow: `.github/workflows/release.yml`. **It is the only CI.** There is no
PR check and **no test job** — pushing a tag proves the app compiles on three
platforms and nothing more. Tests and typechecks are local-only, which is why the
checklist below matters.

### Trigger

```yaml
on: { push: { tags: ['v*'] } }
```

Only a pushed tag. Pushing to `main` runs nothing.

### Job 1 — `build` (matrix of 3)

| Runner | Target |
|---|---|
| `macos-latest` | `aarch64-apple-darwin` |
| `macos-latest` | `x86_64-apple-darwin` |
| `windows-latest` | native |

`fail-fast: false`, so one platform failing does **not** cancel the others.

Steps: checkout → Node 24 → Rust stable (+ the matrix target) → `swatinem/rust-cache`
scoped to `./src-tauri -> target` → `npm install` → **verify the signing key
secret exists** (fails fast with a clear message rather than building for ten
minutes and failing at the end) → `tauri-apps/tauri-action@v0`, which builds,
creates the GitHub release, and uploads that platform's artifacts.

Note `includeUpdaterJson: false` — the action deliberately does **not** write
`latest.json`. That's job 2.

Release is published live immediately (`releaseDraft: false`, `prerelease: false`).

### Job 2 — `publish-updater` (`needs: build`, ubuntu)

An inline Python script that:

1. `gh release download <tag> --pattern '*.sig'` — pulls every signature.
2. Reads exactly three: `Tavern.Sheet_aarch64.app.tar.gz.sig`,
   `Tavern.Sheet_x64.app.tar.gz.sig`, `Tavern.Sheet_<version>_x64_en-US.msi.sig`.
3. Builds `latest.json` mapping each signature to **two** platform keys
   (`darwin-aarch64` + `darwin-aarch64-app`, etc. — Tauri looks up both spellings).
4. **Exits 1 if no signatures were found** ("builds likely failed").
5. `gh release upload ... --clobber`.

### Why v0.23.2 broke, and what it teaches

`needs: build` means job 2 runs only if **all three** matrix legs succeed. With
`fail-fast: false`, both macOS legs failed to compile while Windows succeeded —
so Windows artifacts were published to a live, non-draft, non-prerelease
release, and `publish-updater` was skipped. The result: a "latest" release with
**no `latest.json`**, which 404'd the updater for every existing user.

Two consequences worth holding onto:

- **A partly-failed release still publishes.** Nothing rolls back what the
  succeeding legs already uploaded.
- **Green-looking artifacts are not a working release.** Always check the
  endpoint (below).

### Secrets (repo Settings → Secrets → Actions)

| Secret | Used for |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | Updater signatures. Checked before any build. Password is deliberately empty. |
| `VITE_GOOGLE_CLIENT_ID` / `VITE_GOOGLE_CLIENT_SECRET` | Passed as `GOOGLE_CLIENT_ID`/`_SECRET`, baked into the Rust binary at build time |
| `GITHUB_TOKEN` | Automatic; creates the release and uploads assets |

### Release checklist

1. `cargo test --lib` (separate target dir) · `npx tsc -b --force` · `npm run build`.
   **CI will not do any of this for you.**
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
   must be HTTP 200, the new version, and every platform signed.

### If you change this workflow

- Renaming artifacts breaks job 2 silently-ish — the filenames in the Python
  block are hardcoded, and a missed signature just drops that platform from
  `latest.json` rather than failing (only *zero* platforms is an error).
- Adding a platform means adding a matrix leg **and** a `read_sig` + platform
  block in the Python.
- `npm install` (not `npm ci`) — the lockfile isn't enforced, and heavy
  devDependencies land on every CI run on all three legs. Keep them out.
- A rollback is `gh release delete vX.Y.Z --cleanup-tag`. Marking a bad release
  as prerelease is the fast mitigation: `releases/latest/download/` resolves to
  the newest **non**-prerelease, so it immediately falls back to the previous
  good version.

---

## 4. Repo map

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

## 5. Campaign data and memory — where the DM's brain lives

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

Only `CLAUDE.md` is written, and only Claude reads it (§7). For Codex/Gemini,
`local_llm::cli_project_context` resolves `CLAUDE.md` + its `@imports` and
prepends the result to the prompt — once per thread, and again whenever the
content hash changes (so a chapter advance still reaches the DM next turn, which
is the property Claude gets free by re-reading the file).

---

## 6. How the main flows work

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

## 7. The multi-engine layer

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
`-pro-high`. Codex probes its own ingest model too (`best_codex_ingest_model`).

**Claude is deliberately still NOT auto-selected**, and that is not an oversight:
its tiers are pinned on measurements that auto-overriding would silently
invalidate (`BOARD_READ_MODEL` is opus because sonnet scored 3/6 against opus's
6/6; `classify_biome` is opus-at-medium because the cheap call was the
destructive one, §10). Probe the engines whose tiers rest on nothing measured;
leave alone the ones that do.

---

## 8. Driving and verifying the app

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

## 9. Feature map — shipped and planned

### Shipped and working (the app as it stands)

Treat all of this as done. It is easy to look at a 13k-line file and assume
something is half-built; almost nothing here is.

**Character side**
- Creation wizard — species/race, class, subclass, background, ability scores,
  skills, feats, spells, starting equipment. **PHB 2014 and 2024 both supported**,
  gated per-book by `BookId` (14 source books).
- Sheet — HP, conditions, death saves (with the skull die), exhaustion,
  inspiration; combat tab with spell slots, pact magic, class/subclass resources,
  hit dice, rests; full spellbook with prepared/concentration tracking; inventory
  with weight + encumbrance and a generated Town Store; traits/notes; session
  journal; a customisable sidebar of 9 pinnable modules.
- Level up — ASI/feat choices, subclass selection, multiclassing (including
  multiclass proficiency gains), HP rolling.
- **3D character viewer** — all PHB base races M/F, HP-driven wound/limp/dying
  states, modular hair with colour tint, helmet armor via bone-socket attachment.
  Models are side-loaded Tauri resources, not embedded (embedding overflows LLVM).
- Export/import — JSON, an official WotC-style print sheet, a built-in PDF
  generator, multi-character print, **Google Drive sync** (PKCE loopback OAuth,
  per-character merge, tombstones, OS keychain).
- Graveyard, 8 themes, dice roller with a d20 FAB, auto-update on startup.

**DM side**
- **Voice DM console** — mic → Whisper → engine → TTS, with distinct
  auto-assigned per-NPC voices. Claude streams so narration starts early.
- **Campaign memory** — persistent lore, entities, locations, party, flagged
  facts, session index and recaps, all recalled across sessions (§5).
- **Module import** — adventure PDF → text extraction → chapterization → per
  chapter naming → arc plan → cross-model critique. Chapter progress tracked.
- **Plan Next Session** — drafts what's coming, critiqued, cached.
- **Battle map generator** — printable lettered/numbered tactical maps composed
  from a 183k-tile catalog (15 biome packs), plus an optional AI atmosphere pass
  (local ComfyUI or Gemini).
- **Multi-story maps** — stacked floors joined by cell-aligned stairs.
- **Three battle modes** — Theater, Grid, Hex; the mode gates a lot of rules text.
- **LAN party sync** — players join from their own devices, narration broadcasts
  to the table, players can talk to the DM from their own sheet.
- **Present to TV** — chrome-less second-monitor map view.
- **Camera board read** — photograph the physical table, get which printed square
  each miniature is on, DM confirms, it lands in the battle log.
- **TTS** — Kokoro by default; F5 is an opt-in HD engine with a 108-voice archive.
- **Multi-engine** — Claude / Codex / Gemini / a local LLM, per-workload model
  choice, cross-model critique, failover (§7).

### Shipped in v0.23.6 – v0.23.9

- Campaign archive/delete manager; in-app tile-library import; artwork re-pick
  and DM-driven `revise_battle_map` from the map card; vision picks chunked and
  routed across engines with a persisted `MapArtDiagnostics` sidecar; a coherence
  pass that reviews the chosen art *as a set* and re-picks outliers; a grid-mode
  map-readiness nudge in every turn prompt (the `makeMap` trigger attempt).

### Shipped in v0.23.5

- Cross-model critique now also runs on **Plan Next Session** (it already ran on
  campaign lore, lore updates, and a module's plan at import). Measured: two
  reviewers, two rounds, 10/10 edits applied — and round 2 repaired a
  contradiction round 1's own patch introduced, which is why there are two.
- **`[combat]` means "a fight CAN happen"**, including optional and
  failure-state ones. Maps are generated for `[combat]` encounters and no others.
- **Three maps per plan** (`MAX_PLAN_MAPS`), in plan order, everything dropped
  named in `skipped_maps` and shown in the UI.
- **Biome classification hardened** — see §10, the worst silent defect found.

### Open, highest value first

1. **`makeMap` doesn't trigger.** Fully wired (parses, strips, rejects malformed
   input, grid-gated in code, never blocks the turn) but across four live Codex
   turns the DM never asked — including a party explicitly declaring an attack on
   an unmapped place. **`ask_dm_engine` rejects Claude**, so the engine most
   sessions use was never tested. Try a real Claude session first. If it stays
   silent, the fix is probably surfacing the action in the always-loaded action
   list — which needs an upgrade path for existing campaigns (§5), not a one-liner.
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
5. **Tree canopy hides map entrances.** FA ships `Tree_*_3x3.webp`; `split_footprint`
   reads that size from the vendor's own filename and the renderer draws it
   centred on its 1x1 cell, overhanging on purpose (canopy, not shrubs). But a
   `T` anchored beside a border opening throws canopy across it, so a map with a
   4-cell southern mouth reads as sealed. **Only a human is misled** — the bot
   reads the ASCII, so its tactics stay correct. Do NOT "fix" this with a shrink
   constant: `split_footprint` falls back to `1x1`, so packs that don't use
   `_NxM` filenames have no overhang to shrink, and you would be tuning an
   FA-only number while crushing FA's trees into shrubs. Anything keyed on the
   *grid* (which border cells are open) travels to every pack.
6. **Never verified:** `getUserMedia` actually returning a frame (no camera on
   this box, so `captureTableFrame` has never run for real); the
   `TILE PICK AGREED` log arm.
7. **Housekeeping:** the scratch campaigns now have an archive/delete manager
   (`set_campaigns_archived`, `delete_campaigns`), so this is a chore, not a
   missing feature. `zz-gloam` is the useful one (Gloamwood Whispers imported,
   grid mode). `test-campaign/the-black-fen` is a hand-made dark-floor fixture —
   the only repro of a marsh floor with black water; keep it.
   The maplog interleaves on concurrent writes (cosmetic).

### Intend to ship (discussed, scoped, not started)

| Idea | Notes |
|---|---|
| **Mid-session map generation that's actually usable** | The pieces exist — `generate_battle_map` takes a free-text hint and `makeMap` lets the DM ask — but a map is ~9 minutes and the ad-hoc control lives inside the Plan dialog. Plan: surface it during play, keep generation async, and cut candidates for the on-demand path (measure before believing that one). |
| **Per-NPC custom voices** | F5-TTS is shipped; cloning a specific voice per NPC is the remaining "whisper" feature. |
| **Android port** | Long-discussed, unscoped. |
| **Party-wide initiative tracking** | Shelved. |
| **Cross-check on the vision board read** | The diff exists (`boardCrossCheck.ts`); extending the same idea to the tile *vision* picks is open. |
| **Manual map tile editing** | Nudge a misplaced tile by hand instead of re-rolling a ~9-minute map. Scoped below. |
| **Curse of Strahd import** | The real stress test of chapterization: 230 pages, non-linear, Tarokka branching. |

#### Manual map tile editing — scoped 2026-07-28, not started

The escape hatch for a generator that costs ~9 minutes and is non-deterministic:
today the only remedy for one badly-placed tile is a full re-roll that may come
back worse. Nine minutes and a gamble versus five seconds is the asymmetry that
justifies this — not any single bad map.

**The one rule: edit the grid glyph, never the sprite placement.** A drag that
only re-anchored artwork would leave the DM still believing there is a tree at
the old cell — deliberately building the render/truth desync that most of §10
exists to prevent. Editing the glyph keeps the picture and the bot's tactical
model in lockstep for free, because both read the same grid, and a human nudge
then corrects the DM's understanding too.

Easy half and hard half, from `parse_placements`:

- **Field glyphs (`T` foliage, `^` rubble) are self-describing** — their position
  lives *only* in the grid character, and the Features line supplies nothing but
  flavour ("willow" vs "pine"). Moving one is a one-character edit. They also
  resolve with variety and **no vision call**, so re-anchoring them is near-instant.
- **Named objects (`=`, `o`, crates) also carry cells in their Features caption**,
  so moving one means rewriting `"Sunken bog-oak idol at K9-L10"` as well. Second
  phase; don't start here.

Smallest version: a **grid editor, not a sprite editor** — click or rubber-band
cells, set them to `T` or `.`, write the grid back. No adding, rotating or
deleting objects. Plus one small backend piece: a field-glyph-only re-anchor, so
an edit doesn't need the full `reresolve_map_tiles` (~2 min, re-picks
*everything*) before the render catches up. That gap is the difference between a
tool that gets used and one that gets avoided.

Zero-code way to validate demand first: hand-edit a `T` in a `<slug>.md` grid,
save, and hit Change artwork in the console. If nudging by hand feels worth it,
the editor is that with a mouse.

Deliberately **not** doing: an API-key path for any model. Everything runs on
subscriptions the user already pays for, via each vendor's own CLI. That
constraint is the reason the multi-engine layer looks the way it does.

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

## 10. Hard lessons

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
- **A number fitted to an eyeball judgement should be delegated back to eyes
  when it starts fighting the fiction.** `LIQUID_FLOOR_CONTRAST_MIN` was
  calibrated against maps already judged by eye, then used as a pre-pick cull —
  which made "black water" impossible on any dark floor, because mean RGB cannot
  see the ripples that make dark-on-dark readable. On the worst floor it dropped
  **7 of 8** candidates: not biasing the vision pick, *deleting* it. Measured
  2026-07-28 after handing the judgement to the picker (shown the floor tile):
  a marsh chose water **59** apart and it reads clearly, where the 2026-07-22
  failure was **64** apart and invisible. Five points closer, opposite outcome —
  proof the metric was never measuring the thing that makes water readable. The
  constant survives as an advisory `LIQUID CONTRAST AUDIT` log line, never a gate.
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
- **Run `git diff --stat` after the FIRST edit to a large file, not the third.**
  A 13k-line file is one tool quirk away from a whole-file reformat: an edit to
  `campaign.rs` once reprinted it as 5,363 insertions of rustfmt-style rewrapping,
  two more edits were stacked on the wreckage, and the session ended with zero
  code landed. **This codebase is not rustfmt-clean on purpose** (deliberate long
  single-line log/json calls), so any wholesale format is both a lost session and
  a diff nobody can review. Surgical edits here run tens of lines, not thousands.
- **Scripted edits anchor on content, not line numbers** — and re-read the file
  immediately before splicing. Line numbers recorded earlier in a session are a
  liability; the recovery attempt above failed a second time on exactly that.
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
