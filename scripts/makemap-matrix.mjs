// Does the DM actually ASK for a battle map when a fight is taking shape
// somewhere it has no map for — on EVERY engine, not just the one that was
// convenient to test?
//
// Builds the turn with the app's REAL buildTurnPrompt rather than a hand-written
// approximation. That matters: two earlier false negatives came from a bespoke
// prompt (one ended "narrate in three sentences", which measured my own
// instruction instead of the campaign's rules). Whatever dmPrompt.ts sends in
// production is exactly what this sends.
//
// Usage: node makemap-matrix.mjs <campaignId> [engine,engine,...]
const [campaignId, engineArg] = process.argv.slice(2);
const ENGINES = (engineArg || 'codex,gemini,claude').split(',').map((e) => e.trim()).filter(Boolean);
if (!campaignId) { console.error('Usage: node makemap-matrix.mjs <campaignId> [engines]'); process.exit(2); }

// In-fiction, and deliberately leaves every specific to the DM. dm_rules.md
// rejects players who invent unestablished NPCs/places, and separately says an
// out-of-fiction/meta request must NEVER produce a dm-actions block — so a
// prompt like "pretend a fight starts" would suppress the very thing under test.
const SPOKEN = "We're not sneaking past this one. We move up on the ruins ahead and take them head-on — everyone, weapons out.";

const targets = (await (await fetch('http://127.0.0.1:9222/json/list')).json()).filter((t) => t.type === 'page');
const page = targets.find((t) => /localhost:\d+|tauri:\/\//.test(t.url || '')) || targets[0];
if (!page) { console.error('No dev app on CDP :9222'); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let mid = 0; const pending = new Map();
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++mid; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } });
await new Promise((r) => ws.addEventListener('open', r));
await send('Runtime.enable');
const ev = async (expr, ms = 900000) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: ms });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400));
  return r.result?.value;
};
const inv = (n, a) => `window.__TAURI_INTERNALS__.invoke(${JSON.stringify(n)}, ${JSON.stringify(a)})`;

const mode = await ev(`(async () => { try { return await ${inv('read_battle_mode', { id: campaignId })}; } catch { return null; } })()`);
if (mode !== 'grid') {
  console.error(`campaign is in "${mode}" mode — makeMap is grid-only by design. Set grid first.`);
  ws.close(); process.exit(2);
}

// The production prompt, from the production builder.
const PROMPT = await ev(`(async () => {
  const m = await import('/src/utils/dmPrompt.ts');
  return m.buildTurnPrompt({ party: [], spokenText: ${JSON.stringify(SPOKEN)}, battleMode: 'grid' });
})()`);
console.log(`=== prompt built by dmPrompt.ts (${PROMPT.length} chars) ===\n${PROMPT}\n`);
console.log(`nudge present: ${/Map readiness check/.test(PROMPT)}\n`);

const rows = [];
for (const engine of ENGINES) {
  const command = engine === 'claude' ? 'ask_dm' : 'ask_dm_engine';
  const args = engine === 'claude'
    ? { prompt: PROMPT, sessionId: null, campaignId }
    : { engine, prompt: PROMPT, sessionId: null, campaignId };
  const t0 = Date.now();
  const out = await ev(`(async () => { try { const r = await ${inv(command, args)}; return { ok: true, text: r.text }; }
    catch (e) { return { ok: false, error: String(e && e.message || e) }; } })()`);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (!out?.ok) { console.log(`\n##### ${engine}: FAILED after ${secs}s — ${out?.error}`); rows.push([engine, secs, 'ERROR', out?.error?.slice(0, 60)]); continue; }
  console.log(`\n##### ${engine} (${secs}s) #####\n${out.text}\n`);
  const m = /```dm-actions\s*([\s\S]*?)```/.exec(out.text);
  if (!m) { rows.push([engine, secs, 'no block', '']); continue; }
  try {
    const o = JSON.parse(m[1]);
    rows.push([engine, secs, o.makeMap ? 'ASKED' : 'block, no makeMap', o.makeMap || Object.keys(o).join(',')]);
  } catch (e) { rows.push([engine, secs, 'bad JSON', e.message.slice(0, 50)]); }
}

console.log('\n================ VERDICT ================');
for (const [e, s, v, d] of rows) console.log(`${e.padEnd(8)} ${String(s).padStart(7)}s  ${v.padEnd(18)} ${d}`);
ws.close();
process.exit(0);
