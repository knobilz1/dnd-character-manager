// Polls the in-flight import_tile_library call (fired earlier and stashed on
// window.__imp) until it settles, reporting staged bytes as it goes. Exits
// non-zero if the import failed, so a background run surfaces that.
import { statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const FILES_DIR = 'C:/Users/nabil/AppData/Roaming/com.nabil.dndsheet/tile_library/files';

function dirSize(dir) {
  let bytes = 0, count = 0;
  const walk = (d) => {
    let ents; try { ents = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else { try { bytes += statSync(p).size; count++; } catch {} }
    }
  };
  walk(dir);
  return { gb: (bytes / 1024 ** 3).toFixed(2), count };
}

const targets = (await (await fetch('http://127.0.0.1:9222/json/list')).json()).filter((t) => t.type === 'page');
const page = targets.find((t) => /localhost:\d+|tauri:\/\//.test(t.url || '')) || targets[0];
if (!page) { console.error('No dev app on CDP :9222'); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let mid = 0; const pending = new Map();
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++mid; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } });
await new Promise((r) => ws.addEventListener('open', r));
await send('Runtime.enable');

for (let i = 0; ; i++) {
  let st;
  try {
    const r = await send('Runtime.evaluate', { expression: 'JSON.stringify(window.__imp ?? null)', returnByValue: true });
    st = JSON.parse(r.result?.value ?? 'null');
  } catch (e) {
    console.log(`[${i}] CDP unreachable (${String(e).slice(0, 60)}) — app may have restarted, import lost`);
    process.exit(2);
  }
  if (!st) { console.log('window.__imp is gone — the page reloaded and the import handle was lost'); process.exit(2); }
  const { gb, count } = dirSize(FILES_DIR);
  const mins = ((Date.now() - st.t0) / 60000).toFixed(1);
  console.log(`[t+${mins}m] staged ${count} files / ${gb} GB${st.done ? '' : ' — running'}`);
  if (st.done) {
    if (st.ok) {
      console.log(`\nIMPORT OK in ${(st.ms / 60000).toFixed(1)} min`);
      console.log(JSON.stringify(st.summary, null, 2).slice(0, 900));
      ws.close(); process.exit(0);
    }
    console.log(`\nIMPORT FAILED after ${(st.ms / 60000).toFixed(1)} min: ${st.err}`);
    ws.close(); process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 60000));
}
