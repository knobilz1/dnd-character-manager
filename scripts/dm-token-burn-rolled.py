"""Does session rolling actually help? Same 40 messages as burn40.py, but end
the CLI session and start fresh once history crosses a threshold.

Two questions burn40 could not answer:
  1. cost at 40 rolled vs unrolled. The spec's model predicts PARITY OR WORSE
     at 40 (rolling re-pays cache warmup), with the win only at 80-120. If
     rolled comes out clearly cheaper at 40, the model is wrong and I need to
     know that before building anything.
  2. does the DM lose the thread across the seam? Not a number. So every reply
     is written to _replies.md to be read afterwards.

Control numbers from the unrolled run of the same 40 lines:
  total $3.71, $0.093/msg, first quarter $0.146, last quarter $0.089,
  history 10,112 -> 51,546, prompt 37,896 -> 79,589.
"""
import json, re, subprocess, shutil, os

SRC = r"C:\Users\nabil\AppData\Roaming\com.nabil.dndsheet\campaigns\curse-of-strahd"
W = r"C:\Users\nabil\AppData\Local\Temp\claude\burnroll"

# history tokens, not turns. From the unrolled table this fires around turn 26.
ROLL_AT = 45_000
COOLDOWN = 10  # turns before another roll is considered (hysteresis, per spec)

STANDING = [
    "CLAUDE.md", "memory/MEMORY.md", "memory/session_index.md", "memory/flagged_facts.md",
    "memory/entities.md", "memory/locations.md", "memory/party.md",
    "memory/battle_maps/index.md", "memory/dm_rules.md", "modules_index.md",
    "active_module/index.md", "active_module/standing.md", "active_module/current.md",
]

HANDOFF = (
    "Summarise the current moment for a DM picking this scene up cold: where the "
    "party physically is, who is present and what they want, what was just said or "
    "done, what question is hanging, and anything true right now that isn't in the "
    "campaign's memory files. Six sentences. No plot recap - the files have that. "
    "Reply with the summary only, no preamble and no dm-actions block."
)

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
    'Something is moving out there. I ready my axe.',
    'I attack it - swinging for the nearest shape.',
    'Is it down? I check the body.',
    'I search whatever it was carrying.',
    'We keep moving toward the town we heard about.',
    'I want to see the town gates before we approach.',
    'I hail the guards and ask to be let in.',
    'I ask the guards what the rules are inside the walls.',
    'We find the inn. I ask the innkeeper for two rooms.',
    'I buy a round and try to get people talking.',
    'I ask about the family that runs this place.',
    'I ask whether anyone here has seen a Vistani camp.',
    'I want to find the local market before it closes.',
    'I ask a shopkeeper what sells and what does not, here.',
    'Sera asks quietly whether anyone is afraid of the burgomaster.',
    'I offer to help with whatever is troubling them.',
    'We take the job, whatever it is. What are we being asked to do?',
    'I want to prepare before we set out - what can we get hold of?',
    'We head out at first light. I take point.',
    'I watch for tracks on the way.',
    'We reach the place. I want to look it over before going in.',
    'I go in first, shield up.',
]

PARTY = ("Party status:\n"
         "- Thorin (Level 3 Dwarf Fighter) - HP 24/28, no conditions\n"
         "- Sera (Level 3 Half-Elf Ranger) - HP 22/22, no conditions\n\n")


def upsert(path, name, desc):
    try:
        txt = open(path, encoding="utf-8", errors="replace").read()
    except FileNotFoundError:
        txt = ""
    line = f"- **{name}:** {desc}"
    out, hit = [], False
    for l in txt.splitlines():
        if l.strip().lower().startswith(f"- **{name.strip().lower()}:**"):
            out.append(line); hit = True
        else:
            out.append(l)
    if not hit:
        out.append(line)
    open(path, "w", encoding="utf-8").write("\n".join(out) + "\n")


def apply_actions(reply):
    m = re.search(r"```dm-actions\s*([\s\S]*?)```", reply)
    if not m:
        return 0
    try:
        a = json.loads(m.group(1))
    except Exception:
        return 0
    n = 0
    for e in a.get("rememberEntity", []) or []:
        if e.get("name"):
            upsert(os.path.join(W, "memory", "entities.md"), e["name"], e.get("description", "")); n += 1
    for e in a.get("rememberLocation", []) or []:
        if e.get("name"):
            upsert(os.path.join(W, "memory", "locations.md"), e["name"], e.get("description", "")); n += 1
    for f in a.get("remember", []) or []:
        open(os.path.join(W, "memory", "flagged_facts.md"), "a", encoding="utf-8").write(f"- **2026-07-29:** {f}\n"); n += 1
    return n


def standing_tokens():
    total = 0
    for rel in STANDING:
        p = os.path.join(W, *rel.split("/"))
        try:
            total += os.path.getsize(p)
        except OSError:
            pass
    return total // 4  # ~4 chars/token


