/**
 * freeze-capture.mjs — leave this running while you use the DM Console; the
 * next time the window locks up it records WHY instead of leaving us to guess.
 *
 *   node scripts/freeze-capture.mjs
 *
 * Needs the dev app started with CDP:
 *   WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 npm run tauri:dev
 *
 * Every second it asks the renderer to evaluate `1`. When that stops coming
 * back it captures, in this order:
 *   1. per-process CPU — says whether the burn is the renderer, the GPU
 *      process, or the Rust side (app.exe);
 *   2. the JS call stack via Debugger.pause — a real frame means JS is
 *      looping; an EMPTY frame means JS is idle and the thread is stuck below
 *      it (layout, paint, GC, GPU), which is a completely different bug;
 *   3. how long the freeze lasted.
 * Everything lands in scripts/freeze-capture.log.
 */
import { appendFileSync } from 'node:fs';
import { execFile } from 'node:child_process';

const LOG = new URL('./freeze-capture.log', import.meta.url).pathname.replace(/^\//, '');
const BLOCK_MS = 3000; // shorter than this is a hiccup, not a freeze
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toISOString().slice(11, 19);
const say = (s) => { const line = `[${stamp()}] ${s}`; console.log(line); try { appendFileSync(LOG, line + '\n'); } catch { /* log is best-effort */ } };

/** Total CPU seconds per process name — the cheapest way to tell which side is burning. */
const cpuSnapshot = () => new Promise((res) => {
  execFile('powershell', ['-NoProfile', '-Command',
    "Get-Process app,msedgewebview2,node -ErrorAction SilentlyContinue | Group-Object ProcessName | ForEach-Object { '{0}={1}' -f $_.Name, [math]::Round(($_.Group | Measure-Object CPU -Sum).Sum,1) }"],
    { timeout: 8000 }, (err, out) => res(err ? 'cpu:unavailable' : (out || '').trim().split(/\r?\n/).join(' ')));
});

const targets = (await (await fetch('http://127.0.0.1:9222/json/list')).json()).filter((t) => t.type === 'page');
const page = targets.find((t) => /localhost:\d+|tauri:\/\//.test(t.url || '')) || targets[0];
if (!page) { say('no CDP page target — is the dev app running with --remote-debugging-port=9222?'); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0; const pending = new Map(); let paused = null;
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Debugger.paused') paused = m.params;
  if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
});
ws.addEventListener('close', () => { say('!! CDP closed — the app window died'); process.exit(0); });
await new Promise((r) => ws.addEventListener('open', r));
await send('Runtime.enable');
await send('Debugger.enable').catch(() => {});
say(`watching ${page.url} — go use the app; freezes get captured here`);

const timed = (pr, ms) => Promise.race([pr, sleep(ms).then(() => null)]).catch(() => null);

let blockedSince = null, captured = false, lastScreen = '';
for (;;) {
  const alive = await timed(send('Runtime.evaluate', {
    expression: "(function(){var t=(document.body&&document.body.innerText)||'';return t.slice(0,80).replace(/\\s+/g,' ');})()",
    returnByValue: true,
  }).then((r) => r.result.value), 2000);

  if (alive === null) {
    if (!blockedSince) { blockedSince = Date.now(); captured = false; say(`FREEZE started. last screen: "${lastScreen}"`); }
    // Capture once, after BLOCK_MS, so a 3s hiccup doesn't pause the debugger.
    if (!captured && Date.now() - blockedSince > BLOCK_MS) {
      captured = true;
      say(`  cpu: ${await cpuSnapshot()}`);
      paused = null;
      await timed(send('Debugger.pause'), 5000);
      for (let n = 0; n < 12 && !paused; n++) await sleep(500);
      if (!paused) say('  JS stack: could not pause — inspector itself is starved');
      else if (!(paused.callFrames || []).length) say('  JS stack: EMPTY — JS is idle; the block is below it (layout/paint/GC/GPU), not a script loop');
      else {
        say('  JS stack (innermost first):');
        for (const f of paused.callFrames.slice(0, 15)) say(`    ${(f.functionName || '(anonymous)').padEnd(30)} ${(f.url || '').split('/').pop()}:${(f.location || {}).lineNumber}`);
      }
      await timed(send('Debugger.resume'), 3000);
    }
  } else {
    if (blockedSince) { say(`FREEZE ended after ${Math.round((Date.now() - blockedSince) / 1000)}s`); blockedSince = null; }
    lastScreen = alive;
  }
  await sleep(1000);
}
