"""Does the app say everything the book says? — the direction no other sweep asks.

Every sweep here asks the same question: is what the app STATES supported by the book. None asks
the reverse, and that leaves one whole class of bug invisible. A description that drops a clause
loses tokens, and "the app claims fewer things than the source" reads as clean in every report we
have. Lance and Net were both that shape — every number correct, an entire rule missing.

What this can and cannot see, stated up front because the distinction is the whole point:

  CAN   the book's entry quantifies something and the app is silent on it entirely — a die, a
        fixed DC, a save ability, a rest type, a damage type, a distance.
  CANNOT a rule with no number in it. Lance's "requires two hands unless mounted" and Net's "only
        one attack regardless of Extra Attack" produce no MECH token, so THIS TOOL WOULD NOT HAVE
        FOUND EITHER OF TODAY'S TWO BUGS. It is a different net, not a finer one.

The comparison is per KIND, not per token. "The book states 3d6 and the app states 2d6" is the
forward sweep's job and it already does it well; asking the same question backwards would just
re-report every forward finding with the sides swapped. What is new is "the book's entry states a
DC and the app's text contains no DC at all" — silence, not disagreement.

The app's structured fields count as things the app says. A spell keeps its damage type in
`damageType` and its save in `savingThrow`, so judging the description alone would report every
spell in the game as omitting both.

SPELLS ONLY. Items were built, measured and rejected — the numbers are in KNOWN LIMITS below.

Usage: ENTITY_BUNDLE=<bundle.mjs> python tools/audit/completeness.py <kind> [book]
       ... --control [--plausible]

KNOWN LIMITS
  items   Does not work and no knob fixes it. DMG magic items are printed shoulder to shoulder,
          which the forward sweep already documents as something no character width can separate.
          Harmless there — a neighbour's tokens only make the app's own claim easier to support.
          Fatal here, where every neighbour token becomes "the app is silent on this". Priced
          across the whole clearance range and the two numbers never separate:
            clearance   25    40    60    90   120
            flagged    51%   53%   53%   55%   56%
            impossible 78%   83%   83%   85%   85%
            plausible  43%   46%   48%   50%   50%
          A sweep that flags half its population is not a finding list. What items would need is a
          bound that is not a character offset at all — the next entry's own rarity line, the way
          itemtable.py bounds a table row at the next cost.
  PHB equipment  253 entries whose whole content is a table row. No prose entry exists to be
          complete or incomplete against; itemtable.py and itemweight.py cover their real claims.
"""
import bisect
import os
import re
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(__file__))
import entitypdf as E  # noqa: E402
from racepdf import mech_tokens  # noqa: E402

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

# Which kinds are worth asking about. Each maps a normalised MECH token to a bucket; a token that
# matches nothing is ignored rather than silently lumped in.
KINDS = [
    ('die',      re.compile(r'^\d+d\d+$')),
    ('distance', re.compile(r'^\d+ft$')),
    ('dc',       re.compile(r'^dc\d+$')),
    ('rest',     re.compile(r'^(?:short|long)rest$')),
    ('damage',   re.compile(r'^(?:acid|cold|fire|force|lightning|necrotic|poison|psychic|radiant'
                            r'|thunder)damage$')),
    ('ability',  re.compile(r'^(?:strength|dexterity|constitution|intelligence|wisdom'
                            r'|charisma)$')),
]
# Deliberately NOT checked: bonusaction, reaction, advantage, disadvantage, resistance, immunity,
# proficiencybonus. Rulebook prose says all of these constantly about things that are not the
# entry — "you have advantage on the next attack", "as a bonus action" appears in the neighbouring
# column — so the book side is never silent on them and the check degenerates into flagging every
# entry that does not happen to repeat the phrase. Measured before dropping: see --by-kind.


# mech_tokens SYNTHESISES these when a book says "your spell save DC" — they are markers that the
# shorthand was used, not values the source states. Fine for the forward sweep, which only ever
# uses them to support an app claim; wrong here, where "the book states a DC the app omits" would
# be true of every entry whose prose happens to use the phrase. 15 of the first 19 dc findings
# were this one token.
SYNTHETIC = {'dc8', 'proficiencybonus'}


def kinds_of(tokens):
    out = {}
    for t in tokens - SYNTHETIC:
        for name, rx in KINDS:
            if rx.match(t):
                out.setdefault(name, set()).add(t)
                break
    return out


