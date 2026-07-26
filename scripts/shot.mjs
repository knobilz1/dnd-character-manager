// Screenshot the running Tauri app's webview over CDP, and report what page it
// is on. Pixel-clicking the native window minimises/closes it, so everything
// here goes through the debugger instead.
import { writeFileSync } from 'node:fs';
const out = process.argv[2] || 'app.png';

const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const page = list.find((t) => t.type === 'page' && /localhost:\d+|tauri:\/\//.test(t.url || ''));
if (!page) { console.error('No app window on CDP :9222'); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
await send('Runtime.enable');
await send('Page.enable');

const info = await send('Runtime.evaluate', {
  expression: `JSON.stringify({
    url: location.href,
    tauri: typeof window.__TAURI_INTERNALS__ !== 'undefined',
    bodyChars: document.body ? document.body.innerText.length : 0,
    heading: (document.querySelector('h1,h2') || {}).innerText || null
  })`,
  returnByValue: true,
});
console.log('page:', info.result.value);

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
console.log('wrote', out);
ws.close();
process.exit(0);
