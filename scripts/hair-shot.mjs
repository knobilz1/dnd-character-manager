// hair-shot.mjs — headless WebGL capture of the 3D character viewport.
//
// WHY: Chrome *background* tabs throttle requestAnimationFrame, so the R3F
// render loop never runs and canvas screenshots come back blank. A headless
// Playwright page is always visibilityState:'visible', so rAF fires. We use
// SwiftShader (software WebGL) so it works without a GPU.
//
// HOW: navigates to the creator, then uses the DEV-only window.__creator hook
// (see useCreatorStore.ts) to jump straight to the Appearance step with a
// chosen race / gender / hairId — the StepAppearance component renders the same
// CharacterViewport used on the sheet. Captures a front and a rear view.
//
// USAGE:
//   node scripts/hair-shot.mjs <raceId> <gender> [hairId] [hairColor]
//   node scripts/hair-shot.mjs elf female long_straight "#3b2a1a"
// Output PNGs land in scripts/_shots/.

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '_shots');
mkdirSync(OUT, { recursive: true });

const raceId = process.argv[2] || 'elf';
const gender = process.argv[3] || 'female';
const hairId = process.argv[4] || 'long_straight';
const hairColor = process.argv[5] || '#3b2a1a';
const suffix = process.env.SUFFIX ? `_${process.env.SUFFIX}` : '';
const tag = `${raceId}_${gender}_${hairId}${suffix}`;

// Optional fit override (JSON in env FIT) injected into the per-body localStorage
// key the viewport reads at mount (hairFit:<styleId>:<modelRace>:<gender>), so we
// can iterate a candidate defaultFitByRaceGender value visually.
const MODEL_RACE = { 'half-orc': 'halforc' };
const modelRace = MODEL_RACE[raceId] ?? raceId;
const fitOverride = process.env.FIT ? JSON.parse(process.env.FIT) : null;

const browser = await chromium.launch({
  headless: true,
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
  ],
});

const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
page.on('pageerror', (e) => console.log('  [pageerror]', e.message.slice(0, 160)));

// Seed the per-body fit override before any app code runs.
if (fitOverride) {
  const key = `hairFit:${hairId}:${modelRace}:${gender}`;
  await page.addInitScript(({ key, fit }) => {
    try { localStorage.setItem(key, JSON.stringify(fit)); } catch {}
  }, { key, fit: fitOverride });
  console.log('injected', key, '=', JSON.stringify(fitOverride));
}

await page.goto('http://localhost:5173/create', { waitUntil: 'domcontentloaded' });

// Wait for the DEV hook, then jump to the Appearance step with our selections.
await page.waitForFunction(() => !!(window).__creator, null, { timeout: 15000 });
await page.evaluate(({ raceId, gender, hairId, hairColor }) => {
  const store = (window).__creator;
  const s = store.getState();
  store.setState({
    step: 'appearance',
    draft: { ...s.draft, raceId, appearance: { gender, hairId, hairColor } },
  });
}, { raceId, gender, hairId, hairColor });

// Wait for the lazy CharacterViewport chunk + canvas, then for the GLBs to load.
await page.waitForSelector('canvas', { timeout: 20000 });
await page.waitForTimeout(7000);

const canvas = page.locator('canvas').first();
const box = await canvas.boundingBox();
if (!box) { console.log('no canvas box'); await browser.close(); process.exit(1); }
console.log('canvas', `${Math.round(box.width)}x${Math.round(box.height)}`);

await canvas.screenshot({ path: join(OUT, `${tag}_1front.png`) });

// Orbit. drei OrbitControls azimuth = 2π·Δx / clientHeight. clientHeight ≈ box.height.
// Δx = box.height/2 → π (180°, rear). Do it in two ~90° hops for stability.
const cx = box.x + box.width / 2;
const cy = box.y + box.height / 2;
async function orbitTo(fraction, name) {
  const dx = box.height * fraction; // fraction of full-turn-per-clientHeight
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  const steps = 24;
  for (let i = 1; i <= steps; i++) await page.mouse.move(cx + (dx * i) / steps, cy);
  await page.mouse.up();
  await page.waitForTimeout(600);
  await canvas.screenshot({ path: join(OUT, `${tag}_${name}.png`) });
}
// From front (+Z): drag right by height/2 → 180° to rear (-Z, back of head).
await orbitTo(0.5, '2rear');
// A little further for a 3/4 rear angle to read the crown/parting clearly.
await orbitTo(0.12, '3rearquarter');

// Close-up of the crown: snap to the HEAD camera preset, then orbit to the rear.
// This is where a missing/floating parting-groove fill would be obvious.
await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll('button')).find(
    (b) => b.textContent?.trim().toLowerCase() === 'head',
  );
  btn?.click();
});
await page.waitForTimeout(700);
await orbitTo(0.5, '4headrear');

console.log('saved', tag);
await browser.close();