# Structured fields are the app speaking too — a spell states its range in `range`, not in prose.
FIELDS = ('damageType', 'savingThrow', 'range', 'duration', 'castingTime')


def app_text(e):
    """Everything the app says about this entry, including its structured fields."""
    parts = [e.get('d') or '']
    for f in FIELDS:
        if e.get(f):
            parts.append(str(e[f]))
    return '\n'.join(parts)


def tight_span(e, ctx, marks):
    """The entry and nothing but the entry.

    The forward sweep reads a 1,500-character window that reaches 200 back and freely overruns
    into the next entry, and that is correct for it. Reused here it reported 82% of spells as
    incomplete: Guidance, a cantrip that does nothing but add 1d4, came back "the book states
    radiant damage, 4d6 and 15 ft" — Sacred Flame and its other neighbours, read through the
    window. So: start AT the entry (never before it — anything earlier belongs to the previous
    entry) and stop at the next entry's own start mark.
    """
    idx, pos = ctx['idx'], ctx['pos']
    end = min(len(idx) - 1, pos + max(len(E.flat(e.get('d') or '')) * 2, ctx['kn']['width']))
    # Skip the marks belonging to THIS entry. A spell is anchored at its NAME and its own Casting
    # Time line sits a few characters later, so bounding at the very next mark gave a ~20-character
    # window: 0 findings AND 0% detection on both controls — the quiet failure that reads as a
    # clean result.
    #
    # Items needed it too, contrary to the first guess that they are anchored at the mark itself
    # and so need no clearance. Item marks are built from name VARIANTS, so "Belt of Giant
    # Strength" and "Giant Strength" both mark the same heading: median DMG window 7 characters,
    # 210 of 265 under 200, and 8% detection. Measuring the window widths said in one line what
    # the control could only say as a number.
    #
    # Structural, not a character floor. A 300-character floor was tried first and it silently ate
    # the bound of every SHORT entry: Misty Step is ~250 characters, so its own end mark fell
    # inside the floor, the window ran on to the entry after next, and Misty Step was reported for
    # Modify Memory's Wisdom save. Counting marks cannot mis-handle a short entry; a distance can.
    nxt = bisect.bisect_right(marks, pos + MIN_ENTRY)
    if nxt < len(marks):
        end = min(end, marks[nxt])
    return ctx['raw'][idx[pos]: idx[end]]


def make_judge(bucket, only_kind=None, judged=None):
    marks_cache = {}

    def judge(e, spans, ctx):
        key = e['book']
        if key not in marks_cache:
            # Items already publish their entry starts; spells' equivalent is the Casting Time /
            # school line that spell_entry anchors on.
            marks_cache[key] = sorted(ctx['bounds']) if ctx['bounds'] else sorted(
                E._ct_marks(key, ctx['book'])) if e['kind'] == 'spell' else []
        marks = marks_cache[key]
        if judged is not None:
            judged.add(e['name'])
        # source=True on the APP side, which looks wrong and is not. mech_tokens is generous
        # reading a book and strict reading the app, because the forward question is "is the app's
        # claim supported" and a lenient app side would invent support. The reverse question is
        # "does the app say it", so the generosity has to flip with it: Guidance, Bless, Resistance
        # and Blink all write "roll a d4"/"roll a d20" where the book writes 1d4/1d20, and reading
        # the app strictly reported four of the most common spells in the game as missing the die
        # they are entirely about.
        app = kinds_of(mech_tokens(app_text(e), source=True))
        book = {}
        for seg in ([tight_span(e, ctx, marks)] if marks else spans):
            for k, v in kinds_of(mech_tokens(seg, source=True)).items():
                book.setdefault(k, set()).update(v)
        # Silence, not disagreement: the book states this kind and the app states NONE of it.
        gap = sorted(k for k in book if k not in app and (only_kind is None or k == only_kind))
        if not gap:
            return None
        bucket.append((e['name'], e['book'], gap,
                       {k: sorted(book[k])[:3] for k in gap}))
        return ('APP SILENT ON', e['name'], e['book'], '',
                'book states ' + ', '.join(f'{k} ({", ".join(sorted(book[k])[:3])})' for k in gap))
    return judge


# Clearance past a spell's own header, priced rather than picked. Detection is flat across the
# whole range and only the finding count moves, so the low end wins outright:
#   80  -> 105 findings, 92% / 73%      220 -> 109 findings, 93% / 73%
#   120 -> 106 findings, 92% / 73%      300 -> 125 findings, 94% / 74%
# 160 -> 106 findings, 92% / 73%. Set at 120: same numbers as 80 with a little margin over the
# longest header line.
MIN_ENTRY = 120

