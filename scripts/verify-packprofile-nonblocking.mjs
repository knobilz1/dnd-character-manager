// Fires get_pack_profile WITHOUT awaiting it, then repeatedly times a trivial
// main-thread evaluate while it's in flight. A sync #[tauri::command] runs on
// the main thread, so under the old code these probes stall for the whole call;
// off-thread they answer in milliseconds. Measures the freeze, not the duration.
const targets = (await (await fetch('http://127.0.0.1:9222/json/list')).json()).filter((t) => t.type === 'page');
const page = targets.find((t) => /localhost:\d+|tauri:\/\//.test(t.url || '')) || targets[0];
if (!page) { console.error('No dev app on CDP :9222'); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let mid = 0; const pending = new Map();
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++mid; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } });
await new Promise((r) => ws.addEventListener('open', r));
await send('Runtime.enable');

await send('Runtime.evaluate', {
  expression: `(() => {
    window.__pp = { done: false, ms: null, err: null, size: 0 };
    const t0 = performance.now();
    window.__TAURI_INTERNALS__.invoke('get_pack_profile')
      .then((v) => { window.__pp = { done: true, ms: Math.round(performance.now() - t0), err: null, size: JSON.stringify(v ?? null).length }; })
      .catch((e) => { window.__pp = { done: true, ms: Math.round(performance.now() - t0), err: String(e).slice(0, 120), size: 0 }; });
    return 'fired';
  })()`,
  returnByValue: true,
});
console.log('get_pack_profile fired (not awaited)\n');

const rtts = [];
for (let i = 0; i < 40; i++) {
  const t0 = Date.now();
  const r = await send('Runtime.evaluate', { expression: 'JSON.stringify(window.__pp)', returnByValue: true });
  const rtt = Date.now() - t0;
  rtts.push(rtt);
  const st = JSON.parse(r.result?.value ?? '{}');
  if (i % 5 === 0 || st.done) console.log(`  probe ${String(i).padStart(2)}: main-thread ${String(rtt).padStart(6)}ms   profile ${st.done ? `DONE in ${st.ms}ms (${st.err ? 'ERR ' + st.err : st.size + ' bytes'})` : 'still running'}`);
  if (st.done) {
    const worst = Math.max(...rtts);
    console.log(`\nworst main-thread stall while it ran: ${worst}ms over ${rtts.length} probes`);
    console.log(worst < 1000 ? 'PASS — UI stayed responsive throughout' : `FAIL — UI blocked for ${worst}ms`);
    ws.close(); process.exit(worst < 1000 ? 0 : 1);
  }
  await new Promise((r) => setTimeout(r, 4000));
}
console.log(`\nstill running after 40 probes; worst main-thread stall ${Math.max(...rtts)}ms`);
ws.close();
process.exit(0);
