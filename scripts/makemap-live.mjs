// Will the DM actually ASK for a map when a fight is taking shape somewhere it
// has no map for? Switches the campaign to grid (which regenerates dm_rules.md
// with the makeMap protocol), runs one real turn on a fight-is-brewing scene,
// and reports whether the action came back. Restores the previous mode.
const [engine, campaignId] = process.argv.slice(2);

const targets = (await (await fetch('http://127.0.0.1:9222/json/list')).json()).filter((t) => t.type === 'page');
const page = targets.find((t) => /localhost:\d+|tauri:\/\//.test(t.url || '')) || targets[0];
const ws = new WebSocket(page.webSocketDebuggerUrl);
let mid = 0; const pending = new Map();
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++mid; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } });
await new Promise((r) => ws.addEventListener('open', r));
await send('Runtime.enable');
const ev = async (expr, ms = 1200000) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: ms });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400));
  return r.result?.value;
};
const inv = (n, a) => `window.__TAURI_INTERNALS__.invoke(${JSON.stringify(n)}, ${JSON.stringify(a)})`;

const prev = await ev(`(async () => { try { return await ${inv('read_battle_mode', { id: campaignId })}; } catch (e) { return 'theater'; } })()`);
await ev(`${inv('set_battle_mode', { id: campaignId, mode: 'grid' })}`);
console.log(`battle mode: ${prev} -> grid (regenerates dm_rules.md with the map protocol)`);

// A fight clearly taking shape, at a place no prepared map covers. The scene
// deliberately does NOT say "roll initiative" — the whole point is asking early.
// Deliberately a bare player turn, the way the console actually sends one. An
// earlier version ended with "Narrate the approach in three or four sentences"
// and got pure narration every time — which measured my own instruction, not the
// campaign's rules. Telling the model what shape to reply in is exactly what
// stops it consulting the rules about that shape.
// Must be built from what the MODULE establishes. An earlier version had the
// party follow cultist tracks to a sawmill, and the DM correctly refused —
// "you haven't found cultist tracks, an old sawmill, or evidence of a ritual" —
// because dm_rules.md tells it to reject invented player overreach outright. A
// test that trips that rule measures the rule, not the feature.
const PROMPT = `A player at the table says, in character:

"That chanting in the clearing ahead — that's them. We creep up through the reeds until we can see the whole gathering, and then we charge them before they finish."`;

const started = Date.now();
const out = await ev(`(async () => { try {
    const r = await ${inv('ask_dm_engine', { engine, prompt: PROMPT, sessionId: null, campaignId })};
    return { ok: true, text: r.text };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; } })()`);
const secs = ((Date.now() - started) / 1000).toFixed(1);
await ev(`${inv('set_battle_mode', { id: campaignId, mode: prev })}`);
console.log(`battle mode restored to: ${prev}`);

if (!out?.ok) { console.error(`FAILED after ${secs}s: ${out?.error}`); ws.close(); process.exit(1); }
console.log(`\n=== reply (${secs}s) ===\n${out.text}\n`);

const m = /```dm-actions\s*([\s\S]*?)```/.exec(out.text);
if (!m) { console.log('VERDICT: no dm-actions block at all'); }
else {
  try {
    const o = JSON.parse(m[1]);
    console.log('action keys :', JSON.stringify(Object.keys(o)));
    console.log(`VERDICT     : ${o.makeMap ? `ASKED — "${o.makeMap}"` : 'did NOT ask for a map'}`);
  } catch (e) { console.log('block present but invalid JSON:', e.message); }
}
ws.close();
process.exit(0);