SENT = re.compile(r'(?<=[.!?])\s+')


def corrupt(rows, plausible):
    """Corruption here is DELETION — the bug shape this sweep exists to find."""
    out, changed = [], set()
    for e in rows:
        d = e.get('d') or ''
        if not mech_tokens(d):
            out.append(e)
            continue
        if plausible:
            # Drop ONE sentence that carries a mechanic, keeping the rest intact. This is exactly
            # what a truncated entry looks like: Lance kept its die, its damage type and its reach
            # and lost one clause.
            sents = SENT.split(d)
            idx = next((i for i, s in enumerate(sents) if mech_tokens(s)), None)
            if idx is None:
                out.append(e)
                continue
            n = ' '.join(sents[:idx] + sents[idx + 1:])
        else:
            # Strip every mechanic. Nothing subtle: if the sweep cannot see this it cannot see
            # anything.
            n = E.MECH.sub('', d) if hasattr(E, 'MECH') else re.sub(
                r'\b\d+d\d+\b|\b\d+\s*(?:feet|foot|ft)\b|\bdc\s*\d+\b'
                r'|\b(?:short|long)\s+rest\b'
                r'|\b(?:acid|cold|fire|force|lightning|necrotic|poison|psychic|radiant|thunder)'
                r'\s+damage\b'
                r'|\b(?:strength|dexterity|constitution|intelligence|wisdom|charisma)\b', '', d,
                flags=re.I)
        e2 = dict(e, d=n)
        # A structured field the app still carries is still the app speaking, so the control has
        # to blank those too or it is corrupting a copy while the original answers for it.
        for f in FIELDS:
            if e2.get(f):
                e2[f] = None
        if n != d or any(e.get(f) for f in FIELDS):
            changed.add(e['name'])
        out.append(e2)
    return out, changed


def run(rows, only, only_kind=None):
    """Findings, plus the set of entries the sweep actually reached.

    The reached set is not bookkeeping — it is the control's denominator. Scoring a corruption the
    sweep never looked at as a miss reported DMG items at 2% detection, because `corrupt` ran over
    all 785 items while the sweep was restricted to one book's 265. A probe that cannot see all of
    what it measures reports the shortfall as a failure of the thing measured.
    """
    bucket, judged = [], set()
    E.sweep(rows, only=only, judge=make_judge(bucket, only_kind, judged))
    return bucket, judged


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if not args:
        sys.exit(__doc__)
    kind = args[0]
    only = args[1] if len(args) > 1 else None
    rows = [dict(r, kind=kind) for r in E.entities(kind)]

    if '--control' in sys.argv:
        mode = 'plausible' if '--plausible' in sys.argv else 'impossible'
        bad, changed = corrupt(rows, mode == 'plausible')
        bad_found, _ = run(bad, only)
        base_found, reached = run(rows, only)
        flagged = {n for n, _, _, _ in bad_found}
        base = {n for n, _, _, _ in base_found}
        changed &= reached
        # An entry the CLEAN run already flags cannot demonstrate detection: it would be reported
        # whether or not the corruption landed. Scoring those as hits is how fighting styles read a
        # false 100%.
        testable = changed - base
        det = testable & flagged
        print(f'CONTROL[{mode}]: {len(testable)} corrupted, reached and not already '
              f'flagged, '
              f'{len(det)} detected ({100 * len(det) // max(1, len(testable))}%)')
        print(f'  excluded as already-flagged when clean: {len(changed & base)}')
        return

    found, _ = run(rows, only, args[2] if len(args) > 2 else None)
    per = Counter(k for _, _, gap, _ in found for k in gap)
    total = sum(1 for r in rows if not only or r['book'] == only)
    print(f'# completeness: {kind}{" [" + only + "]" if only else ""}\n')
    print(f'  entries          : {total}')
    print(f'  APP SILENT ON    : {len(found)}  ({100 * len(found) // max(1, total)}% of entries)')
    print(f'  by kind          : {dict(per)}\n')
    for nm, bk, gap, vals in found[:80]:
        print(f'  - {nm} [{bk}]: book states ' +
              '; '.join(f'{k} {vals[k]}' for k in gap))
    if len(found) > 80:
        print(f'  … {len(found) - 80} more')


if __name__ == '__main__':
    main()
