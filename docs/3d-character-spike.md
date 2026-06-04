# 3D Character Viewport — Phase 0 Spike Findings

Goal: prove React Three Fiber can render an animated character inside the Tauri
webview at acceptable performance and bundle cost, behind a feature flag, with the
system structured so later phases (HP-reactive animation, armor, creator) drop in.

## What shipped in the spike

- Deps: `three@0.184`, `@react-three/fiber@9.6`, `@react-three/drei@10.7`
  (R3F v9 is required for React 19).
- `src/pages/sheet/CharacterViewport.tsx` — R3F `<Canvas>` with lights, contact
  shadow, `OrbitControls`.
  - **Step A (active):** procedural primitive figure with a code-driven idle bob.
  - **Step B (scaffold):** `GltfCharacter` loads a GLB via `useGLTF` and plays an
    idle clip via `useAnimations`. Activated by setting `CHARACTER_MODEL_URL` in
    `SheetPage.tsx` once a model is dropped in `public/models/`.
- `src/store/useSettingsStore.ts` — persisted `show3DCharacter` flag, default OFF.
- `Character3DCard` in `SheetPage.tsx` (top of the Combat tab) — toggle + viewport.
  Lazy-imported so the heavy chunk only loads when enabled.

## Bundle cost (measured, `npm run build`)

| Chunk | raw | gzip |
|-------|-----|------|
| `CharacterViewport-*.js` (three + R3F + drei) | 972 KB | **260 KB** |
| main `index-*.js` (unchanged) | 2,670 KB | 747 KB |

The 3D code is a **separate lazy chunk** — users who never enable the flag download
**zero** extra bytes. Enabling 3D costs ~260 KB gzip of JS (one-time, cached),
plus the GLB asset in Step B (typically ~0.5–3 MB for a low-poly CC0 model).

Verdict: **acceptable for an opt-in feature.** Proceed to Phase 1 when ready.

## How to test

1. `npm run tauri dev`, open a character → Combat tab → "Character 3D · beta" card
   → **Show**. The placeholder figure renders and idles; OrbitControls (drag to
   rotate, scroll to zoom) work; no console errors.
2. **Step B:** download a CC0 model (recommended: KayKit "Adventurers",
   kaylousberg.itch.io — ships with rigged idle/hit/death clips, no Mixamo retarget
   needed), save as `public/models/adventurer.glb`, set `CHARACTER_MODEL_URL =
   '/models/adventurer.glb'` in `SheetPage.tsx`. The real model loads and plays its
   idle clip.

## Notes / gotchas

- **Validate with `npm run build`, not `npx tsc --noEmit`.** The latter missed three
  string-literal syntax errors in `src/data/classes/*` that the real build caught.
- Bundled same-origin GLBs need no Tauri CSP changes.
- CC0 low-poly packs have no facial morphs → "grimace" will be a body flinch
  (Phase 1). A true facial expression is a Phase 4 stretch (Ready Player Me /
  morph-target model).

## Next (not in spike)

Phase 1 HP-reactive state machine → Phase 2 armor (weight-class body + shield) →
Phase 3 3D creator. See the approved plan for detail.
