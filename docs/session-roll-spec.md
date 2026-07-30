# Bounding conversation history ("session rolling")

Status: **spec, not built.** Written 2026-07-29 off a measured 40-message run.

## What the measurement says

40 chained messages against the real Curse of Strahd campaign, memory writes
applied between turns as the app applies them:

| turn | prompt | cache read | cache write | standing block | history |
|-----:|-------:|-----------:|------------:|---------------:|--------:|
| 1  | 37,896 |  2,131 | 35,762 | 27,784 | 10,112 |
| 10 | 56,743 | 53,467 |  3,273 | 27,784 | 28,959 |
| 20 | 66,118 | 63,778 |  2,337 | 27,847 | 38,271 |
| 30 | 74,504 | 74,188 |    313 | 27,847 | 46,657 |
| 40 | 79,589 | 78,974 |    612 | 28,043 | 51,546 |

Total $3.71, $0.093/message. First quarter $0.146/msg, last quarter $0.089/msg.

Two findings, one of which killed the previous plan:

1. **The standing block is flat and cheap.** 27,784 → 28,043 over forty
   messages, and after warmup it is almost entirely cache *reads* at a tenth
   the cost. Every "trim the always-loaded files" idea targets this. Folding
   the ~15 stub chapters would save ~1% of a turn-40 prompt. Not the problem.
2. **History is the only thing growing.** 10,112 → 51,546, dead linear at
   ~1,050 tokens/message, unbounded. By message 40 it is 1.8× the standing
   block. It raises the prompt on every turn AND raises the cost of every cache
   miss, because there is more to re-write.

Misses land every 5–7 turns at $0.25–0.33; turns between them cost $0.03.

## The idea

The campaign already has a continuity mechanism that is not the transcript:
`entities.md`, `locations.md`, `flagged_facts.md`, `party.md`, `MEMORY.md`,
`standing.md`. They exist so the DM remembers across sessions. Within a session
the verbatim conversation duplicates that job — and it is the expensive copy.
Fifty thousand tokens of transcript to remember what four small registries
already hold.

So: periodically end the CLI session and start a fresh one. History resets to
near zero, the prompt drops back to ~30k, and continuity comes from the files
that reload anyway plus a short handoff.

## THE COST MODEL SAYS DON'T DO THIS TOO EARLY

This is the part that has to survive review, because the naive version makes
things worse.

Rolling re-pays the warmup. Turns 1–4 of the measured run cost $0.24–0.35 each
because the 28k standing block had to be written to cache. Turns 25–40 cost
$0.03. **A session that rolls every 10 turns pays first-quarter prices
($0.146/msg) forever instead of settling to last-quarter prices ($0.089/msg).**

Modelled per 30 turns, using measured rates:

| | hits | misses | roll overhead | total |
|---|---|---|---|---|
| rolled, steady prompt ~54k | 25 × $0.016 | 5 × $0.15 | ~$0.13 | **~$1.28** |
| unrolled, around turn 100 (prompt ~143k) | 25 × $0.043 | 5 × $0.44 | — | **~$3.28** |

Rolling wins ~2.5× *at turn 100*. Around turn 40 it is break-even or slightly
worse. **Break-even is roughly turn 40–50**, so the trigger must be a history
threshold near that, not a small turn count.

Proposed trigger: **roll when history exceeds ~45,000 tokens** (about turn 40
from cold). A 150-message session then rolls ~3 times and the prompt oscillates
38k→80k instead of climbing to ~195k.

## Design

**Trigger.** After a turn completes, estimate history as
`(cache_read + cache_write + input) − standing_block_size`. Both halves are
already available: the CLI returns usage in its JSON, and the standing block is
just the byte size of `CLAUDE.md` plus its imports. No new model call to decide.

**Guards — never roll when:**
- a battle is active (`battleLog` non-null). Initiative order, positions and
  mid-round HP live in the transcript and nowhere else.
- the DM asked for something that lands next turn (`recallSession`,
  `recallMap`, `recallChapter`, a pending `makeMap`). The stash is keyed to the
  next turn of the current session.
- a turn is in flight.

Defer to the next eligible turn rather than skipping. Out of combat, mid-scene
is survivable if the handoff is good; mid-round is not.

**The handoff.** One cheap call (`sonnet`, low effort) before the roll:

> Summarise the current moment for a DM picking this scene up cold: where the
> party physically is, who is present and what they want, what was just said or
> done, what question is hanging, and anything true right now that isn't in the
> campaign's memory files. Six sentences. No plot recap — the files have that.

Stash the result and prepend it to the first turn of the new session, labelled
as "where we are right now", the same shape `recalledSession` already uses.

**What carries over for free:** everything in `CLAUDE.md` and its imports. That
is the whole point — the registries are the durable memory and they reload
automatically on the fresh session.

**Failure mode.** If the handoff call fails, do not roll. A failed roll costs
nothing; a roll with no handoff drops the party mid-scene.

## Risks

- **The seam.** The DM may repeat itself or re-describe a room. Six sentences
  may not be enough. This is the thing to measure, not reason about.
- **Trigger thrash.** History estimation is approximate (bytes/4). Add
  hysteresis: after a roll, don't consider another for at least 10 turns.
- **`--resume` chain identity.** `sessionIdRef` is the app's handle on the CLI
  conversation; rolling replaces it. Anything else keyed to that id (streaming
  listeners, the local-LLM `end_local_dm_session` path) has to move with it.

## Validating it

Do not ship on the model above. The 40-message harness
(`scratchpad/burn40.py`) already produces the table; extend it to roll at the
threshold and compare:

1. **Cost:** same 40 messages, rolled vs not. Expect no better than parity at
   40 — the win should appear at 80–120, so run those too.
2. **Continuity:** read the three turns after a roll. Does the DM repeat a
   description, forget who it was talking to, or lose the hanging question?
   That is a read-the-output judgement, not a number.
3. **The guard:** force a roll mid-combat in a test and confirm it defers.

If continuity survives and cost drops at 100 messages, ship it. If the seam is
visible, the fallback is a larger threshold — fewer, later rolls — rather than
a better summary.
