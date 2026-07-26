// Render a generated map to a PNG on disk, exactly the way the console renders
// it (same module, same call shape as DMConsolePage's export path) — so what I
// look at is what the DM would see. Judging a map from its tile list is the
// mistake this exists to prevent.
//
// Pass --reresolve to exercise the artwork-only regeneration path before
// rendering. This keeps the visual check and its persisted diagnostics together.
// Usage: node render-map.mjs <campaignId> <slug> <out.png> [cellPx] [--reresolve] [--engine=codex]
import { writeFileSync } from 'node:fs';

const [campaignId, slug, outPath, cellPxArg, ...options] = process.argv.slice(2);
if (!campaignId || !slug || !outPath) { console.error('Usage: node render-map.mjs <campaignId> <slug> <out.png> [cellPx] [--reresolve] [--engine=codex]'); process.exit(2); }
const cellPx = Number(cellPxArg || 64);
const reresolve = options.includes('--reresolve');
const engine = options.find((arg) => arg.startsWith('--engine='))?.slice('--engine='.length);

const targets = (await (await fetch('http://127.0.0.1:9222/json/list')).json()).filter((t) => t.type === 'page');
const page = targets.find((t) => /localhost:\d+|tauri:\/\//.test(t.url || '')) || targets[0];
if (!page) { console.error('No dev app on CDP :9222'); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let mid = 0; const pending = new Map();
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++mid; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } });
await new Promise((r) => ws.addEventListener('open', r));
await send('Runtime.enable');

const r = await send('Runtime.evaluate', {
  expression: `(async () => {
    try {
      const inv = window.__TAURI_INTERNALS__.invoke;
      if (${JSON.stringify(engine ?? null)}) {
        await inv('set_ingestion_engine', { engine: ${JSON.stringify(engine ?? '')}, crossCheck: [] });
      }
      if (${JSON.stringify(reresolve)}) {
        await inv('reresolve_map_tiles', { id: ${JSON.stringify(campaignId)}, slug: ${JSON.stringify(slug)} });
      }
      const spec = await inv('read_battle_map', { id: ${JSON.stringify(campaignId)}, slug: ${JSON.stringify(slug)} });
      const art  = await inv('get_map_tiles',   { id: ${JSON.stringify(campaignId)}, slug: ${JSON.stringify(slug)} });
      const m = await import('/src/utils/battleMapRender.ts');
      await m.preloadBattleTileSprites();
      // Terrain is assembled from TOP-LEVEL floor/liquid/natural_walls — there is
      // no .terrain key on the response. Reading one made the map render with
      // built-in sprites: brick ground and cartoon-blue water in a marsh, which
      // looked exactly like a texture-resolution bug and was this line.
      const floor = (art && art.floors && art.floors[0]) || art || {};
      const terrain = { floor: floor.floor, liquid: floor.liquid, naturalWalls: floor.natural_walls };
      await m.preloadResolvedTileArt(floor.tiles ?? [], terrain);
      const url = m.battleMapToPngDataUrl(spec, ${cellPx}, floor.tiles ?? [], terrain, false);
      if (!url) return { ok: false, error: 'renderer returned null — the spec did not parse' };
      const parsed = m.parseBattleMapFloors(spec)[0];
      return { ok: true, url, cols: parsed?.cols, rows: parsed?.rows,
               tiles: (floor.tiles ?? []).length, diagnostics: art?.diagnostics, spec };
    } catch (e) { return { ok: false, error: String(e && e.stack || e) }; }
  })()`,
  returnByValue: true, awaitPromise: true, timeout: 240000,
});
const out = r.result?.value;
if (!out?.ok) { console.error('FAILED:', out?.error ?? JSON.stringify(r).slice(0, 500)); ws.close(); process.exit(1); }

writeFileSync(outPath, Buffer.from(out.url.split(',')[1], 'base64'));
console.log(`wrote ${outPath}  (${out.cols}x${out.rows} grid, ${out.tiles} resolved tile(s), ${Math.round(out.url.length / 1366)} KB)`);
if (out.diagnostics) console.log(`art diagnostics: ${JSON.stringify(out.diagnostics)}`);
writeFileSync(outPath.replace(/\.png$/, '.spec.txt'), out.spec);
console.log(`wrote ${outPath.replace(/\.png$/, '.spec.txt')}`);
ws.close();
process.exit(0);
