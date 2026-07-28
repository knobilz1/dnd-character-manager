// Times every backend call the Plan dialog makes on open, individually, from
// inside the page — so the one that pins the main thread names itself instead
// of being guessed at from reading code.
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
    const inv = window.__TAURI_INTERNALS__.invoke;
    // The console persists its active campaign in the campaign store.
    let id = null;
    for (const k of Object.keys(localStorage)) {
      if (!/campaign/i.test(k)) continue;
      try { const v = JSON.parse(localStorage.getItem(k)); const s = v?.state ?? v;
        id = s?.activeCampaignId ?? s?.activeId ?? id; } catch {}
    }
    const out = { id, calls: [] };
    const time = async (name, fn) => {
      const t0 = performance.now();
      try { const v = await fn(); out.calls.push({ name, ms: Math.round(performance.now() - t0), ok: true, size: JSON.stringify(v ?? null).length }); }
      catch (e) { out.calls.push({ name, ms: Math.round(performance.now() - t0), ok: false, err: String(e).slice(0, 120) }); }
    };
    await time('get_tile_library_summary', () => inv('get_tile_library_summary'));
    await time('get_pack_profile', () => inv('get_pack_profile'));
    if (id) {
      await time('read_cached_session_plan', () => inv('read_cached_session_plan', { id }));
      await time('list_battle_maps', () => inv('list_battle_maps', { id }));
    }
    return out;
  })()`,
  returnByValue: true, awaitPromise: true, timeout: 600000,
});
console.log(JSON.stringify(r.result?.value, null, 2));
ws.close();
process.exit(0);
