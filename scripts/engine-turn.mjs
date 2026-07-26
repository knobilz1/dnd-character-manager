// Two live DM turns on a non-Claude engine, through the REAL ask_dm_engine
// command with a REAL campaign folder as cwd.
//
// Checks the three things that can only fail at runtime:
//   1. the reply is narration, not banner lines leaking through the parser
//   2. turn 2 remembers turn 1 (the session-id scrape actually works)
//   3. a ```dm-actions block comes back and its JSON parses
//
// Usage: node engine-turn.mjs <engine> <campaignId>
import { basename } from 'node:path';

const [engine, campaignId] = process.argv.slice(2);
if (!engine) { console.error('Usage: node engine-turn.mjs <engine> [campaignId]'); process.exit(2); }

const targets = (await (await fetch('http://127.0.0.1:9222/json/list')).json()).filter((t) => t.type === 'page');
const page = targets.find((t) => /localhost:\d+|tauri:\/\//.test(t.url || '')) || targets[0];
if (!page) { console.error('No dev app on CDP :9222'); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
let mid = 0; const pending = new Map();
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++mid; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } });
await new Promise((r) => ws.addEventListener('open', r));
await send('Runtime.enable');

async function turn(prompt, sessionId) {
  const started = Date.now();
  const r = await send('Runtime.evaluate', {
    expression: `(async () => {
      try {
        const reply = await window.__TAURI_INTERNALS__.invoke('ask_dm_engine', {
          engine: ${JSON.stringify(engine)},
          prompt: ${JSON.stringify(prompt)},
          sessionId: ${JSON.stringify(sessionId ?? null)},
          campaignId: ${JSON.stringify(campaignId ?? null)}
        });
        return { ok: true, reply };
      } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
    })()`,
    returnByValue: true, awaitPromise: true,
  });
  return { out: r.result?.value, secs: ((Date.now() - started) / 1000).toFixed(1) };
}

// Turn 1 has to do two jobs: plant a fact no model could guess (so turn 2 proves
// the session id round-tripped), and force a real state change (so an ABSENT
// dm-actions block means the engine can't produce one, rather than that this turn
// simply had nothing to report — the block is optional by design).
//
// The facts are handed over as DM-side scene notes, NOT as a player declaring
// them. dm_rules.md tells the DM to reject invented player overreach outright,
// and it does: phrased as a player claim, the reply was "there isn't a brass key
// tucked in the cultist's boot" — correct behaviour that tests nothing here.
const T1 = `Scene notes for you, the DM — these are established facts, not a player's claim:
  - The party has just killed a robed cultist in the marsh shrine.
  - On his body is a brass key stamped with the number 47.
  - The shrine's guardian, a giant toad, now lunges from the water and bites Mira the wizard, dealing 7 piercing damage.

Narrate this to the table, then report the state changes.`;
const T2 = `A player asks, out of character: "Wait — what number was stamped on that brass key we found on the cultist?"

Answer them directly.`;

console.log(`engine   : ${engine}`);
console.log(`campaign : ${campaignId || '(none — no cwd, so no project context at all)'}`);

console.log('\n===== TURN 1 =====');
const a = await turn(T1, null);
if (!a.out?.ok) { console.error(`FAILED after ${a.secs}s: ${a.out?.error ?? JSON.stringify(a).slice(0, 300)}`); ws.close(); process.exit(1); }
console.log(`(${a.secs}s)  session_id: ${a.out.reply.session_id ?? 'NONE — turn 2 will start fresh'}`);
console.log('---8<--- reply ---8<---');
console.log(a.out.reply.text);
console.log('---8<------------8<---');

console.log('\n===== TURN 2 (memory canary) =====');
const b = await turn(T2, a.out.reply.session_id);
if (!b.out?.ok) { console.error(`FAILED after ${b.secs}s: ${b.out?.error}`); ws.close(); process.exit(1); }
console.log(`(${b.secs}s)  session_id: ${b.out.reply.session_id ?? 'NONE'}`);
console.log('---8<--- reply ---8<---');
console.log(b.out.reply.text);
console.log('---8<------------8<---');

// ---- verdicts, measured not assumed ----
const t1 = a.out.reply.text || '', t2 = b.out.reply.text || '';
console.log('\n===== VERDICTS =====');
console.log(`memory       : ${/\b47\b/.test(t2) ? 'PASS — recalled "47" from turn 1' : 'FAIL — the key number did not survive to turn 2'}`);

// Banner leakage: agy/codex both print a header block on stderr/stdout that must
// never reach narration. These are the exact strings each one emits.
const banners = ['workdir:', 'reasoning effort:', 'session id:', 'OpenAI Codex v', 'provider: openai',
                 'conversation_id', 'duration_seconds', 'tokens used', 'Reading additional input'];
const leaked = banners.filter((s) => t1.includes(s) || t2.includes(s));
console.log(`banner leak  : ${leaked.length ? `FAIL — ${JSON.stringify(leaked)}` : 'PASS — no banner text in either reply'}`);

const m = /```dm-actions\s*([\s\S]*?)```/i.exec(t1);
if (!m) {
  console.log('dm-actions   : ABSENT — no block at all in turn 1');
} else {
  try { const o = JSON.parse(m[1]); console.log(`dm-actions   : PASS — parses, keys: ${JSON.stringify(Object.keys(o))}`); }
  catch (e) { console.log(`dm-actions   : FAIL — block present but invalid JSON: ${e.message}`); }
}
// Whether the brief arrived is NOT readable from the reply's vocabulary — a
// well-behaved DM doesn't echo its own instruction words, so the first version of
// this check reported "no sign of it" on a turn that was visibly obeying
// dm_rules.md. The honest signal is the actions block plus the campaign's own
// proper nouns; behaviour under the house rules is the real proof and belongs in
// the transcript above, not in a token match.
console.log(`campaign nouns: ${/Gloamwood|Witchfell|marsh shrine/i.test(t1) ? 'present in the narration' : 'none (may just be this scene)'}`);
ws.close();
process.exit(0);
