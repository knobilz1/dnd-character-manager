// Generate ONE battle map with the tile-pick cross-check armed, so the two
// vision texture picks (ground + liquid) each get a second opinion.
// Usage: node gen-map.mjs <campaignId> "<hint>"
const [campaignId, hint] = process.argv.slice(2);
if (!campaignId || !hint) { console.error('Usage: node gen-map.mjs <campaignId> "<hint>"'); process.exit(2); }

const targets = (await (await fetch('http://127.0.0.1:9222/json/list')).json()).filter((t) => t.type === 'page');
const page = targets.find((t) => /localhost:\d+|tauri:\/\//.test(t.url || '')) || targets[0];
if (!page) { console.error('No dev app on CDP :9222'); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let mid = 0; const pending = new Map();
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++mid; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } });
await new Promise((r) => ws.addEventListener('open', r));
await send('Runtime.enable');

const evaluate = async (expr, ms = 1_800_000) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: ms });
  return r.result?.value;
};

// Claude picks by looking at the image; Codex re-picks from the filenames alone.
// Deliberately a different lens, not a redundant one.
const cfg = await evaluate(`(async () => {
  try {
    await window.__TAURI_INTERNALS__.invoke('set_ingestion_engine', { engine: 'claude', crossCheck: ['codex'] });
    return 'set';
  } catch (e) { return 'FAILED: ' + String(e && e.message || e); }
})()`);
console.log(`cross-check config : ${cfg}`);

console.log(`generating         : ${campaignId} ← "${hint}"`);
const started = Date.now();
const out = await evaluate(`(async () => {
  try {
    const metas = await window.__TAURI_INTERNALS__.invoke('generate_battle_map', {
      id: ${JSON.stringify(campaignId)}, hint: ${JSON.stringify(hint)}
    });
    return { ok: true, metas };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
})()`);
const secs = ((Date.now() - started) / 1000).toFixed(1);
if (!out?.ok) { console.error(`FAILED after ${secs}s: ${out?.error ?? 'no result'}`); ws.close(); process.exit(1); }
console.log(`done in ${secs}s — ${out.metas.length} map(s):`);
for (const m of out.metas) console.log(`  ${m.slug}  ${m.name ?? ''}`);
ws.close();
process.exit(0);
