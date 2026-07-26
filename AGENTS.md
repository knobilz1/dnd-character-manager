# Tavern Sheet — working notes for coding agents

Tauri v2 desktop app: a D&D character manager that grew a voice DM console, a
battle-map generator, and a multi-engine LLM layer. Windows is the primary dev
box; releases build for Windows + macOS. Published as `knobilz1`.

**This file is auto-loaded by Codex.** Claude Code reads `CLAUDE.md`; `agy`
(Gemini/Antigravity) reads neither — see "Which CLI reads what" below, it is
measured, not assumed.

Current release: **v0.23.5** (2026-07-25), `main` clean at `chore: v0.23.5`.
470 Rust tests. The auto-updater endpoint serves it across 6 signed platforms.

---

## 1. Rules that will burn you

These are all things that have actually gone wrong here, not hypotheticals.

| Rule | Why |
|---|---|
| **Version lives ONLY in `src-tauri/tauri.conf.json`** | `package.json` says `0.0.0` and `Cargo.toml` says `0.1.0`. They are decoys. Releases are triggered by pushing a `vX.Y.Z` tag. |
| **`npx tsc --noEmit` checks NOTHING** | The root tsconfig is `files: []` + project references. Use **`npx tsc -b --force`**. |
| **Never pixel-click the app window** | Clicks land wrong and minimise/close it. Drive it over CDP instead (§4). |
| **Don't run `cargo test` against the same target dir as a running `tauri dev`** | They fight over the lock. Use a separate `CARGO_TARGET_DIR`. |
| **Don't edit `.rs` or `tauri.conf.json` while a generation harness is running** | `tauri dev` watches them, restarts the app, CDP dies, the harness exits mid-run. |
| **The `Objects:`/`Features:` map layers must NEVER contain NPCs, characters or monsters** | Nabil uses physical miniatures. Naming cells in the text `Deployment:` section is correct and expected; drawing a creature onto the map is not. |
| **Render and LOOK at every generated map** | Judging a map from its sidecar/tile-list has produced confident wrong conclusions repeatedly. See §4. |
| **Measure before fixing** | Ranking/prompt changes must be diffed against the real 183k-tile catalog or a real run. Guessing has cost whole sessions here. |
| **Never print `.env`** | Real Google OAuth secrets. |

### Release checklist

1. `cargo test --lib` (separate target dir), `npx tsc -b --force`, `npm run build`.
2. **If `src-tauri/src/dm.rs` changed, run the cfg-inversion check** — it is the
   only file with platform arms, and nothing local compiles the macOS side.
   v0.23.2 shipped Windows-only because a `#[cfg(windows)]` got detached from its
   `fn`. On a copy of dm.rs: `#[cfg(not(windows))]` → `#[cfg(all())]`,
   `#[cfg(windows)]` → `#[cfg(any())]`, `#[cfg(target_os = "macos")]` →
   `#[cfg(all())]`, then `cargo check --lib`, then restore. (Repeat with the
   linux arm on.) Anything using `std::os::unix` cannot be checked this way —
   prefer a plain `Command` so it can.
3. Bump `tauri.conf.json`, commit `chore: vX.Y.Z`, push `main`, then push the tag.
4. **Verify the release actually works**, don't trust green CI:
   `curl -sL https://github.com/knobilz1/dnd-character-manager/releases/latest/download/latest.json`
   must return HTTP 200 with the new version and all platforms signed. v0.23.2
   published without `latest.json` and 404'd every user's updater.

---

## 2. Architecture, briefly

