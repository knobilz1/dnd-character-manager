# Bounding conversation history ("session rolling")

Status: **measured 2026-07-29. Not building it.** Continuity survives a roll —
that part works. The cost case does not. Numbers below; re-run the harness
before revisiting, because every one of these is model- and CLI-dependent.

## Verdict

| question | answer |
|---|---|
| Does the DM lose the thread across a roll? | **No.** Seam invisible. See "The seam". |
| Does rolling save money at 40 messages? | **No — it costs $0.70 more over the 10 turns after the roll.** |
| Would it save money eventually? | Only past ~100 messages, and the estimate is inside the noise. |

Three assumptions in the original spec were wrong, all in the same direction:

1. **Roll overhead is ~5× what was budgeted.** Assumed ~$0.13 (one handoff
   call). Measured $0.70. The handoff itself is trivial ($0.028) — the cost is
   that a fresh session *thrashes for 6–9 turns* before its prefix restabilises,
   exactly like turns 1–4 of a cold start. 6 of the 10 turns after the roll were
   cache misses, against 2 for the control.
2. **Unrolled history grows at 462 tok/turn, not 1,050.** The 1,050 figure
   averaged in turn 1, whose reading is artificially low. Over settled turns
   21→40 it is 462/turn and decelerating. So the unrolled prompt at turn 100 is
   ~107k, not the ~143k the break-even model assumed.
3. **Run-to-run noise is larger than the whole effect.** See below.

## The noise finding — this invalidates single-run A/B at this length

Turns 1–30 of both runs are *identical*: same inputs, same campaign, no roll
has happened yet. They should cost the same. They differ by **$1.09, or 39%**.

```
                                      control   rolled   delta
turns  1-30  (identical, no roll yet)   $2.81    $1.73   -1.09
turns 31-40  (rolled run has rolled)    $0.89    $1.59   +0.70
total                                   $3.71    $3.32   -0.39
```

The headline "-10%" is entirely this noise. Cache-miss cadence is not
reproducible between runs — control missed on turns 1,2,3,4,8,11,15,18,31,38;
the rolled run on 1,6,17 over the same first 30 turns. Nothing we control
explains it. **Any future comparison of this kind needs repeats, or a length
where the effect exceeds ~40%.**

The only trustworthy comparison is turns 31–40, where the runs genuinely
differ — and there rolling loses.

## Why it can't win at realistic session lengths

Rolling buys a smaller prompt: 66,409 vs 79,589 at turn 40, a 13,180-token gap
that then grows at 462/turn.

- saving per cache-hit turn: 13,180 × $0.30/1M = **$0.004**
- saving per cache miss: 13,180 × $3.75/1M = **$0.049**, ~1 miss per 6 turns

Against $0.70 to buy it. Integrating the widening gap, break-even lands
**60–100 turns after the roll** — a 130+ message session. A real session looks
like 40–80 DM exchanges, at which point rolling is pure loss.

## The seam (the part that did work)

Rolled at turn 30, history 45,104. Handoff was one `sonnet` call, $0.028,
1,031 chars, using the prompt in "Design" below. Turn 31 — brand new CLI
session, zero transcript — opened:

> Ismark nods slowly as you push back from the table. "It'll be dark soon.
> Bildrath's the only shop in the village…"

It knew who was in the room, that they were seated, and where the shop was.
Turn 33 then recalled Kolyan writing letters for help — established at turn 29
in the *dead* session and **not in the handoff summary**. It came back because
it is module text in `active_module/current.md`, which reloads every turn.
That is precisely the mechanism the idea was betting on, and it holds.

Side effect worth knowing: the fresh session immediately wrote three entities
to memory (Ismark, Bildrath, Parriwimple) that 30 turns of conversation had
never flushed. A roll acts as a memory-flush point.

So if rolling is ever needed for a *non-cost* reason — context-window limits on
a very long session — the continuity design below is validated and can be built
as written.

## What the numbers actually point at

Cache misses are ~67% of the bill ($2.50 of $3.71 over 40 turns, 10 misses at
$0.15–0.35). Miss *cost* is proportional to the prefix being rewritten, which
is standing block + history. Of the 27,784-token standing block,
`active_module/current.md` alone is 14,861 tokens — more than half.

Making that chapter recall-on-demand instead of always-loaded would cut ~20% of
the bill, roughly twice what rolling could deliver, with no continuity risk.
**But it is the chapter the DM is actively running**, so it is a straight
fidelity trade, and the standing instruction is lose no fidelity. Not proposed
— recorded because it is where the arithmetic leads.

## Harness caveat found while doing this

`prompt = cache_read + cache_creation + input` is **not monotonic** and is only
trustworthy on clean cache-hit turns (`write < 2k`). Control turn 8 reports
51,433 while turn 7 reported 61,062 and turn 9 read back 61,059 — a
conversation cannot shrink. Every per-turn prompt/history number taken from a
miss turn is junk. The comparisons above use hit turns only.

## Design (unbuilt, validated on continuity)

Kept because the continuity half is proven and would be reused verbatim.

**Trigger.** After a turn, estimate history as
`(cache_read + cache_write + input) − standing_block_size`, only on hit turns.
Threshold ~45,000 tokens — which from the measured table fires at **turn 30**,
not "about turn 40" as the first draft of this spec claimed.

**Guards — never roll when:**
- a battle is active (`battleLog` non-null); initiative, positions and mid-round
  HP live in the transcript and nowhere else
- something lands next turn (`recallSession`, `recallMap`, `recallChapter`, a
  pending `makeMap`) — the stash is keyed to the next turn of *this* session
- a turn is in flight

Defer to the next eligible turn rather than skipping.

**Handoff**, one cheap `sonnet` call before the roll:

> Summarise the current moment for a DM picking this scene up cold: where the
> party physically is, who is present and what they want, what was just said or
> done, what question is hanging, and anything true right now that isn't in the
> campaign's memory files. Six sentences. No plot recap — the files have that.

Prepend to the first turn of the new session as "Where we are right now:",
the shape `recalledSession` already uses. **If the handoff call fails, do not
roll** — a failed roll costs nothing, a roll without a handoff drops the party.

**Also unresolved:** `sessionIdRef` is the app's handle on the CLI conversation.
Rolling replaces it, so streaming listeners and the local-LLM
`end_local_dm_session` path have to move with it.

## Reproducing

- unrolled control: `scripts/dm-token-burn.py`
- rolled: `scripts/dm-token-burn-rolled.py` (writes every reply to
  `_replies.md` — read the turns either side of the roll, do not judge the seam
  from the cost table)

Both copy the live campaign to a temp dir first and never touch it. Re-run both
if the model, the CLI's cache behaviour, or the campaign size changes; every
conclusion here depends on all three.
