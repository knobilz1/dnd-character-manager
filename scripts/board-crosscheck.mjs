// Cross-checked board read (#39), end to end on a real map.
//
// Renders the campaign's actual map, drops 8 tokens on KNOWN squares, warps it
// into a trapezoid so it looks like a hand-held shot from the table's near edge
// (measured before: angled is where reads drift by a column, which is exactly the
// condition the second opinion exists for), then has two engines read it and runs
// the REAL disputedCells on their answers.
//
// Usage: node board-crosscheck.mjs <campaignId> <slug> <out.jpg>
import { writeFileSync } from 'node:fs';

const [campaignId, slug, outPath] = process.argv.slice(2);
if (!campaignId || !slug) { console.error('Usage: node board-crosscheck.mjs <campaignId> <slug> [out.jpg]'); process.exit(2); }

// Chosen off the spec's own Map block: all plain floor, none in water, on the
// altar, under a tree or on a standing stone. Well spread so a one-column drift
// is visible rather than ambiguous.
const TOKENS = [
  { cell: 'P2',  color: '#d92b2b', label: 'red' },
  { cell: 'L4',  color: '#2b5fd9', label: 'blue' },
  { cell: 'C6',  color: '#e0d020', label: 'yellow' },
  { cell: 'R6',  color: '#22a04a', label: 'green' },
  { cell: 'C9',  color: '#f0f0f0', label: 'white' },
  { cell: 'Q9',  color: '#111111', label: 'black' },
  { cell: 'E14', color: '#e07b1f', label: 'orange' },
  { cell: 'R15', color: '#8a2be2', label: 'purple' },
];

const targets = (await (await fetch('http://127.0.0.1:9222/json/list')).json()).filter((t) => t.type === 'page');
const page = targets.find((t) => /localhost:\d+|tauri:\/\//.test(t.url || '')) || targets[0];
if (!page) { console.error('No dev app on CDP :9222'); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let mid = 0; const pending = new Map();
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++mid; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } });
await new Promise((r) => ws.addEventListener('open', r));
await send('Runtime.enable');
const evaluate = async (expr, ms = 900_000) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: ms });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 600));
  return r.result?.value;
};

const CELL = 72;
const built = await evaluate(`(async () => {
  try {
    const inv = window.__TAURI_INTERNALS__.invoke;
    const spec = await inv('read_battle_map', { id: ${JSON.stringify(campaignId)}, slug: ${JSON.stringify(slug)} });
    const art  = await inv('get_map_tiles',   { id: ${JSON.stringify(campaignId)}, slug: ${JSON.stringify(slug)} });
    const m = await import('/src/utils/battleMapRender.ts');
    await m.preloadBattleTileSprites();
    const f = (art && art.floors && art.floors[0]) || art || {};
    const terrain = { floor: f.floor, liquid: f.liquid, naturalWalls: f.natural_walls };
    await m.preloadResolvedTileArt(f.tiles ?? [], terrain);
    const parsed = m.parseBattleMapFloors(spec)[0];
    const base = m.renderBattleMapToCanvas(parsed, ${CELL}, undefined, f.tiles ?? [], terrain, false);

    // The ruler gutter is half a cell on the left and top (composeRulerFrame), so
    // a cell's centre sits at ruler + index*cell + cell/2.
    const ruler = Math.round(${CELL} * 0.5);
    const ctx = base.getContext('2d');
    for (const t of ${JSON.stringify(TOKENS)}) {
      const [q, r] = m.parseCellRefToken(t.cell);
      const cx = ruler + q * ${CELL} + ${CELL} / 2;
      const cy = ruler + r * ${CELL} + ${CELL} / 2;
      // A flat disc with a dark rim — flat tokens read perfectly in the earlier
      // measurements; upright standees are what drift, and that is a photography
      // problem, not something this test is about.
      ctx.beginPath(); ctx.arc(cx, cy, ${CELL} * 0.36, 0, Math.PI * 2);
      ctx.fillStyle = t.color; ctx.fill();
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.stroke();
    }

    // Trapezoid warp: rows near the top of the frame are further away, so they
    // get narrower. Row-by-row is enough — it produces the same one-column
    // registration error a real angled shot does.
    const warp = document.createElement('canvas');
    warp.width = base.width; warp.height = base.height;
    const wc = warp.getContext('2d');
    wc.fillStyle = '#101010'; wc.fillRect(0, 0, warp.width, warp.height);
    const NEAR = 1.0, FAR = 0.62;
    for (let y = 0; y < base.height; y++) {
      const t = y / (base.height - 1);
      const scale = FAR + (NEAR - FAR) * t;
      const w = base.width * scale;
      wc.drawImage(base, 0, y, base.width, 1, (base.width - w) / 2, y, w, 1);
    }
    const photo = warp.toDataURL('image/jpeg', 0.88);
    return { ok: true, photo, cols: parsed.cols, rows: parsed.rows, px: base.width + 'x' + base.height };
  } catch (e) { return { ok: false, error: String(e && e.stack || e) }; }
})()`);
if (!built?.ok) { console.error('photo build FAILED:', built?.error); ws.close(); process.exit(1); }
console.log(`photo   : ${built.px}, ${Math.round(built.photo.length / 1366)} KB jpeg, ${built.cols}x${built.rows} grid`);
console.log(`truth   : ${TOKENS.map((t) => `${t.label}=${t.cell}`).join(' ')}`);
if (outPath) { writeFileSync(outPath, Buffer.from(built.photo.split(',')[1], 'base64')); console.log(`wrote   : ${outPath}`); }

