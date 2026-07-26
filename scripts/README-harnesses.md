# CDP harnesses

Small Node scripts that drive the **running app** over the Chrome DevTools
Protocol, for verifying things that only fail at runtime. They exist because
most of the defects in this project are invisible to unit tests: a prompt the
model ignores, a map that renders wrong, a CLI flag that is accepted and not
obeyed.

All of them need the app running with the debugger open:

```bash
WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 npm run tauri dev
```

Node 26+ (built-in `WebSocket`, no `ws` dependency). They connect to
`127.0.0.1:9222`, find the app page, and call backend commands via
`window.__TAURI_INTERNALS__.invoke`.

| Script | What it does |
|---|---|
| `render-map.mjs <campaign> <slug> <out.png> [cellPx]` | Renders a battle map with the app's own renderer and writes a PNG + the spec. **Use this before judging any map** — a tile list will not show you brick ground in a marsh. |
| `engine-turn.mjs <engine> [campaign]` | Two live DM turns on a non-Claude engine. Checks the reply is narration and not banner text, that turn 2 remembers a fact planted in turn 1 (proves the session id round-trips), and that the ```dm-actions block parses. |
| `gen-map.mjs <campaign> "<hint>"` | Generates one battle map with the tile-pick cross-check armed. |
| `board-crosscheck.mjs <campaign> <slug> [out.jpg]` | Renders a real map, drops 8 tokens on known squares, warps it into a trapezoid so it reads like a hand-held photo, has two engines read it, and runs the real `disputedCells` on their answers. |
| `plan-critique.mjs <campaign>` | Runs "Plan Next Session" with the cross-model critique armed, forcing theater mode so it measures the plan and not 9 minutes of map generation per encounter. |
| `makemap-live.mjs <engine> <campaign>` | Asks whether the DM actually emits the `makeMap` action when a fight is taking shape at an unmapped place. Currently answers "no" — see AGENTS.md §5. |
| `setmode.mjs <campaign> <grid\|theater\|hex>` | Sets battle mode and **reports what actually happened**. Changing mode regenerates `memory/dm_rules.md`, which is how grid-only rules reach the DM. |
| `shot.mjs <out.png>` | Screenshots the app's webview. |
| `board-read.mjs <photo> <cols> <rows> [model]` | The original single board-read instrument: hand it one real photo and print what the model saw. |

## Things these scripts already know, that cost time to learn

- **Write these files with an editor, never a bash heredoc.** `\n`, `\d`,
  backticks and `${}` all get mangled on the way through, and the result is a
  test that fails for reasons that have nothing to do with the app.
- **The page has no `process`.** Referencing it inside `Runtime.evaluate` throws
  silently, so the invoke never runs — and a script that prints success
  unconditionally will report a pass. Build every value in Node, inject it as a
  JSON literal, and check the returned `ok` flag.
- **Use forward slashes for Windows paths.** Backslashes get mangled through
  bash → JS → JSON.
- **`get_map_tiles` has no `.terrain` key.** Assemble terrain from the top-level
  `floor` / `liquid` / `natural_walls`, exactly as `fetchMapTiles` does in
  DMConsolePage. Reading `.terrain` silently renders built-in sprites, which
  looks like a texture bug and is not one.
- **Waiting for "the page is up" is not waiting for "the rebuild landed".** If
  the old app never went down, a CDP poll passes instantly and you test stale
  code. Check that the thing you changed is actually present — e.g. grep the
  campaign's regenerated `memory/dm_rules.md` — before trusting a negative
  result.
- **Don't instruct the model into the shape you're testing for.** A prompt ending
  "narrate this in three sentences" measures your instruction, not the campaign's
  rules. Send a bare player turn the way the console does.
- **Don't build a scenario on invented content.** `dm_rules.md` tells the DM to
  reject player overreach outright, and it does — a test scenario that invents a
  location measures that rule instead of the feature.
