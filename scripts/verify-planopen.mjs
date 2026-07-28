// End-to-end repro of the reported bug: click "Plan Next Session" on a campaign
// with no cached plan and measure whether the window stays alive. DOM click, not
// a pixel click — pixel-clicking this window minimises/closes it.
const targets = (await (await fetch('http://127.0.0.1:9222/json/list')).json()).filter((t) => t.type === 'page');
const page = targets.find((t) => /localhost:\d+|tauri:\/\//.test(t.url || '')) || targets[0];
if (!page) { console.error('No dev app on CDP :9222'); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let mid = 0; const pending = new Map();
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++mid; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } });
await new Promise((r) => ws.addEventListener('open', r));
await send('Runtime.enable');

// The app may have restarted on Home; route straight into the DM console.
if (!/\/dm/.test(page.url || '')) {
  await send('Runtime.evaluate', { expression: `location.href = '/dm'`, returnByValue: true });
  await new Promise((r) => setTimeout(r, 9000));
  await send('Runtime.enable');
}

const click = await send('Runtime.evaluate', {
  expression: `(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => /plan next session/i.test(b.innerText || ''));
    if (!btn) return { ok: false, buttons: [...document.querySelectorAll('button')].map((b) => (b.innerText||'').trim()).filter(Boolean).slice(0, 40) };
    btn.click();
    return { ok: true };
  })()`,
  returnByValue: true,
});
if (!click.result?.value?.ok) { console.error('No "Plan Next Session" button found. Visible buttons:', click.result?.value?.buttons); ws.close(); process.exit(1); }
console.log('clicked "Plan Next Session"\n');

const rtts = [];
for (let i = 0; i < 15; i++) {
  const t0 = Date.now();
  const r = await send('Runtime.evaluate', {
    expression: `(() => {
      const dlg = [...document.querySelectorAll('div')].find((el) => getComputedStyle(el).position === 'fixed' && /Plan Next Session/i.test(el.innerText || ''));
      const hdr = [...document.querySelectorAll('button')].find((b) => /Detected biomes/i.test(b.innerText || ''));
      return JSON.stringify({ dialogOpen: !!dlg, biomes: hdr ? (hdr.innerText||'').replace(/\\s+/g,' ').slice(0, 80) : 'no panel' });
    })()`,
    returnByValue: true,
  });
  const rtt = Date.now() - t0;
  rtts.push(rtt);
  const st = JSON.parse(r.result?.value ?? '{}');
  console.log(`  t+${String(i * 3).padStart(2)}s  main-thread ${String(rtt).padStart(5)}ms  dialog=${st.dialogOpen}  biomes: ${st.biomes}`);
  await new Promise((r) => setTimeout(r, 3000));
}
const worst = Math.max(...rtts);
console.log(`\nworst main-thread stall after opening Plan: ${worst}ms`);
console.log(worst < 1000 ? 'PASS — no freeze' : `FAIL — window blocked ${worst}ms`);
ws.close();
process.exit(worst < 1000 ? 0 : 1);