async function read(engine) {
  const started = Date.now();
  const out = await evaluate(`(async () => {
    try {
      const r = await window.__TAURI_INTERNALS__.invoke('read_table_positions', {
        photo: window.__ccPhoto, cols: ${built.cols}, rows: ${built.rows},
        engine: ${JSON.stringify(engine)}
      });
      return { ok: true, r };
    } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  })()`);
  return { out, secs: ((Date.now() - started) / 1000).toFixed(1) };
}

// Stash the photo once rather than shipping ~1MB of base64 through two more
// evaluates.
await evaluate(`(() => { window.__ccPhoto = ${JSON.stringify(built.photo)}; return window.__ccPhoto.length; })()`);

const scored = (minis) => {
  const byLabel = {};
  for (const m of minis) {
    const hit = TOKENS.find((t) => (m.description || '').toLowerCase().includes(t.label));
    if (hit && !byLabel[hit.label]) byLabel[hit.label] = m.cell.toUpperCase();
  }
  const exact = TOKENS.filter((t) => byLabel[t.label] === t.cell).length;
  return { byLabel, exact };
};

for (const engine of ['claude', 'codex']) {
  const { out, secs } = await read(engine);
  if (!out?.ok) { console.error(`\n${engine} read FAILED after ${secs}s: ${out?.error}`); continue; }
  const s = scored(out.r.minis);
  console.log(`\n=== ${engine} — ${out.r.minis.length} placed of ${out.r.seen} seen, ${secs}s, ${s.exact}/${TOKENS.length} exact ===`);
  for (const m of out.r.minis) console.log(`   ${String(m.cell).padEnd(5)} ${m.description}`);
  globalThis[`__${engine}`] = out.r.minis;
}

const first = globalThis.__claude ?? [], second = globalThis.__codex ?? [];
if (!first.length || !second.length) { console.error('\nneed both reads to compare'); ws.close(); process.exit(1); }

// The real shipped function, on the real reads.
const verdict = await evaluate(`(async () => {
  const { disputedCells } = await import('/src/utils/boardCrossCheck.ts');
  const first = ${JSON.stringify(first)}, second = ${JSON.stringify(second)};
  const disputed = disputedCells(first, second);
  // Sabotage check on the same shipped function: three identically-worded tokens
  // where the reviewer lists only two. Pairing by best word-overlap is a tie for
  // every one of them, so nothing may be reported.
  const tie = disputedCells(
    [{ cell: 'A1', description: 'red circular token' },
     { cell: 'B2', description: 'red circular token' },
     { cell: 'C3', description: 'red circular token' }],
    [{ cell: 'A1', description: 'red circular token' },
     { cell: 'Z9', description: 'red circular token' }]
  );
  return { disputed, tie };
})()`);

console.log('\n=== the real disputedCells, on those two reads ===');
console.log(`flagged rows: ${verdict.disputed.length === 0 ? 'none' : verdict.disputed.join(', ')}`);
for (const i of verdict.disputed) {
  const mine = first[i];
  console.log(`  row ${i}: claude said ${mine.cell} for "${mine.description}"`);
}
console.log(`\ntie sabotage : ${verdict.tie.length === 0 ? 'PASS — an unattributable match reports nothing' : `FAIL — flagged ${JSON.stringify(verdict.tie)}`}`);
ws.close();
process.exit(0);
