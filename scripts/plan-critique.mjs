// "Plan Next Session" with the critique armed. Battle mode is forced to theater
// for the run so we measure the PLAN, not 9 minutes of map generation per
// encounter, then restored to whatever it was.
const [campaignId] = process.argv.slice(2);
const targets = (await (await fetch('http://127.0.0.1:9222/json/list')).json()).filter((t) => t.type === 'page');
const page = targets.find((t) => /localhost:\d+|tauri:\/\//.test(t.url || '')) || targets[0];
const ws = new WebSocket(page.webSocketDebuggerUrl);
let mid = 0; const pending = new Map();
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++mid; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } });
await new Promise((r) => ws.addEventListener('open', r));
await send('Runtime.enable');
const ev = async (expr, ms=1800000) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: ms })).result?.value;

const inv = (name, args) => `window.__TAURI_INTERNALS__.invoke(${JSON.stringify(name)}, ${JSON.stringify(args)})`;
const prev = await ev(`(async()=>{ try { return await ${inv('read_battle_mode',{id:campaignId})}; } catch(e){ return 'ERR '+e; } })()`);
console.log(`battle mode was: ${prev}`);
await ev(`(async()=>{ await ${inv('set_ingestion_engine',{engine:'claude',crossCheck:['codex','gemini']})};
                      await ${inv('set_battle_mode',{id:campaignId,mode:'theater'})}; return 1; })()`);
console.log('cross-check: claude primary, reviewers codex + gemini; battle mode -> theater');

const t0 = Date.now();
const out = await ev(`(async()=>{ try { const r = await ${inv('regenerate_session_plan',{id:campaignId})}; return {ok:true,r}; }
                                  catch(e){ return {ok:false,error:String(e&&e.message||e)}; } })()`);
const secs = ((Date.now()-t0)/1000).toFixed(1);
await ev(`${inv('set_battle_mode',{id:campaignId,mode:prev||'grid'})}`);
console.log(`battle mode restored to: ${prev||'grid'}`);
if (!out?.ok) { console.error(`FAILED after ${secs}s: ${out?.error}`); ws.close(); process.exit(1); }
console.log(`\n=== plan in ${secs}s (${out.r.plan_text.length} chars, ${out.r.maps.length} maps) ===\n`);
console.log(out.r.plan_text);
ws.close(); process.exit(0);
