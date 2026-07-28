// Evaluate an arbitrary expression in the running dev app and print the result.
// Usage: node cdp-eval.mjs "<js expression>"
// The page has NO `process` — referencing it throws silently in there.
const expression = process.argv[2];
if (!expression) { console.error('Usage: node cdp-eval.mjs "<js expression>"'); process.exit(2); }
const targets = (await (await fetch('http://127.0.0.1:9222/json/list')).json()).filter((t) => t.type === 'page');
const page = targets.find((t) => /localhost:\d+|tauri:\/\//.test(t.url || '')) || targets[0];
if (!page) { console.error('No dev app on CDP :9222'); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let mid = 0; const pending = new Map();
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++mid; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } });
await new Promise((r) => ws.addEventListener('open', r));
await send('Runtime.enable');
const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, timeout: 600000 });
if (r.exceptionDetails) console.error('THREW:', JSON.stringify(r.exceptionDetails).slice(0, 500));
console.log(typeof r.result?.value === 'string' ? r.result.value : JSON.stringify(r.result?.value, null, 2));
ws.close();
process.exit(0);