def run(prompt, sid):
    args = ["claude", "-p", "--output-format", "json", "--model", "sonnet", "--tools", ""]
    if sid:
        args += ["--resume", sid]
    p = subprocess.run(args, input=prompt, capture_output=True, text=True,
                       encoding="utf-8", errors="replace", cwd=W, shell=True)
    try:
        return json.loads(p.stdout)
    except Exception:
        print("FAILED:", p.stdout[:300], p.stderr[:300]); return None


missing = [r for r in STANDING if not os.path.exists(os.path.join(SRC, *r.split("/")))]
shutil.rmtree(W, ignore_errors=True)
shutil.copytree(SRC, W)
rep = open(os.path.join(W, "_replies.md"), "w", encoding="utf-8")
print(f"copied -> {W}")
if missing:
    print(f"WARNING missing standing files (standing size understated): {missing}")
print(f"standing block at start: {standing_tokens():,} tokens   roll when history > {ROLL_AT:,}\n")
print(" turn | prompt | read   | write  |  out | standing | history | writes | $")

sid, rows, carry, last_roll, rolls = None, [], None, -99, []
for i, line in enumerate(LINES, 1):
    st = standing_tokens()
    msg = PARTY + line
    if carry:
        msg = f"Where we are right now:\n{carry}\n\n" + msg
        carry = None
    d = run(msg, sid)
    if not d:
        break
    sid = d.get("session_id", sid)
    u = d["usage"]
    prompt = u["cache_read_input_tokens"] + u["cache_creation_input_tokens"] + u["input_tokens"]
    hist = max(0, prompt - st)
    reply = d.get("result", "")
    n = apply_actions(reply)
    cost = d.get("total_cost_usd", 0)
    rows.append(dict(turn=i, prompt=prompt, read=u["cache_read_input_tokens"],
                     write=u["cache_creation_input_tokens"], out=u["output_tokens"],
                     standing=st, history=hist, writes=n, cost=cost))
    rep.write(f"\n\n## turn {i}\n\n**player:** {line}\n\n{reply}\n")
    rep.flush()
    print(f" {i:>4} | {prompt:>6,} | {rows[-1]['read']:>6,} | {rows[-1]['write']:>6,} | "
          f"{u['output_tokens']:>4,} | {st:>8,} | {hist:>7,} | {n:>6} | {cost:.3f}")

    if hist > ROLL_AT and i - last_roll >= COOLDOWN and i < len(LINES):
        h = run(HANDOFF, sid)
        if h and h.get("result"):
            carry, last_roll = h["result"].strip(), i
            rolls.append(dict(after=i, cost=h.get("total_cost_usd", 0), summary=carry))
            rows[-1]["cost"] += h.get("total_cost_usd", 0)  # roll overhead billed to the roll turn
            sid = None
            rep.write(f"\n\n### ROLL after turn {i} - handoff (${h.get('total_cost_usd',0):.3f})\n\n{carry}\n")
            rep.flush()
            print(f"      >> ROLL after turn {i}: handoff ${h.get('total_cost_usd',0):.3f}, "
                  f"{len(carry)} chars, session reset")
        else:
            print(f"      >> handoff FAILED after turn {i} - not rolling (per spec)")

rep.close()
if rows:
    n = len(rows)
    tot = sum(r["cost"] for r in rows)
    print(f"\n===== {n} messages, ROLLED =====")
    print(f"total cost      : ${tot:.2f}   (${tot/n:.3f}/message)")
    print(f"cache read total: {sum(r['read'] for r in rows):,}")
    print(f"cache write tot : {sum(r['write'] for r in rows):,}")
    print(f"rolls           : {len(rolls)}  at turns {[r['after'] for r in rolls]}  "
          f"overhead ${sum(r['cost'] for r in rolls):.2f}")
    q = max(1, n // 4)
    for lab, sl in (("first quarter", rows[:q]), ("last quarter", rows[-q:])):
        m = len(sl)
        print(f"{lab:>14}: prompt {sum(r['prompt'] for r in sl)//m:>7,}  "
              f"history {sum(r['history'] for r in sl)//m:>7,}  "
              f"write {sum(r['write'] for r in sl)//m:>7,}  ${sum(r['cost'] for r in sl)/m:.3f}/msg")
    print(f"standing block: {rows[0]['standing']:,} -> {rows[-1]['standing']:,} tokens")
    print(f"\ncontrol (unrolled, same 40 lines): $3.71  $0.093/msg  "
          f"history 10,112->51,546  prompt 37,896->79,589")
    print(f"delta: ${tot-3.71:+.2f}  ({(tot/3.71-1)*100:+.0f}%)")
    json.dump(dict(rows=rows, rolls=rolls), open(os.path.join(W, "_burnroll.json"), "w"), indent=1)
    print(f"\nreplies -> {os.path.join(W, '_replies.md')}")