```
src-tauri/src/
  campaign.rs    13k lines — campaigns, memory files, modules/chapters, session
                 plans, battle-map generation + tile resolution. The big one.
  tile_library.rs 4.9k — the 183k-tile catalog: indexing, shortlisting, ranking
  dm.rs          3.0k — live DM turns, CLI process spawning, sign-in, vision.
                 THE ONLY FILE WITH PLATFORM ARMS.
  tts.rs         2.2k — Kokoro + F5 voices
  local_llm.rs   1.8k — ingestion routing, cross-model critique, local-LLM path
  cli_provider.rs 806 — PURE per-engine argv building (well tested, start here
                 to understand the multi-engine layer)
src/pages/dm/DMConsolePage.tsx  — the DM console (~5k lines, most frontend work)
src/utils/dmActions.ts          — parses the DM's ```dm-actions block
src/utils/battleMapRender.ts    — deterministic map spec → PNG/PDF
src/utils/boardCrossCheck.ts    — two-engine board-read diffing (pure, testable)
```

**Campaign data lives outside the repo** at
`%APPDATA%\com.nabil.dndsheet\campaigns\<id>\` — `CLAUDE.md` (persona + world),
`memory/` (MEMORY.md, entities, locations, dm_rules.md, battle_maps/), and
`active_module/`. The DM CLI runs with that folder as its working directory.

### The multi-engine layer (most recent work)

Every engine is the vendor's own CLI driven as a subprocess, so Nabil pays a flat
subscription and never a per-token API key.

| Engine | CLI | Lockdown | Prompt delivery |
|---|---|---|---|
| Claude | `claude` | `--tools ""` | stdin |
| Codex | `codex` | `--sandbox read-only --ignore-user-config` | stdin |
| Gemini | `agy` (Antigravity) | `--mode plan --sandbox` | **argv only** |

- A flag being *accepted* is not a flag being *obeyed*. Only a real write attempt
  + md5 comparison proves a sandbox. Gemini's sandbox **redirects** writes to a
  scratch dir and reports success, so it never errors.
- `cli_provider.rs` is pure and tested; `dm.rs::run_engine_oneshot` /
  `run_engine_turn` do the spawning.

---

## 3. Which CLI reads what (measured 2026-07-25)

A scratch dir was created holding `CLAUDE.md`, `AGENTS.md` and `GEMINI.md`, each
with a different pass-phrase, and each CLI was asked for "the pass-phrase":

| CLI | reads |
|---|---|
| `claude` | CLAUDE.md |
| `codex` | **AGENTS.md only** |
| `agy --print` | **none of the three** |

Tavern Sheet writes only `CLAUDE.md` per campaign, so setting the working
directory — the entire basis of DM recall — reached Claude and nobody else.
Codex and Gemini were running with **no persona, no house rules, no dm-actions
contract, no NPC memory and no module chapter**.

Fixed in v0.23.4: `local_llm::cli_project_context` resolves the campaign's
CLAUDE.md and its `@imports` and prepends it for non-Claude engines, once per
thread and again whenever the content hash changes.

### agy's constraints (all measured)

- The prompt **must** be `--print`'s value. `--print` with no value prints help;
  `--print --` swallows the `--`; stdin is never read (`--prompt` is an alias).
- So it inherits Windows' **32,767-char command-line cap**. A 40,015-char prompt
  does not error — it **fails to spawn** ("Argument list too long"). The campaign
  brief is ~39K, hence the line-aligned chunking in `run_engine_turn`.
- Ingestion's biggest prompts are 60–80K (`MAX_CHAPTER_CHARS`,
  `EXTRACTION_CHUNK_MAX_CHARS`), so module import on Gemini is impossible. It is
  now refused up front with `PROMPT_TOO_LONG_MARKER` and fails over to a
  stdin-capable engine.
- agy's **read tools are auto-denied headless** and it returns
  `"status":"SUCCESS"` with an empty response, so a denied tool looks like a win.
- `agy models` lists the **catalogue, not entitlements** — it prints the full list
  while signed out. That is how a sign-in probe once reported a signed-out account
  as healthy. Only a real call proves anything.

### The campaign-file trap

**`BASE_CLAUDE_MD` is written ONCE when a campaign is created and never
rewritten.** Anything documented there reaches new campaigns and *no existing
one*. `DM_RULES` → `memory/dm_rules.md` is regenerated on every load, and it is
mode-specific (grid/theater/hex), which grid-gates content for free.

**Anything an existing campaign must learn goes in `DM_RULES`.** The `makeMap`
action was nearly shipped into the dead file.

---

## 4. Driving and verifying the app

Start it with the debugger open (this is a native window; browser-preview tools
cannot host it):

```bash
WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 npm run tauri dev
```

Then talk to it over CDP on `127.0.0.1:9222`. Node 26 has a built-in `WebSocket`,
no `ws` dependency needed. Invoke backend commands from the page with
`window.__TAURI_INTERNALS__.invoke('command', { args })`.

Working harnesses live in `scripts/` (see `scripts/README-harnesses.md`).

**Traps that have each cost real time:**

- **Windows paths through CDP: use forward slashes.** Backslashes get mangled
  through bash → JS → JSON and produce failures that look like app bugs.
- **Never build JS with bash heredocs.** `\n`, `\d`, backticks and `${}` get
  mangled; this produced three separate false results in one session. Write the
  file with an editor tool instead.
- **The page has no `process`.** Referencing it inside `Runtime.evaluate` throws
  silently, the invoke never runs, and a script that prints success regardless
  will happily lie to you. Build every value in Node and inject it as a literal.
- **`get_map_tiles` returns `floor` / `liquid` / `natural_walls` at the TOP
  LEVEL.** There is no `.terrain` key. Reading one silently falls back to
  built-in sprites — brick ground and cartoon-blue water — which looks exactly
  like a texture-resolution bug and is not one.
- **Dev and prod are different localStorage origins.** "No characters yet" in dev
  is not data loss.

### Rendering a map (do this before judging one)

`scripts/render-map.mjs <campaignId> <slug> <out.png> [cellPx]` — uses the app's
own renderer, so what you see is what the DM sees. Map debug log:
`%TEMP%\tavern_map_debug.log` (truncated at the start of each generation run).

---

## 5. Where things stand

### Just shipped (v0.23.5)

- Cross-model critique now also runs on **Plan Next Session** (previously: campaign
  lore, lore update, module-plan-at-import). Measured on a real module: two
  reviewers, two rounds, 10/10 edits applied, 2,696 → 5,137 chars. Round 2
  repaired a contradiction round 1's own patch introduced — that is why there are
  two rounds.
- **`[combat]` now means "a fight CAN happen"**, including optional and
  failure-state fights. A battle map is generated for `[combat]` encounters and
  no others, so the old reading left real fights unmapped.
- **Three maps per plan** (`MAX_PLAN_MAPS`), in plan order, with everything
  dropped named in `skipped_maps` and shown in the UI. Note this is *not* a
  wall-time cap: encounter maps generate concurrently, so five take about as long
  as one. It bounds concurrent jobs and quota.
- **Biome classification hardened.** This was the worst silent defect found: one
  spec classified six times gave `swamp`×4, `forest`, **`horror`** — and `horror`
  swapped the ground for flesh, the water for blood and the trees for tentacles,
  because every terrain query keys off that single word. Nothing downstream can
  detect it (within the horror pack that art is correct). Now 3 concurrent votes,
  +3 more on a no-majority tie, on **opus at medium effort** instead of sonnet at
  low. Nine runs, zero splits, `horror` gone.

### Open — highest value first

1. **`makeMap` doesn't trigger.** The dm-action is fully wired (parses, strips,
   rejects malformed input, grid-gated in code, generation never blocks the turn)
   but across four live Codex turns the DM never asked, including a party
   explicitly declaring an attack on an unmapped location. **`ask_dm_engine`
   rejects Claude**, so the engine most sessions use was never tested. Try a real
   Claude session first. If it stays silent, the likely fix is surfacing the
   action in the always-loaded action list — which needs an upgrade path for
   existing campaigns, not a one-line edit (§3).
2. **Curse of Strahd import.** Never run. Extraction is the cost (~10× the
   Gloamwood module); the critique pipeline is validated and roughly constant.
   Gemini can now do it at all only because of the argv fix.
3. **Map quality defects** (pre-existing, all seen in real output): `o` pillars
   render as ~10px rings despite being toppling set pieces; a war camp came out
   ~85% empty; a stalag pool renders near-black; cavern ground picks
   `Webbed_A_01`; hide tents render as brick. Root cause for several is that
   coverage outranks biome affinity, so a generic adjective imports off-biome art
   — and the same shape is sometimes *correct* (a bone pile), so no rule over
   (coverage, affinity) alone separates them. Needs an idea, not a tweak.
4. **The liquid-contrast rule fights the fiction.** It rejects water too close to
   the floor colour for legibility, which guarantees a marsh map cannot have the
   "black water" its own spec describes. Both goals are legitimate; nothing says
   they conflict.
5. **`reresolve_map_tiles` has no UI.** It re-runs only tile resolution (~72s vs a
   ~542s full regenerate) and is very useful for iterating on tile art.
6. **Never verified:** `getUserMedia` actually returning a frame (no camera on the
   dev box, so `captureTableFrame` has never run for real); the
   `TILE PICK AGREED` log arm (the floor pair disagrees deterministically).
7. **Housekeeping:** 82 campaigns exist, most are `x1-*`/`w1-*`/`zz-*` scratch.
   `zz-gloam` is the useful one — Gloamwood Whispers imported, grid mode, 4 maps.
   The maplog interleaves on concurrent writes (cosmetic).

### Measured numbers worth not re-deriving

| Thing | Number |
|---|---|
| Battle map generation | ~542s total = spec ~467s (87%) + tiles ~73s |
| Plan Next Session (plan text only) | ~245–290s |
| DM turn, Codex | 6.0s turn 1 / 2.2s turn 2 |
| DM turn, Gemini | 26.2s on `gemini-3.1-pro-low`, **141.9s on `-pro-high`**, 14.0s on agy's flash default |
| Board read, angled 8-token photo | claude 4/8 exact, codex 2/8 — and they make the **same** error on 2, so agreement is not evidence of correctness |
| Board read | claude ~95s, codex ~12s |

Gemini model choice is per-workload for that reason: turns take `pro-low`,
ingestion takes `pro-high`. Claude and Codex tiers are deliberately NOT
auto-selected — they are pinned on measurements auto-overriding would invalidate
(`BOARD_READ_MODEL` is opus because sonnet scored 3/6 against opus's 6/6).

---

## 6. House style

- Comments explain **why**, especially when the code encodes a measurement or a
  past bug. Match the density already in the file.
- A test should fail if the logic breaks — sabotage-check it. Several tests here
  once passed against a deliberately broken source because they asserted against
  the same constant they were testing.
- Log both outcomes. Silence that could mean "agreed", "returned nothing" or
  "never ran" has hidden two separate defects in this codebase.
- Don't push, tag, merge to `main`, or bump the version unless asked.
