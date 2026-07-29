// The three engines emit the dm-actions block in visibly different shapes —
// Codex inline on one line, Gemini fenced with newlines, Claude compact JSON.
// A makeMap the parser drops is indistinguishable from a DM that never asked,
// so verify all three REAL replies parse, and that the block is stripped from
// what gets spoken aloud.
const REPLIES = {
  codex: 'Hold up—there aren’t any characters at the table yet, so nobody can advance. Once they connect, we’ll place them outside the ruins with weapons drawn.\n\n```dm-actions {"makeMap":"armed party approaching hostile ruins head-on"} ```',
  gemini: '[Narrator]: Alright, weapons drawn. You push forward toward the ruins, the crumbling stone walls casting long shadows. You hear the crunch of debris underfoot, and from within the broken structures, something stirs, alerted to your approach. Roll for initiative!\n\n```dm-actions\n{"makeMap": "combat in ancient stone ruins"}\n```',
  claude: 'The ruins loom out of the treeline — broken stone walls, collapsed archways, moss-eaten and dark. Something moves in there.\n\nThey’ve already spotted you.\n\n```dm-actions\n{"makeMap":"head-on assault on crumbling stone ruins — party charges in against beastmen cultists lurking behind fallen walls and archways"}\n```',
};

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
    const m = await import('/src/utils/dmActions.ts');
    const out = {};
    for (const [engine, text] of Object.entries(${JSON.stringify(REPLIES)})) {
      try {
        const res = m.parseDmReply(text);
        const spoken = res?.spoken ?? res?.narration ?? res?.text ?? '';
        out[engine] = {
          keys: Object.keys(res ?? {}),
          makeMap: res?.actions?.makeMap ?? null,
          warnings: res?.warnings ?? null,
          spokenLeaksBlock: /dm-actions|makeMap/.test(spoken),
          spokenTail: spoken.slice(-70),
        };
      } catch (e) { out[engine] = { error: String(e).slice(0, 200) }; }
    }
    return out;
  })()`,
  returnByValue: true, awaitPromise: true, timeout: 60000,
});
if (r.exceptionDetails) { console.error('THREW:', JSON.stringify(r.exceptionDetails).slice(0, 500)); process.exit(1); }
console.log(JSON.stringify(r.result?.value, null, 2));
ws.close();
process.exit(0);
