// Is the DM console's main thread actually BLOCKED, or is it a long backend
// call behind a blocking overlay? Those look identical to a user and have
// completely different fixes, so measure before guessing.
const targets = (await (await fetch('http://127.0.0.1:9222/json/list')).json()).filter((t) => t.type === 'page');
const page = targets.find((t) => /localhost:\d+|tauri:\/\//.test(t.url || '')) || targets[0];
if (!page) { console.error('No dev app on CDP :9222'); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let mid = 0; const pending = new Map();
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++mid; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } });
await new Promise((r) => ws.addEventListener('open', r));
await send('Runtime.enable');

// A trivial evaluate that must return instantly. If the JS main thread is
// pinned, this round-trip stalls; if it answers in ms the thread is idle and
// the "freeze" is an overlay waiting on the backend.
const t0 = Date.now();
const alive = await send('Runtime.evaluate', { expression: '1+1', returnByValue: true });
const rtt = Date.now() - t0;

const r = await send('Runtime.evaluate', {
  expression: `(() => {
    const vis = (el) => { const s = getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden' && el.getBoundingClientRect().width > 0; };
    // Anything painted over the page: fixed/absolute full-bleed layers.
    const overlays = [...document.querySelectorAll('div,section')].filter((el) => {
      const s = getComputedStyle(el); const b = el.getBoundingClientRect();
      return (s.position === 'fixed' || s.position === 'absolute') && b.width > window.innerWidth * 0.6 && b.height > window.innerHeight * 0.6 && vis(el);
    }).map((el) => ({ cls: el.className?.toString().slice(0, 80), z: getComputedStyle(el).zIndex, text: (el.innerText || '').replace(/\\s+/g, ' ').slice(0, 200) }));
    // Any spinner-ish element still animating.
    const spinners = [...document.querySelectorAll('*')].filter((el) => {
      const c = el.className?.toString?.() || '';
      return /spin|loader|loading|busy/i.test(c) && vis(el);
    }).map((el) => el.className.toString().slice(0, 80));
    // Disabled buttons tell us which busy flag is set.
    const buttons = [...document.querySelectorAll('button')].map((b) => ({ t: (b.innerText || '').replace(/\\s+/g, ' ').slice(0, 40), disabled: b.disabled })).filter((b) => b.t);
    return { overlays, spinners: [...new Set(spinners)], buttons, url: location.href };
  })()`,
  returnByValue: true,
});
console.log(`main-thread round trip: ${rtt}ms  (evaluate returned ${JSON.stringify(alive.result?.value)})`);
console.log(JSON.stringify(r.result?.value, null, 2));
ws.close();
process.exit(0);
