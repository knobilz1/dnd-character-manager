// Stage A instrument for #39 ("read the board"): hand ONE real photo of the
// physical table to the board reader and print what the model saw.
//
// This is the go/no-go gate. Take an overhead photo of your minis standing on a
// Tavern-Sheet map — on the TV or printed-and-taped, both carry the A1..N-M
// ruler labels the model reads — then run this and check the cells against
// where the minis actually are. Realistic shots please: slight angle, normal
// room light, 6-10 minis. If it can't read a real photo, the whole snapshot
// approach is dead and we fall back to the IR touch frame.
//
// Requires the dev app running with CDP:
//   WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 npm run tauri dev
//
// Usage: node scripts/board-read.mjs <photo> <cols> <rows>
//   cols/rows = the map's grid size, i.e. the "Grid: 20x15" line in its spec.
import { readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';

const [photoPath, colsArg, rowsArg, modelArg] = process.argv.slice(2);
if (!photoPath || !colsArg || !rowsArg) {
  console.error('Usage: node scripts/board-read.mjs <photo.jpg> <cols> <rows> [model]');
  console.error('  cols/rows = the map grid size (see the "Grid: WxH" line in the map spec).');
  console.error('  model     = optional vision model, e.g. opus (default: sonnet).');
  process.exit(2);
}
const cols = Number(colsArg), rows = Number(rowsArg);
if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols < 1 || rows < 1) {
  console.error('cols and rows must be positive numbers.');
  process.exit(2);
}

const ext = extname(photoPath).toLowerCase();
const media = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
const b64 = readFileSync(photoPath).toString('base64');
const kb = Math.round(b64.length / 1366);
console.log(`photo : ${basename(photoPath)} — ${kb} KB as ${media}`);
console.log(`grid  : ${cols} x ${rows}  (A..${(() => { let n = cols, s = ''; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; })()}, 1..${rows})`);
console.log(`model : ${modelArg || 'default (opus — see BOARD_READ_MODEL)'}`);
if (kb > 4000) console.log('warning: that is a big photo — if the call fails as "Prompt is too long", export a smaller one.');

const targets = (await (await fetch('http://127.0.0.1:9222/json/list')).json()).filter((t) => t.type === 'page');
// Don't assume the dev port: vite walks past 5173 whenever an old server is
// still holding it, so match any localhost page (or the bundled app's origin).
const page = targets.find((t) => /localhost:\d+|tauri:\/\//.test(t.url || '')) || targets[0];
if (!page) {
  console.error('No dev app found on CDP :9222 — is the app running with --remote-debugging-port=9222?');
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
let mid = 0; const pending = new Map();
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++mid; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } });
await new Promise((r) => ws.addEventListener('open', r));
await send('Runtime.enable');

const timer = setTimeout(() => { console.error('Timed out after 3 min waiting on the vision call.'); process.exit(3); }, 180000);
console.log('asking the model…');
const started = Date.now();
const r = await send('Runtime.evaluate', {
  expression: `(async () => {
    try {
      const minis = await window.__TAURI_INTERNALS__.invoke('read_table_positions', {
        photo: ${JSON.stringify(`data:${media};base64,${b64}`)}, cols: ${cols}, rows: ${rows},
        model: ${JSON.stringify(modelArg || null)}
      });
      return { ok: true, minis };
    } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  })()`,
  returnByValue: true, awaitPromise: true,
});
clearTimeout(timer);
const out = r.result?.value;
const secs = ((Date.now() - started) / 1000).toFixed(1);

if (!out) { console.error('No result:', JSON.stringify(r).slice(0, 400)); process.exit(1); }
if (!out.ok) { console.error(`FAILED after ${secs}s: ${out.error}`); process.exit(1); }

console.log(`\n=== ${out.minis.length} miniature(s) read in ${secs}s ===`);
for (const m of out.minis) console.log(`  ${m.cell.padEnd(5)} (col ${m.col}, row ${m.row})  ${m.description}`);
if (out.minis.length === 0) console.log('  (nothing — see the "BOARD READ (raw reply)" entry in the map log for what it actually said)');
console.log('\nNow compare against where the minis really are. Stage A passes if ~8/10 are right.');
ws.close();
process.exit(0);
