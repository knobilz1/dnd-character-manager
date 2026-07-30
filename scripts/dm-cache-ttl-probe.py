"""Where is the prompt-cache cliff? Every burn number so far assumed turns
~20s apart. Real play has minutes between DM calls. If the cache expires in
that gap, every turn is a miss and the cheap-tail story is fiction.

Warm the cache, then insert a measured gap and see whether the next turn reads
the cache or rewrites it. Re-settle between probes so each gap starts hot.

A HIT looks like  read~60k write<2k.  A MISS looks like  write>20k.
"""
import json, re, subprocess, shutil, os, time

SRC = r"C:\Users\nabil\AppData\Roaming\com.nabil.dndsheet\campaigns\curse-of-strahd"
W = r"C:\Users\nabil\AppData\Local\Temp\claude\ttlprobe"
GAPS = [60, 180, 360, 600]  # seconds

LINES = [
    'We push through the gates into the village. I call out - anyone still alive?',
    'I keep my bow ready and watch the treeline behind us.',
    'I knock on the door of the nearest house that still has a roof.',
    'If someone answers I want to ask, gently, what happened here.',
    'I ask about the castle on the mountain. Who lives up there?',
    'I look for somewhere we can get out of this fog for the night.',
    'I want to buy supplies - rope, torches, whatever they will part with.',
    'I ask around about a road out of the valley.',
    'If anyone gives me a name, I write it down. Who should we talk to?',
    'We settle in for the night. I take first watch by the window.',
    'Morning. I want to look at the village square in daylight.',
    'I examine the church - is anyone tending it?',
    'I try to talk to the priest, if there is one.',
    'I ask whether anyone has gone missing recently.',
    'I want to check the graveyard for fresh graves.',
    'Sera scouts the road north while I stay with the horses.',
    'I listen for anything following us on the road.',
    'We make camp off the road. I set a tripwire.',
]
PARTY = ("Party status:\n"
         "- Thorin (Level 3 Dwarf Fighter) - HP 24/28, no conditions\n"
         "- Sera (Level 3 Half-Elf Ranger) - HP 22/22, no conditions\n\n")

_n = [0]


def run(sid):
    line = LINES[_n[0] % len(LINES)]
    _n[0] += 1
    args = ["claude", "-p", "--output-format", "json", "--model", "sonnet", "--tools", ""]
    if sid:
        args += ["--resume", sid]
    t0 = time.time()
    p = subprocess.run(args, input=PARTY + line, capture_output=True, text=True,
                       encoding="utf-8", errors="replace", cwd=W, shell=True)
    try:
        d = json.loads(p.stdout)
    except Exception:
        print("FAILED:", p.stdout[:300], p.stderr[:300], flush=True); return None, None
    u = d["usage"]
    return d, dict(read=u["cache_read_input_tokens"], write=u["cache_creation_input_tokens"],
                   cost=d.get("total_cost_usd", 0), secs=time.time() - t0)


shutil.rmtree(W, ignore_errors=True)
shutil.copytree(SRC, W)
print(f"copied -> {W}\nprobing gaps {GAPS} seconds\n", flush=True)
# NOTE: no dm-actions applied - a memory write also forces a miss (measured 6/6),
# which would be indistinguishable from a TTL expiry. Keep the files frozen.

sid = None
print("warming (5 turns back to back)", flush=True)
for i in range(5):
    d, r = run(sid)
    if not d:
        raise SystemExit(1)
    sid = d.get("session_id", sid)
    print(f"  warm {i+1}: read {r['read']:>7,} write {r['write']:>7,} ${r['cost']:.3f}", flush=True)

print("\n gap  | read    | write   | verdict | $", flush=True)
out = []
for g in GAPS:
    time.sleep(g)
    d, r = run(sid)
    if not d:
        break
    sid = d.get("session_id", sid)
    miss = r["write"] > 20_000
    out.append(dict(gap=g, **r, miss=miss))
    print(f" {g:>4}s | {r['read']:>7,} | {r['write']:>7,} | {'MISS   ' if miss else 'hit    '} | {r['cost']:.3f}",
          flush=True)
    for _ in range(2):  # re-settle so the next gap starts from a hot cache
        d, r2 = run(sid)
        if d:
            sid = d.get("session_id", sid)

json.dump(out, open(os.path.join(W, "_ttl.json"), "w"), indent=1)
hits = [o["gap"] for o in out if not o["miss"]]
misses = [o["gap"] for o in out if o["miss"]]
print(f"\nsurvived: {hits}s     expired: {misses}s", flush=True)
if misses and hits:
    print(f"cliff is between {max(hits)}s and {min(misses)}s", flush=True)
elif not misses:
    print("cache survived every gap tested - pacing is not a cost factor", flush=True)
else:
    print("cache expired at every gap tested - real play is ALL misses", flush=True)
