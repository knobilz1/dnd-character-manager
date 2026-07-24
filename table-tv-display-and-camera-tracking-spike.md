# Spike: TV/table map display + camera mini-tracking

Two related features that turn Tavern Sheet's digital battle map into a physical
tabletop surface:

1. **Table display** — pop the map out onto a second display (a TV lying flat), scaled to
   true physical size, so physical minis sit directly on top of the digital grid.
2. **Camera tracking (OPTION)** — a camera over the table reads where the physical minis
   actually are and tells the DM, so players don't have to announce positions.

They stack: (2) needs (1) first (the camera watches the TV the map is on), and (1) makes (2)
dramatically easier because **the app knows exactly what it's drawing on the TV**.

Status: design only. Nothing built. This doc is the plan to review, not committed work.

---

## The physical setup we're designing for

- DM machine (Windows desktop, RTX 3090) drives a TV over **HDMI**. TV lies flat on/at the
  table like a battle mat, or is table-mounted. Players stand/sit around it.
- Physical minis placed directly on the TV glass.
- (Feature 2 only) a camera on a boom/arm looking **straight down** at the TV.

This matches how Nabil already plays: **minis are physical, the app never places them** (the
standing rule). Both features respect that — the app renders *terrain*, the minis stay real.
Feature 2 only *reads* mini positions; it never draws tokens on the TV (that would double the
physical minis and break the rule).

---

## Feature 1 — Table/TV display

