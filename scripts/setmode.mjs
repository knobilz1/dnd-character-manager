// Set a campaign's battle mode and REPORT what actually happened, rather than
// printing success regardless. Usage: node setmode.mjs <campaignId> <mode>
const [campaignId, mode] = process.argv.slice(2);
if (!campaignId || !mode) { console.error('Usage: node setmode.mjs <campaignId> <grid|theater|hex>'); process.exit(2); }

const targets = (await (await fetch('http://127.0.0.1:9222/json/list')).json()).filter((t) => t.type === 'page');
const page = targets.find((t) => /localhost:\d+|tauri:\/\//.test(t.url || '')) || targets[0];
const ws = new WebSocket(page.webSocketDebuggerUrl);
let mid = 0; const pending = new Map();
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++mid; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } });
await new Promise((r) => ws.addEventListener('open', r));
await send('Runtime.enable');

// Everything the page evaluates is built here in Node and injected as a literal —
// the page has no `process`, and referencing it silently throws so the invoke
// never runs while the script happily reports success.
const r = await send('Runtime.evaluate', {
  expression: `(async () => { try {
      await window.__TAURI_INTERNALS__.invoke('set_battle_mode', { id: ${JSON.stringify(campaignId)}, mode: ${JSON.stringify(mode)} });
      const now = await window.__TAURI_INTERNALS__.invoke('read_battle_mode', { id: ${JSON.stringify(campaignId)} });
      return { ok: true, now };
    } catch (e) { return { ok: false, error: String(e && e.message || e) }; } })()`,
  returnByValue: true, awaitPromise: true, timeout: 60000,
});
const v = r.result?.value;
if (r.exceptionDetails) { console.error('page threw:', JSON.stringify(r.exceptionDetails).slice(0, 300)); process.exit(1); }
if (!v?.ok) { console.error('FAILED:', v?.error ?? JSON.stringify(r).slice(0, 300)); ws.close(); process.exit(1); }
console.log(`battle mode is now: ${v.now}`);
ws.close();
process.exit(0);
