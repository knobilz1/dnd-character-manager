"""Judge ANY entitypdf finding by pairing like with like, instead of asking whether a token is present.

itemclaims.py did this for items and proved the idea: 278 findings -> 22 judgeable -> 3 real. It
also hardwired the item locator, so spells and backgrounds could not use it. This one goes through
`entitypdf.sweep`'s `judge` seam instead, so it reuses whatever locator that kind already has — the
sixth near-copy of that locator is exactly what the README says not to write.

The token sweep is a FILTER. It answers "is the app's value in this window", which is equally false
when the app is wrong and when the book worded it differently. Exact text comparison can't settle
that either — the app paraphrases, so a diff flags everything. What settles it is pairing within a
KIND: if the app claims a die and the entry states exactly one die, those two are talking about the
same thing and can be compared directly.

Verdicts, in the order they are worth a human's time:
  CONFLICT   entry states exactly one value of that kind and it is NOT the app's   <- likely bug
  AMBIGUOUS  entry states several; cannot pair without reading                     <- needs a human
  PRESENT    the app's value IS in the entry; the sweep's window missed it         <- tool artifact
  ABSENT     entry states no value of that kind at all                             <- unjudgeable

Prints values only, never book prose, so the copyright rule holds while still being decisive.

Usage: ENTITY_BUNDLE=<bundled .mjs> python tools/audit/claims.py --kind=spell [book]
"""
import bisect
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
import entitypdf as E  # noqa: E402
from racepdf import debook  # noqa: E402

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

# Each token kind, and how to read every value of that kind out of the book. Pairing is only
# meaningful WITHIN a kind: a die can be compared with a die, never with a distance. Tokens with no
# entry here (ability names, damage types, "advantage", "bonusaction") are deliberately unjudgeable
# — the book states them in prose the app paraphrases, so absence proves nothing.
KINDS = (
    ('die', re.compile(r'^\d+d\d+$'), re.compile(r'\b\d+d\d+\b')),
    ('distance', re.compile(r'^\d+ft$'), re.compile(r'\b(\d+)\s*(?:feet|foot|ft)\b')),
    ('dc', re.compile(r'^dc\d+$'), re.compile(r'\bDC\s*(\d+)\b', re.I)),
)


def kind_of(tok):
    for name, is_tok, _ in KINDS:
        if is_tok.match(tok):
            return name
    return None


def book_values(kind, seg):
    for name, _, rx in KINDS:
        if name == kind:
            return sorted({(m.group(0) if name == 'die' else
                            (m.group(1) + 'ft' if name == 'distance' else 'dc' + m.group(1)))
                           .lower().replace(' ', '')
                           for m in rx.finditer(seg)})
    return []


def main():
    kind = 'spell'
    only = None
    for a in sys.argv[1:]:
        if a.startswith('--kind='):
            kind = a.split('=', 1)[1]
        elif not a.startswith('-'):
            only = a

    rows = E.entities(kind)
    out = {'CONFLICT': [], 'AMBIGUOUS': [], 'PRESENT': [], 'ABSENT': [], 'UNPAIRABLE': []}

    def judge(e, spans, ctx):
        """Reproduce the default comparison, then pair each surviving gap token against the entry.

        Deliberately NOT a second locator: `spans` and `ctx` are what the sweep itself used, so a
        verdict here is about the same window the finding came from. Anything else would be judging
        a different question from the one that was asked.
        """
        want = E.mech_tokens(e['d'])
        if not want:
            return None
        have = set()
        for seg in spans:
            have |= E.mech_tokens(seg, source=True)
        gap = sorted(t for t in want if t not in have)
        if not gap:
            return None

        # The entry itself: from its anchor to the next entry's own header, exactly as the sweep
        # bounds it. Falling back to the sweep's own width keeps an unbounded kind judgeable.
        raw, idx, pos = ctx['raw'], ctx['idx'], ctx['pos']
        end = pos + max(len(E.flat(e['d'])) * 2, ctx['kn']['width'])
        if ctx['bounds']:
            nxt = bisect.bisect_right(ctx['bounds'], pos)
            if nxt < len(ctx['bounds']):
                end = min(end, ctx['bounds'][nxt])
        seg = debook(raw[idx[pos]: idx[min(len(idx) - 1, end)]])

        for tok in gap:
            k = kind_of(tok)
            if k is None:
                out['UNPAIRABLE'].append((e['name'], e['book'], tok, []))
                continue
            vals = book_values(k, seg)
            tag = ('PRESENT' if tok in vals else
                   'ABSENT' if not vals else
                   'CONFLICT' if len(vals) == 1 else 'AMBIGUOUS')
            out[tag].append((e['name'], e['book'], tok, vals))
        return None  # judged, not re-reported

    stats, _, _, located, unlocated, nobook = E.sweep(rows, only, judge=judge)
    print(f'# {kind}s — {located} located, {unlocated} unlocated, {nobook} without a PDF')

    for tag in ('CONFLICT', 'AMBIGUOUS', 'PRESENT', 'ABSENT', 'UNPAIRABLE'):
        lst = out[tag]
        print(f'\n## {tag} ({len(lst)})')
        for nm, bid, tok, vals in lst[:60]:
            print(f'  - {nm} [{bid}] app {tok} | entry has {vals or "none"}')
        if len(lst) > 60:
            print(f'  … {len(lst) - 60} more')


if __name__ == '__main__':
    main()