### Goal
A second, chrome-less full-screen window on the TV showing only the battle map (the
revealed/fog-of-war projection — same thing players are allowed to see), rendered so **1 grid
square = a real, physical inch** (D&D 5 ft = 1"), and controlled live from the DM Console on
the main screen.

### Architecture — two candidate routes

| | A. Second native window (HDMI) | B. Existing LAN player-view on the TV |
|---|---|---|
| What the TV is | A monitor on the DM's PC | A separate device with a browser (smart TV / HDMI stick / tablet) |
| How it's driven | New Tauri `WebviewWindow` at a `/table` route, moved to the 2nd monitor, fullscreened | The Phase 5 LAN player broadcast, opened full-screen in the TV's browser |
| Reuses | Nothing new (greenfield — no multi-window today) | **All** of the reveal/fog + LAN sync work |
| Latency | None (same process, shared state) | One LAN hop (fine at map cadence) |
| Physical-scale calibration | Lives in the `/table` route | Must be added to the web player view |
| Best when | TV is wired to the DM PC (the common case) | TV is wireless / a separate box |

**Recommendation: build A first** (it's the setup Nabil has — desktop → HDMI → TV), and treat
the TV view as *the same revealed-map projection Phase 5 already computes*. Then B falls out
almost for free later: the LAN player view is the same component pointed at a network source
instead of local state. So — **one "TableView" component, two data sources.**

Concretely for A:
- New route `/table` (react-router already has `/dm`, `/character/:id`, etc. — trivial add).
- `TableView` renders the current map via the existing `battleMapRender.ts` canvas path,
  full-bleed, no sidebar/initiative/chrome — just terrain + grid.
- Rust: a `open_table_window` command using `WebviewWindowBuilder` → enumerate
  `available_monitors()`, pick the non-primary one, `set_position` + `set_fullscreen(true)`,
  `decorations(false)`, hide cursor, keep-awake. (None of this exists yet; it's all standard
  Tauri v2.) A "Present to TV" button in the DM Console triggers it and lets the DM pick which
  monitor if there are several.

### The crux: physical-scale calibration
A mini base is ~1" (25mm). For minis to land on the right squares, each grid cell must render
at the TV's true pixels-per-inch. Every TV differs, so calibrate **once per display**:

- Show a calibration card on the TV: a horizontal bar labelled "make this exactly 6 inches"
  (or a single 1" square). DM holds a real ruler to the screen and drags a slider until the
  on-screen inch matches the real inch → we now know **px-per-inch** for that TV.
- Store it (per monitor id / per TV). Render the grid at `cellPx = pxPerInch` so 1 square = 1".
- Alternative one-shot: DM types the TV's diagonal (e.g. 43") and resolution → compute PPI
  directly. Offer both; the ruler-drag is the fool-proof fallback.

Scale/zoom tension to decide:
- **True-scale mode** (1" = 1 square): correct for minis, but a big map won't fit — needs
  panning, and panning slides the map under stationary minis (bad). So true-scale implies
  "the map is at most TV-sized, or we pan between beats when minis aren't mid-move."
- **Fit mode**: whole map scaled to the TV, squares smaller than 1". Minis still work if
  everyone treats the on-screen square as the unit — you lose "a mini base = a square" but
  gain whole-map visibility.
- Ship **both, default to true-scale**, DM toggles. This is a real gameplay call — flag for
  Nabil rather than guess.

### Control channel
The `/table` window is a dumb display; the DM Console is the brain. Same process, so push
state window→window with Tauri events (`app.emit`) or a shared store the table window
subscribes to: current map, active floor, reveal/fog state, true-scale-vs-fit, grid on/off.
For multi-story: the TV shows the floor the party is physically on; DM switches it (ties
straight into the multi-story reveal toggles already built in Phases 2–4).

### Fog / reveal
The TV is a **player-facing surface** — it must show only revealed areas, exactly the Phase 5
projection. This is the unification worth locking in now: **table view and LAN player view are
two renderers of one "what players may see" state.** Build that projection once.

### MVP staging
- **1.1** Second fullscreen window on a chosen monitor showing the current map (no calibration
  yet — just fit-to-screen). Proves multi-window + live control.
- **1.2** Physical-scale calibration (ruler-drag → px/inch) + true-scale render.
- **1.3** Fog/reveal projection on the table view; floor switching for multi-story.
- **1.4** (later) Route B: same TableView fed by the LAN broadcast for wireless TVs.

### Open questions / risks
- Panning vs. minis in true-scale for maps bigger than the TV (the mode question above).
- Keeping the display awake / no screensaver / no notifications popping over it (kiosk hardening).
- Grid alignment after OS display scaling (Windows 150% scaling will lie about pixels — must
  calibrate in *physical* px, not CSS px; verify with the ruler, don't trust reported DPI).

---

## Feature 2 — Camera mini-tracking (the OPTION)

### Goal
A downward camera over the TV reports, a few times a second: **which grid cell each mini is
on** (and ideally *which* creature it is), so the DM/app knows positions without players
saying them. Feeds the DM Console (a DM-only "where the camera thinks minis are" overlay) and
the **voice DM's spatial awareness** ("the goblin's at F7") — it does **not** render tokens on
the TV.

### Why this is harder than it looks (the one insight that drives everything)
The minis sit on a **bright, colorful, constantly-changing display**. That destroys naive
computer vision — colour/blob/contrast detection assumes a static, dull background, and here
the background is an emissive animated map. Two things survive that environment:

1. **Fiducial markers** — high-contrast black/white coded patterns (ArUco / AprilTag). Read
   robustly regardless of what's glowing underneath, at low resolution, in real time, with a
   well-worn library (OpenCV `aruco`). Each marker carries a unique **ID** → you get *position
   AND identity* for free.
2. **Known-frame subtraction** — because *we render the TV*, we know the exact image under the
   minis. Warp that known frame into the camera's view (via calibration) and subtract it; the
   residual = things that aren't the map = the minis. This trick is almost free here and is
   basically unavailable to anyone who doesn't control the display. Gives *position* but not
   *identity*.

### Approach menu

| Approach | Position | Identity | Beats the glowing bg? | Hardware | Verdict |
|---|---|---|---|---|---|
| **Fiducial tags on bases** | ✅ exact | ✅ (tag ID) | ✅ yes | any webcam | **Primary.** Solves both, cheap, real-time |
| Known-frame subtraction | ✅ blobs | ❌ (anonymous) | ✅ yes | any webcam | **Marker-less fallback**, pair with tap-to-assign + tracking |
| Plain colour/blob | ⚠️ weak | ⚠️ ~8 colours | ❌ fragile | any webcam | Skip — dies on the dynamic background |
| Depth camera (RealSense/Kinect) | ✅ (height blobs) | ❌ | ✅ (ignores colour) | +depth cam | Nice marker-less position source; more kit |
| ML object detector (YOLO) | ✅ | needs training | ⚠️ | GPU (has it) | Overkill/fragile vs. fiducials for v1 |

**Recommendation: fiducial tags as the primary path.** The least-intrusive tagging is a
**numbered ring/base token the mini stands in** (marker faces up at the ceiling camera); a
small topper/flag also works. Offer **known-frame subtraction + tap-to-assign** later as the
"I don't want to tag my minis" mode.

### Identity + tracking
- Tags: identity is intrinsic — pre-register `tag ID → creature` for the encounter (goblin A =
  tag 3). Done.
- Marker-less: detections are anonymous blobs. DM taps each once to name it, then **track
  frame-to-frame by nearest-neighbour** (minis move slowly, no teleporting). On ambiguity (two
  minis adjacent, a hand reaching in, a knocked mini) → mark low-confidence and let the DM
  glance, don't assert.

### Calibration (camera → grid)
Camera pixels must map to map cells. Standard **homography**: display 4 known markers at the
map corners on the TV, camera detects them → solve the 4-point transform → every camera pixel
now maps to a grid coordinate. Re-run if the camera or TV moves. (Feature 1's calibration and
this one are complementary: one fixes *physical inches on the TV*, this fixes *camera pixels →
grid cells*.)

### Architecture — a camera sidecar (fits what already exists)
Tavern Sheet already spawns native/ML helpers as **sidecar processes** (Whisper, Kokoro TTS
in `dm.rs`/`tts.rs` via `Command::new`). A camera tracker is the same shape:

- **`mini-tracker` sidecar** (Python + OpenCV is the fastest to a working ArUco pipeline; a
  Rust `opencv`/`apriltag` binary if we want one language). Owns the webcam, runs detection +
  homography, emits JSON events: `{ id/blob, cell:[col,row], conf }` at ~2–5 Hz (minis are
  slow — no need for 30fps) over stdio or a local socket.
- **Rust** ingests those events, folds them into campaign/encounter state, forwards to the DM
  Console (overlay) and the voice-DM world state.
- **Camera access** stays in the sidecar (OpenCV `VideoCapture`) — cleaner than webview
  `getUserMedia` and keeps CV off the UI thread.

### How positions are used (respecting the standing rule)
- **DM Console**: a DM-only "ghost" overlay showing where the camera thinks each mini is —
  awareness, not authority. Players' physical minis remain ground truth.
- **Voice DM**: feed positions into its world state so it can reason tactically ("the ogre is
  flanking from G4") and so the combat/monster-placement guidance can reference *real*
  positions. This is the big payoff — the voice DM stops being spatially blind.
- **Never** auto-draw tokens on the TV. The physical minis are the tokens.

### MVP staging
- **2.A** Calibration + ArUco detection of a couple of tagged minis → positions in a DM-only
  debug overlay. Proves the whole pipeline against the real glowing-TV background.
- **2.B** Bind `tag ID → creature` for an encounter; feed positions to the DM Console overlay
  and the voice-DM world state.
- **2.C** (optional) Marker-less mode: known-frame subtraction + tap-to-assign + NN tracking,
  and/or a depth-camera position source.

### Hardware Nabil would need
- A flat/table-mountable TV (already implied by Feature 1).
- An **overhead camera** on a boom/arm/ceiling mount, roughly centred over the TV, pointing
  down. A plain 1080p webcam is plenty for ArUco. (Depth cam only if we do 2.C's depth path.)
- Tag stock: printed ArUco ring-tokens / base inserts for the minis.

### Open questions / risks
- **Camera mount** is a real-world ergonomics problem (a boom over the table that isn't in
  everyone's way). Biggest practical hurdle, not a software one.
- Occlusion: hands, dice, terrain pieces → transient false detections. Temporal smoothing +
  confidence gating handle most; fiducials are robust to partial glare.
- Room lighting vs. TV glare on the tags — matte tags + decent overhead light. Verify early.
- Tagging minis is intrusive to some players — hence the marker-less fallback exists.

---

## How the two interlock
- Feature 1 is the substrate; Feature 2 watches it.
- Feature 1's "we know the exact TV frame" *is* Feature 2's known-frame-subtraction fallback.
- Feature 2's positions flow back to the **DM's** awareness + the voice DM — not to the TV.
- Both consume the same **revealed-map projection** that Phase 5 is building. Worth designing
  that projection as the shared spine now.

## Smallest first slice to prove the whole thing is real
**Feature 1, step 1.1**: a second full-screen `WebviewWindow` on the TV mirroring the current
map, live-controlled from the DM Console. No calibration, no camera. If that feels good on the
actual TV, calibration (1.2) and then the camera spike (2.A) are each a self-contained next
step. Everything above is optional and additive — nothing here blocks the multi-story work in
flight.
